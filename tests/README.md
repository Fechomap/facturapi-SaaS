# Tests de Rendimiento y Optimización

Este directorio contiene tests específicos para validar las optimizaciones de rendimiento identificadas en el análisis de cuellos de botella.

## Estructura de Tests

```
tests/
├── performance/          # Tests de rendimiento
│   └── pdf-analysis.test.js
├── middleware/          # Tests de middleware
│   └── tenant-cache.test.js
├── services/           # Tests de servicios
│   ├── invoice-pagination.test.js
│   └── redis-session.test.js
├── controllers/        # Tests de controladores
│   └── invoice-download.test.js
└── README.md
```

## Ejecutar Tests

### Todos los tests
```bash
npm test
```

### Solo tests de rendimiento
```bash
npm test -- --selectProjects=performance
```

### Solo tests de integración
```bash
npm test -- --selectProjects=integration
```

### Test específico
```bash
npm test -- pdf-analysis.test.js
```

### Con coverage
```bash
npm test -- --coverage
```

## Tests de Rendimiento Clave

### 1. PDF Analysis Performance
- Valida que la lectura de PDF no bloquee el event loop
- Verifica el uso eficiente de memoria
- Prueba concurrencia sin degradación

### 2. Tenant Middleware Cache
- Verifica implementación de cache (pendiente)
- Valida tiempos de respuesta < 100ms
- Prueba períodos de gracia de suscripción

### 3. Invoice Pagination
- Compara paginación en memoria vs BD
- Mide uso de memoria con datasets grandes
- Propone implementación optimizada

### 4. Redis Session Service
- Identifica uso problemático de KEYS
- Propone implementación con SCAN
- Valida limpieza eficiente de sesiones

### 5. Invoice Download Streaming
- Detecta carga completa en memoria
- Propone implementación con streaming
- Prueba descargas concurrentes

## Métricas Objetivo

- **Event Loop**: No bloquear más de 100ms
- **Memoria**: No exceder 10MB por operación
- **Latencia**: Middleware < 100ms
- **Concurrencia**: 10+ operaciones simultáneas
- **Streaming**: < 1MB memoria para archivos grandes

## Próximos Pasos

1. Implementar las optimizaciones identificadas
2. Ejecutar tests para validar mejoras
3. Medir métricas antes/después
4. Ajustar umbrales según resultados