import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('./',import.meta.url);
const [server,orders,html,config]=await Promise.all([
  readFile(new URL('../Server.gs',base),'utf8'),readFile(new URL('Orders.gs',base),'utf8'),
  readFile(new URL('Index.html',base),'utf8'),readFile(new URL('../../storefront/server/agent.json',base),'utf8')
]);
const redirect='\n\nCONSULTA DE PEDIDOS: Para compras de cualquier plataforma, indica que debe pulsar «Consultar mi pedido» y verificar allí su correo. No solicites datos personales en la conversación. La verificación y búsqueda ocurren en ese formulario separado; no tienes acceso a los resultados.';
const agent=JSON.parse(config);agent.agent.instructions+=redirect;
const code=server+'\n'+orders+'\nvar AGENT_CONFIG_ = '+JSON.stringify(agent)+';\nvar CHAT_HTML_ = '+JSON.stringify(html)+';\n';
await writeFile(new URL('Code.gs',base),code);
await writeFile(new URL('Codigo-pedidos.txt',base),code);
console.log('Versión de pedidos preparada. Clave y propiedades actuales se conservan en Google.');
