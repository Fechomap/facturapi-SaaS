#!/usr/bin/env node

// scripts/audit-env.js - Script para auditar variables de entorno
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Variables encontradas en tu .env actual
const ENV_VARIABLES = [
  'NODE_ENV',
  'DATABASE_URL',
  'REDIS_URL',
  'API_BASE_URL',
  'FACTURAPI_USER_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'JWT_SECRET',
  // NOTA: Variables CLIENTE_* removidas - sistema multitenant
  'ADMIN_CHAT_IDS',
  'TELEGRAM_AUTHORIZED_USERS',
  'SESSION_EXPIRY',
  'PORT',
  'IS_RAILWAY',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_PUBLIC_DOMAIN'
];

// Archivos a ignorar
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.env',
  'logs'
];

// Función para verificar si un archivo debe ser ignorado
function shouldIgnoreFile(filePath) {
  return IGNORE_PATTERNS.some(pattern => filePath.includes(pattern));
}

// Función para buscar archivos JavaScript/TypeScript recursivamente
function findJSFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (shouldIgnoreFile(filePath)) {
      return;
    }
    
    if (stat.isDirectory()) {
      findJSFiles(filePath, fileList);
    } else if (file.match(/\.(js|ts|mjs|cjs)$/)) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Función para buscar variables de entorno en el contenido de un archivo
function findEnvVariablesInFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const foundVars = new Set();
    
    ENV_VARIABLES.forEach(varName => {
      // Buscar patrones como process.env.VARIABLE_NAME
      const processEnvPattern = new RegExp(`process\\.env\\.${varName}\\b`, 'g');
      // Buscar patrones como "VARIABLE_NAME" o 'VARIABLE_NAME'
      const stringPattern = new RegExp(`['"\`]${varName}['"\`]`, 'g');
      // Buscar comentarios que mencionen la variable
      const commentPattern = new RegExp(`//.*${varName}|/\\*[^*]*${varName}[^*]*\\*/`, 'g');
      
      if (processEnvPattern.test(content) || 
          stringPattern.test(content) || 
          commentPattern.test(content)) {
        foundVars.add(varName);
      }
    });
    
    return foundVars;
  } catch (error) {
    console.error(`Error leyendo archivo ${filePath}:`, error.message);
    return new Set();
  }
}

// Función principal
function auditEnvironmentVariables() {
  console.log('🔍 Auditando variables de entorno en el proyecto...\n');
  
  const jsFiles = findJSFiles(projectRoot);
  const variableUsage = new Map();
  
  // Inicializar contador para cada variable
  ENV_VARIABLES.forEach(varName => {
    variableUsage.set(varName, { files: [], count: 0 });
  });
  
  // Buscar en cada archivo
  jsFiles.forEach(filePath => {
    const relativePath = path.relative(projectRoot, filePath);
    const foundVars = findEnvVariablesInFile(filePath);
    
    foundVars.forEach(varName => {
      const usage = variableUsage.get(varName);
      usage.files.push(relativePath);
      usage.count++;
    });
  });
  
  // Separar variables usadas y no usadas
  const usedVariables = [];
  const unusedVariables = [];
  
  variableUsage.forEach((usage, varName) => {
    if (usage.count > 0) {
      usedVariables.push({ name: varName, ...usage });
    } else {
      unusedVariables.push(varName);
    }
  });
  
  // Mostrar resultados
  console.log('✅ VARIABLES DE ENTORNO USADAS:');
  console.log('═'.repeat(50));
  
  usedVariables
    .sort((a, b) => b.count - a.count)
    .forEach(({ name, files, count }) => {
      console.log(`\n📍 ${name} (${count} referencias)`);
      files.forEach(file => console.log(`   └─ ${file}`));
    });
  
  if (unusedVariables.length > 0) {
    console.log('\n\n❌ VARIABLES DE ENTORNO NO USADAS:');
    console.log('═'.repeat(50));
    unusedVariables.forEach(varName => {
      console.log(`   • ${varName}`);
    });
  }
  
  // Recomendaciones
  console.log('\n\n💡 RECOMENDACIONES:');
  console.log('═'.repeat(50));
  
  const criticalVars = usedVariables.filter(v => v.count >= 5);
  if (criticalVars.length > 0) {
    console.log('\n🔴 Variables críticas (muy usadas):');
    criticalVars.forEach(v => console.log(`   • ${v.name} (${v.count} usos)`));
  }
  
  if (unusedVariables.length > 0) {
    console.log('\n🗑️  Variables que puedes eliminar del .env:');
    unusedVariables.forEach(varName => console.log(`   • ${varName}`));
  }
  
  const optionalVars = ['API_BASE_URL', 'PORT', 'SESSION_EXPIRY'];
  const foundOptional = usedVariables.filter(v => optionalVars.includes(v.name));
  if (foundOptional.length > 0) {
    console.log('\n⚠️  Variables opcionales (tienen valores por defecto):');
    foundOptional.forEach(v => console.log(`   • ${v.name}`));
  }
  
  console.log('\n📊 RESUMEN:');
  console.log(`   Total de variables verificadas: ${ENV_VARIABLES.length}`);
  console.log(`   Variables usadas: ${usedVariables.length}`);
  console.log(`   Variables no usadas: ${unusedVariables.length}`);
  console.log(`   Archivos analizados: ${jsFiles.length}`);
  
  console.log('\n✨ Auditoría completada!');
}

// Ejecutar la auditoría
auditEnvironmentVariables();
