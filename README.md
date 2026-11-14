# Reel

Find movies and TV shows worth watching. Set a quality bar once (e.g. "85%+ Rotten Tomatoes audience
score, nothing I've seen"), rate what you've watched with one tap, and Reel only shows what clears the bar,
ranked by how well it fits your taste.

## Run it

```bash
npm install
npm run catalog   # one-time: downloads IMDb's open datasets (~700 MB) and builds data/catalog.db (~3 min)
npm run build
npm start         # http://localhost:4317
```

For development with hot reload: `npm run dev` (UI on http://localhost:5317, API on 4317).
Refresh ratings and new releases any time with `npm run catalog -- --refresh`.

## Where the data comes from

| Source | What it adds | Setup |
| --- | --- | --- |
| IMDb open datasets | Catalog, ratings, vote counts, directors, per-episode ratings | Built in (local SQLite) |
| Rotten Tomatoes | Audience score, critics score, posters, plots | Toggle in Settings. No public API exists, so Reel reads each title's public page (rate-limited, cached 14 days). Personal use only. |
| TMDB | Posters, trailers, where to stream, cast, "fans also liked" links | Free API key in Settings |
| OMDb | Metacritic, age rating, awards | Free API key in Settings |

## How scoring works

- **Reel score (movies)** – every available source blended into 0–100. IMDb ratings are first shrunk toward
  the catalog average by vote count, so a 9.0 from 600 people doesn't outrank an 8.6 from 600,000.
- **Worth-It score (TV)** – show-level scores are inflated because people who quit rarely rate. Reel looks at
  every episode instead: the episode average, how the final season compares with the rest ("sticks the
  landing" vs "fumbles the ending"), consistency, and retention (how many people were still rating by the
  last season). See `server/tvstats.mjs`.
- **Match %** – learned from your ratings: genre and era affinities, directors/writers you rate highly, and
  TMDB "fans also liked" links when a key is connected. See `server/engine.mjs`.

## Layout

- `server/build-catalog.mjs` – builds the catalog database
- `server/providers.mjs` – Rotten Tomatoes / Wikidata / TMDB / OMDb lookups and caching
- `server/engine.mjs` – taste profile, scoring, candidate ranking
- `server/index.mjs` – API (and serves the built UI)
- `client/src` – React UI
- `data/` – catalog, your ratings and cached scores (git-ignored)

## Before publishing

IMDb's datasets are licensed for personal, non-commercial use and Rotten Tomatoes has no public API, so a
public or paid version needs licensed data (TMDB and OMDb both offer commercial terms), plus user accounts —
ratings currently live in a single local `data/user.db`.
