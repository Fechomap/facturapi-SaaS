/**
 * Constantes de flujos del bot
 * Elimina el uso de "magic strings" en userState.esperando
 */

export const BOT_FLOWS = {
  // Flujos de espera de archivos Excel
  ESCOTEL_AWAIT_EXCEL: 'archivo_excel_escotel',
  AXA_AWAIT_EXCEL: 'archivo_excel_axa',
  CHUBB_AWAIT_EXCEL: 'archivo_excel_chubb',
  QUALITAS_AWAIT_EXCEL: 'archivo_excel_qualitas',
  CLUB_ASISTENCIA_AWAIT_EXCEL: 'archivo_excel_club_asistencia',

  // Flujos de espera de PDFs
  AWAIT_PDF_INVOICE: 'esperando_pdf_factura',

  // Otros flujos
  ONBOARDING: 'onboarding',
  CONFIGURACION: 'configuracion',
} as const;

export const BOT_ACTIONS = {
  // Menús principales
  MENU_PRINCIPAL: 'menu_principal',
  MENU_ESCOTEL: 'menu_escotel',
  MENU_AXA: 'menu_axa',
  MENU_CHUBB: 'menu_chubb',
  MENU_QUALITAS: 'menu_qualitas',

  // Acciones de confirmación ESCOTEL
  ESCOTEL_CONFIRMAR_FACTURAS: 'escotel_confirmar_facturas',
  ESCOTEL_DOWNLOAD_PDFS_ZIP: 'escotel_download_pdfs_zip',
  ESCOTEL_DOWNLOAD_XMLS_ZIP: 'escotel_download_xmls_zip',

  // Acciones AXA
  AXA_SERVICIOS_REALIZADOS: 'axa_servicios_realizados',
  AXA_SERVICIOS_SOLICITADOS: 'axa_servicios_solicitados',
  AXA_CONFIRMAR_FINAL: 'axa_confirmar_final',

  // Acciones CHUBB
  CHUBB_CONFIRMAR_FACTURAS: 'chubb_confirmar_facturas',

  // Otras acciones
  CANCELAR: 'cancelar',
} as const;

// Type helpers para autocompletado
export type BotFlow = typeof BOT_FLOWS[keyof typeof BOT_FLOWS];
export type BotAction = typeof BOT_ACTIONS[keyof typeof BOT_ACTIONS];
