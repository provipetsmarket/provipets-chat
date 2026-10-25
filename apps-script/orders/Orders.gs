/** Private XLSX lookup. No workbook content is sent to OpenAI. */
var ORDER_NS_ = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function requestOrderCode(platform, order, email) {
  platform = orderPlatform_(platform);
  order = orderNumber_(order);
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!platform || !order || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email) || email.length > 254) {
    return {ok:false,text:'Selecciona la plataforma y escribe el número de pedido y el correo de la compra.'};
  }
  var generic = 'Si los datos coinciden con un pedido que tiene correo registrado, recibirás un código válido por 10 minutos. Revisa también spam. Si no llega, verifica los datos o solicita atención en el canal donde compraste.';
  var cache = CacheService.getScriptCache();
  var challenge = Utilities.getUuid().replace(/-/g,'');
  var lock = LockService.getScriptLock();
  var secret, key;
  try {
    if (!lock.tryLock(3000)) return {ok:false,text:'Espera un momento y vuelve a intentarlo.'};
    try {
      var props = PropertiesService.getScriptProperties();
      secret = orderSecret_(props);
      key = orderDigest_(platform+'|'+order+'|'+email,secret);
      var day = Utilities.formatDate(new Date(),'America/Bogota','yyyy-MM-dd');
      var count = props.getProperty('ORDER_DAY') === day ? Number(props.getProperty('ORDER_ATTEMPTS') || 0) : 0;
      // Every attempt counts before reading Drive or sending mail. Not a dollar budget.
      if (count >= 50) return {ok:false,text:'La consulta de pedidos alcanzó su límite diario. Inténtalo mañana o solicita atención en el canal de compra.'};
      props.setProperties({ORDER_DAY:day,ORDER_ATTEMPTS:String(count+1)});
      if (cache.get('order-cooldown:'+key)) return {ok:false,text:'Espera un minuto antes de solicitar otro código.'};
      cache.put('order-cooldown:'+key,'1',60);
    } finally {lock.releaseLock();}
    var workbook = readOrderWorkbook_();
    var result = matchingOrder_(workbook,platform,order,email);
    var code = String(parseInt(orderDigest_(Utilities.getUuid(),secret).slice(0,8),16) % 1000000).padStart(6,'0');
    // Even unknown orders get an opaque challenge and the same response. Never reveal existence.
    cache.put('order-otp:'+challenge,JSON.stringify({hash:orderDigest_(challenge+'|'+code,secret),
      attempts:0,expires:Date.now()+600000,result:result}),600);
    if (result) {
      if (MailApp.getRemainingDailyQuota() < 1) throw new Error('MAIL_QUOTA');
      // Only the exact, registered address is accepted by matchingOrder_. No user-selected recipient.
      MailApp.sendEmail({to:email,subject:'Código para consultar tu pedido — Provipets Market',
        body:'Tu código de verificación es: '+code+'\n\nVence en 10 minutos. No lo compartas. Si no solicitaste consultar tu pedido, puedes ignorar este mensaje.',
        name:'Provipets Market'});
    }
    return {ok:true,challenge:challenge,text:generic};
  } catch (e) {
    cache.remove('order-otp:'+challenge);
    console.error(JSON.stringify({event:'order_lookup_error',code:'LOOKUP_UNAVAILABLE'}));
    return {ok:false,text:'No pude verificar la plantilla en este momento. Inténtalo más tarde o solicita atención en el canal donde compraste.'};
  }
}

function verifyOrderCode(challenge, code) {
  var invalid = {ok:false,text:'El código no es válido o venció. Revisa el código o solicita uno nuevo.'};
  if (typeof challenge !== 'string' || !/^[a-f0-9]{32}$/i.test(challenge) || typeof code !== 'string' || !/^\d{6}$/.test(code)) return invalid;
  var cache = CacheService.getScriptCache(), lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return {ok:false,text:'Espera un momento y vuelve a intentarlo.'};
  try {
    var raw = cache.get('order-otp:'+challenge);
    if (!raw) return invalid;
    var entry = JSON.parse(raw);
    if (entry.expires <= Date.now() || entry.attempts >= 5) {cache.remove('order-otp:'+challenge);return invalid;}
    entry.attempts++;
    var secret = PropertiesService.getScriptProperties().getProperty('ORDER_SECRET');
    var actual = orderDigest_(challenge+'|'+code,secret);
    var diff = actual.length ^ entry.hash.length;
    for (var i=0;i<actual.length;i++) diff |= actual.charCodeAt(i) ^ (entry.hash.charCodeAt(i) || 0);
    if (diff || !entry.result) {
      if (entry.attempts >= 5) cache.remove('order-otp:'+challenge);
      else cache.put('order-otp:'+challenge,JSON.stringify(entry),Math.max(1,Math.ceil((entry.expires-Date.now())/1000)));
      return invalid;
    }
    cache.remove('order-otp:'+challenge); // Single-use code, including across browser tabs.
    return {ok:true,order:entry.result};
  } catch (e) {return invalid;}
  finally {lock.releaseLock();}
}

function orderSecret_(props) {
  var secret = props.getProperty('ORDER_SECRET');
  if (!secret) {secret=Utilities.getUuid()+Utilities.getUuid();props.setProperty('ORDER_SECRET',secret);}
  return secret;
}
function orderDigest_(value,secret) {
  return Utilities.computeHmacSha256Signature(value,secret).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
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
function matchingOrder_(book,platform,number,email) {
  var all=book.rows.filter(function(r){return r.platform===platform && r.number===number;});
  if (!all.length || all.length>100) return null;
  // Fail closed on missing/different email in any row sharing this order and channel.
  if (all.some(function(r){return r.email!==email;})) return null;
  var seen={},items=[];
  all.forEach(function(r){
    var key=JSON.stringify([r.product,r.quantity,r.guide,r.carrier]);
    if (!seen[key]) {seen[key]=true;items.push({product:r.product,quantity:r.quantity,guide:r.guide,carrier:r.carrier});}
  });
  // No recipient details, address, document, phone, other orders, internal status or invented ETA.
  return {number:number,platform:platform,updated:book.updated,items:items};
}

function readOrderWorkbook_() {
  var sourceId=PropertiesService.getScriptProperties().getProperty('ORDERS_FILE_ID');
  if(!sourceId)throw new Error('ORDERS_NOT_CONFIGURED');
  var file=DriveApp.getFileById(sourceId);
  var modified=file.getLastUpdated().getTime();
  if (file.getMimeType()!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') throw new Error('EXPECTED_XLSX');
  if (file.getSize()>10000000) throw new Error('FILE_TOO_LARGE');
  var cache=CacheService.getScriptCache();
  var prefix='orders-v1:'+modified+':';
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
  function xml(path){if(!entries[path])throw new Error('INVALID_XLSX');return XmlService.parse(entries[path].getDataAsString()).getRootElement();}
  var ns=XmlService.getNamespace(ORDER_NS_);
  var strings=[];
  if(entries['xl/sharedStrings.xml']) strings=xml('xl/sharedStrings.xml').getChildren('si',ns).map(function(si){return orderRichText_(si,ns);});
  var book={updated:new Date(modified).toISOString(),rows:[]};
  var names=Object.keys(entries).filter(function(n){return /^xl\/worksheets\/sheet\d+\.xml$/.test(n);});
  if(names.length>150)throw new Error('TOO_MANY_SHEETS');
  names.forEach(function(path){
    var data=xml(path).getChild('sheetData',ns);if(!data)return;
    var rows=data.getChildren('row',ns),headers=null;
    rows.forEach(function(row,index){
      var values={};
      row.getChildren('c',ns).forEach(function(cell){
        var attr=cell.getAttribute('r');if(!attr)return;
        var col=attr.getValue().replace(/[0-9]/g,'');
        var type=cell.getAttribute('t'),v=cell.getChildText('v',ns),is=cell.getChild('is',ns);
        values[col]=type && type.getValue()==='s' ? (strings[Number(v)] || '') : (is ? orderRichText_(is,ns) : (v || ''));
      });
      if(!headers && index<10){
        var candidate={};Object.keys(values).forEach(function(c){candidate[orderHeader_(values[c])]=c;});
        if(candidate.PLATAFORMA && (candidate.ORDEN || candidate.PEDIDO || candidate['NUMERO DE PEDIDO'])) headers=candidate;
        return;
      }
      if(!headers)return;
      function get(keys,max){for(var k=0;k<keys.length;k++){if(headers[keys[k]])return String(values[headers[keys[k]]] || '').trim().slice(0,max || 500);}return '';}
      var platform=orderPlatform_(get(['PLATAFORMA'],50));
      var number=orderNumber_(get(['ORDEN','PEDIDO','NUMERO DE PEDIDO'],100));
      if(!platform || !number)return;
      book.rows.push({platform:platform,number:number,email:get(['EMAIL','E-MAIL','CORREO','CORREO ELECTRONICO'],254).toLowerCase(),
        product:get(['PRODUCTO','NOMBRE PRODUCTO']),quantity:get(['UNDS','UNIDADES','CANTIDAD'],30),
        guide:get(['GUIA','NUMERO DE GUIA','NRO GUIA'],150),carrier:get(['TRANSPORTADORA','TRANSPORTADOR'],80)});
      if(book.rows.length>20000)throw new Error('TOO_MANY_ORDERS');
    });
  });
  if(!book.rows.length || file.getLastUpdated().getTime()!==modified)throw new Error('WORKBOOK_CHANGED');
  // Cache chunks below Google's per-key 100 KB limit, including UTF-8 characters.
  var serialized=JSON.stringify(book),count=Math.ceil(serialized.length/20000);
  if(count<=100){for(var c=0;c<count;c++)cache.put(prefix+c,serialized.slice(c*20000,(c+1)*20000),300);cache.put(prefix+'meta',JSON.stringify({count:count}),300);}
  return book;
}
function orderRichText_(node,ns) {
  var text=node.getChildText('t',ns) || '';
  node.getChildren('r',ns).forEach(function(r){text+=r.getChildText('t',ns) || '';});
  return text;
}
