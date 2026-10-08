// Enregistre le short (cut = main | short) dans Chrome et le dépose dans marketing/out/*.mp4 via server.mjs
import { connect, sleep } from './cdp.mjs';
const cut = process.argv[2] || 'main';
const c = await connect();
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 1, mobile: false });
await c.send('Page.navigate', { url: `http://localhost:8899/index.html?cut=${cut}` });
const t0 = Date.now();
for (;;) {
  await sleep(2000);
  const r = await c.evalJs('JSON.stringify({ r: window.__result ?? null, e: window.__err ?? null })');
  const o = JSON.parse(r || '{}');
  if (o.e) { console.log('ERREUR', o.e); break; }
  if (o.r) { console.log('terminé', JSON.stringify(o.r), Math.round((Date.now() - t0) / 1000) + ' s'); break; }
  if (Date.now() - t0 > 420000) { console.log('délai dépassé'); break; }
}
c.close();
