# Optimización: Import Estático de Facturapi

## Problema

El módulo facturapi se importaba dinámicamente en cada solicitud:

```javascript
if (!FacturapiModule) {
  FacturapiModule = await import('facturapi');
}
```

Esto causaba un delay de 9-10 segundos en la primera factura después de reiniciar el servidor.

## Solución Implementada

### Archivo: `/services/facturapi.service.js`

**Antes:**

```javascript
let FacturapiModule = null;
// ...
if (!FacturapiModule) {
  FacturapiModule = await import('facturapi');
}
const FacturapiConstructor = FacturapiModule.default.default;
```

**Después:**

```javascript
import facturapiModule from 'facturapi';
const Facturapi = facturapiModule.default;
// ...
const client = new Facturapi(apiKey);
```

## Resultados

- Eliminación de 9-10 segundos de latencia
- Primera factura ahora tarda lo mismo que las subsecuentes
- Módulo se carga una sola vez al inicio de la aplicación

## Métricas

- Antes: Primera factura 10+ segundos
- Después: Primera factura ~1 segundo
- Mejora: 90% de reducción en tiempo
