import fs from 'node:fs';
import { connect, sleep } from './cdp.mjs';
const name = process.argv[2] || 'pharmacorp-main.mp4';
const c = await connect();
await c.send('Page.enable');
await c.send('Page.navigate', { url: 'http://localhost:8899/index.html?preview=1' });
await sleep(1500);
const info = await c.evalJs(`(async () => {
  const v = document.createElement('video'); v.src = '/out/${name}'; v.muted = false; v.preload = 'auto'; document.body.appendChild(v);
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('lecture impossible')); setTimeout(() => j(new Error('timeout')), 8000); });
  const out = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
  const cv = document.createElement('canvas'); cv.width = 270; cv.height = 480; const g = cv.getContext('2d');
  const frames = [];
  for (const t of [1.5, 7, 12.5, 17.5, 25, 31, 36, 43.5]) { const sk = new Promise((r) => (v.onseeked = r)); v.currentTime = Math.min(t, v.duration - .1); await sk; await new Promise((r) => setTimeout(r, 400)); g.drawImage(v, 0, 0, 270, 480); frames.push(cv.toDataURL('image/jpeg', .7)); }
  out.frames = frames;
  try { await v.play(); await new Promise((r) => setTimeout(r, 1500)); out.audioBytes = v.webkitAudioDecodedByteCount; out.videoBytes = v.webkitVideoDecodedByteCount; out.hasAudio = v.mozHasAudio ?? (v.webkitAudioDecodedByteCount > 0); } catch (e) { out.playError = String(e); }
  return JSON.stringify(out);
})()`);
const o = JSON.parse(info);
console.log({ duration: o.duration, w: o.w, h: o.h, audioBytes: o.audioBytes, videoBytes: o.videoBytes, playError: o.playError });
fs.mkdirSync('preview', { recursive: true });
o.frames.forEach((d, i) => fs.writeFileSync(`preview/mp4-${i}.jpg`, Buffer.from(d.split(',')[1], 'base64')));
c.close();
