// Petit serveur local : sert le dossier marketing/ et reçoit la vidéo enregistrée par le navigateur.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(rootDir, 'out'); fs.mkdirSync(outDir, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.js': 'text/javascript', '.mp4': 'video/mp4', '.mjs': 'text/javascript' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/upload') {
    const name = path.basename(u.searchParams.get('name') || 'video.mp4');
    const ws = fs.createWriteStream(path.join(outDir, name));
    req.pipe(ws); ws.on('finish', () => { res.writeHead(200); res.end('ok'); });
    return;
  }
  const file = path.join(rootDir, 'video', decodeURIComponent(u.pathname).replace(/^\/+/, ''));
  const alt = path.join(rootDir, decodeURIComponent(u.pathname).replace(/^\/+/, ''));
  const target = [file, alt].find((f) => f.startsWith(rootDir) && fs.existsSync(f) && fs.statSync(f).isFile());
  if (!target) { res.writeHead(404); return res.end('404'); }
  const type = mime[path.extname(target)] || 'application/octet-stream';
  const size = fs.statSync(target).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) { // lecture partielle (nécessaire pour se déplacer dans une vidéo)
    const start = m[1] ? Number(m[1]) : 0, end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(target, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(target).pipe(res);
}).listen(8899, () => console.log('serveur vidéo : http://localhost:8899/'));
