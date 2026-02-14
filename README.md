# AMEN Inventory App

AMEN is a React + Vite + Supabase app with offline-first sync (Dexie) and PWA support.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

3. Run dev server:

```bash
npm run dev
```

## Supabase setup (production-safe)

Run this SQL in Supabase SQL Editor:

- `supabase/migrations/20260209_000001_init_stockflow.sql`
- `supabase/migrations/20260213_000002_inventory_event_idempotency.sql`

Why this script is production-safe:
- It uses `create ... if not exists` where possible.
- It avoids `drop policy` / `drop trigger`.
- It uses guarded `do $$ ... $$;` blocks for policies/triggers.

Note:
- Supabase can still show a warning dialog before execution. That is a generic safety check.

## Build checks

```bash
npm run lint
npm run build
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project in Vercel.
3. In Vercel project settings, add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Deploy.

Important:
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend env vars.
- Use only the publishable/anon key on the client.

## One-time catalog import (client handoff)

This repo includes a strict fail-fast import flow for launch/fix operations.

Required env vars for scripts:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Upload images to Supabase Storage and generate manifest:

```bash
npm run upload:images -- --dir ./client-assets/photos-final --bucket product-images --output images-manifest.json
```

Dry-run catalog import:

```bash
npm run import:catalog -- --file ./client-assets/catalog-final.csv --mode dry-run --images-manifest ./images-manifest.json
```

Apply catalog import:

```bash
npm run import:catalog -- --file ./client-assets/catalog-final.csv --mode apply --images-manifest ./images-manifest.json
```

Detailed docs:
- `docs/CLIENT_HANDOFF_RUNBOOK_ES.md`
- `docs/SUPPORT_WEEK1_CHECKLIST_ES.md`
- `docs/HANDOFF_CLOSEOUT_CHECKLIST_ES.md`

Check roles for handoff (must have at least one admin):

```bash
npm run roles:check
```

## PWA install

Use static brand icons in `public/icons/` (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`).

After deploy over HTTPS, users can install the app from browser prompt/menu:
- Desktop: Install icon in URL bar.
- Mobile: "Add to Home Screen".
