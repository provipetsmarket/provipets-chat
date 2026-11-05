/** Two-field lookup: no personal data or workbook content is sent to OpenAI. */
var ORDERS_SPREADSHEET_DEFAULT_ = '1R243LfwA1MaiO9hJEQ5VPf5QRRjWcH6vqxveqggZurg';
var ORDERS_SHEET_GID_DEFAULT_ = 513838687;

function lookupOrder(type1,value1,type2,value2,product) {
  var fields=['name','phone','email','document'];
  if(fields.indexOf(type1)<0 || fields.indexOf(type2)<0 || type1===type2) return {ok:false,text:'Elige dos datos distintos de tu compra.'};
  var a=orderIdentity_(type1,value1),b=orderIdentity_(type2,value2);
  if(!a || !b) return {ok:false,text:'Revisa los dos datos. Para el nombre, escribe al menos un nombre y un apellido; también puedes usar teléfono, correo o cédula.'};
  if(product!==undefined && (typeof product!=='string' || product.length>200))return {ok:false,text:'Escribe un producto de hasta 200 caracteres.'};
  try {
    var props=PropertiesService.getScriptProperties(),lock=LockService.getScriptLock();
    if(!lock.tryLock(3000))return {ok:false,text:'Espera un momento y vuelve a consultar.'};
    try {
      var day=Utilities.formatDate(new Date(),'America/Bogota','yyyy-MM-dd');
      var used=props.getProperty('ORDER_DAY_V2')===day ? Number(props.getProperty('ORDER_ATTEMPTS_V2') || 0) : 0;
      if(used>=100)return {ok:false,text:'La consulta de guías alcanzó su límite diario. Inténtalo mañana o solicita atención en el canal donde compraste.'};
      props.setProperties({ORDER_DAY_V2:day,ORDER_ATTEMPTS_V2:String(used+1)});
    } finally {lock.releaseLock();}
    return matchingOrder_(readOrderWorkbook_(),type1,a,type2,b,product || '');
  } catch(e) {
    console.error(JSON.stringify({event:'order_lookup_error',code:'LOOKUP_UNAVAILABLE'}));
    return {ok:false,text:'No pude consultar la plantilla en este momento. Inténtalo más tarde o solicita atención en el canal donde compraste.'};
  }
}

function orderIdentity_(type,value) {
  if(typeof value!=='string' || value.length>254)return '';
  var s=value.trim();
  if(type==='email')return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s) ? s.toLowerCase() : '';
  if(type==='name') {
    s=orderHeader_(s).replace(/[.,]/g,'').replace(/\s+/g,' ');
    var tokens=s.split(' ').filter(Boolean);
    return s.length>=3 && s.length<=180 && tokens.length>=2 ? tokens.join(' ') : '';
  }
  if(type==='phone' || type==='document') {
    if(!/^[+\d\s().-]+$/.test(s))return '';
    s=s.replace(/\D/g,'');
    if(type==='phone') {if(s.length===12 && s.slice(0,2)==='57')s=s.slice(2);return s.length===10 ? s : '';}
    return s.length>=5 && s.length<=15 ? s : '';
  }
  return '';
}

function matchingOrder_(book,type1,a,type2,b,product) {
  // Both fields must match the SAME row, not different records belonging to different people.
  var rows=book.rows.filter(function(r){
    var firstMatch=type1==='name' ? orderNameMatches_(String(r.name || ''),a) : orderIdentity_(type1,String(r[type1] || ''))===a;
    var secondMatch=type2==='name' ? orderNameMatches_(String(r.name || ''),b) : orderIdentity_(type2,String(r[type2] || ''))===b;
    return firstMatch && secondMatch;
  });
  var clue=orderHeader_(product);
  if(clue) {
    if(clue.length<4)return {ok:false,needsProduct:true,text:'Escribe al menos cuatro caracteres del producto comprado.'};
    rows=rows.filter(function(r){return orderHeader_(r.product).indexOf(clue)>=0;});
  }
  if(!rows.length)return {ok:false,text:'No encontré una compra que coincida con esos datos. Revísalos o prueba otra combinación. No compartas tus datos en el chat de productos.'};
  var groups={};rows.forEach(function(r){groups[r.platform+'|'+r.number]=true;});
  if(Object.keys(groups).length!==1)return {ok:false,needsProduct:true,text:'Esos datos coinciden con varias compras. Escribe el producto que estás esperando para identificar cuál buscas. Si sigue habiendo varias, solicita atención en el canal de compra.'};
  var seen={},guides=[];
  rows.forEach(function(r){if(r.guide && !seen[r.guide]){seen[r.guide]=true;guides.push(r.guide);}});
  var shipments=guides.map(function(guide){
    var carriers={};rows.forEach(function(r){if(r.guide===guide){var carrier=orderCarrier_(r.carrier);if(carrier)carriers[carrier]=true;}});
    var names=Object.keys(carriers);
    return {guide:guide,carrier:names.length===1 ? names[0] : ''};
  });
  // Only shipment details: never return contact info, names, addresses or order IDs.
  return {ok:true,guides:guides,shipments:shipments,updated:book.updated,text:guides.length ? 'Guía registrada en la plantilla.' : 'Todavía no aparece una guía registrada para esta compra en la plantilla. Esto no confirma el estado del despacho.'};
}
function orderCarrier_(value) {
  var key=orderHeader_(value).replace(/[^A-Z]/g,'');
  return {SERVIENTREGA:'Servientrega',ENVIA:'Envía',INTERRAPIDISIMO:'Inter Rapidísimo'}[key] || '';
}
function orderHeader_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
}
function orderPlatform_(value) {
  var p=orderHeader_(value).replace(/[^A-Z0-9]/g,'');
  var map={JUMPSELLER:'WEB',PROVIPETS:'WEB',WEB:'WEB',DIRECTO:'DIRECTO',ADDI:'ADDI',PCO:'PCO',PUNTOSCOLOMBIA:'PCO',ML:'ML',MERCADOLIBRE:'ML',FALABELLA:'FALABELLA'};
  return map[p] || null;
}
function orderNumber_(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  var s=String(value).trim().replace(/^#/,'').toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{0,99}$/.test(s) ? s : '';
}
function orderNameMatches_(registered, supplied) {
  var full=orderHeader_(registered).replace(/[^A-Z0-9 ]/g,' ').replace(/\\s+/g,' ').trim().split(' ').filter(Boolean);
  var query=orderHeader_(supplied).replace(/[^A-Z0-9 ]/g,' ').replace(/\\s+/g,' ').trim().split(' ').filter(Boolean);
  if(full.length<2 || query.length<2 || query.length>full.length) return false;
  // The first supplied word must match the registered first name; every other
  // supplied word must match a distinct registered token (e.g. JHON SOTO).
  if(query[0]!==full[0]) return false;
  var used={}; used[0]=true;
  for(var i=1;i<query.length;i++){
    var found=-1;
    for(var j=1;j<full.length;j++) if(!used[j] && full[j]===query[i]) {found=j;break;}
    if(found<0)return false;
    used[found]=true;
  }
  return true;
}

function readOrderWorkbook_() {
  var props=PropertiesService.getScriptProperties();
  var sourceId=props.getProperty('ORDERS_SPREADSHEET_ID') || ORDERS_SPREADSHEET_DEFAULT_;
  var sheetGid=Number(props.getProperty('ORDERS_SHEET_GID') || ORDERS_SHEET_GID_DEFAULT_);
  if(!sourceId || !Number.isInteger(sheetGid))throw new Error('ORDERS_NOT_CONFIGURED');
  // Drive metadata is used only for cache invalidation; cell data is read
  // directly from the native Google spreadsheet, never from an XLSX export.
  var file=DriveApp.getFileById(sourceId);
  var modified=file.getLastUpdated().getTime();
  var cache=CacheService.getScriptCache();
  var prefix='orders-sheets-v1:'+sourceId+':'+sheetGid+':'+modified+':';
  var meta=cache.get(prefix+'meta');
  if(meta){
    meta=JSON.parse(meta);var chunks=[];
    for(var i=0;i<meta.count;i++){var part=cache.get(prefix+i);if(part===null){chunks=null;break;}chunks.push(part);}
    if(chunks)return JSON.parse(chunks.join(''));
  }
  var spreadsheet=SpreadsheetApp.openById(sourceId);
  var sheet=spreadsheet.getSheets().filter(function(sh){return sh.getSheetId()===sheetGid;})[0];
  if(!sheet)throw new Error('ORDERS_TAB_NOT_FOUND');
  var values=sheet.getDataRange().getDisplayValues();
  if(!values || !values.length)throw new Error('ORDERS_EMPTY');
  var headerRow=-1,headers={};
  for(var h=0;h<Math.min(values.length,10);h++){
    var candidate={};
    values[h].forEach(function(v,i){var key=orderHeader_(v);if(key)candidate[key]=i;});
    if(candidate.PLATAFORMA && (candidate.ORDEN!==undefined || candidate.PEDIDO!==undefined || candidate['NUMERO DE PEDIDO']!==undefined)){
      headerRow=h;headers=candidate;break;
    }
  }
  if(headerRow<0)throw new Error('ORDERS_HEADERS_NOT_FOUND');
  function get(row,keys,max){
    for(var k=0;k<keys.length;k++){
      var col=headers[keys[k]];
      if(col!==undefined)return String(row[col]===undefined?'':row[col]).trim().slice(0,max||500);
    }
    return '';
  }
  var book={updated:new Date(modified).toISOString(),rows:[]};
  for(var ri=headerRow+1;ri<values.length;ri++){
    var row=values[ri],platform=orderPlatform_(get(row,['PLATAFORMA'],50));
    var number=orderNumber_(get(row,['ORDEN','PEDIDO','NUMERO DE PEDIDO'],100));
    if(!platform || !number)continue;
    book.rows.push({
      platform:platform,number:number,
      email:get(row,['EMAIL','E-MAIL','CORREO','CORREO ELECTRONICO'],254).toLowerCase(),
      name:get(row,['NOMBRE','NOMBRE COMPLETO','CLIENTE'],180),
      phone:get(row,['TELEFONO','CELULAR','MOVIL'],40),
      document:get(row,['DOCUMENTO','CEDULA','IDENTIFICACION'],40),
      product:get(row,['PRODUCTO','NOMBRE PRODUCTO']),
      quantity:get(row,['UNDS','UNIDADES','CANTIDAD'],30),
      guide:get(row,['GUIA','NUMERO DE GUIA','NRO GUIA'],150),
      carrier:get(row,['TRANSPORTADORA','TRANSPORTADOR'],80)
    });
    if(book.rows.length>20000)throw new Error('TOO_MANY_ORDERS');
  }
  if(!book.rows.length || DriveApp.getFileById(sourceId).getLastUpdated().getTime()!==modified)throw new Error('WORKBOOK_CHANGED');
  var serialized=JSON.stringify(book),count=Math.ceil(serialized.length/20000);
  if(count<=100){
    for(var c=0;c<count;c++)cache.put(prefix+c,serialized.slice(c*20000,(c+1)*20000),300);
    cache.put(prefix+'meta',JSON.stringify({count:count}),300);
  }
  return book;
}
