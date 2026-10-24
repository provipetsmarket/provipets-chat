import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent,signSession,verifySession,parseSSE} from './server/chat.mjs';
const key='test-only-credential';
const stream=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
const completed={type:'response.completed',response:{id:'resp_test',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Hola'}]}]}};
test('rejects forged or old session tokens',()=>{
 assert.equal(verifySession(signSession('resp_test',key),key),'resp_test');
 assert.throws(()=>verifySession(signSession('resp_test',key),'wrong'));
 assert.throws(()=>verifySession(signSession('sess_old',key),key));
});
test('direct response uses only catalog reads and retains follow-up context',async()=>{
 let body;const emitted=[];
 await runAgent('precio de alimento','resp_previous',e=>emitted.push(e),{key,fetcher:async(url,options)=>{
 assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);
 assert.equal(options.headers['OpenAI-Project'],'proj_jtanwDH277T6LpGAyghNfzEs');
 return stream([{type:'response.output_text.delta',delta:'Ho',item_id:'msg_1',content_index:0,output_index:0},{type:'response.output_text.done',text:'Hola',item_id:'msg_1',content_index:0,output_index:0},completed]);
 }});
 assert.equal(body.previous_response_id,'resp_previous');assert.equal(body.agent_id,undefined);
 assert.equal(body.model,'gpt-6-luna');assert.ok(body.instructions.includes('Nunca inventes'));
 assert.deepEqual(body.tools[0].allowed_tools,['search_products','get_product']);
 assert.equal(emitted.at(-1).type,'complete');assert.equal(verifySession(emitted.at(-2).token,key),'resp_test');
});
test('completion can recover text when deltas are absent',async()=>{
 const events=[];await runAgent('Hola',null,e=>events.push(e),{key,fetcher:async()=>stream([completed])});
 assert.equal(events[0].text,'Hola');assert.equal(events.at(-1).type,'complete');
});
test('failed, incomplete and interrupted streams never report success',async()=>{
 for(const events of [[{type:'response.failed',response:{error:{code:'model_not_found'}}}],[{type:'response.incomplete',response:{incomplete_details:{reason:'max_output_tokens'}}}],[{type:'response.created'}]]){
 const emitted=[];await assert.rejects(runAgent('Hola',null,e=>emitted.push(e),{key,fetcher:async()=>stream(events)}));
 assert.ok(!emitted.some(e=>e.type==='complete'));
 }
});
test('upstream diagnostics retain code and request ID without leaking keys',async()=>{
 await assert.rejects(runAgent('Hola',null,()=>{},{key,fetcher:async()=>new Response(JSON.stringify({error:{code:'invalid_api_key',message:'secret'}}),{status:401,headers:{'x-request-id':'req_test'}})}),e=>e.status===401&&e.code==='invalid_api_key'&&e.requestId==='req_test'&&!e.message.includes('secret'));
});
test('SSE handles UTF-8 split across chunks',async()=>{
 const bytes=new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"ñ"}\n\n');const at=bytes.indexOf(195)+1;
 const body=new ReadableStream({start(c){c.enqueue(bytes.slice(0,at));c.enqueue(bytes.slice(at));c.close();}});
 const events=[];for await(const e of parseSSE(body))events.push(e);assert.equal(events[0].delta,'ñ');
});

test('streamed rate limits are classified for a helpful customer message',async()=>{
 await assert.rejects(runAgent('Hola',null,()=>{},{key,fetcher:async()=>stream([{type:'response.failed',response:{error:{code:'rate_limit_exceeded'}}}])}),e=>e.status===429);
});
