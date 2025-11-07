# 📘 Guía de Estandarización UI - Type V2

## 🎯 Objetivo

Homologar visualmente todos los procesos del bot para que se vean limpios, consistentes y profesionales, independientemente de las reglas específicas de cada cliente.

## 🛠️ Helpers Creados

### 1. **UIMessages** (`@core/utils/ui-messages.helper.ts`)

Mensajes estandarizados para toda la aplicación.

#### Métodos Principales:

```typescript
// ✅ Mensaje de progreso
UIMessages.processingFile('AXA', step, total, 'Leyendo archivo', 'Detalles...')

// ✅ Mensaje de éxito
UIMessages.success('AXA', invoiceCount, totalAmount, 'Folio: F-123')

// ✅ Mensaje de error con botón de volver
UIMessages.error('Archivo inválido', true)

// ✅ Validar archivo Excel
UIMessages.validateExcelFile(file, maxSizeMB)

// ✅ Mensaje de confirmación
UIMessages.confirmationPrompt('AXA', recordCount, totalAmount)

// ✅ Breadcrumb de navegación
UIMessages.breadcrumb(['Menú Principal', 'AXA', 'Generar Factura'])
```

---

### 2. **UIButtons** (`@core/utils/ui-buttons.helper.ts`)

Botones estandarizados con emojis y textos consistentes.

#### Métodos Principales:

```typescript
// ✅ Botón de volver al menú
UIButtons.backToMenu()

// ✅ Botones de confirmación (muestra cantidad si > 1)
UIButtons.confirmGenerate(invoiceCount, 'confirm_callback', 'cancel_callback')

// ✅ Botones de descarga PDF/XML
UIButtons.downloadButtons(invoiceId, folio)

// ✅ Botones de descarga masiva (ZIP)
UIButtons.downloadZipButtons('pdf_callback', 'xml_callback')

// ✅ Botones de selección con/sin retención
UIButtons.serviceTypeButtons(batchId, 'with_callback', 'without_callback')

// ✅ Remover todos los botones (deshabilitar después de confirmación)
UIButtons.removeAll()
```

---

### 3. **ProgressBar** (`@core/utils/progress-bar.helper.ts`)

Barras de progreso animadas y consistentes.

#### Métodos Principales:

```typescript
// ✅ Actualizar barra de progreso estándar
await ProgressBar.update(ctx, messageId, step, total, 'Procesando...', 'Detalles', 'AXA')

// ✅ Barra de progreso simple
await ProgressBar.updateSimple(ctx, messageId, current, total, 'Procesando')

// ✅ Barra para lotes
await ProgressBar.updateBatch(ctx, chatId, messageId, current, total, 'lote')

// ✅ Mensaje de completado
await ProgressBar.updateCompleted(ctx, messageId, 'Proceso', itemsProcessed)

// ✅ Mensaje de error
await ProgressBar.updateError(ctx, messageId, 'Error al procesar')
```

---

### 4. **ProcessGuard** (`@core/utils/process-guard.helper.ts`)

Blindaje contra doble clic y procesos concurrentes.

#### Métodos Principales:

```typescript
// ✅ Verificar y bloquear si ya está activo
const isBlocked = await ProcessGuard.checkAndBlock(ctx, processId, 'Ya procesando...')
if (isBlocked) return

// ✅ Ejecutar función protegida
await ProcessGuard.execute(ctx, processId, async () => {
  // Tu código aquí
})

// ✅ Wrapper para actions (uso simplificado)
bot.action('my_action', ProcessGuard.wrap('my_action', async (ctx) => {
  // Tu código aquí - automáticamente protegido
}))

// ✅ Remover botones de forma segura
await ProcessGuard.removeButtons(ctx)

// ✅ Responder callback de forma segura
await ProcessGuard.answerCallback(ctx, '✓ Seleccionado')
```

---

## 📋 Antes vs Después

### ❌ ANTES (Inconsistente)

```typescript
// Diferentes en cada handler
const PROGRESS_FRAMES = ['⏳', '⌛', '⏳', '⌛'];
const PROGRESS_BARS = ['▱▱▱', '▰▱▱', ...];

async function updateProgressMessage(ctx, messageId, step, total, task, details) {
  const percentage = Math.round((step / total) * 100);
  const progressBarIndex = Math.min(Math.floor((step / total) * 10), 9);
  const frameIndex = step % PROGRESS_FRAMES.length;

  const progressText =
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo AXA**\n\n` + // ❌ ** vs *
    `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
    `🔄 ${task}\n` +
    (details ? `📝 ${details}\n` : '') +
    `\n⏱️ Por favor espere...`;

  await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText, {
    parse_mode: 'Markdown',
  });
}

// Sin blindaje contra doble clic
bot.action('axa_confirmar', async (ctx) => {
  // ❌ Se puede ejecutar múltiples veces
  await generarFactura();
});

// Mensajes de éxito inconsistentes
await ctx.reply(
  `🎯 *Proceso AXA completado exitosamente*\n\n` + // ❌ AXA usa 🎯
  `✅ Factura generada: ${factura.id}\n` +
  ...
);
```

### ✅ DESPUÉS (Estandarizado)

```typescript
// ✅ Importar helpers centralizados
import { UIMessages, UIButtons, ProgressBar, ProcessGuard } from '@core/utils/ui.helpers.js';

// ✅ Sin constantes duplicadas - todo centralizado en helpers

// ✅ Uso de ProgressBar helper
await ProgressBar.update(ctx, messageId, step, total, 'Leyendo archivo', 'Cargando datos', 'AXA');

// ✅ Blindaje automático contra doble clic
bot.action('axa_confirmar', ProcessGuard.wrap('axa_confirmar', async (ctx) => {
  // ✅ Solo se ejecuta una vez, bloqueado automáticamente
  await generarFactura();
}));

// ✅ Mensajes de éxito estandarizados
const successMsg = UIMessages.success('AXA', 1, total, `Folio: ${factura.folio_number}`);
const buttons = UIButtons.downloadButtons(factura.id, factura.folio_number);

await ctx.reply(successMsg, {
  parse_mode: 'Markdown',
  reply_markup: buttons,
});
```

---

## 🔧 Patrón de Refactorización

### 1. **Reemplazar updateProgressMessage**

```typescript
// ❌ ANTES
async function updateProgressMessage(ctx, messageId, step, total, task, details) {
  // ... 20+ líneas de código duplicado
}

await updateProgressMessage(ctx, progressMessageId, 1, 6, 'Leyendo archivo', 'Cargando...');

// ✅ DESPUÉS
import { ProgressBar } from '@core/utils/ui.helpers.js';

await ProgressBar.update(ctx, progressMessageId, 1, 6, 'Leyendo archivo', 'Cargando...', 'AXA');
```

### 2. **Reemplazar Validación de Archivos**

```typescript
// ❌ ANTES
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

// ✅ DESPUÉS
import { UIMessages } from '@core/utils/ui.helpers.js';

const validation = UIMessages.validateExcelFile(document, 15);
if (!validation.valid) {
  await ctx.reply(validation.error!.text, validation.error!.options);
  return;
}
```

### 3. **Reemplazar Botones de Confirmación**

```typescript
// ❌ ANTES (diferentes en cada handler)
await ctx.reply(
  `¿Confirma la generación de la factura?`,
  {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Confirmar y Generar', `axa_confirmar_final:${batchId}`)],
      [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
    ]),
  }
);

// ✅ DESPUÉS (estandarizado)
import { UIButtons } from '@core/utils/ui.helpers.js';

const buttons = UIButtons.confirmGenerate(1, `axa_confirmar_final:${batchId}`, BOT_ACTIONS.MENU_PRINCIPAL);
await ctx.reply(`¿Confirma la generación de la factura?`, {
  parse_mode: 'Markdown',
  reply_markup: buttons,
});
```

### 4. **Blindar Botones Críticos**

```typescript
// ❌ ANTES (sin protección)
bot.action(/^axa_confirmar_final:(.+)$/, async (ctx: Context) => {
  await ctx.answerCbQuery();
  // ❌ Puede ejecutarse múltiples veces si usuario hace doble clic
  await generarFactura();
});

// ✅ DESPUÉS (protegido)
import { ProcessGuard } from '@core/utils/ui.helpers.js';

bot.action(/^axa_confirmar_final:(.+)$/, async (ctx: Context) => {
  const match = (ctx as any).match;
  const batchId = match ? match[1] : null;
  const processId = `axa_confirmar_${batchId}`;

  // ✅ Verifica y bloquea si ya está activo
  const isBlocked = await ProcessGuard.checkAndBlock(ctx, processId);
  if (isBlocked) return;

  await ProcessGuard.execute(ctx, processId, async () => {
    await ctx.answerCbQuery();
    await generarFactura();
  });
});

// 🚀 OPCIÓN ALTERNATIVA (wrapper automático)
bot.action(/^axa_confirmar_final:(.+)$/, ProcessGuard.wrap('axa_confirmar', async (ctx: Context) => {
  await ctx.answerCbQuery();
  await generarFactura();
}));
```

### 5. **Remover Botones Después de Confirmación**

```typescript
// ❌ ANTES (inconsistente, puede fallar)
await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

// ✅ DESPUÉS (estandarizado y seguro)
import { ProcessGuard } from '@core/utils/ui.helpers.js';

await ProcessGuard.removeButtons(ctx);
```

### 6. **Mensajes de Error Estandarizados**

```typescript
// ❌ ANTES (diferentes formatos)
await ctx.reply('❌ Error al procesar el archivo Excel.');
// o
await ctx.reply(
  `❌ Error: ${error.message}`,
  Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Volver', 'menu_principal')],
  ])
);

// ✅ DESPUÉS (estandarizado)
import { UIMessages } from '@core/utils/ui.helpers.js';

const errorMsg = UIMessages.error('Error al procesar el archivo Excel.', true);
await ctx.reply(errorMsg.text, errorMsg.options);
```

---

## 📊 Checklist de Migración por Handler

### ✅ AXA Handler
- [ ] Reemplazar `updateProgressMessage` con `ProgressBar.update`
- [ ] Reemplazar validación de archivos con `UIMessages.validateExcelFile`
- [ ] Reemplazar botones de confirmación con `UIButtons.confirmGenerate`
- [ ] Blindar acción `axa_confirmar_final` con `ProcessGuard`
- [ ] Reemplazar botones de descarga con `UIButtons.downloadButtons`
- [ ] Reemplazar mensajes de error con `UIMessages.error`
- [ ] Reemplazar mensajes de éxito con `UIMessages.success`
- [ ] Eliminar constantes duplicadas (PROGRESS_FRAMES, PROGRESS_BARS)

### ✅ Chubb Handler
- [ ] Mismos pasos que AXA
- [ ] Estandarizar mensajes de resumen de grupos

### ✅ Escotel Handler
- [ ] Mismos pasos que AXA
- [ ] Estandarizar botones de descarga ZIP

### ✅ Qualitas Handler
- [ ] Mismos pasos que AXA
- [ ] Estandarizar selección de retención

### ✅ Club Asistencia Handler
- [ ] Mismos pasos que AXA

### ✅ Invoice Handler
- [ ] Blindar acción `confirmar_` con `ProcessGuard`
- [ ] Estandarizar breadcrumbs con `UIMessages.breadcrumb`

### ✅ PDF Batch Handler
- [ ] Reemplazar barras de progreso con `ProgressBar.updateBatch`
- [ ] Estandarizar botones de lote

### ✅ Payment Complement Handler
- [ ] Estandarizar botones de descarga
- [ ] Blindar acciones de descarga

---

## 🎨 Reglas de Estilo Visual

### 1. **Markdown Consistente**
- ✅ Usar `*texto*` para bold (UN asterisco)
- ❌ NO usar `**texto**` (DOS asteriscos)

### 2. **Emojis Estandarizados**
- ✅ Éxito: `✅` al inicio
- ✅ Error: `❌` al inicio
- ✅ Procesando: `⏳` o `⌛` (animado)
- ✅ Completado con éxito específico: `🎯` o `✅`

### 3. **Estructura de Mensajes**
```
✅ *Título Principal*

📊 Información clave 1
💰 Información clave 2

📥 Llamada a la acción
```

### 4. **Botones**
- Siempre incluir emoji relevante
- Texto en formato: `Emoji + Acción`
- Ejemplos: `✅ Confirmar`, `❌ Cancelar`, `🔙 Volver al menú`, `📄 Descargar PDF`

### 5. **Breadcrumbs**
```typescript
UIMessages.breadcrumb(['Menú Principal', 'Generar Factura', 'AXA'])
// Resultado: "🏠 Menú Principal → Generar Factura → AXA"
```

---

## 🚀 Beneficios de la Estandarización

1. **Código más limpio**: Elimina 1000+ líneas de código duplicado
2. **Mantenimiento fácil**: Cambios en un solo lugar
3. **Experiencia consistente**: Usuarios ven mismo estilo siempre
4. **Blindaje robusto**: Previene errores de doble clic
5. **Profesionalismo**: La app se ve pulida y bien diseñada
6. **Escalabilidad**: Agregar nuevos clientes es más rápido

---

## 📞 Importación Unificada

```typescript
// ✅ Importar todos los helpers desde un solo punto
import { UIMessages, UIButtons, ProgressBar, ProcessGuard } from '@core/utils/ui.helpers.js';

// Ya no necesitas importar Markup directamente para botones estandarizados
// Ya no necesitas definir PROGRESS_FRAMES, PROGRESS_BARS, etc.
// Ya no necesitas función updateProgressMessage
```

---

## 🔒 Seguridad y Blindaje

### Todos los botones críticos deben estar blindados:

```typescript
// Acciones que generan facturas
ProcessGuard.wrap('confirmar_factura', handler)

// Acciones que descargan archivos
ProcessGuard.wrap('download_pdf', handler)

// Acciones que procesan lotes
ProcessGuard.wrap('batch_generate', handler)

// Acciones que confirman pagos
ProcessGuard.wrap('confirm_payment', handler)
```

### Botones que SIEMPRE deben deshabilitarse después de confirmación:

```typescript
await ProcessGuard.removeButtons(ctx);
```

---

## ✨ Resultado Final

Con esta estandarización, todos los procesos se verán:
- 🎨 **Visualmente consistentes**
- 🛡️ **Blindados contra errores**
- 🧹 **Limpios y profesionales**
- 📱 **Fáciles de mantener**
- 🚀 **Listos para escalar**

---

**Fecha de creación**: 2025-11-07
**Versión**: 1.0
**Autor**: Claude Code - Estandarización Type V2
