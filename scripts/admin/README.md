# Scripts de Administración

Scripts para configuración y administración del sistema SaaS.

## 📝 Scripts Disponibles

### `create-subscription-plan.js`

**Propósito**: Crear nuevos planes de suscripción en Stripe y base de datos

**Funcionalidad**:

- Crea producto en Stripe
- Configura precios y intervalos
- Registra plan en base de datos local

**Uso**:

```bash
node scripts/admin/create-subscription-plan.js
```

---

### `check-plans.js`

**Propósito**: Verificar estado y consistencia de planes de suscripción

**Funcionalidad**:

- Valida planes en Stripe vs BD local
- Verifica precios y configuraciones
- Detecta inconsistencias

**Uso**:

```bash
node scripts/admin/check-plans.js
```

---

### `update-plan-price.js`

**Propósito**: Actualizar precios de planes existentes

**Funcionalidad**:

- Modifica precios en Stripe
- Actualiza base de datos local
- Mantiene consistencia de datos

**Uso**:

```bash
node scripts/admin/update-plan-price.js
```

**⚠️ Precaución**: Cambios de precio afectan suscripciones activas

## 🛡️ Seguridad

- Estos scripts requieren variables de entorno de Stripe configuradas
- Validar cambios en ambiente de prueba primero
- Crear backups antes de modificaciones importantes

## 📋 Flujo Recomendado

1. **Crear plan**: `create-subscription-plan.js`
2. **Verificar**: `check-plans.js`
3. **Actualizar si necesario**: `update-plan-price.js`
