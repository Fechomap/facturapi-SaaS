# Auditoría Crítica: Duplicidad de `tenant.service.ts`

**Fecha:** 2025-11-07
**Autor:** PM / Auditor de Procesos
**Estado:** ANÁLISIS COMPLETADO - ACCIÓN REQUERIDA
**Criticidad:** **EXTREMA**

---

## 1. Resumen Ejecutivo del Problema

Durante la fase final de la auditoría de la funcionalidad "Datos Completos en Facturas", se descubrió un problema arquitectónico de máxima criticidad: la existencia de **dos versiones del archivo `tenant.service.ts`** dentro de la misma base de código (`v2-typescript`).

1.  **Versión Correcta y Principal:** `src/core/tenant/tenant.service.ts`
2.  **Versión Fantasma y Obsoleta:** `src/services/tenant.service.ts`

Esta duplicidad introduce un riesgo severo de **corrupción de datos silenciosa** y comportamiento inconsistente en la aplicación, ya que diferentes partes del código estaban utilizando distintas implementaciones de la misma lógica de negocio.

---

## 2. Descubrimiento y Evidencia

Tras la detección de la duplicidad, se realizó un análisis de dependencias en toda la base de código para determinar el alcance del problema. La investigación consistió en rastrear cada importación de ambas versiones del servicio.

### Evidencia A: Uso Correcto del Servicio

La investigación confirma que la mayoría de los nuevos flujos de trabajo utilizan la versión correcta del servicio, ubicada en `@core`.

*   **Dependencia Correcta:** `import TenantService from '@core/tenant/tenant.service.js';`
*   **Archivos que la utilizan:**
    *   ✅ `src/bot/handlers/axa.handler.ts`
    *   ✅ `src/bot/handlers/chubb.handler.ts`
    *   ✅ `src/bot/handlers/club-asistencia.handler.ts`
    *   ✅ `src/bot/handlers/qualitas.handler.ts`
    *   ✅ `src/bot/handlers/escotel.handler.ts`

### Evidencia B: Uso Incorrecto del Servicio (Causa del Problema)

La investigación localizó un único pero crítico punto de falla.

*   **Dependencia Incorrecta:** `import TenantService from './tenant.service.js';`
*   **Archivo que la utiliza:**
    *   ❌ `src/services/invoice.service.ts`
*   **Análisis:** Al estar ubicado en el mismo directorio (`src/services`), la importación relativa en `invoice.service.ts` resolvía a la versión "fantasma" (`src/services/tenant.service.ts`), no a la versión principal en `@core`.

---

## 3. Análisis de Impacto y Riesgo

El impacto de esta duplicidad es severo y multifacético:

*   **Corrupción de Datos Silenciosa (Impacto CRÍTICO):**
    *   El `invoice.service.ts`, al usar la versión obsoleta del `TenantService`, habría provocado que todas las facturas generadas a través de su flujo **no guardaran los datos financieros completos**.
    *   El bug no habría generado un error visible (crash), sino que habría insertado `NULL` en los nuevos campos de la base de datos, corrompiendo los registros de forma silenciosa y muy difícil de rastrear.

*   **Inconsistencia de Lógica de Negocio:**
    *   Las dos versiones del servicio habían divergido. La versión de `@core` contenía la lógica de `registerInvoicesBatch`, mientras que la de `@services` contenía métodos de gestión de suscripciones.
    *   Esto significa que, dependiendo de qué servicio se importara, un desarrollador tendría acceso a un conjunto de funcionalidades completamente diferente, llevando a errores y confusión.

*   **Deuda Técnica y Mantenibilidad Nula:**
    *   Este es un caso clásico de deuda técnica de alto impacto. Cualquier futuro bug arreglado en un solo archivo reaparecería en otras partes de la aplicación.
    *   Hace que el mantenimiento sea una pesadilla, ya que la "única fuente de verdad" no existe.

---

## 4. Plan de Solución Definitivo

Para erradicar este problema de raíz y asegurar la estabilidad y mantenibilidad del código, se debe ejecutar el siguiente plan de 3 pasos:

### Paso 1: Consolidar Funcionalidad

Antes de eliminar el archivo obsoleto, debemos asegurarnos de no perder ninguna funcionalidad útil.

*   **Acción:** Mover los métodos que solo existen en `src/services/tenant.service.ts` (ej: `extendSubscription`, `suspendSubscription`, `changePlan`) al archivo principal en `src/core/tenant/tenant.service.ts`.

### Paso 2: Refactorizar la Importación Incorrecta

Corregir el único punto de llamada que utiliza la versión incorrecta.

*   **Archivo a modificar:** `src/services/invoice.service.ts`
*   **Acción:** Cambiar la línea de importación:
    *   **Línea actual:** `import TenantService from './tenant.service.js';`
    *   **Línea corregida:** `import TenantService from '@core/tenant/tenant.service.js';`

### Paso 3: Eliminar el Archivo Obsoleto (Paso CRÍTICO)

Este es el paso final y más importante para garantizar que el problema no vuelva a ocurrir.

*   **Acción:** Borrar permanentemente el archivo `src/services/tenant.service.ts`.

---

## 5. Conclusión del PM

El descubrimiento de esta duplicidad ha sido un hallazgo fundamental que ha prevenido una futura y muy probable corrupción de datos.

La ejecución del plan de 3 pasos propuesto no es opcional; es **mandatoria** para asegurar la salud de la base de código. La consolidación en una única versión del servicio en `@core` y la eliminación del duplicado son las únicas acciones que garantizan la consistencia, mantenibilidad y correctitud del sistema a largo plazo.
