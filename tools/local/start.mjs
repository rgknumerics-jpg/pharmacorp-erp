/**
 * Lanceur local de PHARMACORP ERP (Windows, sans Docker) :
 *   base PostgreSQL embarquee (donnees dans .local-db) -> migrations -> API (port 3000) -> interface (port 5173).
 * Au premier lancement, un jeu de donnees de demonstration est cree (voir demo-seed.mjs).
 * Arret : fermer la fenetre (ou Ctrl+C).
 */
import EmbeddedPostgres from 'embedded-postgres';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dataDir = join(root, '.local-db');
const OWNER_URL = 'postgresql://erp:erp@localhost:5442/erp_dev?schema=public';
const APP_URL = 'postgresql://erp_app:erp_app@localhost:5442/erp_dev?schema=public';
const log = (m) => console.log(`\n=== ${m}`);
const run = (cmd, cwd, env = {}) => {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`Echec : ${cmd}`);
};

mkdirSync(dataDir, { recursive: true });
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'erp', password: 'erp', port: 5442, persistent: true,
  // messages du serveur en anglais : le demarrage attend le texte « ready to accept connections »
  initdbFlags: ['--lc-messages=C'], postgresFlags: ['-c', 'lc_messages=C'] });
log('Base de donnees');
if (!existsSync(join(dataDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try { await pg.createDatabase('erp_dev'); } catch { /* deja creee */ }

log('Mise a jour du schema');
run('npx prisma migrate deploy', join(root, 'packages', 'database'), { DATABASE_URL: OWNER_URL });
run('npm run db:seed', root, { DATABASE_URL: OWNER_URL });

if (!existsSync(join(root, 'apps', 'api', 'dist', 'main.js'))) { log('Compilation de l\'API (premier lancement)'); run('npm run build:api', root); }
if (!existsSync(join(root, 'apps', 'web', 'dist', 'index.html'))) { log('Compilation de l\'interface (premier lancement)'); run('npx vite build', join(root, 'apps', 'web')); }

log('Demarrage de l\'API (http://localhost:3000)');
const api = spawn('node', ['dist/main.js'], { cwd: join(root, 'apps', 'api'), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: APP_URL, QUEUE_MODE: 'off' } });
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://localhost:3000/health')).status < 500) break; } catch { /* pas encore pret */ } await new Promise((r) => setTimeout(r, 1000)); }

const flag = join(dataDir, '.demo-ok');
if (!existsSync(flag)) {
  log('Creation des donnees de demonstration (une seule fois)');
  run('node demo-seed.mjs', here, { OWNER_URL });
  writeFileSync(flag, new Date().toISOString());
}

log('Interface : http://localhost:5173');
const web = spawn('npx', ['vite', 'preview', '--port', '5173', '--strictPort', '--host', '127.0.0.1'], { cwd: join(root, 'apps', 'web'), stdio: 'inherit', shell: true });
setTimeout(() => spawn('cmd', ['/c', 'start', 'http://localhost:5173'], { stdio: 'ignore', detached: true }), 3000);

const stop = async () => { api.kill(); web.kill(); await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
