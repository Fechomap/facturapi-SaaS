// test-phase4.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Determinar directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
const NODE_ENV = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${NODE_ENV}` });

console.log(chalk.blue(`🔍 Pruebas de Fase 4 (Bot de Telegram) - Entorno: ${NODE_ENV}`));

// Archivos y directorios requeridos
const requiredFiles = [
  'bot/index.js',
  'bot/commands/index.js',
  'bot/commands/start.command.js',
  'bot/commands/help.command.js',
  'bot/commands/menu.command.js',
  'bot/commands/subscription.command.js',
  'bot/handlers/index.js',
  'bot/handlers/client.handler.js',
  'bot/handlers/invoice.handler.js',
  'bot/handlers/chubb.handler.js',
  'bot/handlers/onboarding.handler.js',
  'bot/middlewares/auth.middleware.js',
  'bot/middlewares/error.middleware.js',
  'bot/middlewares/tenant.middleware.js',
  'bot/views/menu.view.js',
  'bot/views/invoice.view.js',
  'bot/views/client.view.js'
];

// Prueba de estructura de archivos
console.log(chalk.blue('🔹 PRUEBA DE ESTRUCTURA DE ARCHIVOS'));
let allFilesExist = true;

for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  const exists = fs.existsSync(filePath);
  
  if (exists) {
    console.log(`  ${chalk.green('✅')} ${file}`);
  } else {
    console.log(`  ${chalk.red('❌')} ${file}`);
    allFilesExist = false;
  }
}

if (allFilesExist) {
  console.log(chalk.green('✅ Todos los archivos requeridos existen'));
} else {
  console.log(chalk.red('❌ Faltan algunos archivos requeridos'));
}

// Resumen de pruebas
console.log(chalk.blue('📊 RESUMEN DE PRUEBAS'));
console.log('-------------------');
console.log(`Estructura de archivos: ${allFilesExist ? chalk.green('✅ Pasó') : chalk.red('❌ Falló')}`);

if (allFilesExist) {
  console.log(chalk.green('🎉 IMPLEMENTACIÓN DE FASE 4 EXITOSA'));
  console.log('Los componentes del Bot de Telegram están correctamente estructurados.');
  console.log('\nPara probar funcionalidad completa:');
  console.log('1. Ejecuta el bot con: npm run dev:bot');
  console.log('2. Interactúa con el bot en Telegram');
} else {
  console.log(chalk.red('❌ LA IMPLEMENTACIÓN DE FASE 4 REQUIERE CORRECCIONES'));
  console.log('Revisa los errores reportados y corrige los problemas.');
}