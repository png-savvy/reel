import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// REEL_DATA points the server at another data folder (used to test against a copy of the real data).
export const DATA = process.env.REEL_DATA || path.join(ROOT, 'data');
export const CATALOG_PATH = path.join(DATA, 'catalog.db');

fs.mkdirSync(DATA, { recursive: true });
export const hasCatalog = () => fs.existsSync(CATALOG_PATH);

export const db = new Database(path.join(DATA, 'user.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (title_id TEXT PRIMARY KEY, value INTEGER NOT NULL, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS watchlist (title_id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS dismissed (title_id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS ext (
    title_id TEXT PRIMARY KEY,
    wd_checked INTEGER, rt_slug TEXT, wiki TEXT,
    rt_checked INTEGER, rt_aud INTEGER, rt_crit INTEGER, rt_aud_count TEXT,
    omdb_checked INTEGER, metacritic INTEGER, omdb_rt_crit INTEGER, rated TEXT, actors TEXT, awards TEXT,
    tmdb_checked INTEGER, tmdb_id INTEGER, tmdb_score REAL, backdrop TEXT, trailer TEXT, providers TEXT, cast TEXT,
    poster TEXT, plot TEXT
  );
  CREATE TABLE IF NOT EXISTS recs (source_id TEXT, target_id TEXT, rank INTEGER, PRIMARY KEY (source_id, target_id));
`);
// Columns added after the first release: where-to-watch, content ratings (Common Sense Media) and VidAngel availability.
for (const [col, kind] of [['rt_watch', 'TEXT'], ['csm_checked', 'INTEGER'], ['csm', 'TEXT'], ['va_checked', 'INTEGER'], ['va', 'TEXT']]) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('ext') WHERE name=?").get(col)) db.exec(`ALTER TABLE ext ADD COLUMN ${col} ${kind}`);
}
// One-off: titles looked up on TMDB before age ratings were collected get looked up again.
if (!db.prepare("SELECT 1 FROM settings WHERE key='ratedBackfill'").get()) {
  db.exec("UPDATE ext SET tmdb_checked = NULL WHERE tmdb_checked IS NOT NULL AND rated IS NULL; INSERT INTO settings (key, value) VALUES ('ratedBackfill', '1')");
}
// One-off: VidAngel availability now comes from their sitemap; forget answers from the old lookup.
if (!db.prepare("SELECT 1 FROM settings WHERE key='vaSitemap'").get()) {
  db.exec("UPDATE ext SET va_checked = NULL; INSERT INTO settings (key, value) VALUES ('vaSitemap', '1')");
}
if (hasCatalog()) db.exec(`ATTACH DATABASE '${CATALOG_PATH.replace(/'/g, "''")}' AS cat`);

const DEFAULTS = {
  onboarded: false,
  rtEnabled: false,
  tmdbKey: '',
  omdbKey: '',
  region: 'US',
};
const getStmt = db.prepare('SELECT value FROM settings WHERE key=?');
const setStmt = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
export function getSetting(key) {
  const row = getStmt.get(key);
  return row ? JSON.parse(row.value) : DEFAULTS[key];
}
export function setSetting(key, value) { setStmt.run(key, JSON.stringify(value)); }
export function allSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = JSON.parse(r.value);
  return out;
}
