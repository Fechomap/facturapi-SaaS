# Para Trabajar Mañana - Redis Sessions

## Ubicación
`/performance-optimization/proposals/redis-sessions/`

## Objetivo
Implementar sesiones Redis-only para eliminar los delays de 2-20 segundos en `saveUserState`.

## Archivos principales
1. `PROPUESTA_REDIS_SESSIONS.md` - Plan completo de implementación
2. `redis-only-session.service.js` - Código del nuevo servicio
3. `session-config.js` - Configuración con feature flags

## Pasos inmediatos
1. Revisar la propuesta
2. Activar con `USE_REDIS_ONLY_SESSIONS=true`
3. Probar en desarrollo
4. Medir mejoras

## Beneficio esperado
- De 2-20 segundos → <10ms
- Sin timeouts ni reintentos
- Mejor experiencia de usuario

---
Rama actual: `feature/performance-optimizations`