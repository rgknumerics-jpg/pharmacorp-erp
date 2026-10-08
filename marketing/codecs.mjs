import { connect, sleep } from './cdp.mjs';
const c = await connect();
await c.send('Page.enable');
await c.send('Page.navigate', { url: 'http://localhost:8899/index.html?preview=1' });
await sleep(1500);
console.log(await c.evalJs(`(async () => {
  const out = {};
  out.vEnc = typeof VideoEncoder; out.aEnc = typeof AudioEncoder;
  for (const codec of ['avc1.640029', 'avc1.64002A', 'avc1.4d0029', 'avc1.42E01F']) { try { const r = await VideoEncoder.isConfigSupported({ codec, width: 1080, height: 1920, bitrate: 3e6, framerate: 30 }); out[codec] = r.supported; } catch (e) { out[codec] = 'err ' + e.message; } }
  try { const r = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 128000 }); out.aac = r.supported; } catch (e) { out.aac = 'err ' + e.message; }
  return JSON.stringify(out);
})()`));
c.close();
