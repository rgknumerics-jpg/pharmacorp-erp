// Petit client DevTools (Chrome lancé avec --remote-debugging-port=9333) : captures de l'ERP réel pour la vidéo.
import fs from 'node:fs';
import path from 'node:path';
const PORT = 9333;
export async function connect() {
  const tabs = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const tab = tabs.find((t) => t.type === 'page') ?? (await (await fetch(`http://localhost:${PORT}/json/new`, { method: 'PUT' })).json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(d.error.message)) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.value; };
  return { send, evalJs, close: () => ws.close() };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function shot(c, file, clip) {
  const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}
export const out = (n) => path.join('C:/Users/DELL 7390 8TH GEN i5/Desktop/ERP COMPLET/marketing/shots', n);
