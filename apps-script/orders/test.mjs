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
  assert.deepEqual(Object.keys(r).sort(),['guides','ok','shipments','text','updated']);
  assert.ok(!JSON.stringify(r).includes('cliente@example.com'));assert.ok(!JSON.stringify(r).includes('MKT-TEST-01'));
 }
});
test('full name accents/case and Colombian phone formatting normalize consistently',()=>{
 const h=harness();assert.equal(h.lookup('name','  MARIA  PRUEBA ','phone','+57 (300) 123-4567').ok,true);
 assert.equal(h.lookup('name','Maria','phone','3001234567').ok,false);
 const j=harness();j.row.name='Jhon Fredy Soto Arboleda';
 assert.equal(j.lookup('name','Jhon Soto','phone','3001234567').ok,true);
 assert.equal(j.lookup('name','Jhon Fredy Soto','phone','3001234567').ok,true);
 assert.equal(j.lookup('name','Jhon Pérez','phone','3001234567').ok,false);
 assert.equal(j.lookup('name','Fredy Arboleda','phone','3001234567').ok,false);
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

test('Google Sheets reader selects the configured GID and maps headers without editing the sheet',()=>{
 const props=new Map([['ORDERS_SPREADSHEET_ID','SHEET_TEST'],['ORDERS_SHEET_GID','513838687']]);
 const rows=[
  ['PLATAFORMA','ORDEN','SKU','PRODUCTO','UNDS','Guia','ESTADO','ESTADO GUÍA','GRUPOS','DESPACHO','TRANSPORTADORA','Nombre','Documento','Email','Telefono','Dirección','Ciudad','Departamento','FACTURADO'],
  ['ADDI','TEST-01','SKU-1','Alimento ficticio','1','GUIA-123','','','','','Servientrega','Jhon Fredy Soto Arboleda','12345678','cliente@example.com','3001234567','','Medellín','Antioquia','SI']
 ];
 let opened='',selected=-1;
 const sheet={getSheetId:()=>513838687,getDataRange:()=>({getDisplayValues:()=>rows})};
 const ctx=vm.createContext({
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
  DriveApp:{getFileById:id=>({getLastUpdated:()=>new Date('2026-10-25')})},
  SpreadsheetApp:{openById:id=>{opened=id;return {getSheets:()=>[sheet]};}},
  CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
  Utilities:{formatDate:()=> '2026-10-25'}
 });
 vm.runInContext(source,ctx);
 const book=ctx.readOrderWorkbook_();
 assert.equal(opened,'SHEET_TEST');assert.equal(book.rows.length,1);
 assert.equal(book.rows[0].name,'Jhon Fredy Soto Arboleda');
 assert.equal(book.rows[0].guide,'GUIA-123');assert.equal(book.rows[0].carrier,'Servientrega');
});
test('carrier stays paired with verified guide; missing or conflicting values are never guessed',()=>{
 for(const [raw,label] of [['SERVIENTREGA','Servientrega'],['Envia','Envía'],['Interrapidísimo','Inter Rapidísimo'],['',''],['Otro dato','']]){
  const h=harness();h.row.carrier=raw;const r=h.lookup('email',h.row.email,'phone',h.row.phone);assert.equal(r.shipments[0].guide,h.row.guide);assert.equal(r.shipments[0].carrier,label);
 }
 const h=harness();h.row.carrier='Servientrega';h.book.rows.push({...h.row,guide:'SECOND',carrier:'Envia'});
 let r=h.lookup('email',h.row.email,'phone',h.row.phone);assert.equal(r.shipments[0].carrier,'Servientrega');assert.equal(r.shipments[1].carrier,'Envía');
 h.book.rows.push({...h.row,carrier:'Inter Rapidisimo'});r=h.lookup('email',h.row.email,'phone',h.row.phone);assert.equal(r.shipments[0].carrier,'');
 assert.equal(h.lookup('email',h.row.email,'phone','3000000000').shipments,undefined);
});
