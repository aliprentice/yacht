# YachtingSignals

Source for **yachtingsignals.com** — the AI-visibility tracker for superyacht suppliers. It asks ChatGPT, Gemini, Perplexity and Claude the top buyer questions in each category, records which brands they name and which sites they cite, and publishes the category leagues and reports.

Runs as a single Cloudflare Worker (`ai-tracker`) with a D1 database.

## Files

| File | What it is |
|---|---|
| `src/worker.js` | The whole site and engine: public pages, admin, the AI query queue, brand extraction, scoring |
| `wrangler.toml` | Worker config: domains, cron triggers, D1 binding, model settings |
| `schema.sql` | D1 database structure (tables and indexes, no data) |

## How it runs

- **Every minute** the cron calls `tick()` and processes up to 5 queued jobs (one question to one AI engine).
- **03:00 UTC on the 1st of each month** it starts a new run for every active category.
- Results go into D1: `runs → jobs → answers → mentions / citations`.

## Deploy

```bash
npm i -g wrangler
wrangler login
wrangler deploy
```

API keys are Worker secrets and are never committed. See the bottom of `wrangler.toml` for the list.

## Note

This repo was created on 23 Nov 2026 from the code **as deployed** on Cloudflare. From now on, edit here and deploy from here so GitHub stays the source of truth.
