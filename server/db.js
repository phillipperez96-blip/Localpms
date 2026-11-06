// SQLite data layer (uses Node's built-in node:sqlite — no native build step required).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'storage.db');

let db = open();

function open() {
  const d = new DatabaseSync(DB_PATH);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return d;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT, address TEXT, city TEXT, state TEXT, zip TEXT,
  phone TEXT, email TEXT, office_hours TEXT, gate_hours TEXT,
  billing_type TEXT DEFAULT 'anniversary', prorate INTEGER DEFAULT 1, tax_rate REAL DEFAULT 0.0825,
  admin_fee REAL DEFAULT 25, deposit REAL DEFAULT 0, gate_deny_days INTEGER DEFAULT 6,
  lien_automation TEXT DEFAULT 'auto', reservation_days INTEGER DEFAULT 7, note_reminder INTEGER DEFAULT 0,
  late_fees TEXT, lien_steps TEXT, audit_template TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]', rank INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT,
  password_hash TEXT NOT NULL, role_id INTEGER REFERENCES roles(id), facility_ids TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1, last_login TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY, facility_id INTEGER NOT NULL REFERENCES facilities(id), number TEXT NOT NULL,
  building TEXT, unit_type TEXT, width REAL, length REAL, sqft REAL, floor INTEGER DEFAULT 1, door_type TEXT,
  street_rate REAL, status TEXT DEFAULT 'vacant', overlocked INTEGER DEFAULT 0, unrentable_reason TEXT,
  features TEXT, map_x REAL, map_y REAL, map_w REAL, map_h REAL, notes TEXT,
  UNIQUE(facility_id, number)
);
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY, facility_id INTEGER NOT NULL REFERENCES facilities(id),
  first_name TEXT, last_name TEXT, company TEXT, email TEXT, phone TEXT, alt_phone TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT, dl_number TEXT, dl_state TEXT, dob TEXT,
  emergency_name TEXT, emergency_phone TEXT, military INTEGER DEFAULT 0,
  gate_code TEXT, gate_access TEXT DEFAULT 'auto', gate_last_state TEXT,
  autopay INTEGER DEFAULT 0, autopay_method TEXT, delinquent_since TEXT, sms_opt_in INTEGER DEFAULT 1, email_opt_in INTEGER DEFAULT 1,
  notes TEXT, status TEXT DEFAULT 'active', lead_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS insurance_plans (
  id INTEGER PRIMARY KEY, name TEXT, coverage REAL, premium REAL, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY, facility_id INTEGER, name TEXT, description TEXT,
  discount_type TEXT, value REAL, months INTEGER DEFAULT 1, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rentals (
  id INTEGER PRIMARY KEY, facility_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  unit_id INTEGER NOT NULL REFERENCES units(id), move_in_date TEXT, move_out_date TEXT, rent REAL,
  insurance_plan_id INTEGER, insurance_premium REAL DEFAULT 0, promotion_id INTEGER, promo_months_left INTEGER DEFAULT 0,
  next_due_date TEXT, status TEXT DEFAULT 'active', lien_status TEXT DEFAULT 'current', lien_hold INTEGER DEFAULT 0,
  move_out_reason TEXT, vacate_notes TEXT, signature TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, facility_id INTEGER NOT NULL, tenant_id INTEGER, rental_id INTEGER,
  date TEXT NOT NULL, type TEXT NOT NULL, category TEXT, description TEXT, amount REAL NOT NULL,
  method TEXT, reference TEXT, sale_id INTEGER, voided INTEGER DEFAULT 0, user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_ledger_tenant ON ledger(tenant_id);
CREATE INDEX IF NOT EXISTS ix_ledger_fac_date ON ledger(facility_id, date);
CREATE TABLE IF NOT EXISTS lien_events (
  id INTEGER PRIMARY KEY, facility_id INTEGER, rental_id INTEGER, tenant_id INTEGER, step_key TEXT,
  step_name TEXT, cycle TEXT, date TEXT, fee REAL DEFAULT 0, notes TEXT, auto INTEGER DEFAULT 0, user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY, facility_id INTEGER, rental_id INTEGER, tenant_id INTEGER, unit_id INTEGER,
  scheduled_date TEXT, platform TEXT, listing_url TEXT, status TEXT DEFAULT 'scheduled',
  winning_bidder TEXT, bidder_phone TEXT, sale_amount REAL, buyer_premium REAL, applied_to_balance REAL,
  surplus REAL, cleanout_deadline TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, facility_id INTEGER, first_name TEXT, last_name TEXT, phone TEXT, email TEXT,
  source TEXT, unit_type TEXT, size_wanted TEXT, desired_date TEXT, status TEXT DEFAULT 'new',
  unit_id INTEGER, reservation_expires TEXT, quoted_rate REAL, follow_up_date TEXT, lost_reason TEXT,
  notes TEXT, assigned_to INTEGER, tenant_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY, key TEXT, name TEXT, channel TEXT, category TEXT, subject TEXT, body TEXT
);
CREATE TABLE IF NOT EXISTS communications (
  id INTEGER PRIMARY KEY, facility_id INTEGER, tenant_id INTEGER, lead_id INTEGER, channel TEXT,
  direction TEXT DEFAULT 'outbound', to_address TEXT, subject TEXT, body TEXT, status TEXT,
  provider_ref TEXT, error TEXT, template_key TEXT, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, facility_id INTEGER, sku TEXT, name TEXT, category TEXT, price REAL, cost REAL,
  qty_on_hand INTEGER DEFAULT 0, reorder_point INTEGER DEFAULT 5, taxable INTEGER DEFAULT 1, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY, facility_id INTEGER, tenant_id INTEGER, customer_name TEXT, subtotal REAL,
  tax REAL, total REAL, method TEXT, reference TEXT, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, date TEXT
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, name TEXT, qty INTEGER, price REAL
);
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY, facility_id INTEGER, product_id INTEGER, qty_change INTEGER, reason TEXT,
  notes TEXT, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_closes (
  id INTEGER PRIMARY KEY, facility_id INTEGER, date TEXT, expected_cash REAL, counted_cash REAL,
  expected_check REAL, counted_check REAL, card_total REAL, ach_total REAL, other_total REAL, total REAL,
  variance REAL, deposit_ref TEXT, notes TEXT, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(facility_id, date)
);
CREATE TABLE IF NOT EXISTS rent_increases (
  id INTEGER PRIMARY KEY, facility_id INTEGER, rental_id INTEGER, tenant_id INTEGER, unit_id INTEGER,
  old_rent REAL, new_rent REAL, notice_date TEXT, effective_date TEXT, status TEXT DEFAULT 'scheduled',
  user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rate_history (
  id INTEGER PRIMARY KEY, facility_id INTEGER, unit_type TEXT, size TEXT, old_rate REAL, new_rate REAL,
  unit_count INTEGER, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, facility_id INTEGER, title TEXT, description TEXT, due_date TEXT,
  priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', category TEXT, assigned_to INTEGER,
  created_by INTEGER, source TEXT DEFAULT 'manual', audit_id INTEGER, tenant_id INTEGER, unit_id INTEGER,
  completed_at TEXT, completed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY, facility_id INTEGER, auditor_id INTEGER, visit_date TEXT, period TEXT,
  status TEXT DEFAULT 'draft', score REAL, max_score REAL, summary TEXT, manager_response TEXT,
  acknowledged_by INTEGER, acknowledged_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_items (
  id INTEGER PRIMARY KEY, audit_id INTEGER, category TEXT, label TEXT, max_points REAL, points REAL,
  notes TEXT, sort INTEGER
);
CREATE TABLE IF NOT EXISTS audit_photos (
  id INTEGER PRIMARY KEY, audit_id INTEGER, filename TEXT, caption TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gate_events (
  id INTEGER PRIMARY KEY, facility_id INTEGER, tenant_id INTEGER, unit_id INTEGER, code TEXT, event TEXT,
  detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY, facility_id INTEGER, user_id INTEGER, entity_type TEXT, entity_id INTEGER,
  action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_activity ON activity_log(facility_id, created_at);
CREATE TABLE IF NOT EXISTS tenant_notes (
  id INTEGER PRIMARY KEY, facility_id INTEGER, tenant_id INTEGER NOT NULL, user_id INTEGER, body TEXT NOT NULL,
  created_ms INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_tenant_notes ON tenant_notes(tenant_id);
CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT);
`;

export function migrate() {
  db.exec(SCHEMA);
  // lightweight column migrations for databases created by older builds
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('tenants').includes('delinquent_since')) db.exec('ALTER TABLE tenants ADD COLUMN delinquent_since TEXT');
  if (!cols('facilities').includes('note_reminder')) db.exec('ALTER TABLE facilities ADD COLUMN note_reminder INTEGER DEFAULT 0');
  // move notes written by older builds (kept in the activity log) into the notes table, once
  if (!db.prepare("SELECT 1 x FROM system_state WHERE key='notes_migrated'").get()) {
    db.exec(`INSERT INTO tenant_notes (facility_id, tenant_id, user_id, body, created_ms, created_at)
      SELECT facility_id, entity_id, user_id, details, CAST((julianday(created_at) - 2440587.5) * 86400000 AS INTEGER), created_at
      FROM activity_log WHERE entity_type='tenant' AND action='note' AND entity_id IS NOT NULL`);
    db.exec("INSERT INTO system_state(key,value) VALUES('notes_migrated','1')");
  }
  // grant the note-reminder permission to senior roles on databases created before it existed
  if (!db.prepare("SELECT 1 x FROM system_state WHERE key='perm_note_reminder'").get()) {
    for (const r of db.prepare("SELECT id, permissions FROM roles WHERE slug IN ('admin','dm','am')").all()) {
      const perms = JSON.parse(r.permissions || '[]');
      if (!perms.includes('settings.note_reminder')) { perms.push('settings.note_reminder'); db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify(perms), r.id); }
    }
    db.exec("INSERT INTO system_state(key,value) VALUES('perm_note_reminder','1')");
  }
}

export function resetDatabase() {
  db.close();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.rmSync(f);
  db = open();
  migrate();
}

const clean = (row) => (row ? { ...row } : row);
export const all = (sql, ...p) => db.prepare(sql).all(...p).map(clean);
export const get = (sql, ...p) => clean(db.prepare(sql).get(...p));
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const exec = (sql) => db.exec(sql);

let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { depth--; }
}

/** Insert an object into a table; returns new id. */
export function insert(table, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(run(sql, ...keys.map((k) => norm(obj[k]))).lastInsertRowid);
}
/** Update columns on a row by id. */
export function update(table, id, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => norm(obj[k])), id);
}
function norm(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function getState(key, def = null) { const r = get('SELECT value FROM system_state WHERE key=?', key); return r ? r.value : def; }
export function setState(key, value) { run('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }

migrate();
