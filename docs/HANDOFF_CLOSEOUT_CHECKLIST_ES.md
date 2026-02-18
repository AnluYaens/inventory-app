# Checklist De Cierre Pre-Entrega

## Bloque A: Integridad Tecnica
1. `npm run lint` -> OK.
2. `npm run build` -> OK.
3. `npm run roles:check` -> al menos 1 admin.
4. `npm run catalog:review-gate` -> `catalog-review-pending.csv` debe quedar en 0 filas.

## Bloque B: Base De Datos (Supabase)
Ejecutar en este orden:
1. `supabase/migrations/20260209_000001_init_stockflow.sql`
2. `supabase/migrations/20260213_000002_inventory_event_idempotency.sql`
3. `supabase/migrations/20260214_000003_fix_apply_inventory_event_rpc_signature.sql`
4. `supabase/migrations/20260214_000004_enable_realtime_inventory_tables.sql`
5. `supabase/migrations/20260217_000005_admin_controls_and_void_sale.sql`
6. Si aparece `Could not find the function public.admin_void_sale_event(...) in the schema cache`, volver a ejecutar la migracion `20260217_000005` y recargar schema cache.

## Bloque C: Calidad De Catalogo (QA Fuerte)
1. Confirmar que `client-assets/catalog-final.csv` es la version final.
2. Confirmar que `client-assets/photos-sku/` contiene fotos finales con nombre exacto SKU.
3. Regla obligatoria:
- `basename(image_filename) == sku` (case-insensitive).
- 1 foto por SKU (`.png/.jpg/.jpeg/.webp/.avif`).
4. Reconciliar CSV con fotos:
`npm run catalog:reconcile-images -- --file ./client-assets/catalog-final.csv --photos ./client-assets/photos-sku --out ./client-assets/catalog-final.csv`.
5. Validar catalogo:
`npm run catalog:validate -- --file ./client-assets/catalog-final.csv --photos ./client-assets/photos-sku`.

## Bloque D: Carga Operativa
1. Subir/actualizar imagenes:
`npm run upload:images -- --dir ./client-assets/photos-sku --bucket product-images --output images-manifest.json`.
2. Dry-run import:
`npm run import:catalog -- --file ./client-assets/catalog-final.csv --mode dry-run --images-manifest ./images-manifest.json`.
3. Aplicar import final:
`npm run import:catalog -- --file ./client-assets/catalog-final.csv --mode apply --images-manifest ./images-manifest.json`.
4. Guardar `import-report-*.json` y reportes en `artifacts/`.

## Bloque E: Roles Y Seguridad Operativa
1. Confirmar al menos 1 admin cliente.
2. Validar restricciones staff/admin en UI:
- staff no puede cambiar settings.
- admin si puede.
3. Rotar `SUPABASE_SERVICE_ROLE_KEY` tras carga inicial.
4. Verificar que `SUPABASE_SERVICE_ROLE_KEY` nunca esta en frontend env vars.
5. Verificar que frontend usa solo `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Bloque F: QA iPhone/PWA
1. Caso online:
venta/restock se aplican sin pendientes atascados.
2. Caso offline:
crear eventos, volver online, sincroniza correctamente.
3. Caso resume/background:
cerrar/reabrir app durante sync, no entra en loop infinito.
4. Evidencia:
capturas de `Estado de sincronizacion` y resultados por escenario.

## Bloque G: Handoff
1. Entregar runbook:
`docs/CLIENT_HANDOFF_RUNBOOK_ES.md`.
2. Entregar checklist soporte semana 1:
`docs/SUPPORT_WEEK1_CHECKLIST_ES.md`.
3. Agendar training con casos reales de inventario/venta/reintentos.
