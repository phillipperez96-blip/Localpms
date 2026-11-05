import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
app.listen(PORT, () => {
  console.log(`\n  LocalPMS API running on http://localhost:${PORT}`);
  if (fs.existsSync(dist)) console.log(`  Open http://localhost:${PORT} in your browser`);
  console.log('  Demo login: admin@demo.com / demo123\n');
});
