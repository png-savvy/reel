// Builds data/catalog.db from IMDb's open datasets (https://datasets.imdbws.com).
// Usage: npm run catalog [-- --refresh]   (--refresh re-downloads the raw files)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { computeTvStats, bayes } from './tvstats.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'catalog.db');
const TMP = OUT + '.building';
const FILES = ['title.ratings', 'title.basics', 'title.episode', 'title.crew', 'name.basics'];
const MIN_VOTES = { movie: 400, tv: 300 };
const refresh = process.argv.includes('--refresh');

const log = (...a) => console.log(`[catalog ${new Date().toTimeString().slice(0, 8)}]`, ...a);

async function download() {
  fs.mkdirSync(RAW, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(RAW, `${f}.tsv.gz`);
    if (fs.existsSync(dest) && !refresh) continue;
    log('downloading', f);
    const res = await fetch(`https://datasets.imdbws.com/${f}.tsv.gz`);
    if (!res.ok) throw new Error(`download failed for ${f}: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + '.part'));
    fs.renameSync(dest + '.part', dest);
  }
}

async function* rows(name) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(RAW, `${name}.tsv.gz`)).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    yield line.split('\t');
  }
}
const nul = (v) => (v === '\\N' || v === undefined ? null : v);
const int = (v) => (v === '\\N' || v === undefined ? null : parseInt(v, 10));

async function main() {
  await download();
  if (fs.existsSync(TMP)) fs.rmSync(TMP);
  const db = new Database(TMP);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.exec(`
    CREATE TABLE titles (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, original TEXT,
      year INTEGER, end_year INTEGER, runtime INTEGER, genres TEXT,
      rating REAL, votes INTEGER, bayes REAL, directors TEXT, kind TEXT
    );
    CREATE TABLE episodes (
      id TEXT PRIMARY KEY, parent TEXT NOT NULL, season INTEGER, episode INTEGER,
      title TEXT, rating REAL, votes INTEGER
    );
    CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE title_people (title_id TEXT, person_id TEXT, role TEXT);
    CREATE TABLE tv_stats (
      id TEXT PRIMARY KEY, seasons INTEGER, eps INTEGER, ep_avg REAL, consistency REAL,
      landing REAL, retention REAL, hype_gap REAL, peak_season INTEGER, good_through INTEGER,
      worth REAL, season_means TEXT, ended INTEGER
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  log('reading ratings');
  const ratings = new Map();
  for await (const [id, r, v] of rows('title.ratings')) ratings.set(id, [parseFloat(r), parseInt(v, 10)]);

  log('reading titles');
  const TYPE = { movie: 'movie', tvSeries: 'tv', tvMiniSeries: 'tv' };
  const insTitle = db.prepare(`INSERT INTO titles (id,type,title,original,year,end_year,runtime,genres,rating,votes,kind)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const kept = new Map(); // id -> type
  let sums = { movie: [0, 0], tv: [0, 0] };
  db.exec('BEGIN');
  for await (const c of rows('title.basics')) {
    const type = TYPE[c[1]];
    if (!type || c[4] === '1') continue;
    const r = ratings.get(c[0]);
    if (!r || r[1] < MIN_VOTES[type]) continue;
    insTitle.run(c[0], type, c[2], c[3] !== c[2] ? c[3] : null, int(c[5]), int(c[6]), int(c[7]), nul(c[8]), r[0], r[1], c[1]);
    kept.set(c[0], type);
    sums[type][0] += r[0] * r[1]; sums[type][1] += r[1];
  }
  db.exec('COMMIT');
  log('kept', kept.size, 'titles');

  log('reading episodes');
  const insEp = db.prepare('INSERT OR IGNORE INTO episodes (id,parent,season,episode,rating,votes) VALUES (?,?,?,?,?,?)');
  const epIds = new Set();
  db.exec('BEGIN');
  for await (const [id, parent, s, e] of rows('title.episode')) {
    if (kept.get(parent) !== 'tv') continue;
    const r = ratings.get(id);
    insEp.run(id, parent, int(s), int(e), r ? r[0] : null, r ? r[1] : null);
    epIds.add(id);
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_ep_parent ON episodes(parent, season, episode)');

  log('reading episode titles');
  const updEp = db.prepare('UPDATE episodes SET title=? WHERE id=?');
  db.exec('BEGIN');
  for await (const c of rows('title.basics')) {
    if (c[1] === 'tvEpisode' && epIds.has(c[0])) updEp.run(c[2], c[0]);
  }
  db.exec('COMMIT');

  log('reading crew');
  const insTP = db.prepare('INSERT INTO title_people (title_id, person_id, role) VALUES (?,?,?)');
  const needNames = new Set();
  db.exec('BEGIN');
  for await (const [id, directors, writers] of rows('title.crew')) {
    const type = kept.get(id);
    if (!type) continue;
    const list = type === 'movie' ? nul(directors) : nul(writers);
    if (!list) continue;
    for (const p of list.split(',').slice(0, 3)) {
      insTP.run(id, p, type === 'movie' ? 'director' : 'creator');
      needNames.add(p);
    }
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_tp_title ON title_people(title_id); CREATE INDEX idx_tp_person ON title_people(person_id);');

  log('reading names');
  const insP = db.prepare('INSERT INTO people (id,name) VALUES (?,?)');
  db.exec('BEGIN');
  for await (const c of rows('name.basics')) if (needNames.has(c[0])) insP.run(c[0], c[1]);
  db.exec('COMMIT');
  db.exec(`UPDATE titles SET directors = (
    SELECT group_concat(p.name, ', ') FROM title_people tp JOIN people p ON p.id = tp.person_id WHERE tp.title_id = titles.id
  )`);

  log('computing weighted ratings + TV analytics');
  const mean = { movie: sums.movie[0] / sums.movie[1], tv: sums.tv[0] / sums.tv[1] };
  // Unweighted catalog means are a better prior than vote-weighted ones.
  for (const t of ['movie', 'tv']) mean[t] = db.prepare('SELECT avg(rating) a FROM titles WHERE type=?').get(t).a;
  const updB = db.prepare('UPDATE titles SET bayes=? WHERE id=?');
  const insStats = db.prepare(`INSERT INTO tv_stats VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const epsOf = db.prepare('SELECT season, episode, rating, votes FROM episodes WHERE parent=? ORDER BY season, episode');
  db.exec('BEGIN');
  for (const t of db.prepare('SELECT id,type,rating,votes,end_year FROM titles').all()) {
    const b = bayes(t.rating, t.votes, mean[t.type], t.type === 'movie' ? 2500 : 1500);
    updB.run(b, t.id);
    if (t.type === 'tv') {
      const s = computeTvStats(epsOf.all(t.id), { rating: t.rating, bayes: b, ended: t.end_year != null });
      if (s) insStats.run(t.id, s.seasons, s.eps, s.epAvg, s.consistency, s.landing, s.retention, s.hypeGap,
        s.peakSeason, s.goodThrough, s.worth, JSON.stringify(s.seasonMeans), t.end_year != null ? 1 : 0);
    }
  }
  db.exec('COMMIT');

  log('indexing');
  db.exec(`
    CREATE INDEX idx_titles_type_bayes ON titles(type, bayes DESC);
    CREATE INDEX idx_titles_type_votes ON titles(type, votes DESC);
    CREATE VIRTUAL TABLE titles_fts USING fts5(title, original, content='titles', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    INSERT INTO titles_fts (rowid, title, original) SELECT rowid, title, original FROM titles;
  `);
  const meta = db.prepare('INSERT INTO meta VALUES (?,?)');
  meta.run('built_at', new Date().toISOString());
  meta.run('mean_movie', String(mean.movie));
  meta.run('mean_tv', String(mean.tv));
  db.exec('VACUUM');
  db.close();
  fs.renameSync(TMP, OUT);
  log('done →', OUT, `${(fs.statSync(OUT).size / 1e6).toFixed(0)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
