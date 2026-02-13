# Especificacion de Importacion (One-Time)

## Objetivo
Estandarizar la carga inicial de catalogo desde PDF/Excel hacia CSV para evitar errores en produccion.

## Flujo recomendado (PDF -> CSV revisado)
1. Extraer staging desde PDF:
```bash
npm run extract:catalog-pdf -- --pdf "C:\\ruta\\CATALOGO.pdf"
```
2. Revisar y completar `artifacts/catalog_staging.csv`:
- `cost`
- `initial_stock`
- correcciones de `name/sku/image_filename` si aplica
3. Guardar versión final en `client-assets/catalog.csv`.

## Formato de archivo
- Tipo: `.csv` (UTF-8)
- Una fila por variante (SKU/talla/color).
- Encabezados requeridos:
`sku,name,category,size,color,price,cost,initial_stock,image_filename`

## Reglas de validacion (strict fail-fast)
1. `sku` obligatorio y no duplicado dentro del archivo.
2. `name` obligatorio.
3. `price` obligatorio, numerico y >= 0.
4. `cost` opcional, si existe debe ser numerico y >= 0.
5. `initial_stock` obligatorio, entero y >= 0.
6. `image_filename` obligatorio y debe existir en `images-manifest.json` o ser URL http/https.

## Flujo de importacion a base de datos
1. Usar `client-assets/catalog.csv` final.
2. Subir imagenes:
```bash
npm run upload:images -- --dir ./client-assets/photos --bucket product-images --output images-manifest.json
```
3. Validar import:
```bash
npm run import:catalog -- --file ./client-assets/catalog.csv --mode dry-run --images-manifest ./images-manifest.json
```
4. Aplicar import:
```bash
npm run import:catalog -- --file ./client-assets/catalog.csv --mode apply --images-manifest ./images-manifest.json
```

## Resultado esperado
- Dry-run sin errores.
- Apply con reporte `import-report-<timestamp>.json`.
- Conteos reconciliados contra Excel original.
