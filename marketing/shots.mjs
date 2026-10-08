import { connect, out, shot, sleep } from './cdp.mjs';
const B = 'http://localhost:3000';
const l = await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!', tenantSlug: 'pharmacie-pilote' }) })).json();
const session = { accessToken: l.accessToken, refreshToken: l.refreshToken, user: l.user, tenant: l.tenant, permissions: l.permissions };
const c = await connect();
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false });
await c.send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500);
await c.evalJs(`sessionStorage.setItem('erp.session', ${JSON.stringify(JSON.stringify(session))}); true`);
const pages = ['cockpit', 'dashboard', 'advisor', 'sales', 'products', 'stock', 'purchasing', 'suppliers', 'online', 'customers', 'finance', 'accounting', 'company', 'plants', 'team', 'tax', 'payroll', 'training', 'pos'];
for (const p of pages) {
  await c.send('Page.navigate', { url: `http://localhost:5173/#${p}` });
  await c.evalJs(`location.hash='${p}'; true`);
  await c.send('Page.reload');
  await sleep(4500);
  await shot(c, out(`${p}.png`));
  const txt = await c.evalJs(`document.querySelector('main')?.innerText?.slice(0, 700) ?? ''`);
  console.log('=== ' + p + '\n' + String(txt).replace(/\n+/g, ' | ').slice(0, 420));
}
c.close();
