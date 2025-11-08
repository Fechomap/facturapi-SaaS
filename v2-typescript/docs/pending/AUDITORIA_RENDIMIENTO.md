# Auditoría de Rendimiento y Cuellos de Botella - Proyecto v2

## Introducción

Este documento resume los hallazgos de una auditoría de rendimiento realizada sobre el código de `v2-typescript`. Se han identificado varios cuellos de botella que afectan la escalabilidad, la concurrencia y la experiencia del usuario. A continuación, se detallan los problemas y se proponen soluciones concretas para cada uno.

---

## Resumen de Hallazgos

1.  **Procesamiento Síncrono de PDFs (Crítico):** El manejo de archivos PDF bloquea el hilo principal del bot, afectando a todos los usuarios concurrentes.
2.  **Conteo Ineficiente de Facturas en Lote (Grave):** El registro de facturas por lote genera un número excesivo de consultas a la base de datos (problema N+1), degradando el rendimiento a medida que el lote crece.
3.  **Dependencia de API Externa en Reportes de Lotes (Corregido):** Se confirmó que el servicio de reportes para lotes (`batch-excel.service.ts`) no estaba optimizado y realizaba llamadas innecesarias a la API de FacturAPI. Se ha propuesto una solución para esto.

---

## Análisis Detallado y Soluciones

### 1. Cuello de Botella Crítico: Procesamiento Síncrono de PDFs

-   **Archivo Afectado:** `v2-typescript/src/bot/handlers/pdf-invoice.handler.ts`
-   **Descripción del Problema:** El handler que procesa los PDFs enviados por los usuarios realiza operaciones pesadas y lentas (descarga de archivos, análisis de contenido con `PDFAnalysisService`, y consultas a APIs externas) de manera síncrona (`await`).
-   **Impacto:** Mientras un usuario sube y procesa un PDF, el bot se vuelve completamente insensible para **todos los demás usuarios**. Esto crea una mala experiencia de usuario y limita severamente la capacidad del sistema para manejar más de un usuario a la vez.
-   **Evidencia:**
    ```typescript
    // en pdf-invoice.handler.ts
    bot.on('document', async (ctx: BotContext, next: () => Promise<void>) => {
      // ...
      // 1. Bloqueo durante la descarga
      const filePath = await downloadTelegramFile(ctx, document.file_id, fileName, tempDir);

      // 2. Bloqueo durante el análisis
      const analysisResult = await PDFAnalysisService.analyzePDF(filePath);

      // 3. Bloqueo durante la búsqueda en API externa
      const clientes = await facturapi.customers.list({ q: analysis.clientName });
      // ...
    });
    ```
-   **Solución Propuesta:**
    Refactorizar el flujo para que sea asíncrono y no bloqueante.
    1.  El handler `bot.on('document', ...)` solo debe encargarse de recibir el archivo y añadir una tarea a una cola de trabajos (como `BullMQ` o similar).
    2.  Un **proceso trabajador (worker)** separado debe escuchar esa cola.
    3.  El worker se encargará del trabajo pesado: descargar el archivo, analizarlo, hacer las consultas a la API, etc.
    4.  Una vez que el worker termine, debe notificar al usuario original con el resultado a través del bot.
    Este enfoque libera al bot para que pueda atender a múltiples usuarios de forma instantánea.

### 2. Cuello de Botella Grave: Conteo Ineficiente de Facturas en Lote

-   **Archivo Afectado:** `v2-typescript/src/core/tenant/tenant.service.ts`
-   **Descripción del Problema:** La función `incrementInvoiceCountBy`, que se llama al registrar un lote de facturas, utiliza un bucle `for` para incrementar el contador de facturas una por una. Esto es un clásico problema de **N+1 consultas**.
-   **Impacto:** Si se registra un lote de 500 facturas, el sistema realiza aproximadamente 1000 consultas a la base de datos (`findFirst` y `update` dentro del bucle) en lugar de una sola. Esto sobrecarga la base de datos y hace que el proceso de registro de lotes sea innecesariamente lento y poco escalable.
-   **Evidencia:**
    ```typescript
    // en tenant.service.ts
    private static async incrementInvoiceCountBy(tenantId: string, count: number) {
      // PROBLEMA: Bucle que ejecuta 'count' llamadas a la BD
      for (let i = 0; i < count; i++) {
        await this.incrementInvoiceCount(tenantId);
      }
    }
    ```
-   **Solución Propuesta:**
    Modificar la función para que realice una única actualización atómica en la base de datos. Prisma está preparado para esto.

    **Código Corregido:**
    ```typescript
    // en tenant.service.ts
    private static async incrementInvoiceCountBy(tenantId: string, count: number) {
      const subscription = await prisma.tenantSubscription.findFirst({
        where: {
          tenantId,
          OR: [{ status: 'active' }, { status: 'trial' }],
        },
      });

      if (subscription) {
        // UNA SOLA CONSULTA para actualizar el contador
        await prisma.tenantSubscription.update({
          where: { id: subscription.id },
          data: {
            invoicesUsed: {
              increment: count, // Prisma maneja esto de forma atómica
            },
          },
        });
      }
    }
    ```

### 3. Cuello de Botella Corregido: Dependencia de API en Reportes de Lotes

-   **Archivos Afectados:** `v2-typescript/src/services/batch-excel.service.ts`, `v2-typescript/src/services/excel-report.service.ts`
-   **Descripción del Problema:** Se confirmó que el servicio para reportes grandes (`batch-excel.service.ts`) no estaba optimizado. Llamaba a la función `enrichWithFacturapiData` la cual, a su vez, realizaba una llamada a la API de FacturAPI por cada factura para obtener datos como `verificationUrl`, `subtotal`, etc., incluso si el UUID ya existía en la base de datos local.
-   **Impacto:** La generación de reportes para facturas ya migradas seguía siendo extremadamente lenta, anulando el beneficio de la migración de UUIDs.
-   **Solución Propuesta (Ya discutida):**
    Modificar `enrichWithFacturapiData` para que, si un `invoice.uuid` existe, **no realice ninguna llamada a la API** y simplemente popule el reporte con los datos disponibles en la base de datos local, dejando los campos faltantes en blanco o con valores por defecto. Esto prioriza la velocidad y resuelve el cuello de botella.
