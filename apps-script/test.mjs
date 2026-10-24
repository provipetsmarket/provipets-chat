import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('./Code.gs',import.meta.url),'utf8');
const messageId = n => 'request_' + String(n).padStart(16,'0');
function harness() {
  const properties = new Map([['OPENAI_API_KEY','test-key-not-real']]);
  const cache = new Map(), calls = [], logs = [];
  let locked = false;
  const lock = {tryLock:() => { if (locked) return false; locked = true; return true; },releaseLock:() => {locked = false;}};
  const app = {status:200,data:null,hook:null};
  const context = vm.createContext({
    console:{log:v => logs.push(v),error:v => logs.push(v)},
    PropertiesService:{getScriptProperties:() => ({getProperty:k => properties.get(k) ?? null,setProperty:(k,v) => properties.set(k,v),setProperties:o => Object.entries(o).forEach(([k,v]) => properties.set(k,v))})},
    CacheService:{getScriptCache:() => ({get:k => cache.get(k) ?? null,put:(k,v) => cache.set(k,v)})},
    LockService:{getScriptLock:() => lock},
    Utilities:{
      getUuid:() => crypto.randomUUID(),formatDate:() => '2026-10-24',Charset:{UTF_8:'utf8'},
      base64EncodeWebSafe:value => Buffer.from(value).toString('base64url'),
      base64DecodeWebSafe:value => Buffer.from(value,'base64url'),
      computeHmacSha256Signature:(value,key) => crypto.createHmac('sha256',key).update(value).digest(),
      newBlob:value => ({getDataAsString:() => Buffer.from(value).toString('utf8')})
    },
    UrlFetchApp:{fetch:(url,options) => {
      calls.push({url,...options,payload:JSON.parse(options.payload)});
      if (app.hook) app.hook();
      const data = app.data || {id:'resp_test_' + calls.length,status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Respuesta ' + calls.length}]}],usage:{input_tokens:200,output_tokens:50}};
      return {getResponseCode:() => app.status,getContentText:() => JSON.stringify(data)};
    }}
  });
  vm.runInContext(source,context);
  return {context,properties,cache,calls,app,logs,chat:context.chat};
}

test('catalog request stays on server; signed continuation uses stored response',() => {
  const h = harness();
  const first = h.chat('Hola',null,messageId(1));
  assert.equal(first.ok,true); assert.equal(first.remaining,19);
  assert.ok(first.token); assert.ok(!JSON.stringify(first).includes('test-key'));
  const call = h.calls[0];
  assert.equal(call.url,'https://api.openai.com/v1/responses');
  assert.equal(call.headers['OpenAI-Project'],'proj_jtanwDH277T6LpGAyghNfzEs');
  assert.equal(call.payload.model,'gpt-6-luna');
  assert.equal(call.payload.stream,false);
  assert.deepEqual(call.payload.tools[0].allowed_tools,['search_products','get_product']);
  assert.equal(call.payload.tools[0].require_approval,'never');
  assert.equal(call.payload.previous_response_id,undefined);
  const second = h.chat('¿Cuánto cuesta?',first.token,messageId(2));
  assert.equal(second.ok,true); assert.equal(second.remaining,18);
  assert.equal(h.calls[1].payload.previous_response_id,'resp_test_1');
  assert.ok(h.logs.every(line => !line.includes('test-key') && !line.includes('¿Cuánto')));
});

test('forged or expired tokens never spend an API call',() => {
  const h = harness();
  const first = h.chat('Hola',null,messageId(1));
  assert.match(h.chat('Otro',first.token + 'x',messageId(2)).text,/venció/);
  const expired = h.context.signToken_({sid:'a'.repeat(32),expires:Date.now()-1000},h.properties.get('SESSION_SECRET'));
  assert.match(h.chat('Otro',expired,messageId(3)).text,/venció/);
  assert.equal(h.calls.length,1);
});

test('duplicate delivery is idempotent and a busy session rejects overlapping requests',() => {
  const h = harness();
  const first = h.chat('Hola',null,messageId(1));
  assert.equal(h.chat('Hola',first.token,messageId(1)).text,first.text);
  assert.equal(h.calls.length,1);
  h.app.hook = () => {
    h.app.hook = null;
    const overlapping = h.chat('Tercero',first.token,messageId(3));
    assert.equal(overlapping.ok,false); assert.match(overlapping.text,/sigue en proceso/);
  };
  assert.equal(h.chat('Segundo',first.token,messageId(2)).ok,true);
  assert.equal(h.calls.length,2);
});

test('20 successful turns per session; global daily cap includes failed requests',() => {
  const h = harness(); let token;
  for (let i=1;i<=20;i++) { const result = h.chat('Hola',token,messageId(i)); assert.equal(result.ok,true); token = result.token; }
  assert.match(h.chat('Uno más',token,messageId(21)).text,/20 consultas/);
  assert.equal(h.calls.length,20);
  h.properties.set('DAILY_REQUEST_LIMIT','21');
  h.app.status = 429; h.app.data = {error:{code:'rate_limit_exceeded'}};
  assert.equal(h.chat('Prueba',null,messageId(22)).ok,false);
  assert.match(h.chat('Prueba',null,messageId(23)).text,/límite diario/);
  assert.equal(h.calls.length,21);
});

test('incomplete replies and API errors do not advance conversation; busy reservation clears',() => {
  const h = harness();
  const first = h.chat('Hola',null,messageId(1));
  h.app.data = {id:'resp_partial',status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'No mostrar'}]}],incomplete_details:{reason:'max_output_tokens'}};
  const incomplete = h.chat('Segundo',first.token,messageId(2));
  assert.equal(incomplete.ok,false); assert.ok(!incomplete.text.includes('No mostrar'));
  h.app.status = 401; h.app.data = {error:{code:'invalid_api_key',message:'test-key-not-real'}};
  assert.match(h.chat('Tercero',first.token,messageId(3)).text,/conexión/);
  h.app.status = 429; h.app.data = {error:{code:'insufficient_quota'}};
  assert.match(h.chat('Cuarto',first.token,messageId(4)).text,/saldo/);
  h.app.data = {error:{code:'rate_limit_exceeded'}};
  assert.match(h.chat('Quinto',first.token,messageId(5)).text,/temporal/);
  h.app.status = 200; h.app.data = null;
  const recovered = h.chat('Sexto',first.token,messageId(6));
  assert.equal(recovered.ok,true); assert.equal(recovered.remaining,18);
  assert.equal(h.calls.at(-1).payload.previous_response_id,'resp_test_1');
  assert.ok(h.logs.every(line => !line.includes('test-key-not-real')));
});

test('missing key and invalid inputs never call OpenAI; shipped HTML uses safe nodes',() => {
  const h = harness();
  assert.equal(h.chat('',null,messageId(1)).ok,false);
  assert.equal(h.chat('x'.repeat(2001),null,messageId(1)).ok,false);
  assert.equal(h.chat('Hola',null,'short').ok,false);
  h.properties.delete('OPENAI_API_KEY');
  assert.match(h.chat('Hola',null,messageId(1)).text,/activación/);
  assert.equal(h.calls.length,0);
  assert.ok(h.context.CHAT_HTML_.includes('google.script.run.withSuccessHandler'));
  assert.ok(!h.context.CHAT_HTML_.includes('innerHTML'));
  const scripts = [...h.context.CHAT_HTML_.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  new vm.Script(scripts[0][1]);
});
