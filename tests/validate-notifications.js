// tests/validate-notifications.js
import NotificationService from '../services/notification.service.js';
import { initConfig } from '../config/index.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import logger from '../core/utils/logger.js';

const testLogger = logger.child({ module: 'notification-validation' });

async function validateNotifications() {
  testLogger.info('Iniciando validación de notificaciones');
  
  try {
    // Inicializar configuración y base de datos
    await initConfig();
    await connectDatabase();
    
    // Inicializar servicio de notificaciones
    const initialized = NotificationService.initialize();
    
    if (!initialized) {
      throw new Error('No se pudo inicializar el servicio de notificaciones');
    }
    
    testLogger.info('Servicio de notificaciones inicializado correctamente');
    
    // Solicitar ID de Telegram para la prueba
    const readline = (await import('readline')).createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const telegramId = await new Promise(resolve => {
      readline.question('Ingresa tu ID de Telegram para recibir la notificación de prueba: ', resolve);
    });
    
    readline.close();
    
    // Enviar notificación de prueba
    const testMessage = 
      `🔔 *Prueba de Notificación*\n\n` +
      `Esta es una notificación de prueba para validar el sistema.\n\n` +
      `Fecha y hora: ${new Date().toISOString()}\n` +
      `Si estás recibiendo este mensaje, el sistema de notificaciones funciona correctamente.`;
    
    const result = await NotificationService.sendTelegramNotification(
      telegramId,
      testMessage,
      { parse_mode: 'Markdown' }
    );
    
    if (result.success) {
      console.log('✅ Notificación enviada correctamente');
    } else {
      throw new Error(`Error al enviar notificación: ${result.error}`);
    }
    
    console.log('✅ Validación de notificaciones completada');
    
  } catch (error) {
    testLogger.error({ error }, 'Error al validar notificaciones');
    console.error('❌ Error en la validación de notificaciones:', error.message);
  } finally {
    await disconnectDatabase();
  }
}

validateNotifications()
  .then(() => {
    console.log('Script de validación finalizado');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el script de validación:', error);
    process.exit(1);
  });