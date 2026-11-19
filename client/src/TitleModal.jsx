import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { Modal, Poster, RateButtons, ScoreRing, TitleCard, fmtRuntime, fmtVotes, yearSpan, scoreTone, useEnriched, CONTENT_CATS, LEVELS, Dots } from './components.jsx';

const epColor = (r) => {
  // 5.0 → red, 7.5 → amber, 9.5 → green
  const t = Math.max(0, Math.min(1, (r - 5) / 4.5));
  return `hsl(${Math.round(t * 135)} 62% ${30 + t * 8}%)`;
};

function SourceTile({ label, value, sub, href, tone }) {
  const body = (<><span className="st-value">{value ?? '—'}</span><span className="st-label">{label}</span>{sub && <span className="st-sub">{sub}</span>}</>);
  return href ? <a className={`source-tile ${tone || ''}`} href={href} target="_blank" rel="noreferrer">{body}</a> : <div className={`source-tile ${tone || ''}`}>{body}</div>;
}

export function TitleModal({ id, onClose }) {
  const { merge, actions, status, openSettings } = useApp();
  const [data, setData] = useState(null);
  const [full, setFull] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null); setFull(false); setErr(null);
    // Fast local data first, then the enriched version once outside lookups finish.
    api.title(id, true).then((d) => { if (live) setData((cur) => cur || d); }).catch((e) => live && setErr(e.message));
    api.title(id).then((d) => { if (live) { setData(d); setFull(true); } }).catch(() => live && setFull(true));
    return () => { live = false; };
  }, [id]);

  if (err) return <Modal onClose={onClose} label="Error"><div className="detail-pad"><h2>Couldn’t load that title</h2><p className="muted">{err}</p></div></Modal>;
  if (!data) return <Modal onClose={onClose} label="Loading"><div className="detail-pad center"><div className="spinner" /></div></Modal>;

  const item = merge(data);
  const src = status.sources;
  const isTv = item.type === 'tv';
  const main = isTv && item.tv ? item.tv.worth : item.score;
  const pending = !full && (src.rt || src.tmdb || src.omdb);
  const tone = (v, good, ok) => (v == null ? '' : v >= good ? 'great' : v >= ok ? 'ok' : 'low');

  return (
    <Modal onClose={onClose} className="detail" label={item.title}>
      {item.backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${item.backdrop})` }} />}
      <div className="detail-top">
        <Poster item={item} className="detail-poster" />
        <div className="detail-head">
          <div className="eyebrow">{isTv ? (item.kind === 'tvMiniSeries' ? 'Miniseries' : 'TV series') : 'Movie'}{item.rated ? ` · ${item.rated}` : ''}</div>
          <h1>{item.title}</h1>
          <div className="pick-meta">
            {[yearSpan(item), isTv ? (item.tv ? `${item.tv.seasons} season${item.tv.seasons > 1 ? 's' : ''} · ${item.tv.eps} episodes` : null) : fmtRuntime(item.runtime), item.genres.join(', ')].filter(Boolean).join('  ·  ')}
          </div>
          {item.directors && <div className="muted small">{isTv ? 'Written by' : 'Directed by'} {item.directors}</div>}

          <div className="detail-scoreline">
            <ScoreRing value={main} size={68} />
            <div>
              <div className="score-name">{isTv ? 'Worth-It score' : 'Reel score'} <span className={`tone-text tone-${scoreTone(main)}`}>{main == null ? '' : main >= 82 ? 'Excellent' : main >= 72 ? 'Good bet' : main >= 60 ? 'Mixed' : 'Skip'}</span></div>
              <div className="muted small">{isTv ? 'Ratings adjusted for the ending, consistency and whether viewers kept watching.' : 'Audience scores only (RT audience + IMDb), adjusted for how many people voted.'}</div>
              {item.match != null && <div className={`match-line ${item.match >= 75 ? 'hot' : ''}`}><b>{item.match}% match</b>{item.reasons?.length ? ` — ${item.reasons.map((r) => r.text).join(' · ')}` : ''}</div>}
            </div>
          </div>

          <div className="detail-actions">
            <button className={`btn primary ${item.watchlisted ? 'done' : ''}`} onClick={() => actions.watchlist(item, !item.watchlisted)}>{item.watchlisted ? '✓ On watchlist' : '+ Watchlist'}</button>
            {item.trailer && <a className="btn" href={`https://www.youtube.com/watch?v=${item.trailer}`} target="_blank" rel="noreferrer">▶ Trailer</a>}
            <RateButtons item={item} />
          </div>
        </div>
      </div>

      <div className="detail-body">
        <div className="source-tiles">
          <SourceTile label="RT audience" value={item.rtAud != null ? `${item.rtAud}%` : pending && src.rt ? '…' : null} sub={item.rtAudCount || (!src.rt ? 'off' : item.rtChecked && item.rtAud == null ? 'no score' : null)} href={item.rtUrl} tone={tone(item.rtAud, 85, 60)} />
          <SourceTile label="RT critics" value={item.rtCrit != null ? `${item.rtCrit}%` : pending && src.rt ? '…' : null} href={item.rtUrl} tone={tone(item.rtCrit, 85, 60)} />
          <SourceTile label="IMDb" value={item.imdb?.toFixed(1)} sub={`${item.votes?.toLocaleString()} votes`} href={item.imdbUrl} tone={tone(item.imdb, 7.8, 6.5)} />
          {isTv && item.tv && <SourceTile label="Episode avg" value={item.tv.epAvg.toFixed(1)} sub={`${item.tv.eps} eps`} tone={tone(item.tv.epAvg, 8.2, 7.2)} />}
          {item.metacritic != null && <SourceTile label="Metacritic" value={item.metacritic} tone={tone(item.metacritic, 75, 55)} />}
          {item.tmdb != null && <SourceTile label="TMDB" value={item.tmdb.toFixed(1)} tone={tone(item.tmdb, 7.6, 6.5)} />}
        </div>
        {!src.rt && <p className="hint">Rotten Tomatoes scores are off. <button className="link" onClick={openSettings}>Turn them on in Settings</button></p>}

        {item.plot ? <p className="plot">{item.plot}</p> : pending ? <p className="plot muted">Fetching details…</p> : null}
        {item.cast?.length > 0 && <p className="muted small"><b>Cast</b> {item.cast.slice(0, 6).join(', ')}</p>}
        {item.awards && <p className="muted small"><b>Awards</b> {item.awards}</p>}

        <WhereToWatch item={item} pending={pending} />
        <ContentGuide item={item} pending={!full} />

        {isTv && item.verdicts?.length > 0 && (
          <section className="tv-verdicts">
            <h3>Should you start it?</h3>
            <ul>{item.verdicts.map((v) => <li key={v.label} className={v.tone}><b>{v.label}</b><span>{v.detail}</span></li>)}</ul>
          </section>
        )}
        {isTv && item.episodes?.length > 0 && <EpisodeGrid item={item} />}

        {item.similar?.length > 0 && (
          <section className="similar">
            <h3>{item.similarLabel}</h3>
            <SimilarRow items={item.similar} />
          </section>
        )}

        <div className="detail-foot">
          <a href={item.imdbUrl} target="_blank" rel="noreferrer">IMDb ↗</a>
          {item.rtUrl && <a href={item.rtUrl} target="_blank" rel="noreferrer">Rotten Tomatoes ↗</a>}
          {item.wiki && <a href={item.wiki} target="_blank" rel="noreferrer">Wikipedia ↗</a>}
          <button className="link" onClick={() => { actions.dismiss(item, true); onClose(); }}>Not interested — hide</button>
        </div>
      </div>
    </Modal>
  );
}

function WhereToWatch({ item, pending }) {
  const { status, openSettings } = useApp();
  const w = item.watch;
  const logos = Object.fromEntries([...(item.providers?.stream || []), ...(item.providers?.rent || [])].map((p) => [p.name, p.logo]));
  const list = (names) => names.map((n) => <span className="prov" key={n}>{logos[n] && <img src={logos[n]} alt="" />}{n}</span>);
  if (!w) return pending ? null : <section className="watch"><h3>Where to watch</h3><p className="muted small">{status.sources.rt || status.sources.tmdb ? 'No availability info found for this title.' : <>Turn on a score source in <button className="link" onClick={openSettings}>Settings</button> to see streaming availability.</>}</p></section>;
  const nothing = !w.stream.length && !w.rent.length;
  return (
    <section className="watch">
      <h3>Where to watch <small className="muted">{w.complete ? `${status.settings.region || 'US'} · data from JustWatch via TMDB` : 'US'}</small></h3>
      {w.stream.length > 0 && <div className="prov-row"><span className="prov-kind">Stream</span>{list(w.stream)}</div>}
      {w.rent.length > 0 && <div className="prov-row"><span className="prov-kind">Rent / buy</span>{list(w.rent)}</div>}
      {w.showtimes && <p className="muted small">Rotten Tomatoes lists showtimes for this title, which can mean a current release or just a limited re-release. {item.rtUrl && <a href={item.rtUrl} target="_blank" rel="noreferrer">Check showtimes ↗</a>}</p>}
      {nothing && <p className="muted small">{w.complete ? 'Not on any streaming service in your region right now.' : 'No services listed.'}</p>}
      {!w.complete && <p className="muted small">This list comes from Rotten Tomatoes and only covers its partner services, so it can miss some. <button className="link" onClick={openSettings}>Connect TMDB</button> for complete, per-country availability.</p>}
      {w.link && <a className="link small" href={w.link} target="_blank" rel="noreferrer">All options ↗</a>}
    </section>
  );
}

function ContentGuide({ item, pending }) {
  const { status } = useApp();
  const on = status.sources.csm, va = item.va?.show ? item.va : null;
  if (!on && !va) return null;
  const c = item.content;
  const flagged = Object.fromEntries((item.flags || []).map((f) => [f.key, f]));
  const over = (item.flags || []).some((f) => f.over);
  return (
    <section className="content-guide">
      <h3>Content {c?.age != null && <small className="muted">Common Sense Media says age {c.age}+</small>}</h3>
      {on && c && (
        <div className="content-grid">
          {CONTENT_CATS.map((k) => {
            const f = flagged[k.key];
            return (
              <div key={k.key} className={`content-cat ${f ? (f.over ? 'over' : 'flagged') : ''}`}>
                <span className="cc-name">{k.label}</span>
                <Dots level={c[k.key] ?? 0} />
                <span className="cc-level">{LEVELS[c[k.key] ?? 0]}{f ? (f.over ? ' · over your limit' : ' · flagged') : ''}</span>
              </div>
            );
          })}
        </div>
      )}
      {on && over && <p className="muted small">{item.rescued ? 'Over your limit, but kept because VidAngel can filter it.' : 'Over a limit you set, so this is left out of For you, tonight’s pick and Discover.'}</p>}
      {on && c && <a className="link small" href={c.url} target="_blank" rel="noreferrer">What’s in it, in detail (Common Sense Media) ↗</a>}
      {on && !c && <p className="muted small">{pending || !item.contentChecked ? 'Looking up content levels…' : 'Common Sense Media has no review for this title.'}</p>}
      {va && (
        <div className="va-box">
          {va.available ? (
            <>
              <p><b>On VidAngel</b>{va.via.length ? ` — plays through ${va.via.join(', ')}` : ''}. <a href={va.url} target="_blank" rel="noreferrer">Open in VidAngel ↗</a></p>
              {!va.via.length && va.viaKnown && <p className="muted small">VidAngel has filters for it, but it isn’t included with Netflix, Prime Video, Apple TV+ or Paramount+ right now. Check VidAngel for how to watch it.</p>}
              {va.cats?.length > 0 && <div className="va-cats"><span className="muted small">Moments it can skip or mute:</span>{va.cats.map((x) => <span className="prov" key={x.name}>{x.name} <b>{x.count}</b></span>)}</div>}
              {item.type === 'tv' && <p className="muted small">Shows are tagged episode by episode, so counts are on VidAngel.</p>}
            </>
          ) : <p className="muted">{pending && !item.vaChecked ? 'Checking VidAngel…' : 'Not in VidAngel’s catalogue.'}</p>}
        </div>
      )}
      {!va && status.settings.vidangel && <p className="muted small">{item.vaBlocked ? 'Couldn’t download VidAngel’s title list. Reel will try again within the hour.' : pending ? 'Checking VidAngel…' : 'Couldn’t check VidAngel for this title.'}</p>}
    </section>
  );
}

function SimilarRow({ items }) {
  const list = useEnriched(items, true);
  return <div className="row-scroll">{list.map((s) => <TitleCard key={s.id} item={s} />)}</div>;
}

function EpisodeGrid({ item }) {
  const [hover, setHover] = useState(null);
  const seasons = new Map();
  for (const e of item.episodes) { if (!seasons.has(e.season)) seasons.set(e.season, []); seasons.get(e.season).push(e); }
  const means = Object.fromEntries((item.seasonMeans || []).map((s) => [s.s, s.mean]));
  const list = [...seasons.entries()];
  const long = list.some(([, eps]) => eps.length > 26);
  return (
    <section className="epgrid">
      <div className="epgrid-head">
        <h3>Every episode, rated</h3>
        <div className="ep-readout">{hover ? <><b>S{hover.season}·E{hover.episode}</b> {hover.title} — <b>{hover.rating.toFixed(1)}</b> <span className="muted">({fmtVotes(hover.votes)} votes)</span></> : <span className="muted">Hover an episode · greener is better</span>}</div>
      </div>
      <div className={`ep-rows ${long ? 'long' : ''}`}>
        {list.map(([s, eps]) => (
          <div className="ep-row" key={s}>
            <span className={`ep-season ${item.tv?.goodThrough != null && s > item.tv.goodThrough ? 'past' : ''}`}>S{s}</span>
            <div className="ep-cells">
              {eps.map((e) => (
                <span key={`${e.season}-${e.episode}`} className="ep" style={{ background: epColor(e.rating) }} tabIndex={0}
                  onMouseEnter={() => setHover(e)} onFocus={() => setHover(e)} onMouseLeave={() => setHover(null)} aria-label={`Season ${e.season} episode ${e.episode}: ${e.rating}`}>
                  {!long && e.rating.toFixed(1)}
                </span>
              ))}
            </div>
            <span className="ep-mean" title="Season average">{means[s]?.toFixed(1) ?? ''}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
