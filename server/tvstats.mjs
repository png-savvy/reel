// Episode-level analytics for TV series. Show-level audience scores are often inflated
// (fans rate, quitters don't), so we look at what the people who kept watching said,
// episode by episode, and how many of them were still around at the end.

export const bayes = (rating, votes, mean, m) => (votes / (votes + m)) * rating + (m / (votes + m)) * mean;

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * @param eps  [{season, episode, rating, votes}] ordered by season, episode
 * @param show {rating, bayes, ended}
 */
export function computeTvStats(eps, show) {
  const rated = eps.filter((e) => e.rating != null && e.votes >= 5 && e.season != null && e.season > 0);
  if (rated.length < 3) return null;

  const bySeason = new Map();
  for (const e of rated) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, []);
    bySeason.get(e.season).push(e);
  }
  const seasonNums = [...bySeason.keys()].sort((a, b) => a - b);
  const seasonMeans = seasonNums.map((s) => ({ s, mean: r2(avg(bySeason.get(s).map((e) => e.rating))), n: bySeason.get(s).length }));

  const all = rated.map((e) => e.rating);
  const epAvg = avg(all);
  const sd = Math.sqrt(avg(all.map((x) => (x - epAvg) ** 2)));

  // Landing: how the final stretch compares with everything before it.
  let landing = 0;
  if (seasonNums.length >= 2) {
    const last = seasonMeans[seasonMeans.length - 1];
    const before = rated.filter((e) => e.season !== last.s).map((e) => e.rating);
    landing = last.mean - avg(before);
  } else if (rated.length >= 6) {
    const tail = Math.max(2, Math.round(rated.length / 4));
    landing = avg(all.slice(-tail)) - avg(all.slice(0, -tail));
  }

  // Retention: are people still rating (i.e. watching) at the end? Finale/premiere spikes are
  // excluded by using medians.
  let retention = null;
  if (seasonNums.length >= 2) {
    const first = median(bySeason.get(seasonNums[0]).map((e) => e.votes));
    const lastV = median(bySeason.get(seasonNums[seasonNums.length - 1]).map((e) => e.votes));
    if (first >= 20) retention = lastV / first;
  }

  let peak = seasonMeans[0];
  for (const sm of seasonMeans) if (sm.mean > peak.mean) peak = sm;

  // "Good through": last season before quality falls clearly below the show's own early standard.
  let goodThrough = seasonNums[seasonNums.length - 1];
  const bar = Math.max(peak.mean - 0.9, 0);
  for (let i = 0; i < seasonMeans.length; i++) {
    if (seasonMeans[i].mean < bar && i > 0) {
      // only call it if it never recovers
      if (seasonMeans.slice(i).every((x) => x.mean < bar + 0.15)) { goodThrough = seasonMeans[i - 1].s; break; }
    }
  }

  const hypeGap = show.rating - epAvg;

  // Worth-It score (0–100). Shrunk series rating blended with the shrunk episode average,
  // then adjusted for the ending, consistency and whether viewers stuck around.
  const epShrunk = (rated.length / (rated.length + 8)) * epAvg + (8 / (rated.length + 8)) * show.bayes;
  let s10 = 0.55 * show.bayes + 0.45 * epShrunk;
  s10 += clamp(landing, -2.5, 0.5) * 0.6;
  s10 -= Math.max(0, sd - 0.5) * 0.5;
  if (retention != null) s10 += clamp(Math.log2(retention), -2.5, 1) * 0.12;
  const worth = clamp(Math.round(s10 * 10), 0, 100);

  return {
    seasons: seasonNums.length,
    eps: rated.length,
    epAvg: r2(epAvg),
    consistency: r2(sd),
    landing: r2(landing),
    retention: retention == null ? null : r2(retention),
    hypeGap: r2(hypeGap),
    peakSeason: peak.s,
    goodThrough,
    worth,
    seasonMeans,
  };
}

/** Human verdicts for a stats row. */
export function tvVerdicts(st) {
  if (!st) return [];
  const v = [];
  const lastSeason = st.season_means?.length ? st.season_means[st.season_means.length - 1].s : st.seasons;
  if (st.landing <= -0.7) v.push({ tone: 'bad', label: 'Fumbles the ending', detail: `Final season rated ${Math.abs(st.landing).toFixed(1)} below the rest of the show.` });
  else if (st.landing <= -0.35) v.push({ tone: 'warn', label: 'Weaker ending', detail: `Final season dips ${Math.abs(st.landing).toFixed(1)} below earlier seasons.` });
  else if (st.landing >= 0.2 && st.seasons >= 2) v.push({ tone: 'good', label: st.ended ? 'Sticks the landing' : 'Getting better', detail: `Latest season rated ${st.landing.toFixed(1)} above earlier ones.` });
  else if (st.ended && st.seasons >= 2) v.push({ tone: 'good', label: 'Solid ending', detail: 'The final season holds up against the rest.' });

  if (st.consistency <= 0.35) v.push({ tone: 'good', label: 'Very consistent', detail: 'Almost no weak episodes.' });
  else if (st.consistency >= 0.8) v.push({ tone: 'warn', label: 'Uneven', detail: 'Episode quality swings a lot.' });

  if (st.retention != null) {
    if (st.retention >= 1.3) v.push({ tone: 'good', label: 'Audience kept growing', detail: `${st.retention.toFixed(1)}× as many people rated the last season as the first.` });
    else if (st.retention >= 0.75) v.push({ tone: 'good', label: 'Viewers stayed', detail: `${st.retention >= 0.97 ? 'As many' : `${Math.round(st.retention * 100)}% as many`} people rated the last season as the first.` });
    else if (st.retention <= 0.3) v.push({ tone: 'warn', label: 'Viewers dropped off', detail: `Only ${Math.round(st.retention * 100)}% as many people rated the last season as the first.` });
  }
  if (st.good_through != null && st.good_through < lastSeason) v.push({ tone: 'warn', label: `Best through season ${st.good_through}`, detail: 'Quality falls off after that and never recovers.' });
  if (st.hype_gap >= 0.6) v.push({ tone: 'warn', label: 'Score looks inflated', detail: `Show score is ${st.hype_gap.toFixed(1)} higher than its episodes average.` });
  return v;
}
