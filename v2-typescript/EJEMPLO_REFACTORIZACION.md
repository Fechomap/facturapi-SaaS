# 🔄 Ejemplo Completo de Refactorización - Handler AXA

## 📌 Fragmento del Handler ANTES de Estandarizar

```typescript
// ❌ CÓDIGO ANTERIOR - axa.handler.ts (fragmentos)

import { Markup, Context } from 'telegraf';
// ... otras importaciones

// ❌ CONSTANTES DUPLICADAS (están en TODOS los handlers)
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const PROGRESS_FRAMES = ['⏳', '⌛', '⏳', '⌛'];
const PROGRESS_BARS = [
  '▱▱▱▱▱▱▱▱▱▱',
  '▰▱▱▱▱▱▱▱▱▱',
  '▰▰▱▱▱▱▱▱▱▱',
  '▰▰▰▱▱▱▱▱▱▱',
  '▰▰▰▰▱▱▱▱▱▱',
  '▰▰▰▰▰▱▱▱▱▱',
  '▰▰▰▰▰▰▱▱▱▱',
  '▰▰▰▰▰▰▰▱▱▱',
  '▰▰▰▰▰▰▰▰▱▱',
  '▰▰▰▰▰▰▰▰▰▱',
  '▰▰▰▰▰▰▰▰▰▰',
];

// ❌ FUNCIÓN DUPLICADA (20+ líneas en CADA handler)
async function updateProgressMessage(
  ctx: Context,
  messageId: number | undefined,
  step: number,
  total: number,
  currentTask: string,
  details = ''
): Promise<void> {
  if (!messageId) return;

  const percentage = Math.round((step / total) * 100);
  const progressBarIndex = Math.min(Math.floor((step / total) * 10), 9);
  const frameIndex = step % PROGRESS_FRAMES.length;

  const progressText =
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo AXA**\n\n` + // ❌ ** (doble asterisco)
    `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
    `🔄 ${currentTask}\n` +
    (details ? `📝 ${details}\n` : '') +
    `\n⏱️ Por favor espere...`;

  try {
    await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.debug('No se pudo editar mensaje de progreso');
  }
}

// ❌ VALIDACIÓN DE ARCHIVO - CÓDIGO DUPLICADO
bot.on('document', async (ctx: Context, next: () => Promise<void>) => {
  const userState = (ctx as any).userState;
  if (!userState || userState.esperando !== BOT_FLOWS.AXA_AWAIT_EXCEL) {
    return next();
  }

  const document = (ctx.message as any)?.document;
  if (!document) {
    return next();
  }

  // ❌ VALIDACIÓN DUPLICADA (misma en todos los handlers)
  if (document.file_size && document.file_size > MAX_FILE_SIZE_BYTES) {
    await ctx.reply(
      `❌ El archivo es demasiado grande (${Math.round(document.file_size / (1024 * 1024))} MB).\n` +
        `El tamaño máximo permitido es ${MAX_FILE_SIZE_MB} MB.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
      ])
    );
    return;
  }

  const fileName = document.file_name || '';
  const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

  if (!isExcel) {
    await ctx.reply(
      '❌ El archivo debe ser un Excel (.xlsx o .xls)',
      Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
      ])
    );
    return;
  }

  // ❌ MENSAJE DE PROGRESO MANUAL
  const receivingMessage = await ctx.reply(
    '📥 Recibiendo archivo Excel de AXA...\n⏳ Validando archivo...'
  );
  const receivingMessageId = receivingMessage.message_id;

  // ❌ LLAMADAS MANUALES A updateProgressMessage
  await updateProgressMessage(
    ctx,
    receivingMessageId,
    1,
    6,
    'Leyendo archivo Excel',
    'Cargando datos...'
  );

  // ... más código ...

  await updateProgressMessage(
    ctx,
    receivingMessageId,
    2,
    6,
    'Detectando columnas',
    'Analizando estructura...'
  );

  // ... más código ...
});

// ❌ BOTONES SIN BLINDAJE (se pueden presionar múltiples veces)
bot.action(/^axa_confirmar_final:(.+)$/, async (ctx: Context) => {
  try {
    await ctx.answerCbQuery();

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    // ❌ SIN PROTECCIÓN CONTRA DOBLE CLIC
    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura AXA...\n⏳ Validando datos precalculados...'
    );

    // ... proceso de facturación ...

    // ❌ BOTONES MANUALES (formato inconsistente)
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    // ❌ MENSAJE DE ÉXITO - INCONSISTENTE
    if (factura) {
      await ctx.reply(
        `🎯 *Proceso AXA completado exitosamente*\n\n` + // ❌ 🎯 en lugar de ✅
          `✅ Factura generada: ${factura.id}\n` +
          `📊 ${facturaData.items.length} servicios procesados\n` +
          `💰 Total: $${facturaData.total.toFixed(2)}\n` +
          `📋 Folio: ${factura.folio_number}\n\n` +
          `📥 Seleccione una opción para descargar:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '📄 Descargar PDF',
                `pdf_${factura.id}_${factura.folio_number}`
              ),
            ],
            [
              Markup.button.callback(
                '🔠 Descargar XML',
                `xml_${factura.id}_${factura.folio_number}`
              ),
            ],
          ]),
        }
      );
    }
  } catch (error) {
    logger.error({ error }, 'Error al confirmar factura');
    // ❌ MENSAJE DE ERROR MANUAL
    await ctx.reply(
      `❌ Error al generar factura: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
  }
});
```

---

## ✅ Fragmento del Handler DESPUÉS de Estandarizar

```typescript
// ✅ CÓDIGO REFACTORIZADO - axa.handler.ts

import { Context } from 'telegraf';
// ... otras importaciones

// ✅ IMPORTAR HELPERS ESTANDARIZADOS
import { UIMessages, UIButtons, ProgressBar, ProcessGuard } from '@core/utils/ui.helpers.js';

// ✅ YA NO SE NECESITAN ESTAS CONSTANTES (están en los helpers)
// ✅ Eliminadas: PROGRESS_FRAMES, PROGRESS_BARS, MAX_FILE_SIZE_*

// ✅ YA NO SE NECESITA updateProgressMessage (usar ProgressBar.update)

// ✅ VALIDACIÓN DE ARCHIVO - ESTANDARIZADA
bot.on('document', async (ctx: Context, next: () => Promise<void>) => {
  const userState = (ctx as any).userState;
  if (!userState || userState.esperando !== BOT_FLOWS.AXA_AWAIT_EXCEL) {
    return next();
  }

  const document = (ctx.message as any)?.document;
  if (!document) {
    return next();
  }

  // ✅ VALIDACIÓN ESTANDARIZADA (1 línea!)
  const validation = UIMessages.validateExcelFile(document, 15);
  if (!validation.valid) {
    await ctx.reply(validation.error!.text, validation.error!.options);
    return;
  }

  // ✅ MENSAJE DE PROGRESO INICIAL
  const receivingMessage = await ctx.reply(
    UIMessages.fileReceived(document.file_name!, 'AXA')
  );
  const receivingMessageId = receivingMessage.message_id;

  // ✅ LLAMADAS ESTANDARIZADAS A ProgressBar
  await ProgressBar.update(
    ctx,
    receivingMessageId,
    1,
    6,
    'Leyendo archivo Excel',
    'Cargando datos...',
    'AXA'
  );

  // ... más código ...

  await ProgressBar.update(
    ctx,
    receivingMessageId,
    2,
    6,
    'Detectando columnas',
    'Analizando estructura...',
    'AXA'
  );

  // ... más código ...
});

// ✅ BOTONES BLINDADOS (wrapper automático)
bot.action(
  /^axa_confirmar_final:(.+)$/,
  ProcessGuard.wrap('axa_confirmar_final', async (ctx: Context) => {
    // ✅ AUTOMÁTICAMENTE PROTEGIDO contra doble clic
    await ProcessGuard.answerCallback(ctx, '✓ Confirmando...');

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    if (!batchId) {
      const errorMsg = UIMessages.error('No se pudo obtener el ID del lote.', true);
      await ctx.reply(errorMsg.text, errorMsg.options);
      return;
    }

    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura AXA...\n⏳ Validando datos precalculados...'
    );

    try {
      // ... proceso de facturación ...

      // ✅ REMOVER BOTONES DE FORMA SEGURA
      await ProcessGuard.removeButtons(ctx);

      // ✅ MENSAJE DE ÉXITO ESTANDARIZADO
      if (factura) {
        const successMsg = UIMessages.success(
          'AXA',
          facturaData.items.length,
          facturaData.total,
          `Folio: ${factura.folio_number}`
        );

        const downloadButtons = UIButtons.downloadButtons(
          factura.id,
          factura.folio_number
        );

        await ctx.reply(successMsg, {
          parse_mode: 'Markdown',
          reply_markup: downloadButtons,
        });
      }
    } catch (error) {
      logger.error({ error }, 'Error al confirmar factura');

      // ✅ MENSAJE DE ERROR ESTANDARIZADO
      const errorMsg = UIMessages.error(
        `Error al generar factura: ${error instanceof Error ? error.message : 'Error desconocido'}`,
        true
      );
      await ctx.reply(errorMsg.text, errorMsg.options);
    }
  })
);
```

---

## 📊 Comparación de Código

### Líneas Eliminadas ✂️

| Concepto | Antes | Después | Ahorro |
|----------|-------|---------|--------|
| Constantes PROGRESS | 13 líneas | 0 líneas | **-13** |
| Función updateProgressMessage | 20 líneas | 0 líneas | **-20** |
| Validación de archivo | 25 líneas | 3 líneas | **-22** |
| Mensajes de error | ~10 líneas c/u | 1-2 líneas c/u | **-80%** |
| Botones manuales | ~10 líneas c/u | 1 línea | **-90%** |

### Total por Handler: **~100 líneas menos** ✨

### Con 5 handlers: **~500 líneas eliminadas** 🎉

---

## 🎯 Beneficios Visuales

### ANTES ❌
```
🎯 *Proceso AXA completado exitosamente*      ← Emoji diferente
✅ **Facturas CHUBB generadas exitosamente**  ← ** en lugar de *
✅ *Facturas ESCOTEL generadas exitosamente*  ← Formato diferente
🎯 *Proceso Qualitas completado*             ← Sin consistencia
```

### DESPUÉS ✅
```
✅ *Proceso AXA completado exitosamente*
✅ *Facturas CHUBB generadas exitosamente*
✅ *Facturas ESCOTEL generadas exitosamente*
✅ *Proceso Qualitas completado exitosamente*
                    ↑
        ¡TODO CONSISTENTE!
```

---

## 🛡️ Beneficios de Seguridad

### ANTES ❌
```typescript
// Usuario puede hacer doble clic → genera 2 facturas 💸
bot.action('axa_confirmar', async (ctx) => {
  await generarFactura(); // ❌ No protegido
});
```

### DESPUÉS ✅
```typescript
// Usuario intenta doble clic → segunda ejecución bloqueada 🛡️
bot.action('axa_confirmar', ProcessGuard.wrap('axa_confirmar', async (ctx) => {
  await generarFactura(); // ✅ Protegido automáticamente
}));

// Primera ejecución: ✅ Se ejecuta
// Segunda ejecución (inmediata): ⏳ "Este proceso ya está en ejecución..."
```

---

## 🚀 Próximos Pasos

1. ✅ Aplicar a **AXA Handler** (DEMOSTRADO ARRIBA)
2. ⏳ Aplicar a **Chubb Handler**
3. ⏳ Aplicar a **Escotel Handler**
4. ⏳ Aplicar a **Qualitas Handler**
5. ⏳ Aplicar a **Invoice Handler**
6. ⏳ Aplicar a **PDF Batch Handler**
7. ⏳ Aplicar a **Payment Complement Handler**

---

## ✅ Checklist de Refactorización

Para cada handler, seguir estos pasos:

### 1. Imports
```typescript
// ✅ Agregar
import { UIMessages, UIButtons, ProgressBar, ProcessGuard } from '@core/utils/ui.helpers.js';
```

### 2. Eliminar Código Duplicado
```typescript
// ❌ Eliminar estas constantes
const PROGRESS_FRAMES = ...
const PROGRESS_BARS = ...
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = ...

// ❌ Eliminar esta función
async function updateProgressMessage(...) { ... }
```

### 3. Reemplazar Validaciones
```typescript
// ❌ Buscar código así:
if (document.file_size && document.file_size > MAX_FILE_SIZE_BYTES) { ... }
const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

// ✅ Reemplazar con:
const validation = UIMessages.validateExcelFile(document, 15);
if (!validation.valid) {
  await ctx.reply(validation.error!.text, validation.error!.options);
  return;
}
```

### 4. Reemplazar Barras de Progreso
```typescript
// ❌ Buscar:
await updateProgressMessage(ctx, msgId, step, total, 'Tarea', 'Detalle');

// ✅ Reemplazar con:
await ProgressBar.update(ctx, msgId, step, total, 'Tarea', 'Detalle', 'CLIENTE');
```

### 5. Blindar Actions Críticas
```typescript
// ❌ Buscar:
bot.action('confirmar_algo', async (ctx) => { ... });

// ✅ Reemplazar con:
bot.action('confirmar_algo', ProcessGuard.wrap('confirmar_algo', async (ctx) => { ... }));
```

### 6. Estandarizar Mensajes
```typescript
// ❌ Buscar mensajes custom de éxito/error
await ctx.reply(`🎯 *Proceso completado*...`);
await ctx.reply(`❌ Error: ...`);

// ✅ Reemplazar con:
const successMsg = UIMessages.success(cliente, count, total, folioInfo);
const errorMsg = UIMessages.error(errorText, true);
```

### 7. Estandarizar Botones
```typescript
// ❌ Buscar:
Markup.inlineKeyboard([
  [Markup.button.callback('📄 Descargar PDF', `pdf_${id}_${folio}`)],
  [Markup.button.callback('🔠 Descargar XML', `xml_${id}_${folio}`)],
])

// ✅ Reemplazar con:
UIButtons.downloadButtons(id, folio)
```

---

**Resultado**: Código más limpio, consistente y profesional ✨
