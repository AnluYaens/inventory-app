# Checklist De Cierre Pre-Entrega

## Bloque A: Integridad Tecnica
1. `npm run lint` -> OK.
2. `npm run build` -> OK.
3. `npm run roles:check` -> al menos 1 admin.

## Bloque B: Calidad De Catalogo (QA Fuerte)
1. Confirmar que `client-assets/catalog-final.csv` es la version final.
2. Confirmar que `client-assets/photos-final/` contiene las fotos finales.
3. Re-ejecutar dry-run:
`npm run import:catalog -- --file ./client-assets/catalog-final.csv --mode dry-run --images-manifest ./images-manifest.json`.

## Bloque C: Carga Operativa
1. Subir/actualizar imagenes:
`npm run upload:images -- --dir ./client-assets/photos-final --bucket product-images --output images-manifest.json`.
2. Aplicar import final:
`npm run import:catalog -- --file ./client-assets/catalog-final.csv --mode apply --images-manifest ./images-manifest.json`.
3. Guardar el `import-report-*.json` generado en el cierre.

## Bloque D: Roles Y Seguridad Operativa
1. Confirmar al menos 1 admin cliente.
2. Validar restricciones staff/admin en UI:
- staff no puede cambiar settings.
- admin si puede.
3. Rotar `SUPABASE_SERVICE_ROLE_KEY` tras carga inicial.
4. Verificar que service role no esta en frontend env vars.

## Bloque E: QA iPhone/PWA
1. Caso online:
venta/restock se aplican sin pendientes atascados.
2. Caso offline:
crear eventos, volver online, sincroniza correctamente.
3. Caso resume/background:
cerrar/reabrir app durante sync, no entra en loop infinito.
4. Evidencia:
capturas de `Estado de sincronizacion` y resultados por escenario.

## Bloque F: Handoff
1. Entregar runbook:
`docs/CLIENT_HANDOFF_RUNBOOK_ES.md`.
2. Entregar checklist soporte semana 1:
`docs/SUPPORT_WEEK1_CHECKLIST_ES.md`.
3. Agendar training con casos reales de inventario/venta/reintentos.
