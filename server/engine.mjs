// Taste profile, scoring and candidate ranking.
import { db, getSetting } from './db.mjs';
import { tvVerdicts } from './tvstats.mjs';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// A rating of 9 means "seen it, no opinion": it counts as seen everywhere but never feeds the taste profile.
export const RATING_LABEL = { 2: 'loved', 1: 'liked', '-1': 'meh', '-2': 'disliked' };

const BASE_COLS = `t.id, t.type, t.title, t.year, t.end_year, t.runtime, t.genres, t.rating, t.votes, t.bayes, t.directors, t.kind,
  e.rt_aud, e.rt_crit, e.omdb_rt_crit, e.rt_slug, e.rt_checked, e.rt_aud_count, e.metacritic, e.tmdb_score, e.poster, e.plot,
  e.omdb_checked, e.tmdb_checked, e.providers, e.rt_watch, e.csm_checked, e.csm, e.va_checked, e.va, e.rated,
  r.value AS my_rating, (w.title_id IS NOT NULL) AS watchlisted,
  s.seasons, s.eps, s.ep_avg, s.consistency, s.landing, s.retention, s.hype_gap, s.peak_season, s.good_through, s.worth, s.ended`;
const BASE_FROM = `FROM titles t
  LEFT JOIN ext e ON e.title_id = t.id
  LEFT JOIN ratings r ON r.title_id = t.id
  LEFT JOIN watchlist w ON w.title_id = t.id
  LEFT JOIN tv_stats s ON s.id = t.id`;
export const selectTitles = (where, tail = '') => `SELECT ${BASE_COLS} ${BASE_FROM} ${where} ${tail}`;

// ---------- Taste profile ----------
let profileCache = null;
export const invalidateProfile = () => { profileCache = null; };

export function getProfile(type) {
  if (!profileCache) profileCache = {};
  if (profileCache[type]) return profileCache[type];
  const rows = db.prepare(`SELECT t.id, t.title, t.genres, t.year, r.value FROM ratings r JOIN titles t ON t.id = r.title_id WHERE r.value BETWEEN -2 AND 2 AND r.value != 0 AND t.type = ?`).all(type);
  const genres = {}, decades = {}, people = {};
  const add = (m, k, v) => { (m[k] ||= { sum: 0, n: 0 }); m[k].sum += v; m[k].n++; };
  for (const r of rows) {
    for (const g of (r.genres || '').split(',').filter(Boolean)) add(genres, g, r.value);
    if (r.year) add(decades, Math.floor(r.year / 10) * 10, r.value);
  }
  const ppl = db.prepare(`SELECT tp.person_id, p.name, r.value, t.title FROM ratings r JOIN titles t ON t.id=r.title_id
    JOIN title_people tp ON tp.title_id=r.title_id JOIN people p ON p.id=tp.person_id WHERE r.value BETWEEN -2 AND 2 AND r.value != 0 AND t.type=?`).all(type);
  for (const p of ppl) {
    (people[p.person_id] ||= { sum: 0, n: 0, name: p.name, loved: [] });
    people[p.person_id].sum += p.value; people[p.person_id].n++;
    if (p.value > 0) people[p.person_id].loved.push(p.title);
  }
  const mean = rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 0;
  // Centre on the user's own average so someone who "likes" everything still gets contrast.
  const w = (o, k = 2) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, (v.sum - mean * v.n * 0.5) / (v.n + k)]));
  // TMDB "people who liked X also liked" links from titles the user enjoyed.
  const recs = new Map();
  for (const r of db.prepare(`SELECT rc.target_id, rc.rank, t.title, r.value FROM recs rc JOIN ratings r ON r.title_id = rc.source_id
      JOIN titles t ON t.id = rc.source_id WHERE r.value BETWEEN 1 AND 2 AND t.type = ?`).all(type)) {
    const cur = recs.get(r.target_id) || { boost: 0, sources: [] };
    cur.boost += r.value * (1 - r.rank / 30);
    cur.sources.push({ title: r.title, value: r.value });
    recs.set(r.target_id, cur);
  }
  const profile = {
    count: rows.length, genres: w(genres), decades: w(decades, 4), people, recs,
    topGenres: Object.entries(w(genres)).filter(([g, v]) => v > 0.25 && genres[g].n >= 2).sort((a, b) => b[1] - a[1]).map(([g]) => g),
  };
  profileCache[type] = profile;
  return profile;
}

export function tasteMatch(t, profile) {
  if (!profile || profile.count < 3) return { match: null, reasons: [] };
  const gs = (t.genres || '').split(',').filter(Boolean);
  const reasons = [];
  let raw = 0;
  if (gs.length) {
    const ws = gs.map((g) => profile.genres[g] ?? 0);
    // mean, pulled toward the weakest genre so one hated genre matters
    raw += ws.reduce((s, x) => s + x, 0) / ws.length * 0.7 + Math.min(...ws) * 0.3;
    const liked = gs.filter((g) => (profile.genres[g] ?? 0) > 0.5);
    if (liked.length) reasons.push({ kind: 'genre', text: `You tend to enjoy ${liked.slice(0, 2).join(' + ')}` });
  }
  if (t.year) raw += (profile.decades[Math.floor(t.year / 10) * 10] ?? 0) * 0.25;
  const rec = profile.recs.get(t.id);
  if (rec) {
    raw += clamp(rec.boost * 0.45, 0, 1.6);
    const src = rec.sources.sort((a, b) => b.value - a.value)[0];
    reasons.unshift({ kind: 'rec', text: `Fans of ${src.title} also liked this` });
  }
  if (t._people) {
    for (const pid of t._people) {
      const p = profile.people[pid];
      if (p && p.sum > 0) {
        raw += clamp(p.sum * 0.35, 0, 1.2);
        reasons.unshift({ kind: 'person', text: `${t.type === 'movie' ? 'From the director of' : 'From the writer of'} ${p.loved[0]}` });
        break;
      }
    }
  }
  return { match: Math.round(clamp(52 + raw * 24, 1, 99)), reasons: reasons.slice(0, 2) };
}

// ---------- Scores ----------
/** Blend the available audience scores into one 0–100 number. */
export function reelScore(t) {
  const parts = [];
  if (t.type === 'tv' && t.worth != null) parts.push([t.worth, 1.6]);
  if (t.bayes != null) parts.push([t.bayes * 10, 1]);
  if (t.rt_aud != null) parts.push([t.rt_aud * 0.86 + 8, t.type === 'tv' ? 0.4 : 1]); // RT % runs hot; rescale toward the 10-point sources
  // Critics scores (Tomatometer, Metacritic) are shown but deliberately left out: this is an audience-only score.
  if (!parts.length) return null;
  const w = parts.reduce((s, p) => s + p[1], 0);
  return Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / w);
}

/** Streaming availability: TMDB (JustWatch data, complete) when connected, else RT's partner list (partial). */
function whereToWatch(t) {
  try {
    if (t.providers) {
      const p = JSON.parse(t.providers);
      return { source: 'tmdb', complete: true, link: p.link, stream: p.stream.map((x) => x.name), rent: p.rent.map((x) => x.name) };
    }
    if (t.tmdb_checked) return { source: 'tmdb', complete: true, stream: [], rent: [] };
    if (t.rt_watch) {
      const w = JSON.parse(t.rt_watch).map((x) => ({ ...x, name: x.name.replace(/ Us$/, '').replace(/ Plus\b/, '+').replace(/^Amc\b/, 'AMC').replace(/^Mgm\b/, 'MGM') }));
      // RT's "showtimes" tile also appears for one-off re-releases, so it is only ever surfaced as a "check showtimes" link.
      return { source: 'rt', complete: false, stream: w.filter((x) => x.kind === 'stream').map((x) => x.name), rent: w.filter((x) => x.kind === 'rent').map((x) => x.name), showtimes: w.some((x) => x.kind === 'theater') };
    }
  } catch { /* fall through */ }
  return null;
}

/** "250,000+ Ratings" -> 250000, "Fewer than 50 Ratings" -> 0 */
export function parseAudCount(str) {
  if (!str) return null;
  if (/fewer/i.test(str)) return 0;
  const m = str.replace(/,/g, '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
export const serviceKey = (name) => {
  const n = String(name).toLowerCase().replace(/plus/g, '+');
  if (n.includes('netflix')) return 'netflix';
  if (n.includes('prime') || n.includes('amazon')) return 'prime';
  if (n.includes('hbo') || n === 'max' || n.startsWith('max ')) return 'max';
  if (n.includes('hulu')) return 'hulu';
  if (n.includes('disney')) return 'disney';
  if (n.includes('apple tv')) return 'apple';
  if (n.includes('peacock')) return 'peacock';
  if (n.includes('paramount')) return 'paramount';
  return n.trim();
};

// ---------- Content levels & VidAngel ----------
export const CONTENT_CATS = [
  { key: 'sex', label: 'Sex & nudity', short: 'Sex/nudity' },
  { key: 'violence', label: 'Violence', short: 'Violence' },
  { key: 'language', label: 'Language', short: 'Language' },
  { key: 'drugs', label: 'Drugs & alcohol', short: 'Drugs' },
];
const lvl = (v) => (Number.isFinite(+v) ? Math.min(5, Math.max(0, Math.round(+v))) : 0);
/** The saved content rules in a safe shape, or null when content ratings are off. */
export function contentRules() {
  const c = getSetting('content');
  if (!c?.enabled) return null;
  const rules = {};
  for (const { key } of CONTENT_CATS) rules[key] = { flag: lvl(c.rules?.[key]?.flag), hide: lvl(c.rules?.[key]?.hide) };
  const out = { rules, hideUnknown: !!c.hideUnknown, vaRescue: !!c.vaRescue };
  out.filters = out.hideUnknown || Object.values(rules).some((r) => r.hide > 0);
  return out;
}
const json = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
// VidAngel filters a title while it plays on one of these services, so these are the ones that matter for it.
const VA_SERVICES = [[/netflix/i, 'Netflix'], [/amazon prime video|^prime video/i, 'Prime Video'], [/^apple tv ?(\+|plus)?$/i, 'Apple TV+'], [/paramount/i, 'Paramount+']];
function vaVia(providers) {
  const names = (json(providers)?.stream || []).map((p) => p.name);
  return VA_SERVICES.filter(([re]) => names.some((n) => re.test(n))).map(([, label]) => label);
}
/** Adds content levels, flags, the hide verdict and VidAngel availability to a decorated title. */
function addContent(out, t, rules, showVa) {
  const csm = json(t.csm), va = json(t.va);
  out.contentChecked = !!t.csm_checked;
  out.content = csm?.levels ? { ...csm.levels, age: csm.age ?? null, mpaa: csm.mpaa ?? null, url: `https://www.commonsensemedia.org/${csm.slug}` } : null;
  out.rated = t.rated || csm?.mpaa || null;
  out.tmdbChecked = !!t.tmdb_checked;
  out.vaChecked = !!t.va_checked;
  out.va = (showVa || rules?.vaRescue) && va ? { available: !!va.available, via: vaVia(t.providers), viaKnown: !!t.tmdb_checked, url: va.available ? `https://www.vidangel.com/${va.kind}/${va.slug}` : null, cats: va.cats || null, show: !!showVa } : null;
  out.flags = [];
  out.contentPass = true;
  if (!rules) return;
  if (!out.content) { out.contentPass = out.contentChecked ? !rules.hideUnknown : (rules.filters ? null : true); return; }
  let over = false;
  for (const c of CONTENT_CATS) {
    const level = out.content[c.key] ?? 0, r = rules.rules[c.key];
    const hit = r.hide > 0 && level >= r.hide;
    if (hit) over = true;
    if (hit || (r.flag > 0 && level >= r.flag)) out.flags.push({ key: c.key, label: c.short, level, over: hit });
  }
  if (over) {
    // "Keep what VidAngel can filter": an over-the-limit title stays if VidAngel can clean it up.
    if (!rules.vaRescue) out.contentPass = false;
    else out.contentPass = out.vaChecked ? !!va?.available : null;
    out.rescued = out.contentPass === true;
  }
}

const peopleOf = db.prepare('SELECT person_id FROM title_people WHERE title_id=?');
let ruleCache = { at: 0 };
const liveRules = () => {
  if (Date.now() - ruleCache.at > 1000) ruleCache = { at: Date.now(), rules: contentRules(), va: !!getSetting('vidangel') };
  return ruleCache;
};
export const invalidateRules = () => { ruleCache = { at: 0 }; };
export function decorate(t, profile, { withPeople = true } = {}) {
  if (withPeople && profile && Object.keys(profile.people).length) t._people = peopleOf.all(t.id).map((r) => r.person_id);
  const { match, reasons } = tasteMatch(t, profile);
  const score = reelScore(t);
  const out = {
    id: t.id, type: t.type, title: t.title, year: t.year, endYear: t.end_year, runtime: t.runtime,
    genres: (t.genres || '').split(',').filter(Boolean), directors: t.directors, kind: t.kind,
    imdb: t.rating, votes: t.votes, weighted: t.bayes != null ? Math.round(t.bayes * 10) / 10 : null,
    rtAud: t.rt_aud, rtCrit: t.rt_crit ?? t.omdb_rt_crit, rtAudCount: t.rt_aud_count, rtAudN: parseAudCount(t.rt_aud_count), rtVerified: /verified/i.test(t.rt_aud_count || ''), rtUrl: t.rt_slug ? `https://www.rottentomatoes.com/${t.rt_slug}` : null,
    rtChecked: !!t.rt_checked, metacritic: t.metacritic, tmdb: t.tmdb_score,
    poster: t.poster, plot: t.plot, myRating: t.my_rating ?? null, watchlisted: !!t.watchlisted,
    score, match, reasons, watch: whereToWatch(t), watchChecked: !!(t.tmdb_checked || t.rt_watch),
  };
  const rc = liveRules();
  addContent(out, t, rc.rules, rc.va);
  if (t.type === 'tv' && t.worth != null) {
    out.tv = { seasons: t.seasons, eps: t.eps, epAvg: t.ep_avg, consistency: t.consistency, landing: t.landing, retention: t.retention, hypeGap: t.hype_gap, peakSeason: t.peak_season, goodThrough: t.good_through, worth: t.worth, ended: !!t.ended };
    out.verdicts = tvVerdicts({ ...t, season_means: null }).slice(0, 2);
  }
  return out;
}

/** Ranking value used for "For you" ordering. */
export const rankValue = (d) => (d.score ?? 50) * 0.6 + (d.match ?? 55) * 0.4;

// ---------- Candidate query ----------
export function buildWhere(f) {
  const where = ['t.type = @type'];
  const p = { type: f.type };
  const num = (k) => (f[k] !== undefined && f[k] !== '' && f[k] !== null && Number.isFinite(+f[k]) ? +f[k] : null);
  const cmp = (k, sql) => { const v = num(k); if (v !== null) { where.push(sql); p[k] = v; } };
  cmp('yearMin', 't.year >= @yearMin');
  cmp('yearMax', 't.year <= @yearMax');
  cmp('minImdb', 't.rating >= @minImdb');
  cmp('minVotes', 't.votes >= @minVotes');
  cmp('maxVotes', 't.votes <= @maxVotes');
  cmp('runtimeMin', 't.runtime >= @runtimeMin');
  cmp('runtimeMax', 't.runtime <= @runtimeMax');
  (f.genres || []).forEach((g, i) => { where.push(`(',' || t.genres || ',') LIKE @g${i}`); p[`g${i}`] = `%,${g},%`; });
  (f.exclude || []).forEach((g, i) => { where.push(`(',' || IFNULL(t.genres,'') || ',') NOT LIKE @x${i}`); p[`x${i}`] = `%,${g},%`; });
  if (f.hideSeen) where.push('(r.value IS NULL OR r.value = 0)');
  if (f.hideWatchlisted) where.push('w.title_id IS NULL');
  where.push('NOT EXISTS (SELECT 1 FROM dismissed d WHERE d.title_id = t.id)');
  if (f.type === 'tv') {
    cmp('minWorth', 's.worth >= @minWorth');
    cmp('maxSeasons', 's.seasons <= @maxSeasons');
    cmp('minSeasons', 's.seasons >= @minSeasons');
    if (f.endedOnly) where.push('t.end_year IS NOT NULL');
    if (f.goodEnding) where.push('s.landing >= -0.3');
    if (f.consistent) where.push('s.consistency <= 0.5');
    if (f.retained) where.push('s.retention >= 0.6');
    if (f.miniseries) where.push("t.kind = 'tvMiniSeries'");
  }
  return { where: 'WHERE ' + where.join(' AND '), params: p };
}

const ORDER = {
  score: (type) => (type === 'tv' ? 's.worth DESC NULLS LAST, t.bayes DESC' : 't.bayes DESC'),
  match: (type) => (type === 'tv' ? 's.worth DESC NULLS LAST, t.bayes DESC' : 't.bayes DESC'),
  popular: () => 't.votes DESC',
  newest: () => 't.year DESC, t.bayes DESC',
  hidden: () => 't.bayes DESC',
};

/** Returns the full ranked candidate list (decorated), before any external-score verification. */
export function candidates(f, limit = 500) {
  const { where, params } = buildWhere(f);
  const sort = ORDER[f.sort] ? f.sort : 'match';
  const rows = db.prepare(selectTitles(where, `ORDER BY ${ORDER[sort](f.type)} LIMIT ${limit}`)).all(params);
  const profile = getProfile(f.type);
  const out = rows.map((r) => decorate(r, profile));
  if (sort === 'match' && profile.count >= 3) out.sort((a, b) => rankValue(b) - rankValue(a));
  return out;
}

/** Does a decorated title pass the external-score thresholds? null = unknown yet. */
export function passesExternal(d, f, src) {
  const checks = [];
  if (f.minRtAud && src.rt) checks.push(d.rtAud == null ? (d.rtChecked ? false : null) : d.rtAud >= f.minRtAud);
  if (f.minRtCrit && (src.rt || src.omdb)) checks.push(d.rtCrit == null ? (d.rtChecked ? false : null) : d.rtCrit >= f.minRtCrit);
  if (f.minMeta && src.omdb) checks.push(d.metacritic == null ? false : d.metacritic >= f.minMeta);
  if (f.minScore) checks.push(d.score != null && d.score >= f.minScore);
  if (f.minRtAudN && src.rt) checks.push(d.rtAudN == null ? (d.rtChecked ? false : null) : d.rtAudN >= f.minRtAudN);
  if (f.services?.length && (src.rt || src.tmdb)) {
    if (!d.watch) checks.push(d.rtChecked || d.watchChecked ? false : null);
    else { const want = new Set(f.services.map(serviceKey)); checks.push(d.watch.stream.some((n) => want.has(serviceKey(n)))); }
  }
  if (f.content) checks.push(d.contentPass);
  if (checks.includes(false)) return false;
  if (checks.includes(null)) return null;
  return true;
}
