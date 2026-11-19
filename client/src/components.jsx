import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';

const ICONS = {
  heart: <path fill="currentColor" stroke="none" d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 2.9 4.5 6.6 4.5c2 0 3.6 1 5.4 3 1.8-2 3.4-3 5.4-3 3.7 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z" />,
  up: <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />,
  down: <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />,
  meh: <><circle cx="12" cy="12" r="10" /><path d="M8 15h8M9 9h.01M15 9h.01" /></>,
  popcorn: <><path d="M6 10.5 7.5 21h9L18 10.5" /><path d="M10.3 10.8 11 21M13.7 10.8 13 21" strokeWidth="1.4" /><g fill="currentColor" stroke="none"><circle cx="8" cy="7.2" r="2.7" /><circle cx="12" cy="5.4" r="3.1" /><circle cx="16" cy="7.2" r="2.7" /><rect x="6" y="7.5" width="12" height="3" rx="1" /></g></>,
  tomato: <><circle cx="12" cy="13.8" r="7.4" fill="currentColor" stroke="none" /><path d="M12 6.6V3.4M12 6.6c-1-1.7-2.8-2.2-4.2-1.8M12 6.6c1-1.7 2.8-2.2 4.2-1.8" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  star: <path fill="currentColor" stroke="none" d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z" />,
};
export function Icon({ name, size = 16 }) {
  return <svg className={`icon i-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

export const RATINGS = [
  { value: 2, label: 'Loved it', short: 'Loved', icon: 'heart' },
  { value: 1, label: 'Liked it', short: 'Liked', icon: 'up' },
  { value: -1, label: 'It was okay', short: 'Meh', icon: 'meh' },
  { value: -2, label: 'Didn’t like it', short: 'Nope', icon: 'down' },
  // Seen, but no opinion: hides it like any rated title without teaching Reel anything about your taste.
  { value: 9, label: 'Seen it — can’t rate it', short: 'Seen', icon: 'eye' },
];
export const ratingInfo = (v) => RATINGS.find((r) => r.value === v);

const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const fmtVotes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n ?? ''));
export const fmtRuntime = (m) => (m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`) : null);
export const yearSpan = (it) => {
  if (it.type !== 'tv') return it.year;
  if (!it.year) return '';
  if (it.endYear) return it.endYear === it.year ? String(it.year) : `${it.year}–${it.endYear}`;
  return it.tv && it.tv.ended ? String(it.year) : `${it.year}–now`;
};

/** "2006 · 2h 31m" for movies, "2008–2013 · 5 seasons" for shows. */
export const yearAndLength = (it) => [yearSpan(it), it.type === 'movie' ? fmtRuntime(it.runtime) : it.tv ? `${it.tv.seasons} season${it.tv.seasons > 1 ? 's' : ''}` : null, it.rated].filter(Boolean).join(' · ');

export function Poster({ item, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.poster]);
  if (item.poster && !failed) {
    return <div className={`poster ${className}`}><img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></div>;
  }
  const h = hue(item.id);
  return (
    <div className={`poster placeholder ${className}`} style={{ '--h': h }} aria-hidden="true">
      <span className="ph-title">{item.title}</span>
      <span className="ph-year">{item.year}</span>
    </div>
  );
}

export const scoreTone = (s) => (s == null ? 'none' : s >= 82 ? 'great' : s >= 72 ? 'good' : s >= 60 ? 'ok' : 'low');

export function ScoreRing({ value, size = 44, label }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  return (
    <div className={`ring tone-${scoreTone(value)}`} style={{ width: size, height: size }} title={label}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        {value != null && <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={`${(value / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <span style={{ fontSize: size * 0.34 }}>{value ?? '–'}</span>
    </div>
  );
}

/** Compact source chips shown on cards. */
export function ScoreChips({ item, sources }) {
  return (
    <div className="chips">
      {item.rtAud != null && <span className={`chip rt ${item.rtAud >= 60 ? 'up' : 'down'}`} title={`Rotten Tomatoes audience score${item.rtAudCount ? ` · ${item.rtAudCount}` : ''}`}><Icon name="popcorn" size={12} /> {item.rtAud}%</span>}
      {item.rtAud == null && sources?.rt && !item.rtChecked && <span className="chip pending" title="Checking Rotten Tomatoes…"><Icon name="popcorn" size={12} /> …</span>}
      {item.rtCrit != null && <span className={`chip rt ${item.rtCrit >= 60 ? 'up' : 'down'}`} title="Rotten Tomatoes critics (Tomatometer)"><Icon name="tomato" size={12} /> {item.rtCrit}%</span>}
      <span className="chip" title={`IMDb rating · ${item.votes?.toLocaleString()} votes`}><Icon name="star" size={11} /> {item.imdb?.toFixed(1)}</span>
    </div>
  );
}

export function RateButtons({ item, size = 'md', onRated }) {
  const { actions } = useApp();
  return (
    <div className={`rate-btns ${size}`} role="group" aria-label={`Rate ${item.title}`}>
      {RATINGS.map((r) => (
        <button key={r.value} className={`${item.myRating === r.value ? 'on' : ''} v${r.value}`} title={r.label} aria-pressed={item.myRating === r.value}
          onClick={(e) => { e.stopPropagation(); const v = item.myRating === r.value ? null : r.value; actions.rate(item, v); onRated?.(v); }}>
          <span className="ic"><Icon name={r.icon} size={size === 'sm' ? 16 : 15} /></span>{size !== 'sm' && <span className="tx">{r.short}</span>}
        </button>
      ))}
    </div>
  );
}

export function TitleCard({ item: raw, showWhy = false }) {
  const { merge, openTitle, actions, status } = useApp();
  const item = merge(raw);
  if (item.dismissed) return null;
  const main = item.type === 'tv' && item.tv ? item.tv.worth : item.score;
  const mine = ratingInfo(item.myRating);
  return (
    <article className="card" tabIndex={0} onClick={() => openTitle(item.id)} onKeyDown={(e) => { if (e.key === 'Enter') openTitle(item.id); }}>
      <div className="card-art">
        <Poster item={item} />
        <div className="card-score"><ScoreRing value={main} size={40} label={item.type === 'tv' ? 'Worth-It score' : 'Reel score — all sources blended'} /></div>
        {item.match != null && <div className={`match ${item.match >= 75 ? 'hot' : ''}`} title="How well this fits your taste">{item.match}% match</div>}
        {mine && <div className={`mine v${item.myRating}`} title={`You: ${mine.label}`}><Icon name={mine.icon} size={15} /></div>}
        <div className="card-actions">
          <button className={item.watchlisted ? 'on' : ''} title={item.watchlisted ? 'Remove from watchlist' : 'Add to watchlist'} aria-label="Toggle watchlist"
            onClick={(e) => { e.stopPropagation(); actions.watchlist(item, !item.watchlisted); }}>{item.watchlisted ? '✓' : '+'}</button>
          <button title="Not interested — hide this" aria-label="Hide" onClick={(e) => { e.stopPropagation(); actions.dismiss(item, true); }}>✕</button>
        </div>
        <div className="card-rate" onClick={(e) => e.stopPropagation()}><RateButtons item={item} size="sm" /></div>
      </div>
      <div className="card-body">
        <h3 title={item.title}>{item.title}</h3>
        <div className="card-meta">{yearAndLength(item)}</div>
        {item.genres?.length > 0 && <div className="card-meta">{item.genres.slice(0, 2).join(', ')}</div>}
        <ScoreChips item={item} sources={status.sources} />
        {item.type === 'tv' && item.verdicts?.[0] && <div className={`verdict ${item.verdicts[0].tone}`} title={item.verdicts[0].detail}>{item.verdicts[0].label}</div>}
        <CountLine item={item} />
        <WatchLine watch={item.watch} />
        <ContentLine item={item} />
        {showWhy && item.reasons?.[0] && <div className="why">{item.reasons[0].text}</div>}
      </div>
    </article>
  );
}

/** Lazily fill in external scores/posters for a list of items once `active` is true. */
export function useEnriched(items, active = true) {
  const { status } = useApp();
  const [extra, setExtra] = useState({});
  const tried = useRef(new Set());
  const any = status.sources.rt || status.sources.tmdb || status.sources.omdb || status.sources.csm || status.sources.va;
  useEffect(() => {
    if (!active || !any || !items?.length) return;
    const need = items.filter((it) => !tried.current.has(it.id) && ((status.sources.rt && !it.rtChecked) || ((status.sources.tmdb || status.sources.omdb) && !it.poster) || (status.sources.tmdb && !it.tmdbChecked) || (status.sources.csm && !it.contentChecked) || (status.sources.va && !it.vaChecked)));
    if (!need.length) return;
    need.forEach((it) => tried.current.add(it.id));
    let live = true;
    (async () => {
      for (let i = 0; i < need.length && live; i += 8) {
        try {
          const r = await api.enrich(need.slice(i, i + 8).map((x) => x.id));
          if (live) setExtra((e) => ({ ...e, ...Object.fromEntries(r.items.map((x) => [x.id, x])) }));
        } catch { /* scores stay blank */ }
      }
    })();
    return () => { live = false; };
  }, [items, active, any]); // eslint-disable-line
  return items ? items.map((it) => extra[it.id] || it) : items;
}

export function Row({ title, subtitle, items, showWhy, action, hideDone }) {
  const { merge } = useApp();
  const ref = useRef();
  const scroller = useRef();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const enriched = useEnriched(items, seen);
  // On For You, anything you rate or add to your watchlist leaves the row straight away.
  const list = hideDone ? enriched.filter((it) => { const m = merge(it); return !m.myRating && !m.watchlisted; }) : enriched;
  const scroll = (dir) => scroller.current.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: 'smooth' });
  if (hideDone && !list.length) return <span ref={ref} />;
  return (
    <section className="row" ref={ref}>
      <div className="row-head">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <div className="row-tools">
          {action}
          <button className="icon-btn sm" onClick={() => scroll(-1)} aria-label="Scroll left">‹</button>
          <button className="icon-btn sm" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
        </div>
      </div>
      <div className="row-scroll" ref={scroller}>
        {list.map((it) => <TitleCard key={it.id} item={it} showWhy={showWhy} />)}
      </div>
    </section>
  );
}

/** Small "i" button that reveals an explanation on hover, focus or tap. Positioned against the viewport so it is never clipped. */
export function InfoTip({ children }) {
  const [pos, setPos] = useState(null);
  const ref = useRef();
  const show = () => {
    const r = ref.current.getBoundingClientRect();
    const width = Math.min(290, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left - 20, window.innerWidth - width - 12));
    const below = window.innerHeight - r.bottom > 190;
    setPos({ left, width, ...(below ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 }) });
  };
  return (
    <span className="info" ref={ref} tabIndex={0} role="note" aria-label="More info" onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      i{pos && <span className="info-pop" style={pos}>{children}</span>}
    </span>
  );
}

/** How many people are behind the audience score — RT audience ratings when known, otherwise IMDb votes. */
export function CountLine({ item }) {
  if (item.rtAudN != null && item.rtAud != null) {
    return <div className="countline" title={`${item.rtAudCount} on Rotten Tomatoes · ${item.votes?.toLocaleString()} IMDb votes`}>{item.rtAudN ? `${item.rtAudN.toLocaleString()}+` : '<50'} {item.rtVerified ? 'verified ' : ''}RT · {item.votes?.toLocaleString()} IMDb</div>;
  }
  return <div className="countline" title={`${item.votes?.toLocaleString()} IMDb votes`}>{item.votes?.toLocaleString()} IMDb votes</div>;
}

/** Slider over a fixed list of steps (first step = off). */
export function StepSlider({ label, hint, steps, value, onChange, format = fmtVotes, disabled, disabledNote }) {
  let idx = 0;
  steps.forEach((v, i) => { if ((value || 0) >= v) idx = i; });
  return (
    <div className={`slider ${disabled ? 'disabled' : ''}`}>
      <div className="slider-head">
        <label>{label}{hint && <InfoTip>{hint}</InfoTip>}</label>
        <span className={idx ? 'val' : 'muted'}>{disabled ? '' : idx ? `${format(steps[idx])}+` : 'Any'}</span>
      </div>
      {disabled ? <div className="slider-note">{disabledNote}</div> : (
        <input type="range" min={0} max={steps.length - 1} step={1} value={idx} aria-label={label}
          style={{ '--p': `${(idx / (steps.length - 1)) * 100}%` }} onChange={(e) => onChange(steps[+e.target.value])} />
      )}
    </div>
  );
}

export function WatchLine({ watch }) {
  if (!watch) return null;
  const names = watch.stream.length ? watch.stream : null;
  if (!names) return null;
  return <div className="watchline" title={`Streaming on ${names.join(', ')}${watch.complete ? '' : ' (partial list)'}`}><span className="dot" />{names.slice(0, 2).join(', ')}{names.length > 2 ? ` +${names.length - 2}` : ''}</div>;
}

export function Slider({ label, hint, value, onChange, min = 0, max = 100, step = 5, format = (v) => v, offLabel = 'Any', disabled, disabledNote }) {
  const off = !value;
  return (
    <div className={`slider ${disabled ? 'disabled' : ''}`}>
      <div className="slider-head">
        <label>{label}{hint && <InfoTip>{hint}</InfoTip>}</label>
        <span className={off ? 'muted' : 'val'}>{disabled ? '' : off ? offLabel : `${format(value)}+`}</span>
      </div>
      {disabled ? <div className="slider-note">{disabledNote}</div> : (
        <input type="range" min={min} max={max} step={step} value={value || min} aria-label={label}
          style={{ '--p': `${(((value || min) - min) / (max - min)) * 100}%` }}
          onChange={(e) => { const v = +e.target.value; onChange(v <= min ? 0 : v); }} />
      )}
    </div>
  );
}

/** Content flags (per your rules in Settings) and the VidAngel marker, shown under a card. */
export function ContentLine({ item }) {
  const { status } = useApp();
  const on = status.sources.csm;
  const va = item.va?.show && item.va.available;
  const flags = item.flags || [];
  const unknown = on && item.contentChecked && !item.content;
  if (!flags.length && !va && !unknown) return null;
  return (
    <div className="contentline">
      {flags.map((f) => <span key={f.key} className={`flag ${f.over ? 'over' : ''}`} title={`${f.label}: ${f.level} out of 5${f.over ? ' — over your limit' : ''}`}>{f.label} {f.level}</span>)}
      {unknown && <span className="flag none" title="Common Sense Media has no review for this title">No content rating</span>}
      {va && <span className="flag va" title={`VidAngel can filter this${item.va.via.length ? ` (on ${item.va.via.join(', ')})` : ''}`}>VidAngel</span>}
    </div>
  );
}

export const CONTENT_CATS = [
  { key: 'sex', label: 'Sex & nudity' },
  { key: 'violence', label: 'Violence' },
  { key: 'language', label: 'Language' },
  { key: 'drugs', label: 'Drugs & alcohol' },
];
export const LEVELS = ['None', 'Minimal', 'Mild', 'Moderate', 'Strong', 'Severe'];
const LEVEL_OPTIONS = [[0, 'Never'], [1, '1+ Minimal'], [2, '2+ Mild'], [3, '3+ Moderate'], [4, '4+ Strong'], [5, '5 Severe']];
export function Dots({ level }) {
  return <span className="dots" role="img" aria-label={`${level} out of 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= level ? 'on' : ''} />)}</span>;
}

/** Content rules and the VidAngel switch. Saved globally; applies to every page. */
export function ContentSettings() {
  const { status, refreshStatus } = useApp();
  const s = status.settings;
  const c = { enabled: false, rules: {}, hideUnknown: false, vaRescue: false, ...(s.content || {}) };
  const save = (patch) => api.saveSettings(patch).then(refreshStatus);
  const setC = (patch) => save({ content: { ...c, ...patch } });
  const setRule = (key, kind, v) => setC({ rules: { ...c.rules, [key]: { flag: 0, hide: 0, ...(c.rules[key] || {}), [kind]: v } } });
  const hides = c.hideUnknown || CONTENT_CATS.some((k) => c.rules[k.key]?.hide > 0);
  return (
    <>
      <div className={`source-card ${c.enabled ? 'on' : ''}`}>
        <Toggle label="Content ratings" checked={c.enabled} onChange={(v) => setC({ enabled: v })} hint="Sex & nudity, violence, language, drugs — each rated 0 to 5" />
        <p className="muted small">Levels come from Common Sense Media’s public review pages, looked up the same way as Rotten Tomatoes scores and remembered for three months. Only the numbers are stored; each title links to the full write-up.</p>
        {c.enabled && (
          <>
            <div className="rules">
              <div className="rule head"><span /><span>Flag it from</span><span>Hide it from</span></div>
              {CONTENT_CATS.map((k) => (
                <div className="rule" key={k.key}>
                  <b>{k.label}</b>
                  {['flag', 'hide'].map((kind) => (
                    <select key={kind} aria-label={`${kind === 'flag' ? 'Flag' : 'Hide'} ${k.label} from`} value={c.rules[k.key]?.[kind] || 0} onChange={(e) => setRule(k.key, kind, +e.target.value)}>
                      {LEVEL_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  ))}
                </div>
              ))}
            </div>
            <p className="muted small">Flagged titles stay in your lists with a label. Hidden titles are left out of For you, tonight’s pick and Discover; search and your library still show them, marked as over your limit.</p>
            <Toggle label="Hide titles with no content rating" checked={c.hideUnknown} onChange={(v) => setC({ hideUnknown: v })} hint="Older and lesser-known titles often have none" />
            <Toggle label="Keep titles VidAngel can filter" checked={c.vaRescue} onChange={(v) => setC({ vaRescue: v })} hint="Something over your limit stays (flagged) when it’s on VidAngel" />
            {hides && <p className="note">With hiding on, lists take longer the first time because each title’s rating has to be looked up.</p>}
          </>
        )}
      </div>
      <div className={`source-card ${s.vidangel ? 'on' : ''}`}>
        <Toggle label="Show VidAngel availability" checked={s.vidangel} onChange={(v) => save({ vidangel: v })} hint="Marks titles VidAngel can filter" />
        {s.vidangel && status.va?.blocked && <p className="note warn">Couldn’t download VidAngel’s title list, so some badges are missing. Reel tries again within the hour.</p>}
        {s.vidangel && status.va?.titles > 0 && <p className="muted small">Checked against VidAngel’s published list of {status.va.titles.toLocaleString()} titles, refreshed daily.</p>}
        <p className="muted small">Checked against VidAngel’s public catalogue weekly. VidAngel plays titles through a service you already have (Netflix, Prime Video and so on), so each title page shows which one it needs and how many moments are tagged per category.</p>
      </div>
    </>
  );
}

export const SERVICES = ['Netflix', 'Prime Video', 'Max', 'Hulu', 'Disney+', 'Apple TV+', 'Peacock', 'Paramount+'];
/** The "my streaming services" switch and service list. One saved setting, shown in Settings and in Discover. */
export function ServicePicker() {
  const { status, refreshStatus, openSettings } = useApp();
  const s = status.settings, src = status.sources;
  const mine = s.services || [];
  const on = !!s.onlyMyServices;
  const save = (patch) => api.saveSettings(patch).then(refreshStatus);
  const toggle = (sv) => save({ services: mine.includes(sv) ? mine.filter((x) => x !== sv) : [...mine, sv] });
  return (
    <div className="service-picker">
      <Toggle label="Only on my services" checked={on} onChange={(v) => save({ onlyMyServices: v })}
        hint="Applies to For you, tonight’s pick and Discover"
        info={src.tmdb ? 'Uses JustWatch data via TMDB for your region. Availability changes often, so double-check before you sit down.' : 'Without a TMDB key this relies on Rotten Tomatoes, which only lists its partner services — titles that are available can be wrongly hidden.'} />
      <div className="genre-chips">
        {SERVICES.map((sv) => <button key={sv} className={mine.includes(sv) ? 'inc' : ''} aria-pressed={mine.includes(sv)} onClick={() => toggle(sv)}>{mine.includes(sv) ? '✓ ' : ''}{sv}</button>)}
      </div>
      {on && !mine.length && <p className="note warn">Pick at least one service above.</p>}
      {on && mine.length > 0 && !src.tmdb && src.rt && <p className="note">May be incomplete: Rotten Tomatoes only lists some services, so this can hide titles you could actually stream. Connecting TMDB in Settings (free key) makes it accurate.</p>}
      {on && !src.tmdb && !src.rt && <p className="note warn">Needs Rotten Tomatoes or TMDB turned on in <button className="link" onClick={openSettings}>Settings</button>.</p>}
    </div>
  );
}

export function Toggle({ label, hint, info, checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
      <span className="toggle-label"><span>{label}{info && <InfoTip>{info}</InfoTip>}</span>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Skeletons({ n = 12 }) {
  return <>{Array.from({ length: n }, (_, i) => <div className="card skeleton" key={i}><div className="poster" /><div className="sk-line" /><div className="sk-line short" /></div>)}</>;
}

export function Modal({ onClose, children, className = '', label }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}
