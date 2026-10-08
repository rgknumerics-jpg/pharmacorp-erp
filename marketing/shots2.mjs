import { connect, out, shot, sleep } from './cdp.mjs';
const B = 'http://localhost:3000', S = 'pharmacie-pilote';
const post = async (p, body) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const c = await connect();
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// --- application client
await c.send('Page.navigate', { url: `http://localhost:5173/boutique/${S}` });
await sleep(4000);
await c.evalJs(`(()=>{const i=document.querySelector('input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'pa');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
await sleep(2500);
await shot(c, out('m-shop.png'));
// --- application livreur (session d'un livreur de démonstration)
const t = (await post('/auth/login', { email: 'admin@example.com', password: 'ChangeMe123!', tenantSlug: S })).accessToken;
const cs = await (await fetch(B + '/online-orders/couriers', { headers: { authorization: 'Bearer ' + t } })).json();
const ph = cs[0].phone;
const cl = await post(`/online/${S}/courier/login`, { phone: ph, pin: '2468' });
await c.send('Page.navigate', { url: `http://localhost:5173/livreur/${S}` });
await sleep(1500);
await c.evalJs(`localStorage.setItem('courier.${S}.token', ${JSON.stringify(JSON.stringify(cl.token))}); localStorage.setItem('courier.${S}.name', ${JSON.stringify(JSON.stringify(cl.name))}); true`);
await c.send('Page.reload');
await sleep(4500);
await shot(c, out('m-courier.png'));
console.log('ok', ph, cl.name);
c.close();
