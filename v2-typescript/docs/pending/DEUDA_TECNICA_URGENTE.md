# Auditoría de Deuda Técnica Urgente - Proyecto v2

## Introducción

Este documento resume los hallazgos de una auditoría de código enfocada en identificar deuda técnica que representa un riesgo urgente para la funcionalidad, estabilidad y seguridad del proyecto `v2-typescript`. Los siguientes puntos requieren atención prioritaria por parte del equipo de desarrollo.

---

## Lista de Deuda Técnica Prioritaria

### 1. Deuda Crítica: Job de Reportes Automáticos Inoperable

-   **Archivo Afectado:** `v2-typescript/src/jobs/excel-report.job.ts`
-   **Riesgo:** **Funcionalidad Rota.** Una característica principal del sistema, la generación automática y programada de reportes de Excel, no está funcionando.
-   **Evidencia:**
    ```typescript
    // L8: * TODO: Migrar implementación completa desde excel-report.job.js
    // L22: // TODO: Implementar generación completa
    ```
-   **Análisis:** El archivo que debería contener la lógica para los reportes programados es actualmente un "cascarón vacío". La funcionalidad nunca se migró desde la versión anterior del proyecto. Esto significa que si se espera que el sistema envíe reportes periódicos a los usuarios, esta función está fallando silenciosamente.
-   **Acción Recomendada:** Priorizar la implementación de la lógica dentro de `excel-report.job.ts`, conectándolo con el `ExcelReportService` para generar y distribuir los reportes según la programación definida.

### 2. Deuda Grave: Ausencia de Límite de Operaciones (Rate-Limiting)

-   **Archivo Afectado:** `v2-typescript/src/services/safe-operations.service.ts`
-   **Riesgo:** **Estabilidad y Seguridad.** El sistema es vulnerable a abusos. Un usuario o un script malicioso podría llamar repetidamente a operaciones costosas (como la generación de reportes o el análisis de PDFs), causando una sobrecarga en el servidor, un aumento en los costos de API y una degradación del servicio para todos los demás usuarios.
-   **Evidencia:**
    ```typescript
    // L300: // Por simplicidad, permitir todo por ahora
    // L301: // TODO: Implementar contador con TTL en Redis
    ```
-   **Análisis:** El servicio diseñado para prevenir este tipo de abuso está explícitamente desactivado. La solución propuesta en el propio código, usar un contador temporal en Redis (rate-limiting), es la práctica estándar de la industria para mitigar este riesgo, pero no fue implementada.
-   **Acción Recomendada:** Implementar el contador con TTL (Time-To-Live) en Redis para limitar el número de veces que un usuario puede ejecutar operaciones costosas en un período de tiempo determinado (ej. no más de 5 reportes por minuto).

### 3. Deuda Grave: Falta de Limpieza de Sesiones de Usuario

-   **Archivo Afectado:** `v2-typescript/src/bot.ts`
-   **Riesgo:** **Degradación de Rendimiento y Consumo de Memoria a Largo Plazo.** Las sesiones de usuario, que almacenan el estado de la conversación, se guardan en una base de datos (probablemente Redis) pero nunca se eliminan.
-   **Evidencia:**
    ```typescript
    // L47: // TODO: Implementar script de limpieza de sesiones
    ```
-   **Análisis:** Con el tiempo, la base de datos de sesiones acumulará miles o millones de registros obsoletos. Esto incrementará el consumo de memoria del servidor y hará que las operaciones de lectura y escritura de sesiones activas sean progresivamente más lentas, afectando el rendimiento general del bot.
-   **Acción Recomendada:** Crear un script o un job programado que se ejecute periódicamente (ej. una vez al día) para eliminar las sesiones que no han tenido actividad en un tiempo determinado (ej. 30 días). La mayoría de las librerías de sesión sobre Redis permiten configurar un TTL por defecto en las sesiones nuevas, lo que podría ser una solución aún más sencilla de implementar.
