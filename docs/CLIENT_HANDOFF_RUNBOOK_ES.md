# Runbook De Operacion (Cliente)

## 1. Operacion diaria
1. Abrir app desde Home Screen.
2. Revisar estado de sincronizacion (sidebar o Ajustes).
3. Login solamente: las cuentas se crean unicamente desde Supabase (no hay Sign Up en la app).
4. Solo `admin` puede usar `+`, `-` y `$` (stock/precio).
5. `staff` opera en modo solo lectura para inventario y precios.

## 2. Significado de estados de sync
- `Sincronizado`: todo enviado al backend.
- `Sincronizando`: hay eventos pendientes en proceso.
- `Sin conexion`: sin internet, eventos quedan en cola.
- `En conflicto`: evento no aplicado (ej. stock insuficiente).

## 3. Que hacer si hay pendientes
1. Verificar conexion.
2. Mantener app abierta 10-20 segundos.
3. Si persiste: ir a `Configuracion > Estado de sincronizacion` y revisar `Ultimo error`.
4. Reportar error al equipo tecnico con screenshot.

## 3.1 Diagnostico rapido (1 minuto)
1. Abrir `Configuracion > Estado de sincronizacion`.
2. Revisar en este orden:
- `Conexion`
- `Estado`
- `Eventos pendientes`
- `Ultima sync exitosa`
- `Ultimo intento`
- `Reintentos`
- `Ultimo error (usuario)`
- `Detalle tecnico (soporte)`
3. Si `Eventos pendientes > 0` por mas de 2 minutos con internet estable:
- tomar screenshot completo,
- reportar a soporte con hora exacta del incidente.
4. Si `Estado = En conflicto`:
- revisar inventario del SKU afectado,
- aplicar ajuste manual con nota y volver a sincronizar.

## 4. Buenas practicas
- No borrar cache local salvo instruccion tecnica.
- Evitar usar la misma cuenta en demasiados dispositivos al mismo tiempo durante inventario critico.
- Registrar ajustes siempre con nota.
- Si una venta fue accidental, usar `Anular venta` desde `Ventas` (solo admin).

## 4.1 Anulacion de venta (solo admin)
1. Ir a `Ventas` y ubicar la transaccion.
2. Click en `Anular venta`.
3. Confirmar accion y agregar motivo opcional.
4. Verificar que:
- la venta desaparece del historial,
- el stock del producto se restaura.

## 4.2 Control de permisos
- `admin`: puede modificar inventario (`+`, `-`) y precio (`$`), y anular ventas.
- `staff`: no puede modificar inventario ni precios, ni anular ventas.

## 5. Escalacion
Contactar soporte tecnico si:
- Pending Events no baja durante varios minutos con internet estable.
- Aparecen conflictos repetidos sin causa.
- Falta data de productos o imagenes.

## 6. Regla de fotos SKU (operacion interna)
- Cada SKU debe tener una foto con nombre exacto SKU (ej: `PANT-1234-M.png`).
- No se permite compartir un mismo archivo entre SKUs; si dos tallas usan la misma foto visual, duplicar archivo con ambos nombres SKU.
- Si falta una foto SKU o hay multiples archivos para un SKU, se bloquea el handoff/import hasta corregirlo.
