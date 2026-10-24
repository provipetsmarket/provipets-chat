import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
const output = new URL('../.vercel/output/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(new URL('functions/api/chat.func/', output), { recursive: true });
await cp(new URL('../storefront/public/', import.meta.url), new URL('static/', output), { recursive: true });
await cp(new URL('../storefront/server/', import.meta.url), new URL('functions/api/chat.func/', output), { recursive: true });
await writeFile(new URL('functions/api/chat.func/.vc-config.json', output), JSON.stringify({
  runtime: 'nodejs22.x', handler: 'chat.mjs', launcherType: 'Nodejs',
  supportsResponseStreaming: true, maxDuration: 240
}));
await writeFile(new URL('config.json', output), JSON.stringify({version: 3, routes: [
  {src: '/widget.js', headers: {'Cache-Control': 'public, max-age=300'}, continue: true},
  {src: '/(.*)', headers: {'X-Content-Type-Options': 'nosniff'}, continue: true},
  {handle: 'filesystem'}, {src: '/', dest: '/index.html'}
]}));
console.log('Chat web y función /api/chat generados. No requiere base de datos.');
