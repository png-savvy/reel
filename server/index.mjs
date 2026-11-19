import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { db, ROOT, hasCatalog, getSetting, setSetting, allSettings } from './db.mjs';
import { enrich, sourcesEnabled, testKey, rtStatus, vaDetail, vaStatus } from './providers.mjs';
import { candidates, contentRules, decorate, getProfile, invalidateProfile, invalidateRules, passesExternal, rankValue, selectTitles } from './engine.mjs';
import { tvVerdicts } from './tvstats.mjs';

const app = express();
app.use(express.json({ limit: '8mb' }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });
const needCatalog = (req, res, next) => (hasCatalog() ? next() : res.status(503).json({ error: 'catalog-missing' }));

const rowsByIds = (ids) => {
  if (!ids.length) return [];
  const rows = db.prepare(selectTitles(`WHERE t.id IN (${ids.map(() => '?').join(',')})`)).all(...ids);
  const by = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => by.get(id)).filter(Boolean);
};
const decorated = (ids, type) => rowsByIds(ids).map((r) => decorate(r, getProfile(type || r.type)));

// ---------- status & settings ----------
// The services switch used to be a per-page Discover filter. Until the new switch has been set either way,
// honour the old one so nobody's filter silently turns off.
const onlyMyServices = () => getSetting('onlyMyServices') ?? Object.values(getSetting('filters') || {}).some((f) => f?.onMyServices);
const publicSettings = () => {
  const s = allSettings();
  return { ...s, onlyMyServices: onlyMyServices(), tmdbKey: undefined, omdbKey: undefined, hasTmdb: !!s.tmdbKey, hasOmdb: !!s.omdbKey };
};
app.get('/api/status', wrap((req, res) => {
  const out = { catalog: hasCatalog(), settings: publicSettings(), sources: sourcesEnabled(), rt: rtStatus(), va: vaStatus() };
  if (out.catalog) {
    out.builtAt = db.prepare("SELECT value FROM meta WHERE key='built_at'").get()?.value;
    out.counts = Object.fromEntries(db.prepare('SELECT type, count(*) n FROM titles GROUP BY type').all().map((r) => [r.type, r.n]));
    out.rated = Object.fromEntries(db.prepare('SELECT t.type, count(*) n FROM ratings r JOIN titles t ON t.id=r.title_id WHERE r.value BETWEEN -2 AND 2 AND r.value != 0 GROUP BY t.type').all().map((r) => [r.type, r.n]));
    out.watchlist = db.prepare('SELECT count(*) n FROM watchlist').get().n;
  }
  res.json(out);
}));

app.post('/api/settings', wrap(async (req, res) => {
  const allowed = ['onboarded', 'rtEnabled', 'tmdbKey', 'omdbKey', 'region', 'filters', 'services', 'onlyMyServices', 'content', 'vidangel'];
  for (const k of allowed) if (k in req.body) setSetting(k, typeof req.body[k] === 'string' ? req.body[k].trim() : req.body[k]);
  if ('region' in req.body) db.exec('UPDATE ext SET tmdb_checked = NULL');
  if ('content' in req.body || 'vidangel' in req.body) { invalidateRules(); bustLists(); }
  res.json({ settings: publicSettings(), sources: sourcesEnabled() });
}));
app.post('/api/settings/test', wrap(async (req, res) => res.json(await testKey(req.body.kind, String(req.body.key || '').trim()))));

// The "only on my services" switch lives in Settings and applies to For you, tonight's pick and Discover.
// Returns the chosen services, or null when the switch is off or there is no source to check against.
const myServices = (src = sourcesEnabled()) => {
  const list = getSetting('services') || [];
  return onlyMyServices() && list.length && (src.rt || src.tmdb) ? list : null;
};

// Content rules also live in Settings. Truthy only when they can actually hide something; the value changes
// whenever the rules do, so cached lists are never reused across a change.
const contentFilter = () => { const r = contentRules(); return r?.filters ? JSON.stringify(r) : null; };
/** Which outside sources are needed to judge the global filters (services + content). */
const globalOnly = (src, svc, content) => [svc && src.rt && 'rt', svc && src.tmdb && 'tmdb', content && 'csm', content && src.va && contentRules()?.vaRescue && 'va'].filter(Boolean);

// ---------- discover ----------
const parseFilters = (req) => {
  let f = {};
  try { f = JSON.parse(req.query.f || '{}'); } catch { /* ignore */ }
  f.type = f.type === 'tv' ? 'tv' : 'movie';
  const svc = myServices();
  if (svc) f.services = svc; else delete f.services;
  const content = contentFilter();
  if (content) f.content = content; else delete f.content;
  if (f.sort === 'hidden' && !f.maxVotes) f.maxVotes = f.type === 'movie' ? 40000 : 25000;
  if (f.sort === 'hidden' && !f.minVotes) f.minVotes = 1500;
  return f;
};
const PAGE = 24;
let listCache = { key: '', at: 0, list: [] };
function rankedList(f) {
  const key = JSON.stringify(f);
  if (listCache.key === key && Date.now() - listCache.at < 120e3) return listCache.list;
  const list = candidates(f, 700);
  listCache = { key, at: Date.now(), list };
  return list;
}
const bustLists = () => { listCache = { key: '', at: 0, list: [] }; invalidateProfile(); pickCache.clear(); };

app.get('/api/discover', needCatalog, wrap(async (req, res) => {
  const f = parseFilters(req);
  const src = sourcesEnabled();
  let cursor = Math.max(0, parseInt(req.query.cursor || '0', 10));
  const list = rankedList(f);
  const wantServices = f.services?.length && (src.rt || src.tmdb);
  const external = (f.minRtAud && src.rt) || (f.minRtAudN && src.rt) || (f.minRtCrit && (src.rt || src.omdb)) || (f.minMeta && src.omdb) || wantServices || f.content;
  const items = [];
  let checked = 0, rejected = 0;
  const started = Date.now();
  if (!external) {
    while (cursor < list.length && items.length < PAGE) {
      const d = list[cursor++];
      if (passesExternal(d, f, src) === false) { rejected++; continue; }
      items.push(d.id);
    }
  } else {
    const only = [src.rt && (f.minRtAud || f.minRtAudN || f.minRtCrit || wantServices) ? 'rt' : null, src.omdb && (f.minMeta || (f.minRtCrit && !src.rt)) ? 'omdb' : null, src.tmdb && wantServices ? 'tmdb' : null, ...globalOnly(src, null, f.content)].filter(Boolean);
    while (cursor < list.length && items.length < PAGE && checked < 72 && Date.now() - started < 22000) {
      const batch = list.slice(cursor, cursor + 12);
      await enrich(batch, { only });
      const freshRows = decorated(batch.map((b) => b.id), f.type);
      for (const d of freshRows) {
        cursor++; checked++;
        if (passesExternal(d, f, src) === true) items.push(d.id); else rejected++;
        if (items.length >= PAGE) break;
      }
    }
  }
  res.json({
    items: decorated(items, f.type), nextCursor: cursor < list.length ? cursor : null,
    total: list.length, verified: !!external, checked, rejected, content: !!f.content, profileCount: getProfile(f.type).count, rt: rtStatus(),
  });
}));

app.post('/api/enrich', needCatalog, wrap(async (req, res) => {
  const ids = (req.body.ids || []).slice(0, 40);
  await enrich(rowsByIds(ids));
  res.json({ items: decorated(ids) });
}));

// ---------- home ----------
const take = (list, n, used) => {
  const out = [];
  for (const d of list) { if (used.has(d.id)) continue; out.push(d); used.add(d.id); if (out.length >= n) break; }
  return out;
};
app.get('/api/home', needCatalog, wrap(async (req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const profile = getProfile(type);
  const year = new Date().getFullYear();
  const used = new Set();
  const rows = [];
  // With "only on my services" on, each row keeps only titles confirmed to be on one of them. Availability has
  // to be looked up per title, so the work is capped per request; whatever was looked up is remembered, and
  // the next load carries on from there.
  const src = sourcesEnabled();
  const svc = myServices(src);
  const content = contentFilter();
  const verify = !!(svc || content);
  const deadline = Date.now() + 18000;
  let partial = false;
  const takeAvailable = async (list, n) => {
    const only = globalOnly(src, svc, content);
    const pool = list.filter((d) => !used.has(d.id)).slice(0, 72);
    const out = [];
    for (let i = 0; i < pool.length && out.length < n; i += 12) {
      const batch = pool.slice(i, i + 12);
      if (Date.now() < deadline) await enrich(batch, { only });
      for (const d of decorated(batch.map((b) => b.id), type)) {
        const ok = passesExternal(d, { services: svc, content }, src);
        if (ok === null) partial = true;
        if (ok === true && out.length < n && !used.has(d.id)) { out.push(d); used.add(d.id); }
      }
    }
    return out;
  };
  // "Refresh" sends a seed: each row is then drawn in a seeded random order from its strongest candidates
  // (about three rows' worth), so a refresh brings up different titles without dropping the quality bar.
  let seed = parseInt(req.query.seed || '0', 10) >>> 0;
  const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const mix = (list, n) => {
    if (!seed) return list;
    const head = list.slice(0, n * 3);
    for (let i = head.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [head[i], head[j]] = [head[j], head[i]]; }
    return [...head, ...list.slice(n * 3)];
  };
  const add = async (key, title, subtitle, rawList, n = 14) => {
    const list = mix(rawList, n);
    const items = verify ? await takeAvailable(list, n) : take(list, n, used);
    if (items.length >= (verify ? 1 : 4)) rows.push({ key, title, subtitle, items });
  };
  const base = { type, hideSeen: true, hideWatchlisted: true, sort: 'match' };
  const personal = profile.count >= 3;

  if (personal) await add('foryou', 'Picked for you', `Based on ${profile.count} ${type === 'tv' ? 'shows' : 'movies'} you've rated`,
    candidates({ ...base, minVotes: type === 'movie' ? 15000 : 8000, minImdb: 6.8 }, 500));

  // More from people behind titles the user loved
  const fav = Object.entries(profile.people).filter(([, p]) => p.sum >= 2 && p.loved.length).sort((a, b) => b[1].sum - a[1].sum).slice(0, 2);
  for (const [pid, p] of fav) {
    const ids = db.prepare(`SELECT t.id FROM title_people tp JOIN titles t ON t.id = tp.title_id LEFT JOIN ratings r ON r.title_id=t.id
      WHERE tp.person_id=? AND t.type=? AND (r.value IS NULL OR r.value=0) AND t.votes >= 3000
      AND NOT EXISTS (SELECT 1 FROM dismissed d WHERE d.title_id=t.id) AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.title_id=t.id) ORDER BY t.bayes DESC LIMIT 14`).all(pid, type).map((r) => r.id);
    await add(`person-${pid}`, `More from ${p.name}`, `Because you enjoyed ${p.loved[0]}`, decorated(ids, type));
  }

  if (type === 'tv') {
    await add('landing', 'Sticks the landing', 'Finished shows whose final season is as good as the rest — or better',
      candidates({ ...base, endedOnly: true, minSeasons: 2, minWorth: 80, minVotes: 10000 }, 300).filter((d) => d.tv && d.tv.landing >= 0.05));
    await add('mini', 'One and done', 'Miniseries and single-season shows you can finish in a weekend',
      candidates({ ...base, maxSeasons: 1, endedOnly: true, minWorth: 78, minVotes: 8000 }, 200));
    await add('consistent', 'No bad episodes', 'Multi-season shows with remarkably steady episode ratings',
      candidates({ ...base, minSeasons: 2, consistent: true, minWorth: 80, minVotes: 15000 }, 300).filter((d) => d.tv && d.tv.consistency <= 0.38));
  }
  for (const g of profile.topGenres.slice(0, 2)) {
    await add(`genre-${g}`, `Top ${g} for you`, `You rate ${g} highly`, candidates({ ...base, genres: [g], minVotes: type === 'movie' ? 20000 : 8000 }, 200));
  }
  await add('gems', 'Hidden gems', 'Highly rated, but most people have never heard of them',
    candidates({ ...base, sort: 'match', minVotes: 5000, maxVotes: type === 'movie' ? 40000 : 20000, minImdb: 7.4 }, 300));
  await add('recent', 'Recent standouts', `The best of ${year - 3}–${year}`,
    candidates({ ...base, yearMin: year - 3, minVotes: type === 'movie' ? 20000 : 8000, minImdb: 7.1 }, 200));
  await add('greats', personal ? 'Acclaimed, and you haven\'t rated them' : 'All-time greats', 'The highest-rated of all time',
    candidates({ ...base, sort: 'score', minVotes: type === 'movie' ? 250000 : 60000 }, 120), 18);
  res.json({ rows, profileCount: profile.count, services: svc, content: !!content, partial });
}));

// Tonight's pick: one verified suggestion that honours the saved Discover filters.
const pickCache = new Map();
app.get('/api/pick', needCatalog, wrap(async (req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const skip = Math.max(0, parseInt(req.query.skip || '0', 10));
  const src = sourcesEnabled();
  const saved = (getSetting('filters') || {})[type] || {};
  const floor = type === 'movie' ? 25000 : 30000; // a blind pick should be something with a real track record
  const f = { minImdb: 7, ...saved, type, hideSeen: true, sort: 'match' };
  const svc = myServices(src);
  if (svc) f.services = svc; else delete f.services;
  const content = contentFilter();
  if (content) f.content = content; else delete f.content;
  if (saved.sort === 'hidden' || f.maxVotes) { f.sort = 'hidden'; if (!f.maxVotes) f.maxVotes = type === 'movie' ? 40000 : 25000; }
  else f.minVotes = Math.max(f.minVotes || 0, floor);
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}|${type}|${skip}|${JSON.stringify(f)}|${getProfile(type).count}`;
  if (pickCache.has(key)) return res.json({ pick: decorated([pickCache.get(key)], type)[0] || null, filters: f });
  const pool = candidates(f, 400).filter((d) => !d.watchlisted).slice(0, 60);
  if (!pool.length) return res.json({ pick: null, filters: f });
  let seed = [...day].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const start = (seed % Math.min(pool.length, 5)) + skip * 3;
  let pick = null, fallback = null;
  const began = Date.now();
  // Few titles are on any given service, so look further down the list when that filter is on.
  for (let i = 0; i < Math.min(pool.length, svc || content ? 40 : 10) && !pick && Date.now() - began < 20000; i++) {
    const cand = pool[(start + i) % pool.length];
    await enrich([cand]);
    const d = decorated([cand.id], type)[0];
    const ok = passesExternal(d, f, src);
    if (ok === false || ((svc || content) && ok !== true)) continue;
    // With Rotten Tomatoes on, prefer a pick whose audience score we could actually confirm.
    if (src.rt && d.rtAud == null && !rtStatus().blocked) { fallback ||= d; continue; }
    pick = d;
  }
  pick ||= fallback;
  if (pick) pickCache.set(key, pick.id);
  res.json({ pick, filters: f, services: svc, content: !!content });
}));

// ---------- rating queue, search, library ----------
app.get('/api/queue', needCatalog, wrap((req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const genre = req.query.genre || null;
  const decade = parseInt(req.query.decade || '', 10);
  const where = ['t.type=@type', 'r.title_id IS NULL', 'NOT EXISTS (SELECT 1 FROM dismissed d WHERE d.title_id=t.id)'];
  const p = { type };
  if (genre) { where.push("(',' || t.genres || ',') LIKE @g"); p.g = `%,${genre},%`; }
  if (Number.isFinite(decade)) { where.push('t.year BETWEEN @d0 AND @d1'); p.d0 = decade; p.d1 = decade + 9; }
  const rows = db.prepare(selectTitles('WHERE ' + where.join(' AND '), 'ORDER BY t.votes DESC LIMIT 18')).all(p);
  res.json({ items: rows.map((r) => decorate(r, null, { withPeople: false })) });
}));

// Acronym index so "DDLJ" finds Dilwale Dulhania Le Jayenge and "LOTR" finds The Lord of the Rings.
let acronyms = null;
function acronymHits(q, type) {
  const key = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.length < 3 || key.length > 10 || /\s/.test(q.trim())) return [];
  if (!acronyms) {
    acronyms = [];
    const initials = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
    for (const r of db.prepare('SELECT id, type, title, original, votes FROM titles WHERE votes >= 1000').all()) {
      const seen = new Set();
      for (const name of [r.title, r.original]) {
        if (!name) continue;
        const words = initials(name);
        if (words.length < 3) continue;
        const full = words.map((w) => w[0]).join('');
        const noArticle = ['the', 'a', 'an'].includes(words[0]) ? full.slice(1) : full;
        for (const a of [full, noArticle]) if (a.length >= 3 && !seen.has(a)) { seen.add(a); acronyms.push({ a, id: r.id, type: r.type, votes: r.votes }); }
      }
    }
  }
  const out = acronyms.filter((x) => (!type || x.type === type) && (x.a === key || (key.length >= 4 && x.a.startsWith(key))));
  const w = (x) => x.votes * (x.a === key ? 8 : 1); // exact acronyms win unless a prefix match is far better known
  out.sort((x, y) => w(y) - w(x));
  return [...new Set(out.map((x) => x.id))].slice(0, 5);
}

app.get('/api/search', needCatalog, wrap((req, res) => {
  const q = String(req.query.q || '').trim().replace(/["*():^]/g, ' ').trim();
  if (!q) return res.json({ items: [] });
  const match = q.split(/\s+/).map((w) => `"${w}"*`).join(' ');
  const type = req.query.type;
  const ids = db.prepare(`SELECT t.id FROM titles_fts f JOIN titles t ON t.rowid = f.rowid WHERE titles_fts MATCH ? ${type === 'movie' || type === 'tv' ? 'AND t.type = ?' : ''}
    ORDER BY (lower(t.title) = lower(?)) DESC, t.votes DESC LIMIT 12`).all(...[match, ...(type === 'movie' || type === 'tv' ? [type] : []), q]).map((r) => r.id);
  const acr = acronymHits(String(req.query.q || ''), type === 'movie' || type === 'tv' ? type : null);
  // An acronym match leads unless a title literally matches what was typed.
  const exact = ids.length && db.prepare('SELECT 1 FROM titles WHERE id=? AND lower(title)=lower(?)').get(ids[0], q);
  const merged = exact ? [ids[0], ...acr, ...ids.slice(1)] : [...acr, ...ids];
  res.json({ items: decorated([...new Set(merged)].slice(0, 12)) });
}));

app.get('/api/library', needCatalog, wrap((req, res) => {
  const rated = db.prepare('SELECT title_id FROM ratings WHERE value != 0 ORDER BY ts DESC').all().map((r) => r.title_id);
  const watch = db.prepare('SELECT title_id FROM watchlist ORDER BY ts DESC').all().map((r) => r.title_id);
  const hidden = db.prepare('SELECT title_id FROM dismissed ORDER BY ts DESC').all().map((r) => r.title_id);
  res.json({ rated: decorated(rated), watchlist: decorated(watch), dismissed: decorated(hidden) });
}));

app.get('/api/taste', needCatalog, wrap((req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const p = getProfile(type);
  res.json({
    count: p.count,
    genres: Object.entries(p.genres).map(([g, w]) => ({ genre: g, weight: Math.round(w * 100) / 100 })).sort((a, b) => b.weight - a.weight),
    people: Object.values(p.people).filter((x) => x.sum >= 2).sort((a, b) => b.sum - a.sum).slice(0, 8).map((x) => ({ name: x.name, titles: x.loved })),
  });
}));

app.get('/api/genres', needCatalog, wrap((req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const counts = {};
  for (const r of db.prepare('SELECT genres FROM titles WHERE type=? AND votes > 5000').all(type)) for (const g of (r.genres || '').split(',')) if (g) counts[g] = (counts[g] || 0) + 1;
  res.json({ genres: Object.entries(counts).filter(([, n]) => n >= 40).sort((a, b) => b[1] - a[1]).map(([g]) => g) });
}));

// ---------- title detail ----------
app.get('/api/title/:id', needCatalog, wrap(async (req, res) => {
  const id = req.params.id;
  let row = rowsByIds([id])[0];
  if (!row) return res.status(404).json({ error: 'not-found' });
  if (req.query.fast !== '1') { await enrich([row]); if (sourcesEnabled().va) await vaDetail(row); row = rowsByIds([id])[0]; }
  const d = decorate(row, getProfile(row.type));
  const ext = db.prepare('SELECT * FROM ext WHERE title_id=?').get(id) || {};
  d.wiki = ext.wiki; d.rated = d.rated || ext.rated || null; d.awards = ext.awards; d.backdrop = ext.backdrop; d.trailer = ext.trailer;
  d.cast = ext.cast ? JSON.parse(ext.cast) : (ext.actors ? ext.actors.split(', ') : null);
  d.providers = ext.providers ? JSON.parse(ext.providers) : null;
  d.imdbUrl = `https://www.imdb.com/title/${id}/`;
  if (row.type === 'tv') {
    const st = db.prepare('SELECT * FROM tv_stats WHERE id=?').get(id);
    if (st) {
      st.season_means = JSON.parse(st.season_means);
      d.seasonMeans = st.season_means;
      d.verdicts = tvVerdicts(st);
      d.episodes = db.prepare('SELECT season, episode, title, rating, votes FROM episodes WHERE parent=? AND season > 0 AND rating IS NOT NULL ORDER BY season, episode').all(id);
    }
  }
  let similar = db.prepare('SELECT target_id FROM recs WHERE source_id=? ORDER BY rank LIMIT 12').all(id).map((r) => r.target_id);
  if (similar.length < 4) {
    const more = db.prepare(`SELECT DISTINCT t.id FROM title_people a JOIN title_people b ON a.person_id=b.person_id JOIN titles t ON t.id=b.title_id
      WHERE a.title_id=? AND b.title_id != ? AND t.type=? AND t.votes >= 2000 ORDER BY t.bayes DESC LIMIT 12`).all(id, id, row.type).map((r) => r.id);
    d.similarLabel = more.length ? `More from ${row.directors?.split(', ')[0] || 'the same people'}` : null;
    similar = more;
  } else d.similarLabel = 'Fans also liked';
  d.similar = decorated(similar, row.type);
  d.vaBlocked = vaStatus().blocked;
  res.json(d);
}));

// ---------- user actions ----------
app.post('/api/rate', wrap((req, res) => {
  const { id, value } = req.body;
  if (value === null || value === undefined) db.prepare('DELETE FROM ratings WHERE title_id=?').run(id);
  else {
    db.prepare('INSERT INTO ratings (title_id,value,ts) VALUES (?,?,?) ON CONFLICT(title_id) DO UPDATE SET value=excluded.value, ts=excluded.ts').run(id, clampRating(value), Date.now());
    if (value !== 0) db.prepare('DELETE FROM watchlist WHERE title_id=?').run(id);
  }
  bustLists();
  // Loved titles feed "fans also liked" links when TMDB is connected.
  if (value > 0 && sourcesEnabled().tmdb) enrich(rowsByIds([id]), { only: ['tmdb'] }).then(invalidateProfile).catch(() => {});
  res.json({ ok: true });
}));
const clampRating = (v) => ([2, 1, 0, -1, -2, 9].includes(+v) ? +v : 0);
app.post('/api/watchlist', wrap((req, res) => {
  if (req.body.on) db.prepare('INSERT OR IGNORE INTO watchlist (title_id,ts) VALUES (?,?)').run(req.body.id, Date.now());
  else db.prepare('DELETE FROM watchlist WHERE title_id=?').run(req.body.id);
  res.json({ ok: true });
}));
app.post('/api/dismiss', wrap((req, res) => {
  if (req.body.on) db.prepare('INSERT OR IGNORE INTO dismissed (title_id,ts) VALUES (?,?)').run(req.body.id, Date.now());
  else db.prepare('DELETE FROM dismissed WHERE title_id=?').run(req.body.id);
  bustLists();
  res.json({ ok: true });
}));

// ---------- import (IMDb ratings export or Letterboxd ratings.csv) ----------
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
app.post('/api/import', needCatalog, wrap((req, res) => {
  const rows = parseCsv(String(req.body.csv || '').replace(/^﻿/, ''));
  if (rows.length < 2) return res.status(400).json({ error: 'That file looks empty.' });
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  const ins = db.prepare('INSERT INTO ratings (title_id,value,ts) VALUES (?,?,?) ON CONFLICT(title_id) DO UPDATE SET value=excluded.value, ts=excluded.ts');
  let imported = 0, missed = 0;
  const to4 = (ten) => (ten >= 9 ? 2 : ten >= 7 ? 1 : ten >= 5 ? -1 : -2);
  const tx = db.transaction(() => {
    if (col('const') >= 0 && col('your rating') >= 0) {
      const exists = db.prepare('SELECT 1 FROM titles WHERE id=?');
      for (const r of rows.slice(1)) {
        const id = r[col('const')], v = parseFloat(r[col('your rating')]);
        if (!id || !Number.isFinite(v) || !exists.get(id)) { missed++; continue; }
        ins.run(id, to4(v), Date.now()); imported++;
      }
    } else if (col('name') >= 0 && col('rating') >= 0) {
      const find = db.prepare(`SELECT id FROM titles WHERE (title=? COLLATE NOCASE OR original=? COLLATE NOCASE) AND year BETWEEN ? AND ? ORDER BY (type='movie') DESC, votes DESC LIMIT 1`);
      for (const r of rows.slice(1)) {
        const name = r[col('name')], y = parseInt(r[col('year')], 10), v = parseFloat(r[col('rating')]);
        const hit = name && Number.isFinite(v) ? find.get(name, name, (y || 0) - 1, (y || 9999) + 1) : null;
        if (!hit) { missed++; continue; }
        ins.run(hit.id, to4(v * 2), Date.now()); imported++;
      }
    } else throw new Error('Unrecognised file. Use the ratings export from IMDb or ratings.csv from Letterboxd.');
  });
  try { tx(); } catch (e) { return res.status(400).json({ error: e.message }); }
  bustLists();
  res.json({ imported, missed });
}));

// ---------- static client ----------
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api/') ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

const PORT = process.env.PORT || 4317;
// Local-only by default: there is no login, so don't expose ratings and API keys to the whole network.
// Set HOST=0.0.0.0 to reach it from other devices on a network you trust.
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => console.log(`Reel is running at http://localhost:${PORT}${hasCatalog() ? '' : '  (no catalog yet — run: npm run catalog)'}`));
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use — Reel may already be running. Open http://localhost:${PORT}` : e.message);
  process.exit(1);
});
