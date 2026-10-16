"""Direct Agents HTTP API calls through curl; no OpenAI SDK required."""
import json
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = 'proj_jtanwDH277T6LpGAyghNfzEs'
BASE = 'https://api.openai.com/v1/agents/sessions'


class AgentError(Exception):
    pass


def config(message):
    # Omit tools and other settings to inherit them from the saved definition.
    return {**json.loads((ROOT / 'server' / 'agent.json').read_text()),
            'environment': {'type': 'none'}, 'input': message, 'stream': True}


def headers():
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key:
        raise AgentError('Falta configurar OPENAI_API_KEY en el servidor.')
    # curl reads secrets from stdin, never from process arguments or web clients.
    values = [f'Authorization: Bearer {key}', f'OpenAI-Project: {PROJECT}',
              'OpenAI-Beta: agents=v1', 'Content-Type: application/json']
    return ''.join('header = ' + json.dumps(v) + '\n' for v in values)


def spawn(url, payload=None, header_file=None, stream=False):
    tmp = None
    command = ['curl', '--silent', '--show-error', '--fail-with-body',
               '--no-buffer', '--connect-timeout', '15', '--max-time', '180',
               '--config', '-']
    if header_file:
        command += ['--dump-header', header_file]
    if stream:
        command += ['-H', 'Accept: text/event-stream']
    if payload is not None:
        tmp = tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', delete=False)
        json.dump(payload, tmp, ensure_ascii=False)
        tmp.close()
        command += ['--data-binary', '@' + tmp.name,
                    '-H', 'Idempotency-Key: ' + str(uuid.uuid4())]
    command += [url]
    try:
        proc = subprocess.Popen(command, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        proc.stdin.write(headers().encode())
        proc.stdin.close()
        return proc, tmp.name if tmp else None
    except Exception:
        if tmp:
            os.unlink(tmp.name)
        raise


def request(url, payload=None):
    proc, tmp = spawn(url, payload)
    try:
        raw = proc.stdout.read()
        proc.wait()
        if proc.returncode:
            raise AgentError('La API rechazó la solicitud: ' + raw.decode(errors='replace')[:1500])
        return json.loads(raw)
    finally:
        proc.stdout.close()
        proc.stderr.close()
        if tmp:
            os.unlink(tmp)


def blocks(stream):
    data = []
    for raw in stream:
        line = raw.decode('utf-8', errors='replace').rstrip('\r\n')
        if line.startswith('data:'):
            data.append(line[5:].lstrip())
        elif not line and data:
            text = '\n'.join(data)
            data = []
            if text != '[DONE]':
                yield json.loads(text)


def run(message, session_id=None):
    headers()  # Fail before launching any subprocess when the key is missing.
    with tempfile.NamedTemporaryFile() as hf:
        if session_id:
            proc, tmp = spawn(BASE + '/' + session_id + '/events?stream=true',
                              header_file=hf.name, stream=True)
        else:
            proc, tmp = spawn(BASE, config(message), header_file=hf.name, stream=True)
        completed = False
        try:
            # Wait until the event stream is subscribed before sending follow-up.
            deadline = time.monotonic() + 25
            while True:
                response_headers = Path(hf.name).read_text(errors='replace')
                if 'content-type: text/event-stream' in response_headers.lower():
                    break
                if proc.poll() is not None or time.monotonic() > deadline:
                    body = proc.stdout.read(6000).decode(errors='replace') if proc.poll() is not None else ''
                    raise AgentError('No se pudo abrir la sesión. ' + body[:1500])
                time.sleep(.05)
            if session_id:
                request(BASE + '/' + session_id + '/events', {'events': [{
                    'type': 'agent.session.input.message',
                    'input': [{'role': 'user', 'content': [{'type': 'input_text', 'text': message}]}]
                }]})
            for event in blocks(proc.stdout):
                session_id = event.get('session_id') or event.get('session', {}).get('id') or session_id
                if session_id:
                    event['session_id'] = session_id
                yield event
                kind = event.get('type', '')
                if kind == 'agent.session.requires_action':
                    session = request(BASE + '/' + session_id)
                    for action in session.get('required_actions', []):
                        if action.get('type') == 'function_call':
                            # Catalog MCP calls are executed by OpenAI. No arbitrary local code.
                            request(BASE + '/' + session_id + '/events', {'events': [{
                                'type': 'agent.session.input.tool_result',
                                'turn_id': action['turn_id'], 'call_id': action['call_id'],
                                'success': False,
                                'error': 'No local handler configured for ' + action.get('name', '')
                            }]})
                        else:
                            raise AgentError('La sesión requiere configuración adicional: ' + action.get('type', 'unknown'))
                if kind in ('error', 'agent.session.failed', 'agent.session.environment.failed'):
                    raise AgentError('Error de la sesión: ' + json.dumps(event.get('error', {})))
                if kind in ('agent.session.turn.failed', 'agent.session.turn.cancelled') and not event.get('turn', {}).get('subagent_id'):
                    raise AgentError('El turno no se completó: ' + json.dumps(event.get('turn', {}).get('error', {})))
                if kind == 'agent.session.turn.completed' and not event.get('turn', {}).get('subagent_id'):
                    completed = True
                    break
            if not completed:
                raise AgentError('La conexión se interrumpió antes de terminar. No se reenvió el mensaje. Inicia una conversación nueva o revisa la sesión en OpenAI.')
        finally:
            if proc.poll() is None:
                proc.terminate()
            proc.wait()
            proc.stdout.close()
            proc.stderr.close()
            if tmp:
                os.unlink(tmp)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('message', nargs='?', default='Hola, ¿qué productos puedo comprar en Provipets Market?')
    parser.add_argument('--session')
    args = parser.parse_args()
    try:
        for event in run(args.message, args.session):
            print(json.dumps(event, ensure_ascii=False), flush=True)
    except (AgentError, OSError) as exc:
        print(str(exc), file=__import__('sys').stderr)
        raise SystemExit(1)
