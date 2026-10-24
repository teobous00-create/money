# Money

Personal budgeting app (installable PWA) with accounts, categories/subcategories, transfers, recurring entries,
and a joint account shared view-only with a partner. Data lives in Supabase (Postgres + row level security);
the app keeps an offline copy and syncs when online.

- `src/` — React + TypeScript app (Vite, Motion for animations)
- `supabase/schema.sql` — database schema; paste into Supabase SQL Editor and run (safe to re-run)
- `supabase/test-schema.mjs` — tests the schema and permissions in PGlite (`npm run test:db`)
- `src/config.ts` — Supabase URL + publishable key

Every push to `main` builds and deploys to GitHub Pages; installed copies update themselves.

Local dev: `npm install && npm run dev` (set `VITE_LOCAL=1` for local-only mode without Supabase).
