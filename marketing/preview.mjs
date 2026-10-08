import fs from 'node:fs';
import { connect, sleep } from './cdp.mjs';
const cut = process.argv[2] || 'main';
const times = (process.argv[3] || '1,6,12,17,21,26,31,36,41,46').split(',').map(Number);
const c = await connect();
await c.send('Page.enable');
await c.send('Page.navigate', { url: `http://localhost:8899/index.html?preview=1&cut=${cut}` });
await sleep(3500);
const total = await c.evalJs('window.__ready ? window.__frame(0) : -1');
console.log('total', total);
fs.mkdirSync('C:/Users/DELL 7390 8TH GEN i5/Desktop/ERP COMPLET/marketing/preview', { recursive: true });
for (const t of times) {
  await c.evalJs(`window.__frame(${t})`);
  const d = await c.evalJs(`document.getElementById('c').toDataURL('image/jpeg', .85)`);
  fs.writeFileSync(`C:/Users/DELL 7390 8TH GEN i5/Desktop/ERP COMPLET/marketing/preview/${cut}-${String(t).padStart(2, '0')}.jpg`, Buffer.from(d.split(',')[1], 'base64'));
}
c.close();
