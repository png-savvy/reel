import React, { useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { Modal, Toggle, ServicePicker, ContentSettings } from './components.jsx';
import { RateGrid } from './pages.jsx';

export function CatalogMissing({ onRetry }) {
  return (
    <div className="fullmsg">
      <span className="logo-mark big" />
      <h1>One-time setup</h1>
      <p>Reel keeps a local catalog of ~100,000 movies and shows so searching and filtering is instant. Build it once (about 3 minutes, 700 MB download):</p>
      <pre>npm run catalog</pre>
      <button className="btn primary" onClick={onRetry}>I’ve run it — continue</button>
    </div>
  );
}

function KeyField({ kind, label, has, help, href }) {
  const { refreshStatus } = useApp();
  const [val, setVal] = useState('');
  const [state, setState] = useState(null);
  const save = async () => {
    setState({ busy: true });
    const r = await api.testKey(kind, val).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) return setState({ error: r.error || 'That key didn’t work' });
    await api.saveSettings({ [`${kind}Key`]: val });
    setVal(''); setState({ ok: true }); refreshStatus();
  };
  const remove = async () => { await api.saveSettings({ [`${kind}Key`]: '' }); setState(null); refreshStatus(); };
  return (
    <div className="keyfield">
      <div className="kf-head"><b>{label}</b>{has ? <span className="tag ok">Connected</span> : <span className="tag">Optional</span>}</div>
      <p className="muted small">{help} <a href={href} target="_blank" rel="noreferrer">Get a free key ↗</a></p>
      {has ? <button className="btn sm" onClick={remove}>Disconnect</button> : (
        <div className="kf-row">
          <input type="password" placeholder="Paste API key" value={val} onChange={(e) => { setVal(e.target.value); setState(null); }} onKeyDown={(e) => e.key === 'Enter' && val && save()} aria-label={`${label} API key`} />
          <button className="btn primary sm" disabled={!val.trim() || state?.busy} onClick={save}>{state?.busy ? 'Checking…' : 'Connect'}</button>
        </div>
      )}
      {state?.error && <div className="bad small">{state.error}</div>}
    </div>
  );
}

export function Sources() {
  const { status, refreshStatus } = useApp();
  const s = status.settings;
  const setRt = async (on) => { await api.saveSettings({ rtEnabled: on }); refreshStatus(); };
  return (
    <div className="sources">
      <div className="source-card on">
        <div className="kf-head"><b>IMDb ratings & episode data</b><span className="tag ok">Built in</span></div>
        <p className="muted small">{(status.counts?.movie || 0).toLocaleString()} movies and {(status.counts?.tv || 0).toLocaleString()} shows, stored locally from IMDb’s open datasets. Powers search, filters and the TV episode analysis.</p>
      </div>
      <div className={`source-card ${s.rtEnabled ? 'on' : ''}`}>
        <Toggle label="Rotten Tomatoes scores" checked={s.rtEnabled} onChange={setRt} />
        <p className="muted small">Adds the audience score and critics score, plus posters and plot summaries. Rotten Tomatoes has no public API, so Reel reads each title’s public page the way your browser would (slowly, and cached for two weeks). Fine for personal use; if you ever publish Reel you’d need a licensed source instead.</p>
      </div>
      <KeyField kind="tmdb" label="TMDB" has={s.hasTmdb} href="https://www.themoviedb.org/settings/api"
        help="High-quality posters, trailers, where-to-stream, cast, and “fans also liked” links that make recommendations much smarter." />
      <KeyField kind="omdb" label="OMDb" has={s.hasOmdb} href="https://www.omdbapi.com/apikey.aspx"
        help="Metacritic scores, age ratings and awards." />
    </div>
  );
}

export function SettingsModal({ onClose }) {
  const { status, refreshStatus } = useApp();
  const [region, setRegion] = useState(status.settings.region || 'US');
  return (
    <Modal onClose={onClose} className="settings" label="Settings">
      <div className="detail-pad">
        <h1>Settings</h1>
        <h3>Where scores come from</h3>
        <Sources />
        {status.settings.hasTmdb && (
          <div className="field inline"><label htmlFor="region">Streaming region</label>
            <input id="region" maxLength={2} value={region} onChange={(e) => setRegion(e.target.value.toUpperCase())}
              onBlur={() => { if (/^[A-Z]{2}$/.test(region)) api.saveSettings({ region }).then(refreshStatus); }} style={{ width: 64 }} /></div>
        )}
        <h3>Your streaming services</h3>
        <div className="source-card"><ServicePicker /></div>
        <h3>Content filters</h3>
        <div className="sources"><ContentSettings /></div>
        <p className="muted small">Catalog last built {status.builtAt ? new Date(status.builtAt).toLocaleDateString() : '—'}. Run <code>npm run catalog -- --refresh</code> to pull the latest titles and ratings.</p>
        <div className="modal-foot"><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

export function Onboarding() {
  const { refreshStatus, type, setType, status } = useApp();
  const [step, setStep] = useState(0);
  const [count, setCount] = useState(0);
  const finish = async () => { await api.saveSettings({ onboarded: true }); refreshStatus(); };
  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="steps">{[0, 1, 2].map((i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
        {step === 0 && (
          <div className="ob-step center">
            <span className="logo-mark big" />
            <h1>Stop scrolling. Start watching.</h1>
            <p className="lead">Reel finds movies and shows you’ll actually like, and checks the scores for you — so you never have to ask for a recommendation and then go verify it on Rotten Tomatoes again.</p>
            <ul className="ob-points">
              <li><b>Set your bar once.</b> “At least 85% audience score, nothing I’ve seen.” Reel only shows what clears it.</li>
              <li><b>Rate with one tap.</b> Reel learns your taste from what you’ve loved and hated.</li>
              <li><b>TV that’s worth the hours.</b> Episode-by-episode analysis spots shows that fall apart before you start them.</li>
            </ul>
            <button className="btn primary lg" onClick={() => setStep(1)}>Get started</button>
          </div>
        )}
        {step === 1 && (
          <div className="ob-step">
            <h1>Where should scores come from?</h1>
            <p className="lead">Reel works out of the box. Turn on more sources now or later in Settings.</p>
            <Sources />
            <div className="ob-nav"><button className="btn ghost" onClick={() => setStep(0)}>Back</button><button className="btn primary lg" onClick={() => setStep(2)}>Continue</button></div>
          </div>
        )}
        {step === 2 && (
          <div className="ob-step">
            <div className="ob-rate-head">
              <div><h1>Rate a few you’ve seen</h1><p className="lead">Five is enough to start. Skip anything you haven’t watched.</p></div>
              <div className="seg"><button className={type === 'movie' ? 'on' : ''} onClick={() => setType('movie')}>Movies</button><button className={type === 'tv' ? 'on' : ''} onClick={() => setType('tv')}>TV</button></div>
            </div>
            <RateGrid type={type} compact key={type} onCount={(n) => setCount((c) => c + n)} />
            <div className="ob-nav">
              <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
              <span className="muted">{count} rated{count < 5 ? ` · ${5 - count} to go` : ' — nice'}</span>
              <button className={`btn lg ${count >= 5 ? 'primary' : ''}`} onClick={finish}>{count >= 5 ? 'Show my picks' : count ? 'Finish anyway' : 'Skip for now'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ScoreGuide({ onClose }) {
  return (
    <Modal onClose={onClose} className="guide" label="How scores work">
      <div className="detail-pad">
        <h1>How scores work</h1>
        <dl className="guide-list">
          <dt>RT audience score</dt>
          <dd>Rotten Tomatoes’ “Popcornmeter”: the share of regular viewers who rated it 3.5 stars or more out of 5. Read live from the title’s Rotten Tomatoes page and cached for two weeks.</dd>
          <dt>RT critics score</dt>
          <dd>Rotten Tomatoes’ “Tomatometer”: the share of professional critics who reviewed it positively.</dd>
          <dt>IMDb rating</dt>
          <dd>Average user rating out of 10, from IMDb’s published dataset (refreshed when you rebuild the catalog).</dd>
          <dt>How well-known</dt>
          <dd>The number of IMDb votes. It’s a stand-in for how many people have seen something, and it’s also why a 9.0 from 500 people is trusted less than an 8.5 from 500,000.</dd>
          <dt>Reel score <small>movies, 0–100</small></dt>
          <dd>An audience-only score. The RT audience score and the IMDb rating count equally; the IMDb rating is first pulled toward the catalog average when few people have voted, and the RT percentage is rescaled slightly so 95% and 9.5 mean roughly the same thing. Critics scores (Tomatometer, Metacritic) are shown for reference but never counted.</dd>
          <dt>Ratings counts</dt>
          <dd>Under each title: how many audience ratings Rotten Tomatoes reports (in bands such as 10k+; “verified” means ticket buyers, used for releases since 2019) and the exact number of IMDb votes.</dd>
          <dt>Where to watch</dt>
          <dd>With a TMDB key: JustWatch data for your region, which is reliable. Without one: the services Rotten Tomatoes lists, which covers only its partners and can miss some.</dd>
          <dt>Worth-It score <small>TV, 0–100</small></dt>
          <dd>Show-level scores run high because people who quit a show rarely come back to rate it. So Reel starts from a blend of the show’s IMDb rating (55%) and the average of all its episode ratings (45%), then: subtracts up to 15 points if the final season is rated below the rest, subtracts for uneven episode quality, and adds or removes a few points depending on whether as many people were rating the last season as the first.</dd>
          <dt>Match %</dt>
          <dd>How well a title fits your ratings: genres and decades you tend to rate up or down, directors and writers you’ve loved, and — with TMDB connected — what fans of your favourites also liked. Appears after you’ve rated three titles.</dd>
          <dt>Content levels</dt>
          <dd>Sex & nudity, violence, language and drugs, each 0 (none) to 5 (severe), from Common Sense Media’s reviews. In Settings you choose, per category, the level at which a title gets a flag and the level at which it is hidden.</dd>
          <dt>“Best for me” order</dt>
          <dd>60% quality score, 40% match.</dd>
        </dl>
        <div className="modal-foot"><button className="btn primary" onClick={onClose}>Got it</button></div>
      </div>
    </Modal>
  );
}
