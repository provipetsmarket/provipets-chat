/** Two-field lookup: no personal data or workbook content is sent to OpenAI. */
var ORDER_NS_ = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function lookupOrder(type1,value1,type2,value2,product) {
  var fields=['name','phone','email','document'];
  if(fields.indexOf(type1)<0 || fields.indexOf(type2)<0 || type1===type2) return {ok:false,text:'Elige dos datos distintos de tu compra.'};
  var a=orderIdentity_(type1,value1),b=orderIdentity_(type2,value2);
  if(!a || !b) return {ok:false,text:'Revisa los dos datos. Escribe el nombre completo, el teléfono, el correo o la cédula tal como los registraste al comprar.'};
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
    return s.length>=5 && s.length<=180 && s.split(' ').length>=2 ? s : '';
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
  var rows=book.rows.filter(function(r){return orderIdentity_(type1,String(r[type1] || ''))===a && orderIdentity_(type2,String(r[type2] || ''))===b;});
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
function readOrderWorkbook_() {
  var sourceId=PropertiesService.getScriptProperties().getProperty('ORDERS_FILE_ID');
  if(!sourceId)throw new Error('ORDERS_NOT_CONFIGURED');
  var file=DriveApp.getFileById(sourceId);
  var modified=file.getLastUpdated().getTime();
  if (file.getMimeType()!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') throw new Error('EXPECTED_XLSX');
  if (file.getSize()>10000000) throw new Error('FILE_TOO_LARGE');
  var cache=CacheService.getScriptCache();
  var prefix='orders-v3:'+modified+':';
  var meta=cache.get(prefix+'meta');
  if (meta) {
    meta=JSON.parse(meta);
    var chunks=[];
    for (var i=0;i<meta.count;i++) {var part=cache.get(prefix+i);if(part===null){chunks=null;break;}chunks.push(part);}
    if (chunks) return JSON.parse(chunks.join(''));
  }
  // Read XLSX directly as ZIP/XML: no conversion or edits to the PC-synced original.
  var blobs=Utilities.unzip(file.getBlob().setContentType('application/zip'));
  var entries={},total=0;
  blobs.forEach(function(b){var bytes=b.getBytes();total+=bytes.length;if(total>50000000)throw new Error('ARCHIVE_TOO_LARGE');entries[b.getName()]=b;});
  function xml(path){if(!entries[path])throw new Error('INVALID_XLSX');return entries[path].getDataAsString();}
  var strings=[];
  if(entries['xl/sharedStrings.xml']) {
    var shared=xml('xl/sharedStrings.xml'),si,reSi=/<si\b[^>]*>([\s\S]*?)<\/si>/g;
    while((si=reSi.exec(shared))!==null)strings.push(orderXmlText_(si[1]));
  }
  var book={updated:new Date(modified).toISOString(),rows:[]};
  var names=Object.keys(entries).filter(function(n){return /^xl\/worksheets\/sheet\d+\.xml$/.test(n);});
  if(names.length>150)throw new Error('TOO_MANY_SHEETS');
  names.forEach(function(path){
    var sheet=xml(path),row,reRow=/<row\b[^>]*>([\s\S]*?)<\/row>/g,headers=null,index=0;
    while((row=reRow.exec(sheet))!==null){
      var values={};
      var cell,reCell=/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      while((cell=reCell.exec(row[1]))!==null){
        var ref=/\br=["']([A-Z]+)\d+["']/.exec(cell[1]);if(!ref)continue;
        var type=/\bt=["']([^"']+)["']/.exec(cell[1]),body=cell[2] || '',v=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        values[ref[1]]=type && type[1]==='s' ? (strings[Number(v ? v[1] : -1)] || '') : (type && type[1]==='inlineStr' ? orderXmlText_(body) : orderXmlDecode_(v ? v[1] : ''));
      }
      index++;
      if(!headers && index<=10){
        var candidate={};Object.keys(values).forEach(function(c){candidate[orderHeader_(values[c])]=c;});
        if(candidate.PLATAFORMA && (candidate.ORDEN || candidate.PEDIDO || candidate['NUMERO DE PEDIDO'])) headers=candidate;
        continue;
      }
      if(!headers)break;
      function get(keys,max){for(var k=0;k<keys.length;k++){if(headers[keys[k]])return String(values[headers[keys[k]]] || '').trim().slice(0,max || 500);}return '';}
      var platform=orderPlatform_(get(['PLATAFORMA'],50));
      var number=orderNumber_(get(['ORDEN','PEDIDO','NUMERO DE PEDIDO'],100));
      if(!platform || !number)continue;
      book.rows.push({platform:platform,number:number,email:get(['EMAIL','E-MAIL','CORREO','CORREO ELECTRONICO'],254).toLowerCase(),
        name:get(['NOMBRE','NOMBRE COMPLETO','CLIENTE'],180),phone:get(['TELEFONO','CELULAR','MOVIL'],40),document:get(['DOCUMENTO','CEDULA','IDENTIFICACION'],40),
        product:get(['PRODUCTO','NOMBRE PRODUCTO']),quantity:get(['UNDS','UNIDADES','CANTIDAD'],30),
        guide:get(['GUIA','NUMERO DE GUIA','NRO GUIA'],150),carrier:get(['TRANSPORTADORA','TRANSPORTADOR'],80)});
      if(book.rows.length>20000)throw new Error('TOO_MANY_ORDERS');
    }
  });
  if(!book.rows.length || file.getLastUpdated().getTime()!==modified)throw new Error('WORKBOOK_CHANGED');
  // Cache chunks below Google's per-key 100 KB limit, including UTF-8 characters.
  var serialized=JSON.stringify(book),count=Math.ceil(serialized.length/20000);
  if(count<=100){for(var c=0;c<count;c++)cache.put(prefix+c,serialized.slice(c*20000,(c+1)*20000),300);cache.put(prefix+'meta',JSON.stringify({count:count}),300);}
  return book;
}
function orderXmlText_(xml) {
  // Only cell text; phonetic annotations must not alter customer names.
  xml=xml.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g,'');
  var text='',m,re=/<t\b[^>]*>([\s\S]*?)<\/t>/g;
  while((m=re.exec(xml))!==null)text+=orderXmlDecode_(m[1]);
  return text;
}
function orderXmlDecode_(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,function(all,e){
    if(e[0]==='#'){var n=e[1].toLowerCase()==='x' ? parseInt(e.slice(2),16) : Number(e.slice(1));return n>0 && n<=0x10ffff ? String.fromCodePoint(n) : '';}
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()];
  });
}
