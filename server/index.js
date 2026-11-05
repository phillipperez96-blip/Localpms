import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Friendly check: the built-in SQLite database needs Node.js 22.13 or newer.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n  LocalPMS needs Node.js 22.13 or newer (you have ${process.version}).\n  Download the current LTS version from https://nodejs.org and try again.\n`);
  process.exit(1);
}
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { default: express } = await import('express');
const { get, all, getState, setState, UPLOAD_DIR } = await import('./db.js');
const { seedDatabase } = await import('./seed.js');
const { processFacility } = await import('./core.js');
const { today } = await import('./util.js');
const { default: api } = await import('./routes/index.js');

// First run: generate demo data.
if (!get("SELECT name FROM sqlite_master WHERE type='table' AND name='facilities'") || !get('SELECT id FROM facilities LIMIT 1')) {
  await seedDatabase();
}

// Nightly processing: runs on start-up (catch-up) and then every hour checks for a new day.
export async function runDailyProcessing(force = false) {
  const T = today();
  if (!force && getState('last_processed') === T) return null;
  const results = {};
  for (const f of all('SELECT id, name FROM facilities')) results[f.name] = await processFacility(f.id, T);
  setState('last_processed', T);
  console.log(`[daily] processed ${T}`, results);
  return results;
}
await runDailyProcessing();
setInterval(() => runDailyProcessing().catch((e) => console.error('[daily]', e)), 60 * 60 * 1000);

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT) || 3001;
const srv = app.listen(PORT, () => {
  console.log(`\n  LocalPMS API running on http://localhost:${PORT}`);
  if (fs.existsSync(dist)) console.log(`  Open http://localhost:${PORT} in your browser`);
  console.log('  Demo login: admin@demo.com / demo123\n');
  if (process.env.OPEN_BROWSER && fs.existsSync(dist)) openBrowser(`http://localhost:${PORT}`);
});
srv.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Close the other copy of LocalPMS, or start on another port, e.g.\n    Windows:   set PORT=3002 && npm start\n    Mac/Linux: PORT=3002 npm start\n`);
  else console.error(e);
  process.exit(1);
});

async function openBrowser(url) {
  const { spawn } = await import('node:child_process');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser available */ }
}
