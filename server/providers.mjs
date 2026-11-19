// External data providers. Everything is cached in the `ext` table so each title is only
// looked up once per TTL, and lookups are rate-limited to stay polite.
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, DATA, hasCatalog } from './db.mjs';

const UA = 'Reel/0.1 (personal movie-finder app)';
const DAY = 86400e3;
const TTL = { wd: 60 * DAY, rt: 14 * DAY, omdb: 30 * DAY, tmdb: 30 * DAY, csm: 90 * DAY, va: 3 * DAY };
const now = () => Date.now();
const fresh = (ts, ttl) => ts && now() - ts < ttl;

const ensure = db.prepare('INSERT OR IGNORE INTO ext (title_id) VALUES (?)');
const getExt = db.prepare('SELECT * FROM ext WHERE title_id=?');
function update(id, fields) {
  ensure.run(id);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE ext SET ${keys.map((k) => `"${k}"=@${k}`).join(',')} WHERE title_id=@id`).run({ ...fields, id });
}

function limiter(concurrency, gapMs = 0) {
  let active = 0; const queue = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => setTimeout(() => { active--; next(); }, gapMs));
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const rtLimit = limiter(3, 150);
const apiLimit = limiter(6);
const csmLimit = limiter(2, 200);
const vaLimit = limiter(1, 400);

async function get(url, opts = {}, as = 'json') {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) { const e = new Error(`${res.status} ${new URL(url).host}`); e.status = res.status; throw e; }
  return as === 'json' ? res.json() : res.text();
}

// ---------- Wikidata: IMDb id -> Rotten Tomatoes id + Wikipedia article ----------
export async function wikidataBatch(ids) {
  const need = ids.filter((id) => !fresh(getExt.get(id)?.wd_checked, TTL.wd));
  for (let i = 0; i < need.length; i += 60) {
    const chunk = need.slice(i, i + 60);
    const q = `SELECT ?imdb ?rt ?article WHERE { VALUES ?imdb { ${chunk.map((x) => `"${x}"`).join(' ')} } ?item wdt:P345 ?imdb. OPTIONAL { ?item wdt:P1258 ?rt } OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> } }`;
    try {
      const data = await get('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } });
      const found = new Map();
      for (const b of data.results.bindings) {
        const cur = found.get(b.imdb.value) || {};
        if (b.rt && !cur.rt) cur.rt = b.rt.value;
        if (b.article) cur.wiki = b.article.value;
        found.set(b.imdb.value, cur);
      }
      for (const id of chunk) {
        const f = found.get(id) || {};
        const fields = { wd_checked: now(), wiki: f.wiki || null };
        if (f.rt && /^(m|tv)\//.test(f.rt)) fields.rt_slug = f.rt.split('/').slice(0, 2).join('/');
        update(id, fields);
      }
    } catch (e) { console.warn('[wikidata]', e.message); }
  }
}

// ---------- Rotten Tomatoes: public title page ----------
const pct = (s) => { const n = parseInt(String(s ?? '').replace('%', ''), 10); return Number.isFinite(n) ? n : null; };
const RT_SERVICES = {
  netflix: { name: 'Netflix' }, max: { name: 'Max' }, 'hbo-max': { name: 'HBO Max' }, hulu: { name: 'Hulu' },
  'disney-plus': { name: 'Disney+' }, 'amazon-prime-video-us': { name: 'Prime Video' }, 'amazon-prime-video': { name: 'Prime Video' }, 'prime-video': { name: 'Prime Video' },
  'apple-tv-plus': { name: 'Apple TV+' }, 'apple-tv-plus-us': { name: 'Apple TV+' }, 'apple-tv': { name: 'Apple TV', kind: 'rent' }, 'apple-tv-us': { name: 'Apple TV', kind: 'rent' },
  peacock: { name: 'Peacock' }, 'paramount-plus': { name: 'Paramount+' }, 'paramount-plus-us': { name: 'Paramount+' },
  fandango: { name: 'Fandango at Home', kind: 'rent' }, vudu: { name: 'Fandango at Home', kind: 'rent' }, showtimes: { name: 'In theaters', kind: 'theater' },
};
function parseRt(html) {
  const sc = html.match(/<script[^>]*id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/);
  if (!sc) return null;
  const card = JSON.parse(sc[1]);
  const out = {
    aud: pct(card.audienceScore?.scorePercent), crit: pct(card.criticsScore?.scorePercent),
    audCount: card.audienceScore?.bandedRatingCount || null, plot: card.description || null, poster: null, year: null,
  };
  // "Where to watch" tiles. RT only lists its partner services, so this is a partial list.
  const seen = new Set();
  out.watch = [];
  for (const m of html.matchAll(/<where-to-watch-meta[^>]*affiliate="([^"]+)"[\s\S]*?<\/where-to-watch-meta>/g)) {
    const slug = m[1].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    const coverage = (m[0].match(/slot="coverage">([^<]*)</)?.[1] || '').trim();
    const known = RT_SERVICES[slug];
    out.watch.push({ name: known?.name || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), kind: known?.kind || 'stream', coverage: coverage || null });
  }
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      const j = JSON.parse(ld[1]);
      if (typeof j.image === 'string' && j.image.startsWith('http')) out.poster = j.image;
      const d = j.dateCreated || j.startDate;
      if (d) out.year = parseInt(String(d).slice(0, 4), 10);
    } catch { /* ignore */ }
  }
  return out;
}
const slugify = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/['’.:,!?]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

async function fetchRt(title) {
  const ext = getExt.get(title.id) || {};
  const tries = [];
  if (ext.rt_slug) tries.push({ slug: ext.rt_slug, trusted: true });
  else {
    const base = (title.type === 'movie' ? 'm/' : 'tv/') + slugify(title.title);
    if (title.type === 'movie' && title.year) tries.push({ slug: `${base}_${title.year}` });
    tries.push({ slug: base });
  }
  for (const t of tries) {
    try {
      const html = await rtLimit(() => get(`https://www.rottentomatoes.com/${t.slug}`, {}, 'text'));
      const p = parseRt(html);
      if (!p) continue;
      // Guessed slugs must match on year, otherwise we may have a different film with the same name.
      if (!t.trusted && (!p.year || !title.year || Math.abs(p.year - title.year) > 1)) continue;
      const fields = { rt_checked: now(), rt_slug: t.slug, rt_aud: p.aud, rt_crit: p.crit, rt_aud_count: p.audCount, rt_watch: JSON.stringify(p.watch) };
      if (p.poster && !ext.poster) fields.poster = p.poster;
      if (p.plot && !ext.plot) fields.plot = p.plot;
      update(title.id, fields);
      return;
    } catch (e) {
      if (e.status !== 404) { console.warn('[rt]', title.title, e.message); if (e.status === 403 || e.status === 429) throw e; }
    }
  }
  update(title.id, { rt_checked: now(), rt_watch: '[]' });
}

// ---------- OMDb ----------
async function fetchOmdb(title, key) {
  const d = await apiLimit(() => get(`https://www.omdbapi.com/?i=${title.id}&plot=short&apikey=${encodeURIComponent(key)}`));
  const fields = { omdb_checked: now() };
  if (d.Response === 'True') {
    const ext = getExt.get(title.id) || {};
    const rt = d.Ratings?.find((r) => r.Source === 'Rotten Tomatoes');
    fields.omdb_rt_crit = rt ? pct(rt.Value) : null;
    fields.metacritic = pct(d.Metascore);
    fields.rated = d.Rated && d.Rated !== 'N/A' ? d.Rated : null;
    fields.actors = d.Actors && d.Actors !== 'N/A' ? d.Actors : null;
    fields.awards = d.Awards && d.Awards !== 'N/A' ? d.Awards : null;
    if (!ext.poster && d.Poster && d.Poster !== 'N/A') fields.poster = d.Poster;
    if (!ext.plot && d.Plot && d.Plot !== 'N/A') fields.plot = d.Plot;
  }
  update(title.id, fields);
}

// ---------- TMDB ----------
const tmdbGet = (path, key) => {
  const bearer = key.length > 60;
  const url = `https://api.themoviedb.org/3${path}${bearer ? '' : `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`}`;
  return apiLimit(() => get(url, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {}));
};
function catalogMatch(type, name, year) {
  if (!name) return null;
  try {
    const rows = db.prepare(`SELECT id FROM titles WHERE type=? AND (title=? COLLATE NOCASE OR original=? COLLATE NOCASE) AND year BETWEEN ? AND ? ORDER BY votes DESC LIMIT 1`)
      .get(type, name, name, (year || 0) - 1, (year || 9999) + 1);
    return rows?.id || null;
  } catch { return null; }
}
async function fetchTmdb(title, key) {
  const kind = title.type === 'movie' ? 'movie' : 'tv';
  const found = await tmdbGet(`/find/${title.id}?external_source=imdb_id`, key);
  const hit = (kind === 'movie' ? found.movie_results : found.tv_results)?.[0];
  const fields = { tmdb_checked: now() };
  if (hit) {
    const d = await tmdbGet(`/${kind}/${hit.id}?append_to_response=recommendations,watch/providers,videos,credits,${kind === 'movie' ? 'release_dates' : 'content_ratings'}`, key);
    const region = getSetting('region') || 'US';
    const wp = d['watch/providers']?.results?.[region];
    const trailer = d.videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) || d.videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
    Object.assign(fields, {
      tmdb_id: hit.id,
      tmdb_score: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      backdrop: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null,
      trailer: trailer ? trailer.key : null,
      providers: wp ? JSON.stringify({
        link: wp.link,
        stream: (wp.flatrate || []).map((p) => ({ name: p.provider_name, logo: `https://image.tmdb.org/t/p/w92${p.logo_path}` })),
        rent: (wp.rent || []).slice(0, 4).map((p) => ({ name: p.provider_name, logo: `https://image.tmdb.org/t/p/w92${p.logo_path}` })),
      }) : null,
      cast: JSON.stringify((d.credits?.cast || []).slice(0, 8).map((c) => c.name)),
    });
    // Age rating (G, PG-13, TV-MA…) for the chosen region, falling back to the US one.
    const cert = (cc) => {
      if (kind === 'tv') return d.content_ratings?.results?.find((x) => x.iso_3166_1 === cc)?.rating || null;
      const rel = d.release_dates?.results?.find((x) => x.iso_3166_1 === cc)?.release_dates || [];
      return (rel.find((x) => x.type === 3 && x.certification) || rel.find((x) => x.certification))?.certification || null;
    };
    const rated = cert(region) || cert('US');
    if (rated) fields.rated = rated;
    if (d.poster_path) fields.poster = `https://image.tmdb.org/t/p/w500${d.poster_path}`;
    if (d.overview) fields.plot = d.overview;
    const ins = db.prepare('INSERT OR REPLACE INTO recs (source_id, target_id, rank) VALUES (?,?,?)');
    (d.recommendations?.results || []).slice(0, 20).forEach((r, i) => {
      const y = parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10) || null;
      const target = catalogMatch(title.type, r.title || r.name, y);
      if (target) ins.run(title.id, target, i);
    });
  }
  update(title.id, fields);
}

// ---------- Common Sense Media: content levels (0-5) from the public review page ----------
// Only the numeric levels, age and MPA rating are kept; the written review stays on their site.
const csmSlug = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/['’.:,!?]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function parseCsm(html) {
  const levels = {};
  for (const m of html.matchAll(/<button id="content-grid-item-(sex|violence|language|drugs)"[\s\S]*?<\/button>/g)) levels[m[1]] = (m[0].match(/icon-circle-solid active/g) || []).length;
  if (!Object.keys(levels).length) return null;
  const out = { levels, imdb: null, year: null, age: null, mpaa: null };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const id = m[1].match(/imdb\.com\\?\/title\\?\/(tt\d+)/);
    if (id) { out.imdb = id[1]; break; }
  }
  const date = html.match(/class="detail--(?:release-dates-theaters|premiere-date|release-dates-dvd)">\s*([^<]+)</);
  const y = date && date[1].match(/(\d{4})/);
  if (y) out.year = +y[1];
  const age = html.match(/age (\d+)\+/);
  if (age) out.age = +age[1];
  const mpaa = html.match(/class="detail--mpaa-rating">\s*([^<\s][^<]*?)\s*</);
  if (mpaa && mpaa[1].length <= 8) out.mpaa = mpaa[1];
  return out;
}
async function fetchCsm(title) {
  const base = (title.type === 'movie' ? 'movie-reviews/' : 'tv-reviews/') + csmSlug(title.title);
  const tries = [base, ...(title.year ? [`${base}-${title.year}`] : []), `${base}-0`];
  for (const slug of tries) {
    try {
      const html = await csmLimit(() => get(`https://www.commonsensemedia.org/${slug}`, {}, 'text'));
      const p = parseCsm(html);
      if (!p) continue;
      // Same-named titles share slugs, so the page must name this IMDb id (or, failing that, the same year).
      const same = p.imdb ? p.imdb === title.id : (p.year && title.year && Math.abs(p.year - title.year) <= 1);
      if (!same) continue;
      update(title.id, { csm_checked: now(), csm: JSON.stringify({ slug, levels: p.levels, age: p.age, mpaa: p.mpaa }) });
      return;
    } catch (e) {
      if (e.status !== 404) { console.warn('[csm]', title.title, e.message); throw e; }
    }
  }
  update(title.id, { csm_checked: now(), csm: null });
}

// ---------- VidAngel: is the title in their filterable catalogue? ----------
const VA = 'https://api.vidangel.com/api/';
const plain = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
// VidAngel's lookup API refuses automated requests, so availability comes from the public sitemap instead
// (robots.txt points crawlers at it): one download a day lists every movie and show they can filter.
const VA_SITEMAP = 'https://www.vidangel.com/sitemap.xml';
const VA_FILE = path.join(DATA, 'vidangel-catalog.json');
const vaSlug = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/[\s_-]+/g, '-');
let vaCat = null, vaLoading = null;
try { vaCat = JSON.parse(fs.readFileSync(VA_FILE, 'utf8')); } catch { /* not downloaded yet */ }
function parseVaSitemap(xml) {
  const cat = { ts: now(), count: 0, movie: {}, show: {} };
  for (const m of xml.matchAll(/<loc>https:\/\/www\.vidangel\.com\/(movie|show)\/([^/<]+)\//g)) {
    const [, kind, slug] = m;
    cat.count++;
    // Slugs are the title plus a short id ("pulp-fiction-843ca"); a few have a number or nothing at all.
    for (const base of new Set([slug.replace(/-[0-9a-f]{5}$/, ''), slug.replace(/-\d{3,4}$/, ''), slug])) {
      const list = (cat[kind][base] ||= []);
      if (!list.includes(slug)) list.push(slug);
    }
  }
  return cat;
}
async function vaCatalog() {
  if (vaCat && now() - vaCat.ts < DAY) return vaCat;
  vaLoading ||= (async () => {
    const res = await fetch(VA_SITEMAP, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) { const e = new Error(`${res.status} vidangel sitemap`); e.status = res.status; throw e; }
    const cat = parseVaSitemap(await res.text());
    if (Object.keys(cat.movie).length < 500) throw new Error('vidangel sitemap looked incomplete');
    vaCat = cat;
    fs.writeFileSync(VA_FILE, JSON.stringify(cat));
  })().finally(() => { vaLoading = null; });
  try { await vaLoading; } catch (e) { if (!vaCat) throw e; vaCat.ts = now() - DAY + 60 * 60e3; console.warn('[vidangel] keeping the saved list:', e.message); }
  return vaCat;
}
// The sitemap has titles but no years. When several films share a name, VidAngel's copies go to the best-known ones.
const sameName = hasCatalog() ? db.prepare('SELECT id FROM cat.titles WHERE type=? AND title=? COLLATE NOCASE ORDER BY votes DESC LIMIT 12') : null;
async function fetchVa(title) {
  const cat = await vaCatalog();
  const kind = title.type === 'movie' ? 'movie' : 'show';
  const slugs = cat[kind][vaSlug(title.title)] || [];
  let slug = null;
  if (slugs.length) {
    const rank = sameName ? sameName.all(title.type, title.title).findIndex((r) => r.id === title.id) : 0;
    if (rank >= 0 && rank < slugs.length) slug = slugs.length === 1 ? slugs[0] : slugs[rank];
  }
  let old; try { old = JSON.parse(getExt.get(title.id)?.va || 'null'); } catch { old = null; }
  const va = slug ? { available: true, slug, kind, cats: old?.slug === slug ? old.cats : undefined } : { available: false };
  update(title.id, { va_checked: now(), va: JSON.stringify(va) });
}
/** For the title page: how many moments VidAngel has tagged in each category. Movies only (shows are tagged per episode). */
export async function vaDetail(title) {
  const ext = getExt.get(title.id) || {};
  let va; try { va = JSON.parse(ext.va || 'null'); } catch { va = null; }
  if (!va?.available || va.kind !== 'movie' || va.cats || now() < vaApiBlockedUntil) return;
  try {
    const m = (await vaLimit(() => get(`${VA}content/v2/movies/?slug=${encodeURIComponent(va.slug)}`))).results?.[0];
    if (!m) return;
    if (m.imdb_id && m.imdb_id !== title.id) { update(title.id, { va: JSON.stringify({ available: false }) }); return; }
    const set = m.offerings?.find((o) => o.tag_set_id)?.tag_set_id;
    va.cats = [];
    if (set) {
      const p = await vaLimit(() => get(`${VA}bff/filter-preview/${set}/`));
      va.cats = (p.categories || []).filter((c) => c.count > 0 && !/credits/i.test(c.display_title)).map((c) => ({ name: c.display_title, count: c.count }));
    }
    update(title.id, { va: JSON.stringify(va) });
  } catch (e) {
    if (e.status === 403 || e.status === 429) vaApiBlockedUntil = now() + 6 * 60 * 60e3; // the detail API is refusing us; the badge itself doesn't need it
    else console.warn('[vidangel]', title.title, e.message);
  }
}

// ---------- Orchestration ----------
export function sourcesEnabled() {
  const c = getSetting('content');
  return { rt: !!getSetting('rtEnabled'), omdb: !!getSetting('omdbKey'), tmdb: !!getSetting('tmdbKey'), csm: !!c?.enabled, va: !!getSetting('vidangel') || !!(c?.enabled && c.vaRescue) };
}
let rtBlockedUntil = 0;
let csmBlockedUntil = 0;
// If the VidAngel list can't be downloaded, wait an hour before trying again.
let vaBlockedUntil = 0;
let vaApiBlockedUntil = 0;
export const vaStatus = () => ({ blocked: now() < vaBlockedUntil, titles: vaCat?.count || 0, updated: vaCat?.ts || null });
export const rtStatus = () => ({ blocked: now() < rtBlockedUntil });

const inflight = new Map();
/** Enrich a batch of catalog rows ({id,type,title,year}). Resolves when all lookups settle. */
export async function enrich(titles, { only } = {}) {
  const src = sourcesEnabled();
  const want = (s) => src[s] && (!only || only.includes(s));
  if (want('rt') && now() >= rtBlockedUntil) {
    await wikidataBatch(titles.filter((t) => !fresh(getExt.get(t.id)?.rt_checked, TTL.rt)).map((t) => t.id));
  }
  await Promise.all(titles.map((t) => {
    if (inflight.has(t.id)) return inflight.get(t.id);
    const ext = getExt.get(t.id) || {};
    const jobs = [];
    if (want('tmdb') && !fresh(ext.tmdb_checked, TTL.tmdb)) jobs.push(fetchTmdb(t, getSetting('tmdbKey')).catch((e) => console.warn('[tmdb]', e.message)));
    if (want('omdb') && !fresh(ext.omdb_checked, TTL.omdb)) jobs.push(fetchOmdb(t, getSetting('omdbKey')).catch((e) => console.warn('[omdb]', e.message)));
    if (want('rt') && (!fresh(ext.rt_checked, TTL.rt) || ext.rt_watch == null) && now() >= rtBlockedUntil) {
      jobs.push(fetchRt(t).catch((e) => { if (e.status === 403 || e.status === 429) rtBlockedUntil = now() + 10 * 60e3; }));
    }
    if (want('csm') && !fresh(ext.csm_checked, TTL.csm) && now() >= csmBlockedUntil) {
      jobs.push(fetchCsm(t).catch((e) => { if (e.status === 403 || e.status === 429) csmBlockedUntil = now() + 10 * 60e3; }));
    }
    if (want('va') && !fresh(ext.va_checked, TTL.va) && now() >= vaBlockedUntil) {
      jobs.push(fetchVa(t).catch((e) => { if (now() >= vaBlockedUntil) console.warn('[vidangel] list unavailable, pausing for an hour:', e.message); vaBlockedUntil = now() + 60 * 60e3; }));
    }
    if (!jobs.length) return null;
    const p = Promise.all(jobs).finally(() => inflight.delete(t.id));
    inflight.set(t.id, p);
    return p;
  }));
}

export async function testKey(kind, key) {
  try {
    if (kind === 'tmdb') { await tmdbGet('/configuration', key); return { ok: true }; }
    if (kind === 'omdb') { const d = await get(`https://www.omdbapi.com/?i=tt0133093&apikey=${encodeURIComponent(key)}`); return { ok: d.Response === 'True', error: d.Error }; }
  } catch (e) { return { ok: false, error: e.status === 401 ? 'Key was rejected' : e.message }; }
  return { ok: false };
}
