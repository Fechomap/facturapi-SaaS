# Propuesta: Migración a Sesiones Redis-Only

## Resumen Ejecutivo

### Problema Actual
- Las operaciones `saveUserState` tardan entre 2-20 segundos debido a la latencia con la base de datos remota en AWS RDS
- Esto causa timeouts y reintentos en la cola de procesamiento
- Afecta la experiencia del usuario con delays innecesarios

### Solución Propuesta
Migrar el sistema de sesiones para usar **Redis como almacenamiento primario**, con sincronización periódica asíncrona a PostgreSQL como respaldo.

### Beneficios Esperados
- **Rendimiento**: Reducción de 2-20s a <10ms (2000x más rápido)
- **Confiabilidad**: Eliminación de timeouts y reintentos
- **Escalabilidad**: Redis puede manejar millones de operaciones por segundo
- **UX Mejorada**: Respuestas instantáneas para los usuarios

## Análisis Técnico Detallado

### Arquitectura Actual

```
Usuario → Bot → SessionService → PostgreSQL (AWS RDS)
                       ↓
                    Redis (cache)
```

**Problemas identificados:**
1. Cada `saveUserState` hace un upsert a PostgreSQL remoto
2. Latencia de red: ~100-200ms por operación
3. Bloqueos de base de datos en operaciones concurrentes
4. Cola de reintentos saturada con operaciones fallidas

### Arquitectura Propuesta

```
Usuario → Bot → RedisOnlySessionService → Redis (primario)
                                             ↓
                                    Sync Periódico → PostgreSQL (respaldo)
```

**Mejoras:**
1. Escrituras instantáneas a Redis local (<10ms)
2. Sincronización batch asíncrona cada 60 segundos
3. Sin bloqueos ni timeouts
4. PostgreSQL solo como respaldo/histórico

## Implementación

### Fase 1: Desarrollo del Servicio Redis-Only

**Archivos creados:**
- `/core/auth/redis-only-session.service.js` - Servicio principal
- `/config/session-config.js` - Configuración y feature flags

**Características principales:**
1. **Operaciones Redis puras** para `getUserState` y `saveUserState`
2. **Cache de tenant info** (cambia poco frecuentemente)
3. **Sincronización periódica** configurable
4. **Métrica y logging** para monitoreo

### Fase 2: Migración Gradual

**Variables de entorno:**
```bash
# Activar modo Redis-only
USE_REDIS_ONLY_SESSIONS=true

# Intervalo de sincronización (ms)
SESSION_SYNC_INTERVAL=60000

# TTL de sesiones en Redis (segundos)
SESSION_TTL=3600

# TTL de cache de tenant (segundos)
TENANT_CACHE_TTL=3600

# Habilitar métricas detalladas
SESSION_METRICS_ENABLED=true
```

**Plan de migración:**
1. **Semana 1**: Pruebas en desarrollo con sync cada 30s
2. **Semana 2**: Despliegue en staging con monitoreo
3. **Semana 3**: Rollout gradual en producción (10% → 50% → 100%)
4. **Semana 4**: Optimización basada en métricas

### Fase 3: Modificaciones Necesarias

**1. Actualizar imports en archivos principales:**
```javascript
// Antes
import SessionService from './core/auth/session.service.js';

// Después
import { getSessionService } from './config/session-config.js';
const SessionService = await getSessionService();
```

**2. Inicializar sincronización en `app.js`:**
```javascript
// En el arranque de la aplicación
if (process.env.USE_REDIS_ONLY_SESSIONS === 'true') {
  const RedisOnlySessionService = await import('./core/auth/redis-only-session.service.js');
  RedisOnlySessionService.default.startPeriodicSync();
}
```

**3. Graceful shutdown:**
```javascript
process.on('SIGTERM', async () => {
  if (process.env.USE_REDIS_ONLY_SESSIONS === 'true') {
    await RedisOnlySessionService.syncToDB();
  }
  process.exit(0);
});
```

## Consideraciones de Seguridad y Respaldo

### Redis
1. **Persistencia**: Configurar Redis con RDB + AOF
2. **Replicación**: Master-slave para alta disponibilidad
3. **Backups**: Snapshots cada 6 horas
4. **Monitoreo**: Alertas por uso de memoria >80%

### PostgreSQL
1. **Datos históricos**: Mantener 30 días de sesiones
2. **Limpieza**: Job diario para purgar sesiones viejas
3. **Índices**: Optimizar queries de sincronización

### Rollback Plan
1. Feature flag `USE_REDIS_ONLY_SESSIONS=false` para reversión instantánea
2. Sincronización forzada antes de rollback
3. Logs detallados para debugging

## Métricas de Éxito

### KPIs a Monitorear
1. **Latencia p99 de saveUserState**: Objetivo <50ms (actual: 2-20s)
2. **Tasa de timeouts**: Objetivo <0.1% (actual: ~5%)
3. **Throughput**: Objetivo >1000 ops/seg
4. **Sync lag**: Objetivo <2 minutos

### Dashboard de Monitoreo
```
┌─────────────────────────────────────┐
│ Session Operations                  │
├─────────────────────────────────────┤
│ Redis Writes/sec: 523               │
│ Avg Latency: 8ms                    │
│ Sync Queue Size: 142                │
│ Last Sync: 45s ago                  │
│ Sync Duration: 234ms                │
│ Failed Syncs: 0                     │
└─────────────────────────────────────┘
```

## Estimación de Recursos

### Desarrollo
- **Tiempo estimado**: 2-3 días
- **Recursos**: 1 desarrollador senior
- **Testing**: 1 día adicional

### Infraestructura
- **Redis memoria adicional**: ~100MB para 10k usuarios activos
- **CPU impacto**: Mínimo (<5% adicional)
- **Network**: Reducción del 90% en tráfico a RDS

## Riesgos y Mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Pérdida de datos en Redis | Baja | Alto | Persistencia RDB+AOF, replicación |
| Sync falla | Media | Medio | Reintentos, alertas, sync manual |
| Memoria Redis insuficiente | Baja | Alto | Monitoreo, auto-scaling |
| Inconsistencia de datos | Baja | Medio | Validación periódica |

## Conclusión

La migración a Redis-only sessions es una mejora crítica que:
1. Elimina el principal cuello de botella de rendimiento
2. Mejora significativamente la experiencia del usuario
3. Reduce la carga en la base de datos principal
4. Prepara la aplicación para escalar

**Recomendación**: Proceder con la implementación siguiendo el plan de migración gradual.

## Próximos Pasos

1. [ ] Revisar y aprobar esta propuesta
2. [ ] Configurar Redis con persistencia en staging
3. [ ] Implementar cambios de código
4. [ ] Ejecutar pruebas de carga
5. [ ] Desplegar con feature flag desactivado
6. [ ] Activar gradualmente y monitorear
7. [ ] Documentar resultados y optimizar

---

**Autor**: Claude Assistant  
**Fecha**: 2025-07-11  
**Versión**: 1.0