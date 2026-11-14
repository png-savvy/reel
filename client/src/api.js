async function req(path, opts) {
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
const post = (path, body) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  status: () => req('/status'),
  saveSettings: (s) => post('/settings', s),
  testKey: (kind, key) => post('/settings/test', { kind, key }),
  discover: (f, cursor = 0, signal) => req(`/discover?f=${encodeURIComponent(JSON.stringify(f))}&cursor=${cursor}`, { signal }),
  enrich: (ids) => post('/enrich', { ids }),
  home: (type) => req(`/home?type=${type}`),
  pick: (type, skip = 0) => req(`/pick?type=${type}&skip=${skip}`),
  queue: (type, genre, decade) => req(`/queue?type=${type}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}${decade ? `&decade=${decade}` : ''}`),
  search: (q, type) => req(`/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),
  library: () => req('/library'),
  taste: (type) => req(`/taste?type=${type}`),
  genres: (type) => req(`/genres?type=${type}`),
  title: (id, fast) => req(`/title/${id}${fast ? '?fast=1' : ''}`),
  rate: (id, value) => post('/rate', { id, value }),
  watchlist: (id, on) => post('/watchlist', { id, on }),
  dismiss: (id, on) => post('/dismiss', { id, on }),
  importCsv: (csv) => post('/import', { csv }),
};
