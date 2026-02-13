# Runbook De Operacion (Cliente)

## 1. Operacion diaria
1. Abrir app desde Home Screen.
2. Revisar estado de sincronizacion (sidebar o Ajustes).
3. Registrar ventas con `-1`.
4. Registrar reposicion con `+1`.
5. Usar `Ajustar stock` para cambios manuales con nota.

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

## 4. Buenas practicas
- No borrar cache local salvo instruccion tecnica.
- Evitar usar la misma cuenta en demasiados dispositivos al mismo tiempo durante inventario critico.
- Registrar ajustes siempre con nota.

## 5. Escalacion
Contactar soporte tecnico si:
- Pending Events no baja durante varios minutos con internet estable.
- Aparecen conflictos repetidos sin causa.
- Falta data de productos o imagenes.
