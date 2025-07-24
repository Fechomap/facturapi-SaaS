# Propuesta: Redis-Only Sessions

## Para trabajar mañana

Esta carpeta contiene la propuesta completa para migrar el sistema de sesiones a Redis como almacenamiento primario.

### Archivos incluidos:

1. **PROPUESTA_REDIS_SESSIONS.md** - Documento completo con análisis y plan de implementación
2. **redis-only-session.service.js** - Implementación del nuevo servicio
3. **session-config.js** - Configuración y feature flags

### Próximos pasos:

1. Revisar la propuesta con el equipo
2. Configurar Redis con persistencia
3. Implementar los cambios en los archivos principales
4. Testing en desarrollo
5. Rollout gradual con feature flags

### Beneficio esperado:

- Reducir saveUserState de 2-20s a <10ms
- Eliminar timeouts y reintentos
- Mejorar experiencia del usuario
