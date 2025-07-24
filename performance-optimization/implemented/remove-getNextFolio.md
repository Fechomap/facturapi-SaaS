# Optimización: Eliminación de getNextFolio()

## Problema

La función `getNextFolio()` realizaba una operación INSERT ON CONFLICT contra una BD remota en AWS RDS, causando 2-5 segundos de latencia por la distancia de red.

## Análisis

- FacturAPI ya asigna folios automáticamente
- No necesitamos pre-calcular folios
- La operación era completamente innecesaria

## Solución Implementada

### Archivo: `/services/invoice.service.js`

**Antes:**

```javascript
// Obtener el próximo folio
await TenantService.getNextFolio(tenantId, 'A');
```

**Después:**

```javascript
// OPTIMIZACIÓN: Comentar la obtención del folio - FacturAPI lo asigna automáticamente
// El folio se obtiene de FacturAPI después de crear la factura
// Esto elimina 2-3 segundos de latencia con BD remota
/*
await TenantService.getNextFolio(tenantId, 'A');
*/
```

## Intentos de Optimización del Query

Antes de eliminar la función, intentamos optimizar:

1. Agregar índice en `tenantId`
2. Usar `prisma.upsert()` en lugar de SQL raw
3. Ambos fallaron por la latencia de red inherente

## Resultados

- Eliminación de 2-5 segundos por factura
- Simplificación del código
- Menos carga en la BD remota
- Folios siguen siendo secuenciales (manejados por FacturAPI)

## Nota

La función `getNextFolio()` sigue existente en `tenant.service.js` por si algún otro flujo la necesita, pero ya no se usa en la generación de facturas.
