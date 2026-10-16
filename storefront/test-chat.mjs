import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import handler, {runAgent, signSession, verifySession, parseSSE} from './server/chat.mjs';
const key='test-only-not-a-real-credential';
const stream=(events)=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
const completed={type:'agent.session.turn.completed',turn:{subagent_id:null}};

test('signed sessions reject forged tokens and preserve identity',()=>{
  const token=signSession('sess_test',key);
  assert.equal(verifySession(token,key),'sess_test');
  assert.throws(()=>verifySession(token,'other-key'));
  assert.throws(()=>verifySession('sess_test',key));
});
test('initial request inherits saved tools and streams completed text',async()=>{
  const events=[],requests=[];
  await runAgent('Hola',null,e=>events.push(e),{key,fetcher:async(url,options)=>{
    requests.push({url,options});
    return stream([{type:'agent.session.created',session:{id:'sess_test'}},{type:'agent.session.turn.output_text.done',text:'Hola cliente'},completed]);
  }});
  const payload=JSON.parse(requests[0].options.body);
  assert.equal(payload.agent_id,'agent_7cb5416e83484453b3b90134710c6008c1ee5475c9ce418389');
  assert.equal(payload.agent.model,'gpt-6-luna');assert.equal(payload.environment.type,'none');
  assert.equal(payload.agent.tools,undefined);
  assert.equal(events.at(-1).type,'complete');assert.equal(verifySession(events[0].token,key),'sess_test');
});
test('follow-up subscribes before sending input',async()=>{
  const calls=[];
  await runAgent('Más opciones','sess_test',()=>{},{key,fetcher:async(url,opts)=>{
    calls.push({url,opts});return opts.method==='POST'?new Response('{}'):stream([completed]);
  }});
  assert.match(calls[0].url,/events\?stream=true$/);assert.equal(calls[0].opts.method,'GET');
  assert.equal(JSON.parse(calls[1].opts.body).events[0].input[0].content[0].text,'Más opciones');
});
test('stream interruption is not reported as success',async()=>{
  await assert.rejects(runAgent('Hola',null,()=>{},{key,fetcher:async()=>stream([{type:'agent.session.idle'}])}),/stream_interrupted/);
});
test('API authentication failure is explicit',async()=>{
  await assert.rejects(runAgent('Hola',null,()=>{},{key,fetcher:async()=>new Response('{}',{status:401})}),e=>e.status===401);
});
test('unknown local tools receive an error result and MCP remains remote',async()=>{
  const calls=[];
  await runAgent('Busca','sess_test',()=>{},{key,fetcher:async(url,opts)=>{
    calls.push({url,opts});
    if(opts.method==='POST')return new Response('{}');
    if(!url.includes('?stream='))return Response.json({required_actions:[{type:'function_call',turn_id:'turn_1',call_id:'call_1',name:'unknown'}]});
    return stream([{type:'agent.session.requires_action'},completed]);
  }});
  const result=JSON.parse(calls.at(-1).opts.body).events[0];
  assert.equal(result.type,'agent.session.input.tool_result');assert.equal(result.success,false);
});
test('SSE decodes UTF-8 chunk boundaries',async()=>{
  const bytes=new TextEncoder().encode('data: {"type":"x","text":"día"}\n\n');
  const body=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}});
  const events=[];for await(const e of parseSSE(body))events.push(e);
  assert.equal(events[0].text,'día');
});
test('web handler shows activation error without a credential',async()=>{
  const old=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',body:JSON.stringify({message:'Hola'})});
    assert.equal(response.status,503);assert.match((await response.json()).error,/activación/);
  }finally{await new Promise(r=>server.close(r));if(old)process.env.OPENAI_API_KEY=old;}
});
