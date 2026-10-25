import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const base=new URL('./',import.meta.url);
const source=await readFile(new URL('Orders.gs',base),'utf8');
function harness(){
 const props=new Map();let reads=0,held=false;
 const row={platform:'ADDI',number:'MKT-TEST-01',name:'María Prueba',phone:'3001234567',email:'cliente@example.com',document:'12345678',product:'Alimento ficticio 4 kg',guide:'GUIA-FICTICIA'};
 const book={updated:'2026-10-25T13:00:00.000Z',rows:[row]};
 const ctx=vm.createContext({console:{error:()=>{}},Utilities:{formatDate:()=> '2026-10-25'},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperties:o=>Object.entries(o).forEach(([k,v])=>props.set(k,v))})},
 LockService:{getScriptLock:()=>({tryLock:()=>held?false:(held=true),releaseLock:()=>held=false})}});
 vm.runInContext(source,ctx);ctx.readOrderWorkbook_=()=>{reads++;return book;};
 return {ctx,props,book,row,lookup:ctx.lookupOrder,reads:()=>reads};
}
test('all six combinations work without order number; result contains only guide and source time',()=>{
 const fields=['name','phone','email','document'];
 for(let i=0;i<fields.length;i++)for(let j=i+1;j<fields.length;j++){
  const h=harness(),a=fields[i],b=fields[j],r=h.lookup(a,h.row[a],b,h.row[b],'');
  assert.equal(r.ok,true,a+'+'+b);assert.deepEqual([...r.guides],['GUIA-FICTICIA']);
  assert.deepEqual(Object.keys(r).sort(),['guides','ok','text','updated']);
  assert.ok(!JSON.stringify(r).includes('cliente@example.com'));assert.ok(!JSON.stringify(r).includes('MKT-TEST-01'));
 }
});
test('full name accents/case and Colombian phone formatting normalize consistently',()=>{
 const h=harness();assert.equal(h.lookup('name','  MARIA  PRUEBA ','phone','+57 (300) 123-4567').ok,true);
 assert.equal(h.lookup('name','Maria','phone','3001234567').ok,false);
 assert.equal(h.lookup('name','Maria Otra','phone','3001234567').ok,false);
 assert.equal(h.lookup('email','CLIENTE@EXAMPLE.COM','document','12.345.678').ok,true);
});
test('types must differ and both nonempty fields must match the same sale row',()=>{
 const h=harness();assert.equal(h.lookup('phone','3001234567','phone','3001234567').ok,false);assert.equal(h.reads(),0);
 h.book.rows.push({...h.row,number:'OTHER',name:'Otra Persona',phone:'3009999999',email:'otro@example.com'});
 assert.equal(h.lookup('name','María Prueba','phone','3009999999').ok,false);
 assert.equal(h.lookup('email','otro@example.com','document','99999999').ok,false);
 assert.equal(h.lookup('document','','name','María Prueba').ok,false);
});
test('multiple matching purchases reveal no guides; customer product clue disambiguates',()=>{
 const h=harness();h.book.rows.push({...h.row,number:'SECOND',guide:'OTRA-GUIA',product:'Juguete ficticio'});
 const ambiguous=h.lookup('email',h.row.email,'phone',h.row.phone);
 assert.equal(ambiguous.ok,false);assert.equal(ambiguous.needsProduct,true);assert.ok(!JSON.stringify(ambiguous).includes('GUIA'));
 const selected=h.lookup('email',h.row.email,'phone',h.row.phone,'juguete');
 assert.equal(selected.ok,true);assert.deepEqual([...selected.guides],['OTRA-GUIA']);
 assert.equal(h.lookup('email',h.row.email,'phone',h.row.phone,'inexistente').ok,false);
});
test('empty guides and duplicate line items never create invented delivery status',()=>{
 const h=harness();h.row.guide='';const empty=h.lookup('email',h.row.email,'phone',h.row.phone);
 assert.equal(empty.ok,true);assert.equal(empty.guides.length,0);assert.match(empty.text,/no aparece una guía/);
 h.row.guide='GUIA-FICTICIA';h.book.rows.push({...h.row});
 assert.equal(h.lookup('email',h.row.email,'phone',h.row.phone).guides.length,1);
});
test('attempt cap blocks workbook access; module sends neither email nor personal data to OpenAI',()=>{
 const h=harness();h.props.set('ORDER_DAY_V2','2026-10-25');h.props.set('ORDER_ATTEMPTS_V2','100');
 assert.equal(h.lookup('email',h.row.email,'phone',h.row.phone).ok,false);assert.equal(h.reads(),0);
 assert.ok(!source.includes('MailApp'));assert.ok(!source.includes('UrlFetchApp'));
 assert.ok(!source.includes('requestOrderCode'));assert.ok(source.includes("orders-v3:"));
});
test('client and bundle parse; no OTP or raw HTML rendering remains; Drive is read-only',async()=>{
 const html=await readFile(new URL('Index.html',base),'utf8');
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,2);scripts.forEach(s=>new vm.Script(s[1]));
 assert.ok(!html.includes('innerHTML'));assert.ok(!html.includes('verifyOrderCode'));assert.ok(html.includes('.lookupOrder('));
 new vm.Script(await readFile(new URL('Code.gs',base),'utf8'));
 const manifest=JSON.parse(await readFile(new URL('appsscript.json',base),'utf8'));
 assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.readonly'));
 assert.ok(!manifest.oauthScopes.some(s=>s.includes('send_mail')));
});

test('fast XLSX reader decodes rich text, inline cells and sparse rows without XML service',()=>{
 const sheet='<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>PLATAFORMA</t></is></c><c r="B1" t="inlineStr"><is><t>ORDEN</t></is></c><c r="C1" t="inlineStr"><is><t>Nombre</t></is></c><c r="D1" t="inlineStr"><is><t>Guia</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>ADDI</t></is></c><c r="B2" t="inlineStr"><is><t>TEST-01</t></is></c><c r="C2" t="s"><v>0</v></c><c r="D2"><v>123456789</v></c><c r="E2"/></row><row r="1048576"><c r="A1048576"/></row></sheetData></worksheet>';
 const xml={'xl/sharedStrings.xml':'<sst><si><r><t>Mar&#237;a </t></r><r><t>Prueba &amp; Otra</t></r><rPh><t>IGNORE</t></rPh></si></sst>','xl/worksheets/sheet1.xml':sheet};
 const blobs=Object.entries(xml).map(([name,text])=>({getName:()=>name,getBytes:()=>new Uint8Array(Buffer.byteLength(text)),getDataAsString:()=>text}));
 const cache=new Map(),file={getLastUpdated:()=>new Date('2026-10-25'),getSize:()=>1234,getMimeType:()=> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',getBlob:()=>({setContentType:()=>({})})};let unzips=0;
 const ctx=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'TEST'})},DriveApp:{getFileById:()=>file},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},Utilities:{unzip:()=>{unzips++;return blobs;}}});
 vm.runInContext(source,ctx);const book=ctx.readOrderWorkbook_();assert.equal(book.rows.length,1);assert.equal(book.rows[0].name,'María Prueba & Otra');assert.equal(book.rows[0].guide,'123456789');ctx.readOrderWorkbook_();assert.equal(unzips,1);
});
