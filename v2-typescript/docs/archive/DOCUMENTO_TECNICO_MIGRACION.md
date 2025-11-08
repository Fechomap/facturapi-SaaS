# Documento Técnico y Hoja de Ruta para la Migración a TypeScript

## 1. Visión General y Objetivos

Este documento sirve como una guía técnica para la migración en curso a TypeScript. El objetivo principal de esta migración debe ser la creación de una aplicación **robusta, escalable, segura y fácil de mantener**, aprovechando al máximo las ventajas que TypeScript y las prácticas modernas de desarrollo de software ofrecen.

El análisis del directorio `/v2-typescript` revela que, si bien la migración ha comenzado, se han arrastrado problemas arquitectónicos críticos de la versión anterior de JavaScript y aún no se está capitalizando el potencial de seguridad de tipos de TypeScript. 

Este documento presenta una auditoría de la base de código actual y una hoja de ruta (roadmap) con recomendaciones arquitectónicas para asegurar el éxito del proyecto.

---

## 2. Auditoría del Código Actual (`/v2-typescript`)

### 2.1. Hallazgos de Seguridad (Prioridad: Crítica)

#### 2.1.1. Exposición de Claves de API en Registros (Logs)

-   **Riesgo:** **Crítico.** Partes de las claves de API de FacturAPI se están escribiendo en los logs. Esto es una vulnerabilidad de seguridad grave que podría permitir a un atacante obtener acceso no autorizado a las cuentas de facturación.
-   **Evidencia (`src/bot/handlers/invoice.handler.ts`):**
    ```typescript
    console.log('API Key (primeros 20 chars):', tenant.facturapiApiKey?.substring(0, 20));
    ```
-   **Mitigación:** Eliminar inmediatamente cualquier línea que registre claves de API. Solo se debe registrar la existencia de la clave o su modo (test/live), nunca la clave en sí.

#### 2.1.2. Potencial Denegación de Servicio (DoS) por Subida de Archivos

-   **Riesgo:** **Alto.** No se valida el tamaño de los archivos subidos por los usuarios.
-   **Impacto:** Un usuario podría subir un archivo de un tamaño desmesurado (cientos de MB o GB), lo que podría agotar el espacio en disco o la memoria del servidor, causando un bloqueo total de la aplicación para todos los usuarios.
-   **Mitigación:** Antes de descargar el archivo, verificar la propiedad `ctx.message.document.file_size` y rechazar cualquier archivo que exceda un límite razonable (ej. 15 MB).

### 2.2. Hallazgos de Integridad y Rendimiento (Prioridad: Alta)

#### 2.2.1. Pérdida y Corrupción de Datos por Caché Global

-   **Riesgo:** **Alto.** A pesar de no usar `global.` directamente en una búsqueda, el patrón de caché en memoria persiste, como se evidencia en el código migrado.
-   **Evidencia (`src/bot/handlers/qualitas.handler.ts`):**
    ```typescript
    const tempData = (global as any).tempQualitasData?.[ctx.from?.id];
    ```
-   **Impacto:** Este enfoque sigue siendo vulnerable a la **pérdida de datos** si el servidor se reinicia y a la **corrupción de estado** si un usuario sube dos archivos consecutivamente. Es un patrón inseguro para producción.
-   **Mitigación:** Implementar un servicio de estado externo como **Redis**. (Ver sección 3.2).

#### 2.2.2. Bloqueo del Servidor por Operaciones de Archivo Síncronas

-   **Riesgo:** **Alto.** El uso de `fs.existsSync`, `fs.mkdirSync` y `fs.unlinkSync` bloquea el hilo principal de Node.js, degradando el rendimiento y la capacidad de respuesta del bot bajo carga concurrente.
-   **Evidencia (`src/bot/handlers/qualitas.handler.ts`):**
    ```typescript
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    // ...
    fs.unlinkSync(filePath);
    ```
-   **Mitigación:** Reemplazar todas las llamadas síncronas por sus equivalentes asíncronos del módulo `fs/promises` (ej. `await fs.mkdir(...)`, `await fs.unlink(...)`).

### 2.3. Hallazgos de Calidad de Código y Tipado (Prioridad: Alta)

#### 2.3.1. Modo Estricto de TypeScript Desactivado

-   **Riesgo:** **Alto.** El principal beneficio de TypeScript, la seguridad de tipos, está mayormente desactivado.
-   **Evidencia (`tsconfig.json`):**
    ```json
    "strict": false,
    "noImplicitAny": false,
    "strictNullChecks": false
    ```
-   **Impacto:** Permite errores comunes como variables implícitamente `any` y un manejo inseguro de `null` y `undefined`, lo que lleva a errores en tiempo de ejecución que TypeScript debería prevenir. Anula en gran medida el propósito de la migración.
-   **Mitigación:** Activar `"strict": true` en `tsconfig.json` y refactorizar el código para corregir los errores de tipo que surgirán. Esta es la acción más importante para mejorar la calidad del código.

#### 2.3.2. Uso Excesivo de `any`

-   **Riesgo:** **Medio.** El uso manual de `any` desactiva el chequeo de tipos para variables específicas, creando "agujeros" en la seguridad de tipos del sistema.
-   **Evidencia (`src/bot/handlers/qualitas.handler.ts`):**
    ```typescript
    export function registerQualitasHandler(bot: any): void { ... }
    const tempData = (global as any).tempQualitasData?.[ctx.from?.id];
    ```
-   **Mitigación:** Crear interfaces y tipos definidos para las estructuras de datos comunes (ej. `QualitasData`, `Bot`, etc.) y reemplazar los `any` por tipos específicos. Esto permitirá al compilador detectar errores y mejorará el autocompletado.

---

## 3. Arquitectura Recomendada y Hoja de Ruta

Para construir una base sólida, se recomienda adoptar una arquitectura más limpia y moderna.

### 3.1. Configuración de TypeScript: Tolerancia Cero a la Inseguridad

-   **Acción:** Activar `"strict": true` en `tsconfig.json`.
-   **Justificación:** Es el estándar de la industria para cualquier proyecto serio en TypeScript. Forzará al equipo a escribir código más explícito y seguro, eliminando una clase entera de bugs en tiempo de ejecución.

### 3.2. Capa de Estado: Reemplazo del Caché Global con Redis

-   **Acción:** Crear un `RedisStateService` para manejar todo el estado temporal (lotes de facturas pendientes, sesiones de usuario, etc.).
-   **Diseño Sugerido:**
    ```typescript
    // src/services/redis-state.service.ts
    import { redisClient } from '@config/redis'; // Cliente Redis centralizado

    const BATCH_EXPIRATION_SECONDS = 900; // 15 minutos

    export class RedisStateService {
      static async saveBatchData(userId: number, batchId: string, data: any): Promise<void> {
        const key = `batch:${userId}:${batchId}`
        await redisClient.set(key, JSON.stringify(data), { EX: BATCH_EXPIRATION_SECONDS });
      }

      static async getBatchData(userId: number, batchId: string): Promise<any | null> {
        const key = `batch:${userId}:${batchId}`
        const data = await redisClient.get(key);
        return data ? JSON.parse(data) : null;
      }
    }
    ```
-   **Justificación:** Redis proporciona persistencia, expiración automática de datos (TTL) y es seguro para entornos de múltiples procesos (clúster), solucionando los tres problemas del caché global.

### 3.3. Capa de Acceso a Datos: Operaciones por Lote

-   **Acción:** Para cada servicio que necesite insertar múltiples registros, crear métodos de lote que utilicen `prisma.createMany`.
-   **Diseño Sugerido (`src/core/tenant/tenant.service.ts`):**
    ```typescript
    // Añadir este método al TenantService
    static async registerInvoicesBatch(invoiceData: Prisma.TenantInvoiceCreateManyInput[]): Promise<Prisma.BatchPayload> {
      return prisma.tenantInvoice.createMany({
        data: invoiceData,
        skipDuplicates: true, // Evita fallos si se reintenta
      });
    }
    ```
-   **Justificación:** Reduce la carga sobre la base de datos y mejora drásticamente el rendimiento en operaciones masivas.

### 3.4. Capa de Servicios y Handlers: Lógica Limpia

-   **Acción:** Refactorizar los handlers para que contengan la menor lógica de negocio posible. Su única responsabilidad debe ser: (1) Parsear el contexto (`ctx`) de Telegraf, (2) Llamar a los servicios apropiados con datos limpios, y (3) Responder al usuario.
-   **Diseño Sugerido:**
    ```typescript
    // En el handler
    bot.action('confirmar_lote:BATCH_ID', async (ctx) => {
      const batchId = ctx.match[1]; // Obtener ID del callback
      await ctx.reply('Procesando lote...');
      // El servicio se encarga de toda la lógica compleja
      const result = await EscotelService.processAndInvoiceBatch(ctx.from.id, batchId);
      await ctx.reply(`Resultado: ${result.message}`);
    });
    ```
-   **Justificación:** Esto mejora la separación de responsabilidades (SoC), facilita las pruebas unitarias de la lógica de negocio (que ahora reside en los servicios) y hace que el flujo del bot sea más fácil de entender.

---

## 4. Pasos Accionables Inmediatos

Se recomienda abordar los problemas en el siguiente orden de prioridad:

1.  **Corregir la Fuga de API Keys:** Eliminar inmediatamente todos los `console.log` que muestren claves de API.
2.  **Activar el Modo Estricto:** Cambiar `"strict": true` en `tsconfig.json`. Esta acción revelará muchos errores de tipo latentes. Corregir estos errores es fundamental para estabilizar la base de código.
3.  **Eliminar I/O Síncrona:** Refactorizar todas las llamadas a `fs.*Sync` para usar `fs/promises` y `await`. Esto mejorará inmediatamente la capacidad de respuesta del bot.
4.  **Diseñar e Implementar el `RedisStateService`:** Reemplazar el patrón de `(global as any)` por un servicio de estado basado en Redis antes de continuar migrando o desarrollando los manejadores de lotes restantes (`escotel`, `axa`, etc.).
