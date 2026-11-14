import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Home, Discover, RatePage, Library } from './pages.jsx';
import { TitleModal } from './TitleModal.jsx';
import { SettingsModal, Onboarding, CatalogMissing, ScoreGuide } from './Settings.jsx';
import { Poster, RATINGS, fmtRuntime } from './components.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const NAV = [
  { key: 'home', label: 'For you' },
  { key: 'discover', label: 'Discover' },
  { key: 'rate', label: 'Rate' },
  { key: 'library', label: 'My list' },
];

export default function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(() => (NAV.some((n) => n.key === location.hash.slice(1)) ? location.hash.slice(1) : 'home'));
  const [type, setType] = useState(() => localStorage.getItem('reel.type') || 'movie');
  const [openId, setOpenId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [version, setVersion] = useState(0); // bumps when ratings change, so pages can refresh lazily
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const refreshStatus = useCallback(() => api.status().then(setStatus).catch((e) => setError(e.message)), []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);
  useEffect(() => { if (location.hash.slice(1) !== view) location.hash = view; window.scrollTo(0, 0); }, [view]);
  useEffect(() => {
    // Keep the browser's back/forward buttons working between sections.
    const onHash = () => { const h = location.hash.slice(1); if (NAV.some((n) => n.key === h)) setView(h); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { localStorage.setItem('reel.type', type); }, [type]);

  const notify = useCallback((text, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const patch = (id, p) => setOverrides((o) => ({ ...o, [id]: { ...o[id], ...p } }));
  const actions = useMemo(() => ({
    rate: async (item, value, { silent } = {}) => {
      const prev = item.myRating ?? null;
      patch(item.id, { myRating: value, ...(value ? { watchlisted: false } : {}) });
      await api.rate(item.id, value);
      if (!silent && value) notify(`Rated “${item.title}” · ${RATINGS.find((r) => r.value === value)?.short}`, () => actions.rate({ ...item, myRating: value }, prev, { silent: true }));
      setVersion((v) => v + 1);
      refreshStatus();
    },
    watchlist: async (item, on) => {
      patch(item.id, { watchlisted: on });
      await api.watchlist(item.id, on);
      notify(on ? `Added “${item.title}” to your watchlist` : `Removed “${item.title}” from your watchlist`);
      refreshStatus();
    },
    dismiss: async (item, on) => {
      patch(item.id, { dismissed: on });
      await api.dismiss(item.id, on);
      if (on) notify(`Hidden “${item.title}”`, () => actions.dismiss(item, false));
    },
  }), [notify, refreshStatus]);

  const merge = useCallback((item) => (overrides[item.id] ? { ...item, ...overrides[item.id] } : item), [overrides]);

  if (error) return <div className="fullmsg"><h1>Can’t reach the Reel server</h1><p>{error}</p><p className="muted">Start it with <code>npm run dev</code> and reload.</p></div>;
  if (!status) return <div className="fullmsg"><div className="spinner" /></div>;
  if (!status.catalog) return <CatalogMissing onRetry={refreshStatus} />;

  const ctx = { status, refreshStatus, type, setType, view, setView, openTitle: setOpenId, actions, merge, version, notify, openSettings: () => setShowSettings(true), openGuide: () => setShowGuide(true) };

  if (!status.settings.onboarded) return <Ctx.Provider value={ctx}><Onboarding /></Ctx.Provider>;

  return (
    <Ctx.Provider value={ctx}>
      <header className="topbar">
        <button className="logo" onClick={() => setView('home')} aria-label="Reel home">
          <span className="logo-mark" aria-hidden="true" /> Reel
        </button>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={view === n.key ? 'active' : ''} onClick={() => setView(n.key)}>
              {n.label}{n.key === 'library' && status.watchlist ? <span className="count">{status.watchlist}</span> : null}
            </button>
          ))}
        </nav>
        <div className="seg type-toggle" role="tablist" aria-label="Movies or TV">
          <button role="tab" aria-selected={type === 'movie'} className={type === 'movie' ? 'on' : ''} onClick={() => setType('movie')}>Movies</button>
          <button role="tab" aria-selected={type === 'tv'} className={type === 'tv' ? 'on' : ''} onClick={() => setType('tv')}>TV</button>
        </div>
        <Search />
        <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      </header>

      <main className="main">
        {view === 'home' && <Home key={type} />}
        {view === 'discover' && <Discover key={type} />}
        {view === 'rate' && <RatePage key={type} />}
        {view === 'library' && <Library />}
      </main>

      <nav className="bottomnav">
        {NAV.map((n) => <button key={n.key} className={view === n.key ? 'active' : ''} onClick={() => setView(n.key)}>{n.label}</button>)}
      </nav>

      {openId && <TitleModal id={openId} onClose={() => setOpenId(null)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showGuide && <ScoreGuide onClose={() => setShowGuide(false)} />}
      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && <button onClick={() => { toast.undo(); setToast(null); }}>Undo</button>}
        </div>
      )}
    </Ctx.Provider>
  );
}

function Search() {
  const { openTitle } = useApp();
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef();
  const input = useRef();

  useEffect(() => {
    if (!q.trim()) { setItems([]); return; }
    let live = true;
    const t = setTimeout(() => api.search(q).then((r) => { if (live) { setItems(r.items); setHi(0); } }).catch(() => {}), 140);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); input.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, []);
  const choose = (it) => { openTitle(it.id); setOpen(false); setQ(''); input.current?.blur(); };

  return (
    <div className="search" ref={box}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={input} value={q} placeholder="Search any movie or show" aria-label="Search titles"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(items.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter' && items[hi]) choose(items[hi]);
          else if (e.key === 'Escape') { setOpen(false); e.target.blur(); }
        }} />
      {open && q.trim() && (
        <div className="search-results">
          {items.length === 0 && <div className="search-empty">No matches for “{q}”</div>}
          {items.map((it, i) => (
            <button key={it.id} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onClick={() => choose(it)}>
              <Poster item={it} className="tiny" />
              <span className="sr-main"><b>{it.title}</b><span className="muted">{it.year || '—'} · {it.type === 'tv' ? 'TV' : fmtRuntime(it.runtime) || 'Movie'}{it.directors ? ` · ${it.directors.split(', ')[0]}` : ''}</span></span>
              <span className="sr-score">{it.imdb?.toFixed(1)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
