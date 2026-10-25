import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
const base=new URL('./',import.meta.url);
const source=await readFile(new URL('Orders.gs',base),'utf8');
function harness(){
  const props=new Map(),cache=new Map(),sent=[];let held=false;
  const ctx=vm.createContext({console:{error:()=>{}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),setProperties:o=>Object.entries(o).forEach(([k,v])=>props.set(k,v))})},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
    LockService:{getScriptLock:()=>({tryLock:()=>held?false:(held=true),releaseLock:()=>held=false})},
    Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:()=> '2026-10-25',computeHmacSha256Signature:(v,s)=>[...crypto.createHmac('sha256',s).update(v).digest()]},
    MailApp:{getRemainingDailyQuota:()=>100,sendEmail:m=>sent.push(m)}
  });
  vm.runInContext(source,ctx);
  const book={updated:'2026-10-23T12:44:23.710Z',rows:[{platform:'ADDI',number:'MKT-123-01',email:'cliente@example.com',product:'Producto ficticio',quantity:'1',guide:'GUIA-FICTICIA',carrier:''}]};
  ctx.readOrderWorkbook_=()=>book;
  return {ctx,props,cache,sent,book,request:ctx.requestOrderCode,verify:ctx.verifyOrderCode,code:()=>sent.at(-1).body.match(/\b\d{6}\b/)[0]};
}
test('registered email OTP gates minimal marketplace result; code is single-use',()=>{
 const h=harness();const requested=h.request('ADDI','MKT-123-01','cliente@example.com');
 assert.equal(requested.ok,true);assert.equal(h.sent.length,1);
 assert.ok(!JSON.stringify(requested).includes('GUIA-FICTICIA'));
 const result=h.verify(requested.challenge,h.code());assert.equal(result.ok,true);
 assert.equal(result.order.items[0].guide,'GUIA-FICTICIA');
 assert.ok(!JSON.stringify(result).includes('cliente@example.com'));
 assert.equal(h.verify(requested.challenge,h.code()).ok,false);
});
test('wrong email, channel, or missing order neither emails nor reveals existence',()=>{
 const good=harness().request('ADDI','MKT-123-01','cliente@example.com');
 for(const args of [['ADDI','MKT-123-01','other@example.com'],['ML','MKT-123-01','cliente@example.com'],['ADDI','MKT-999','cliente@example.com']]){
  const h=harness(),result=h.request(...args);assert.equal(result.ok,true);assert.equal(result.text,good.text);assert.equal(h.sent.length,0);
  assert.equal(h.verify(result.challenge,'000000').ok,false);
 }
});
test('mixed ownership and absent email fail closed, including another row in same order',()=>{
 const h=harness();h.book.rows.push({...h.book.rows[0],email:'otro@example.com'});
 assert.equal(h.request('ADDI','MKT-123-01','cliente@example.com').ok,true);assert.equal(h.sent.length,0);
 const g=harness();g.book.rows[0].email='';g.request('ADDI','MKT-123-01','cliente@example.com');assert.equal(g.sent.length,0);
});
test('five wrong codes invalidate correct code; expiry and cache eviction do too',()=>{
 const h=harness(),r=h.request('ADDI','MKT-123-01','cliente@example.com');
 const wrong=h.code()==='000000'?'111111':'000000';
 for(let i=0;i<5;i++)assert.equal(h.verify(r.challenge,wrong).ok,false);
 assert.equal(h.verify(r.challenge,h.code()).ok,false);
 const g=harness(),s=g.request('ADDI','MKT-123-01','cliente@example.com');
 const entry=JSON.parse(g.cache.get('order-otp:'+s.challenge));entry.expires=Date.now()-1;g.cache.set('order-otp:'+s.challenge,JSON.stringify(entry));
 assert.equal(g.verify(s.challenge,g.code()).ok,false);
 assert.equal(g.verify('a'.repeat(32),'123456').ok,false);
});
test('daily ceiling and cooldown block repeated mail; no model call exists',()=>{
 const h=harness();h.request('ADDI','MKT-123-01','cliente@example.com');
 assert.equal(h.request('ADDI','MKT-123-01','cliente@example.com').ok,false);assert.equal(h.sent.length,1);
 h.props.set('ORDER_ATTEMPTS','50');
 assert.equal(h.request('ADDI','OTHER','cliente@example.com').ok,false);assert.equal(h.sent.length,1);
 assert.ok(!source.includes('UrlFetchApp'));assert.ok(!source.includes('api.openai.com'));
});
test('malformed input never accesses workbook; platform aliases and strict order matching',()=>{
 const h=harness();let reads=0;h.ctx.readOrderWorkbook_=()=>{reads++;return h.book;};
 for(const args of [['ANY','MKT-123','a@example.com'],['ADDI','123','x@example.com,attacker@example.com'],['ADDI','<script>','a@example.com']])assert.equal(h.request(...args).ok,false);
 assert.equal(reads,0);assert.equal(h.ctx.orderPlatform_('Mercado Libre'),'ML');assert.equal(h.ctx.orderPlatform_('Puntos Colombia'),'PCO');
 assert.equal(h.ctx.orderHeader_('  Número de Guía '),'NUMERO DE GUIA');
});
test('empty guides never become invented tracking; shipped UI scripts parse without HTML injection',async()=>{
 const h=harness();h.book.rows[0].guide='';const r=h.request('ADDI','MKT-123-01','cliente@example.com');
 assert.equal(h.verify(r.challenge,h.code()).order.items[0].guide,'');
 const html=await readFile(new URL('Index.html',base),'utf8');
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,2);
 scripts.forEach(s=>new vm.Script(s[1]));assert.ok(!html.includes('innerHTML'));
 new vm.Script(await readFile(new URL('Code.gs',base),'utf8'));
});
