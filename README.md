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
- `supabase/migrations/20260214_000003_fix_apply_inventory_event_rpc_signature.sql`
- `supabase/migrations/20260214_000004_enable_realtime_inventory_tables.sql`

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
Image policy for handoff:
- `image_filename` basename must match `sku` (case-insensitive).
- Exactly one supported image file per SKU in the source folder (`.png/.jpg/.jpeg/.webp/.avif`).
- Missing or ambiguous SKU-photo mapping blocks validation/import.

Required env vars for scripts:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Canonical pre-handoff sequence:

```bash
npm run lint
npm run build
npm run catalog:review-gate
npm run catalog:reconcile-images -- --file ./client-assets/catalog-final.csv --photos ./client-assets/photos-sku --out ./client-assets/catalog-final.csv
npm run catalog:validate -- --file ./client-assets/catalog-final.csv --photos ./client-assets/photos-sku
npm run upload:images -- --dir ./client-assets/photos-sku --bucket product-images --output images-manifest.json
npm run import:catalog -- --file ./client-assets/catalog-final.csv --mode dry-run --images-manifest ./images-manifest.json
npm run roles:check
```

Notes:
- `npm run catalog:review-gate` fails if `catalog-review-pending.csv` has rows.
- If your folder path is different, replace `./client-assets/photos-sku`.

Apply final import only after all gates are clean:

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
