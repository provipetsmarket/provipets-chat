import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
const agentConfig = JSON.parse(readFileSync(new URL('./agent.json', import.meta.url)));
const BASE = 'https://api.openai.com/v1/agents/sessions';
const PROJECT = 'proj_jtanwDH277T6LpGAyghNfzEs';
const limits = new Map();

export function signSession(id, key) {
  const data = Buffer.from(JSON.stringify({id, expires: Date.now()+3600000})).toString('base64url');
  return data+'.'+createHmac('sha256', key).update(data).digest('base64url');
}
export function verifySession(token, key) {
  if (!token) return null;
  if (typeof token !== 'string' || token.length > 2000) throw Error('invalid_session');
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra) throw Error('invalid_session');
  const expected=createHmac('sha256',key).update(data).digest();
  const supplied=Buffer.from(signature,'base64url');
  if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw Error('invalid_session');
  const value=JSON.parse(Buffer.from(data,'base64url').toString());
  if (value.expires<Date.now() || !/^sess_[a-zA-Z0-9_-]+$/.test(value.id)) throw Error('invalid_session');
  return value.id;
}

export async function* parseSSE(body) {
  const decoder=new TextDecoder(); let buffer='';
  for await (const chunk of body) {
    buffer+=decoder.decode(chunk,{stream:true}).replace(/\r\n/g,'\n');
    let end;
    while((end=buffer.indexOf('\n\n'))>=0) {
      const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
      const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(data && data!=='[DONE]') yield JSON.parse(data);
    }
  }
}

export async function runAgent(message, sessionId, emit, {key, signal, fetcher=fetch}) {
  const headers={'Authorization':`Bearer ${key}`, 'OpenAI-Project':PROJECT, 'OpenAI-Beta':'agents=v1', 'Content-Type':'application/json'};
  async function call(url, payload) {
    const response=await fetcher(url,{method:payload?'POST':'GET',headers:{...headers,...(payload?{'Idempotency-Key':randomUUID()}:{})},
      body:payload?JSON.stringify(payload):undefined,signal});
    if(!response.ok) {const error=Error('upstream_error');error.status=response.status;error.requestId=response.headers.get('x-request-id');throw error;}
    return response;
  }
  // Subscribe before posting a follow-up to avoid losing early events.
  const response=sessionId ? await call(`${BASE}/${sessionId}/events?stream=true`) : await call(BASE,{
    ...agentConfig,environment:{type:'none'},input:message,stream:true
  });
  if(!response.headers.get('content-type')?.includes('text/event-stream')) throw Error('invalid_stream');
  try {
    if(sessionId) await call(`${BASE}/${sessionId}/events`,{events:[{
      type:'agent.session.input.message',input:[{role:'user',content:[{type:'input_text',text:message}]}]
    }]}).then(r=>r.arrayBuffer());
    let announced=false;
    for await(const event of parseSSE(response.body)) {
      sessionId=event.session_id || event.session?.id || sessionId;
      if(sessionId && !announced) {emit({type:'session',token:signSession(sessionId,key)});announced=true;}
      const type=event.type||'';
      if(type.endsWith('output_text.delta') || type.endsWith('output_text.done')) {
        emit(Object.fromEntries(['type','text','delta','item_id','output_index','content_index'].filter(k=>k in event).map(k=>[k,event[k]])));
      } else if(type==='agent.session.requires_action') {
        const state=await call(`${BASE}/${sessionId}`).then(r=>r.json());
        for(const action of state.required_actions||[]) {
          if(action.type!=='function_call') throw Error('configuration_required');
          await call(`${BASE}/${sessionId}/events`,{events:[{
            type:'agent.session.input.tool_result',turn_id:action.turn_id,call_id:action.call_id,
            success:false,error:'No local function handler configured. Use the saved catalog MCP tools.'
          }]}).then(r=>r.arrayBuffer());
        }
      } else if(type==='agent.session.turn.completed' && !event.turn?.subagent_id) {
        emit({type:'complete'});return;
      } else if(['error','agent.session.failed','agent.session.environment.failed'].includes(type) ||
        (['agent.session.turn.failed','agent.session.turn.cancelled'].includes(type) && !event.turn?.subagent_id)) {
        const error=Error('agent_failed');error.code=event.error?.code||event.turn?.error?.code;throw error;
      } else if(type.includes('mcp') || type.includes('tool')) emit({type:'status',text:'Consultando la tienda…'});
    }
    throw Error('stream_interrupted');
  } finally {
    if(response.body && !response.body.locked) await response.body.cancel().catch(()=>{});
  }
}

export default async function handler(req,res) {
  const json=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') {res.setHeader('Allow','POST');return json(405,{error:'Método no permitido'});}
  if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) return json(403,{error:'Origen no permitido'});
  const key=process.env.OPENAI_API_KEY;
  if(!key) return json(503,{error:'Chat pendiente de activación. Falta configurar la conexión con OpenAI.'});
  let body;
  try {
    let raw='';for await(const chunk of req) {raw+=chunk;if(Buffer.byteLength(raw)>12000) return json(413,{error:'Mensaje demasiado largo'});}
    body=JSON.parse(raw);
    if(typeof body.message!=='string' || !body.message.trim() || body.message.length>2000) throw Error();
  } catch {return json(400,{error:'Escribe una consulta de hasta 2000 caracteres.'});}
  let id;
  try {id=verifySession(body.token,key);}catch{return json(400,{error:'La conversación venció. Pulsa Nuevo chat.'});}
  const address=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0];
  const now=Date.now();
  for(const [address,entry] of limits) if(now>entry.until) limits.delete(address);
  const entry=limits.get(address)||{count:0,until:now+600000};
  if(entry.count>=30) return json(429,{error:'Has realizado varias consultas. Inténtalo en unos minutos.'});
  entry.count++;limits.set(address,entry);
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),55000);
  res.on('close',()=>controller.abort());
  res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders?.();
  try {
    await runAgent(body.message.trim(),id,event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');},{key,signal:controller.signal});
  } catch(error) {
    console.error('Agent request failed', {kind:error.message,status:error.status,code:error.code,requestId:error.requestId});
    const text=error.status===401 || error.status===403 ? 'La conexión con OpenAI necesita revisión. Inténtalo más tarde.' :
      error.status===429 ? 'El servicio está ocupado o sin saldo disponible. Inténtalo más tarde.' :
      'No pude completar la consulta. Pulsa Nuevo chat antes de volver a intentarlo.';
    if(!res.destroyed)res.write(JSON.stringify({type:'error',text})+'\n');
  } finally {clearTimeout(timeout);res.end();}
}
