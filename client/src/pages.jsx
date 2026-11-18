import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { Poster, RateButtons, Row, ScoreChips, ScoreRing, Skeletons, Slider, TitleCard, Toggle, useEnriched, fmtRuntime, yearSpan, yearAndLength, RATINGS, Icon, InfoTip, StepSlider, CountLine, ServicePicker } from './components.jsx';

const noun = (type, n = 2) => (type === 'tv' ? (n === 1 ? 'show' : 'shows') : n === 1 ? 'movie' : 'movies');

// ============================== HOME ==============================
// Non-empty only when the global "only on my services" switch is on and usable; changes when the list does.
const servicesKey = (status) => (status.settings.onlyMyServices && status.settings.services?.length ? status.settings.services.join('|') : '');
// Changes whenever the content rules or the VidAngel switch do, so lists rebuild.
const contentKey = (status) => JSON.stringify([status.settings.content?.enabled ? status.settings.content : 0, !!status.settings.vidangel]);

export function Home() {
  const { type, setView, version, status, openSettings } = useApp();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadedVersion = useRef(-1);
  const svcKey = servicesKey(status);
  const globalKey = svcKey + contentKey(status);
  const loadedSvc = useRef(globalKey);
  const rated = status.rated?.[type] || 0;
  const seed = useRef(0);
  const load = () => { setBusy(true); return api.home(type, seed.current).then((d) => { setData(d); loadedVersion.current = version; }).finally(() => setBusy(false)); };
  // "Refresh suggestions": same quality bar, different titles.
  const reshuffle = () => { seed.current = Math.floor(Math.random() * 1e9) + 1; window.scrollTo({ top: 0, behavior: 'smooth' }); return load(); };
  const stale = !!data && loadedVersion.current !== version;
  useEffect(() => {
    if (loadedVersion.current === version && data) return;
    // While Reel is still learning (under 10 ratings) lists re-tune after each rating. After that they
    // stay put so nothing vanishes while you're browsing — a "Refresh picks" button appears instead.
    if (data && rated >= 10) return;
    const t = setTimeout(load, data ? 1500 : 0);
    return () => clearTimeout(t);
  }, [type, version]); // eslint-disable-line
  // Changing the streaming-services setting always rebuilds the lists.
  useEffect(() => { if (loadedSvc.current === globalKey) return; loadedSvc.current = globalKey; setData(null); load(); }, [globalKey]); // eslint-disable-line

  return (
    <div className="home">
      <Pick />
      {rated < 5 && (
        <div className="nudge">
          <div>
            <b>{rated === 0 ? `Tell Reel what you like` : `${5 - rated} more to unlock personal picks`}</b>
            <p>Rate a handful of {noun(type)} you’ve seen and every list below gets tuned to your taste.</p>
          </div>
          <button className="btn primary" onClick={() => setView('rate')}>Rate {noun(type)}</button>
        </div>
      )}
      {stale && rated >= 10 && (
        <div className="refresh-bar"><span>You’ve rated more since these lists were built.</span><button className="btn sm" onClick={load}>Refresh picks</button></div>
      )}
      {(data?.services || data?.content) && (
        <div className="refresh-bar">
          <span>{[data.services && `Only showing what’s on ${data.services.join(', ')}.`, data.content && 'Titles over your content limits are hidden.', data.partial && 'Still checking, so some rows are short.'].filter(Boolean).join(' ')}</span>
          <span className="row-tools">
            {data.partial && <button className="btn sm" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Check for more'}</button>}
            <button className="btn sm ghost" onClick={openSettings}>Change</button>
          </span>
        </div>
      )}
      {(data?.services || data?.content) && !data.rows.length && <div className="empty"><h3>Nothing confirmed yet</h3><p>{data.partial ? 'Reel is still looking titles up. Check for more in a moment.' : 'Try loosening your streaming or content settings.'}</p></div>}
      {!data && <section className="row"><div className="row-head"><div><h2>{svcKey ? 'Checking what’s on your services…' : status.settings.content?.enabled ? 'Checking content ratings…' : 'Loading…'}</h2>{svcKey && <p>The first time takes a little while. Results are remembered.</p>}</div></div><div className="row-scroll"><Skeletons n={8} /></div></section>}
      {data && data.rows.length > 0 && (
        <div className="suggest-head">
          <span className="muted small">{seed.current ? 'Showing a fresh mix.' : 'Showing your top suggestions.'}</span>
          <button className="btn sm" disabled={busy} onClick={reshuffle}>{busy ? 'Refreshing…' : '↻ Refresh suggestions'}</button>
        </div>
      )}
      {data?.rows.map((r) => <Row key={`${r.key}-${seed.current}`} title={r.title} subtitle={r.subtitle} items={r.items} showWhy={r.key === 'foryou'} hideDone />)}
    </div>
  );
}

function Pick() {
  const { type, openTitle, actions, merge, status, setView } = useApp();
  const [skip, setSkip] = useState(0);
  const [state, setState] = useState({ loading: true });
  const svcKey = servicesKey(status);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api.pick(type, skip).then((d) => live && setState({ loading: false, ...d })).catch(() => live && setState({ loading: false, pick: null }));
    return () => { live = false; };
  }, [type, skip, svcKey, contentKey(status)]); // eslint-disable-line
  const raw = state.pick;
  if (state.loading && !raw) return <div className="pick skeleton-pick"><div className="spinner" /><span>Finding tonight’s pick{status.sources.rt ? ' and checking its scores' : ''}…</span></div>;
  if (!raw) return (
    <div className="pick empty"><div><h2>No pick fits your filters right now</h2><p className="muted">{state.services ? `Nothing unseen that passes your filters could be confirmed on ${state.services.join(', ')}. Loosen the filters or add a service.` : 'Your Discover filters are strict enough that nothing unseen passes. Loosen them a little.'}</p></div>
      <button className="btn" onClick={() => setView('discover')}>Adjust filters</button></div>
  );
  const item = merge(raw);
  const main = item.type === 'tv' && item.tv ? item.tv.worth : item.score;
  return (
    <section className={`pick ${state.loading ? 'is-loading' : ''}`}>
      <div className="pick-bg" style={item.poster ? { backgroundImage: `url(${item.poster})` } : undefined} />
      <button className="pick-poster" onClick={() => openTitle(item.id)} aria-label={`Open ${item.title}`}><Poster item={item} /></button>
      <div className="pick-info">
        <div className="eyebrow">{type === 'tv' ? 'Start this next' : 'Tonight’s pick'}{item.match != null ? ` · ${item.match}% match` : ''}</div>
        <h1><button onClick={() => openTitle(item.id)}>{item.title}</button></h1>
        <div className="pick-meta">
          {[yearSpan(item), item.type === 'movie' ? fmtRuntime(item.runtime) : item.tv ? `${item.tv.seasons} season${item.tv.seasons > 1 ? 's' : ''}` : null, item.genres.slice(0, 3).join(', '), item.directors ? (item.type === 'movie' ? `Dir. ${item.directors.split(', ')[0]}` : null) : null].filter(Boolean).join('  ·  ')}
        </div>
        <div className="pick-scores">
          <ScoreRing value={main} size={54} label={item.type === 'tv' ? 'Worth-It score' : 'Reel score'} />
          <div><ScoreChips item={item} sources={status.sources} />
            <CountLine item={item} />
            {item.reasons?.[0] && <div className="why big">{item.reasons.map((r) => r.text).join(' · ')}</div>}
            {item.verdicts?.length > 0 && <div className="verdict-row">{item.verdicts.map((v) => <span key={v.label} className={`verdict ${v.tone}`} title={v.detail}>{v.label}</span>)}</div>}
          </div>
        </div>
        {item.plot && <p className="pick-plot">{item.plot}</p>}
        <div className="pick-actions">
          <button className={`btn primary ${item.watchlisted ? 'done' : ''}`} onClick={() => actions.watchlist(item, !item.watchlisted)}>{item.watchlisted ? '✓ On your watchlist' : '+ Watchlist'}</button>
          <button className="btn" onClick={() => openTitle(item.id)}>Details</button>
          <button className="btn ghost" onClick={() => setSkip((s) => s + 1)} disabled={state.loading}>↻ Show me another</button>
          <span className="seen-it">Seen it? <RateButtons item={item} size="sm" onRated={(v) => v && setSkip((s) => s + 1)} /></span>
        </div>
      </div>
    </section>
  );
}

// ============================== DISCOVER ==============================
const DEFAULT_FILTERS = {
  movie: { sort: 'match', hideSeen: true, minImdb: 7, minVotes: 10000, minRtAud: 80, genres: [], exclude: [] },
  tv: { sort: 'match', hideSeen: true, minWorth: 75, minVotes: 5000, genres: [], exclude: [] },
};
const SORTS = [
  { key: 'match', label: 'Best for me' },
  { key: 'score', label: 'Highest rated' },
  { key: 'popular', label: 'Most popular' },
  { key: 'newest', label: 'Newest' },
  { key: 'hidden', label: 'Hidden gems' },
];
const RT_COUNTS = [0, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
const IMDB_COUNTS = [0, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 1500000, 2000000];
const FAME = [{ v: 0, l: 'Any' }, { v: 1000, l: '1k+' }, { v: 10000, l: '10k+' }, { v: 50000, l: '50k+' }, { v: 200000, l: '200k+' }];
const PRESETS = {
  movie: [
    { label: 'Crowd-pleasers', f: { sort: 'match', minRtAud: 90, minImdb: 7.3, minVotes: 50000 } },
    { label: 'Critics & audiences agree', f: { sort: 'score', minRtAud: 85, minRtCrit: 85, minVotes: 10000 } },
    { label: 'Hidden gems', f: { sort: 'hidden', minImdb: 7.4, minVotes: 0 } },
    { label: 'Under 100 minutes', f: { sort: 'match', runtimeMax: 100, minImdb: 7.2, minVotes: 10000 } },
    { label: 'Last 5 years', f: { sort: 'match', yearMin: new Date().getFullYear() - 5, minImdb: 7, minVotes: 10000 } },
  ],
  tv: [
    { label: 'Finished & ends well', f: { sort: 'match', endedOnly: true, goodEnding: true, minWorth: 80, minVotes: 5000 } },
    { label: 'Weekend binge', f: { sort: 'match', maxSeasons: 1, endedOnly: true, minWorth: 78, minVotes: 5000 } },
    { label: 'No weak seasons', f: { sort: 'match', consistent: true, minSeasons: 2, minWorth: 80, minVotes: 10000 } },
    { label: 'Hidden gems', f: { sort: 'hidden', minWorth: 78, minVotes: 0 } },
  ],
};

export function Discover() {
  const { type, status, version, openSettings, openGuide, merge } = useApp();
  const src = status.sources;
  const [f, setF] = useState(() => ({ ...DEFAULT_FILTERS[type], ...(status.settings.filters?.[type] || {}), type }));
  const [genres, setGenres] = useState([]);
  const svcKey = servicesKey(status);
  const [res, setRes] = useState({ items: [], loading: true });
  const [more, setMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const ctl = useRef();
  const first = useRef(true);

  useEffect(() => { api.genres(type).then((g) => setGenres(g.genres)); }, [type]);

  const load = useCallback((filters) => {
    ctl.current?.abort();
    ctl.current = new AbortController();
    setRes((r) => ({ ...r, loading: true }));
    api.discover(filters, 0, ctl.current.signal).then((d) => setRes({ ...d, loading: false })).catch((e) => { if (e.name !== 'AbortError') setRes({ items: [], loading: false, error: e.message }); });
  }, []); // eslint-disable-line

  // Debounced reload + persist whenever filters change.
  useEffect(() => {
    const t = setTimeout(() => {
      load(f);
      if (!first.current) { const { type: _t, ...rest } = f; api.saveSettings({ filters: { ...(status.settings.filters || {}), [type]: rest } }); status.settings.filters = { ...(status.settings.filters || {}), [type]: rest }; }
      first.current = false;
    }, first.current ? 0 : 350);
    return () => clearTimeout(t);
  }, [f, svcKey, contentKey(status), src.rt, src.omdb, src.tmdb]); // eslint-disable-line

  const loadMore = async () => {
    if (res.nextCursor == null || more) return;
    setMore(true);
    try {
      const d = await api.discover(f, res.nextCursor);
      setRes((r) => ({ ...d, items: [...r.items, ...d.items.filter((x) => !r.items.some((y) => y.id === x.id))], checked: (r.checked || 0) + d.checked, rejected: (r.rejected || 0) + d.rejected, loading: false }));
    } finally { setMore(false); }
  };

  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const cycleGenre = (g) => setF((cur) => {
    const inc = cur.genres || [], exc = cur.exclude || [];
    if (inc.includes(g)) return { ...cur, genres: inc.filter((x) => x !== g), exclude: [...exc, g] };
    if (exc.includes(g)) return { ...cur, exclude: exc.filter((x) => x !== g) };
    return { ...cur, genres: [...inc, g] };
  });
  const reset = () => setF({ ...DEFAULT_FILTERS[type], type });
  const enriched = useEnriched(res.items, !res.loading);
  // Rated or hidden titles drop out of the grid straight away (the toast offers Undo).
  const items = enriched.filter((it) => { const m = merge(it); return !m.dismissed && !(f.hideSeen && m.myRating); });
  const activeCount = useMemo(() => ['minRtAud', 'minRtAudN', 'minRtCrit', 'minImdb', 'minScore', 'minMeta', 'minWorth', 'yearMin', 'yearMax', 'runtimeMax', 'minVotes', 'maxSeasons', 'minSeasons', 'endedOnly', 'goodEnding', 'consistent', 'retained', 'miniseries'].filter((k) => f[k]).length + (f.genres?.length || 0) + (f.exclude?.length || 0) + (svcKey ? 1 : 0), [f, svcKey]);
  const rtNote = <button className="link" onClick={openSettings}>Turn on Rotten Tomatoes scores</button>;

  return (
    <div className="discover">
      <aside className={`filters ${showFilters ? 'open' : ''}`}>
        <div className="filters-head">
          <h2>Filters</h2>
          <button className="link" onClick={openGuide}>How scores work</button>
          <button className="link muted-link" onClick={reset}>Reset</button>
          <button className="icon-btn sm only-mobile" onClick={() => setShowFilters(false)} aria-label="Close filters">✕</button>
        </div>

        <div className="fgroup">
          <h3>Quality bar</h3>
          {type === 'tv' && <Slider label="Worth-It score" hint="Reel’s own 0–100 score for TV. It blends the show’s IMDb rating with the average rating of every episode, then takes points off for a weak final season and uneven episodes, and adjusts for whether people were still watching at the end. 85+ is excellent, 75+ is a good bet." value={f.minWorth} onChange={(v) => set({ minWorth: v })} min={50} max={95} step={1} />}
          <Slider label="RT audience score" hint="Rotten Tomatoes “Popcornmeter”: the percentage of regular viewers who rated it 3.5 stars or higher out of 5. This is the number you’d normally go and check by hand." value={f.minRtAud} onChange={(v) => set({ minRtAud: v })} min={40} max={98} step={1} format={(v) => `${v}%`} disabled={!src.rt} disabledNote={rtNote} />
          <Slider label="RT critics score" hint="Rotten Tomatoes “Tomatometer”: the percentage of professional critics who gave it a positive review." value={f.minRtCrit} onChange={(v) => set({ minRtCrit: v })} min={40} max={98} step={1} format={(v) => `${v}%`} disabled={!src.rt && !src.omdb} disabledNote={rtNote} />
          <Slider label="IMDb rating" hint="Average rating from IMDb users, out of 10." value={f.minImdb} onChange={(v) => set({ minImdb: v })} min={5} max={9} step={0.1} format={(v) => v.toFixed(1)} />
          {type === 'movie' && <Slider label="Reel score" hint="Reel’s own 0–100 audience score: the RT audience score and the IMDb rating blended equally, with the IMDb rating pulled toward average when few people have voted. Critics scores are not included." value={f.minScore} onChange={(v) => set({ minScore: v })} min={50} max={95} step={1} />}
          {src.omdb && <Slider label="Metacritic" value={f.minMeta} onChange={(v) => set({ minMeta: v })} min={40} max={95} step={1} />}
        </div>

        <div className="fgroup">
          <h3>How many people rated it</h3>
          <StepSlider label="RT audience ratings" steps={RT_COUNTS} value={f.minRtAudN} onChange={(v) => set({ minRtAudN: v })} disabled={!src.rt} disabledNote={rtNote}
            hint="How many people are behind the Rotten Tomatoes audience score. RT only publishes this in bands, and its top band is “250,000+” — it never gives a higher or exact figure, so that is as far as this slider goes. Titles released since 2019 often show “verified” ratings from ticket buyers, which run much lower — 10,000+ verified is a lot." />
          <StepSlider label="IMDb votes" steps={IMDB_COUNTS} value={f.minVotes} onChange={(v) => set({ minVotes: v })}
            hint="How many people have rated it on IMDb. More votes means more widely seen, and a score you can trust more. “Any” includes obscure titles." />
        </div>

        <div className="fgroup">
          <h3>Streaming</h3>
          <ServicePicker />
        </div>

        <div className="fgroup">
          <h3>Content</h3>
          <p className="note">{!status.settings.content?.enabled ? 'Content ratings are off.' : res.content ? 'Titles over your content limits are hidden.' : 'Content flags are on; nothing is hidden.'} <button className="link" onClick={openSettings}>{status.settings.content?.enabled ? 'Change' : 'Set up content filters'}</button></p>
        </div>

        {type === 'tv' && (
          <div className="fgroup">
            <h3>Beyond the score</h3>
            <Toggle label="Finished shows only" hint="No cliffhangers waiting on a renewal" info="Only shows IMDb lists with an end year." checked={f.endedOnly} onChange={(v) => set({ endedOnly: v })} />
            <Toggle label="Ends well" hint="Final season holds up against the rest" info="The final season’s average episode rating is no more than 0.3 points below the seasons before it." checked={f.goodEnding} onChange={(v) => set({ goodEnding: v })} />
            <Toggle label="Consistent" hint="Few weak episodes" info="Episode ratings stay within a narrow band (standard deviation of 0.5 points or less)." checked={f.consistent} onChange={(v) => set({ consistent: v })} />
            <Toggle label="Viewers stuck around" hint="People kept watching to the last season" info="A typical last-season episode has at least 60% as many IMDb votes as a typical first-season episode — a sign people didn’t give up on it." checked={f.retained} onChange={(v) => set({ retained: v })} />
            <Toggle label="Miniseries only" info="Shows IMDb classifies as a limited series." checked={f.miniseries} onChange={(v) => set({ miniseries: v })} />
            <div className="field"><label>Seasons</label>
              <div className="pair"><input type="number" min="1" placeholder="min" value={f.minSeasons || ''} onChange={(e) => set({ minSeasons: +e.target.value || 0 })} aria-label="Minimum seasons" /><span>to</span>
                <input type="number" min="1" placeholder="max" value={f.maxSeasons || ''} onChange={(e) => set({ maxSeasons: +e.target.value || 0 })} aria-label="Maximum seasons" /></div></div>
          </div>
        )}

        <div className="fgroup">
          <h3>Genres <small>tap to include, again to exclude</small></h3>
          <div className="genre-chips">
            {genres.map((g) => {
              const st = f.genres?.includes(g) ? 'inc' : f.exclude?.includes(g) ? 'exc' : '';
              return <button key={g} className={st} onClick={() => cycleGenre(g)} aria-label={`${g}${st === 'inc' ? ' (included)' : st === 'exc' ? ' (excluded)' : ''}`}>{st === 'exc' ? '⊘ ' : st === 'inc' ? '✓ ' : ''}{g}</button>;
            })}
          </div>
        </div>

        <div className="fgroup">
          <h3>Details</h3>
          <div className="field"><label>Released</label>
            <div className="pair"><input type="number" placeholder="from" value={f.yearMin || ''} onChange={(e) => set({ yearMin: +e.target.value || 0 })} aria-label="From year" /><span>to</span>
              <input type="number" placeholder="to" value={f.yearMax || ''} onChange={(e) => set({ yearMax: +e.target.value || 0 })} aria-label="To year" /></div></div>
          {type === 'movie' && <div className="field"><label>Max length</label>
            <div className="seg small">{[0, 100, 120, 150].map((m) => <button key={m} className={(f.runtimeMax || 0) === m ? 'on' : ''} onClick={() => set({ runtimeMax: m })}>{m ? `${m}m` : 'Any'}</button>)}</div></div>}
          <Toggle label={`Hide ${noun(type)} I’ve rated`} checked={f.hideSeen} onChange={(v) => set({ hideSeen: v })} />
        </div>
      </aside>

      <section className="results">
        <div className="results-head">
          <div className="presets">
            {PRESETS[type].map((p) => <button key={p.label} className="pill" onClick={() => setF({ hideSeen: true, genres: [], exclude: [], ...p.f, type })}>{p.label}</button>)}
          </div>
          <div className="results-tools">
            <button className="btn only-mobile" onClick={() => setShowFilters(true)}>Filters{activeCount ? ` (${activeCount})` : ''}</button>
            <label className="sort">Sort <select value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          </div>
        </div>
        <div className="results-status" aria-live="polite">
          {res.loading ? <><span className="spinner sm" /> {src.rt && (f.minRtAud || f.minRtAudN || f.minRtCrit || svcKey) ? 'Checking scores on Rotten Tomatoes — first time takes a few seconds…' : 'Searching…'}</>
            : res.error ? <span className="bad">{res.error}</span>
              : res.verified ? <>Showing <b>{items.length}</b> that passed · checked {res.checked} against your score bar, {res.rejected} didn’t make it</>
                : <><b>{res.total >= 700 ? '700+' : res.total}</b> {noun(type, res.total)} match{res.total === 1 ? 'es' : ''}{f.sort === 'match' && res.profileCount < 3 ? ' · rate a few titles to personalise the order' : ''}</>}
          {res.rt?.blocked && <span className="bad"> · Rotten Tomatoes is rate-limiting us; scores will resume shortly</span>}
          {f.minRtAud > 0 && !src.rt && <span className="warn"> · RT audience filter is off until you enable Rotten Tomatoes in Settings</span>}
        </div>
        <div className={`grid ${res.loading ? 'dim' : ''}`}>
          {res.loading && items.length === 0 ? <Skeletons n={12} /> : items.map((it) => <TitleCard key={it.id} item={it} showWhy={f.sort === 'match'} />)}
        </div>
        {!res.loading && items.length === 0 && !res.error && (
          <div className="empty"><h3>Nothing clears that bar</h3><p>{res.nextCursor != null ? 'None of the titles checked so far passed — keep looking, or loosen a filter.' : 'Try lowering a score threshold or removing a genre.'}</p>
            {res.nextCursor == null && <button className="btn" onClick={reset}>Reset filters</button>}</div>
        )}
        {res.nextCursor != null && !res.loading && <div className="more"><button className="btn" onClick={loadMore} disabled={more}>{more ? <><span className="spinner sm" /> {res.verified ? 'Checking more…' : 'Loading…'}</> : items.length ? 'Show more' : 'Keep looking'}</button></div>}
      </section>
      {showFilters && <div className="scrim only-mobile" onClick={() => setShowFilters(false)} />}
    </div>
  );
}

// ============================== RATE ==============================
export function RateGrid({ type, compact, onCount }) {
  const { merge, actions, openTitle } = useApp();
  const [genres, setGenres] = useState([]);
  const [genre, setGenre] = useState('');
  const [decade, setDecade] = useState(0);
  const [items, setItems] = useState(null);
  const [done, setDone] = useState(0);
  const loading = useRef(false);

  useEffect(() => { api.genres(type).then((g) => setGenres(g.genres.slice(0, 14))); }, [type]);
  const load = useCallback(() => { loading.current = true; api.queue(type, genre, decade).then((d) => { setItems(d.items); loading.current = false; }); }, [type, genre, decade]);
  useEffect(() => { setItems(null); load(); }, [load]);

  const act = async (item, value) => {
    await actions.rate(item, value, { silent: true });
    if (value !== 0) { setDone((n) => n + 1); onCount?.(1); }
    setItems((list) => {
      const next = list.filter((x) => x.id !== item.id);
      if (next.length <= 6 && !loading.current) load();
      return next;
    });
  };
  const shown = useEnriched(items, true);

  return (
    <div className="rategrid">
      <div className="rate-filters">
        <div className="chip-scroll">
          <button className={`pill ${!genre ? 'on' : ''}`} onClick={() => setGenre('')}>Most popular</button>
          {genres.map((g) => <button key={g} className={`pill ${genre === g ? 'on' : ''}`} onClick={() => setGenre(g)}>{g}</button>)}
        </div>
        <div className="chip-scroll">
          <button className={`pill ${!decade ? 'on' : ''}`} onClick={() => setDecade(0)}>Any era</button>
          {[2020, 2010, 2000, 1990, 1980, 1970].map((d) => <button key={d} className={`pill ${decade === d ? 'on' : ''}`} onClick={() => setDecade(d)}>{d}s</button>)}
        </div>
      </div>
      <div className={`rate-cards ${compact ? 'compact' : ''}`}>
        {!shown && <Skeletons n={compact ? 6 : 12} />}
        {shown?.slice(0, compact ? 6 : 12).map((raw) => {
          const item = merge(raw);
          return (
            <div className="rate-card" key={item.id}>
              <button className="rate-poster" onClick={() => openTitle(item.id)} aria-label={`Details for ${item.title}`}><Poster item={item} /></button>
              <div className="rate-info">
                <h3>{item.title}</h3>
                <div className="card-meta">{yearAndLength(item)}{item.directors && type === 'movie' ? ` · ${item.directors.split(', ')[0]}` : ''}</div>
                <div className="rate-actions">
                  {RATINGS.map((r) => <button key={r.value} className={`v${r.value}`} onClick={() => act(item, r.value)} title={r.label}><span className="ic"><Icon name={r.icon} size={18} /></span><span>{r.short}</span></button>)}
                </div>
                <button className="skip" onClick={() => act(item, 0)}>Haven’t seen it</button>
              </div>
            </div>
          );
        })}
        {shown?.length === 0 && <div className="empty"><h3>You’ve been through all of these</h3><p>Pick another genre or era, or search for a specific title.</p></div>}
      </div>
    </div>
  );
}

export function RatePage() {
  const { type, status } = useApp();
  const rated = status.rated?.[type] || 0;
  const goal = rated < 10 ? 10 : rated < 25 ? 25 : rated < 50 ? 50 : 100;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Rate what you’ve seen</h1>
          <p className="muted">One tap each. The more you rate, the sharper your picks — and rated {noun(type)} stop showing up in recommendations.</p>
        </div>
        <div className="progress" title={`${rated} rated`}>
          <div className="progress-num"><b>{rated}</b> rated <span className="muted">· next milestone {goal}</span></div>
          <div className="progress-bar"><span style={{ width: `${Math.min(100, (rated / goal) * 100)}%` }} /></div>
        </div>
      </div>
      <RateGrid type={type} />
    </div>
  );
}

// ============================== LIBRARY ==============================
export function Library() {
  const { version, merge, actions, openTitle, type, notify, refreshStatus } = useApp();
  const [data, setData] = useState(null);
  const [taste, setTaste] = useState(null);
  const [tab, setTab] = useState('watchlist');
  const [filter, setFilter] = useState('all');
  const file = useRef();
  const reload = useCallback(() => { api.library().then(setData); api.taste(type).then(setTaste); }, [type]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (version) { const t = setTimeout(() => api.taste(type).then(setTaste), 600); return () => clearTimeout(t); } }, [version, type]);

  const onImport = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const r = await api.importCsv(await f.text());
      notify(`Imported ${r.imported} ratings${r.missed ? ` · ${r.missed} couldn’t be matched` : ''}`);
      reload(); refreshStatus();
    } catch (err) { notify(err.message); }
    e.target.value = '';
  };

  const watch = useEnriched(data?.watchlist, tab === 'watchlist');
  if (!data) return <div className="page"><div className="spinner" /></div>;
  const rated = data.rated.map(merge).filter((x) => x.myRating && x.type === type && (filter === 'all' || x.myRating === +filter));
  const watchlist = (watch || []).map(merge).filter((x) => x.watchlisted && x.type === type);
  const hidden = data.dismissed.map(merge).filter((x) => x.dismissed !== false && x.type === type);
  const maxW = taste ? Math.max(0.5, ...taste.genres.map((g) => Math.abs(g.weight))) : 1;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>My list</h1><p className="muted">Your watchlist, everything you’ve rated, and what Reel has learned about your taste in {noun(type)}.</p></div>
        <div>
          <input type="file" accept=".csv,text/csv" hidden ref={file} onChange={onImport} />
          <button className="btn" onClick={() => file.current.click()} title="IMDb ratings export or Letterboxd ratings.csv">Import ratings (CSV)</button>
        </div>
      </div>

      {taste && taste.count >= 3 && (
        <section className="taste">
          <h2>Your taste profile <small className="muted">from {taste.count} rated {noun(type, taste.count)}</small></h2>
          <div className="taste-body">
            <div className="taste-genres">
              {taste.genres.slice(0, 12).map((g) => (
                <div className="tg" key={g.genre} title={g.weight > 0 ? 'You tend to like this' : 'You tend to dislike this'}>
                  <span className="tg-name">{g.genre}</span>
                  <span className="tg-bar"><span className={g.weight >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(g.weight) / maxW) * 50}%` }} /></span>
                </div>
              ))}
            </div>
            {taste.people.length > 0 && <div className="taste-people"><h3>{type === 'movie' ? 'Directors you rate highly' : 'Writers you rate highly'}</h3>
              {taste.people.map((p) => <div key={p.name}><b>{p.name}</b> <span className="muted">{p.titles.slice(0, 3).join(', ')}</span></div>)}</div>}
          </div>
        </section>
      )}

      <div className="tabs">
        <button className={tab === 'watchlist' ? 'on' : ''} onClick={() => setTab('watchlist')}>Watchlist <span className="count">{watchlist.length}</span></button>
        <button className={tab === 'rated' ? 'on' : ''} onClick={() => setTab('rated')}>Rated <span className="count">{data.rated.map(merge).filter((x) => x.myRating && x.type === type).length}</span></button>
        <button className={tab === 'hidden' ? 'on' : ''} onClick={() => setTab('hidden')}>Hidden <span className="count">{hidden.length}</span></button>
        {tab === 'rated' && <div className="seg small right">{[{ v: 'all', l: 'All' }, ...RATINGS.map((r) => ({ v: String(r.value), l: r.short }))].map((o) => <button key={o.v} className={filter === o.v ? 'on' : ''} onClick={() => setFilter(o.v)}>{o.l}</button>)}</div>}
      </div>

      {tab === 'watchlist' && (watchlist.length ? <div className="grid">{watchlist.map((it) => <TitleCard key={it.id} item={it} />)}</div>
        : <div className="empty"><h3>Your watchlist is empty</h3><p>Hit + on anything that looks good and it’ll wait for you here.</p></div>)}
      {tab === 'rated' && (rated.length ? (
        <div className="rated-list">
          {rated.map((it) => (
            <div className="rated-row" key={it.id}>
              <button className="rated-main" onClick={() => openTitle(it.id)}><Poster item={it} className="tiny" /><span><b>{it.title}</b><span className="muted">{yearAndLength(it)} · {it.genres.slice(0, 2).join(', ')}</span></span></button>
              <RateButtons item={it} size="sm" />
            </div>
          ))}
        </div>
      ) : <div className="empty"><h3>Nothing here yet</h3><p>Head to Rate and tap through a few {noun(type)} you’ve seen.</p></div>)}
      {tab === 'hidden' && (hidden.length ? (
        <div className="rated-list">{hidden.map((it) => (
          <div className="rated-row" key={it.id}>
            <button className="rated-main" onClick={() => openTitle(it.id)}><Poster item={it} className="tiny" /><span><b>{it.title}</b><span className="muted">{yearSpan(it)}</span></span></button>
            <button className="btn sm" onClick={() => actions.dismiss(it, false).then(reload)}>Unhide</button>
          </div>))}</div>
      ) : <div className="empty"><h3>Nothing hidden</h3><p>Use ✕ on a card to stop Reel suggesting it.</p></div>)}
    </div>
  );
}
