#!/usr/bin/env node
/**
 * Script para iniciar el servidor MCP de Stripe
 * 
 * Este script inicia el servidor MCP de Stripe utilizando npx.
 * Configura automáticamente la API key de Stripe desde las variables de entorno.
 * 
 * Uso:
 *   node scripts/start-mcp-server.js
 *   
 * O después de hacerlo ejecutable (chmod +x scripts/start-mcp-server.js):
 *   ./scripts/start-mcp-server.js
 */

import dotenv from 'dotenv';
import { spawn } from 'child_process';
import readline from 'readline';

// Cargar variables de entorno
dotenv.config();

// Colores para la salida
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

// Obtener la API key de Stripe
const stripeApiKey = process.env.STRIPE_SECRET_KEY;

if (!stripeApiKey) {
  console.error(`${colors.red}Error: No se encontró la variable de entorno STRIPE_SECRET_KEY${colors.reset}`);
  console.error(`${colors.yellow}Por favor, configura esta variable en tu archivo .env o pásala como argumento:${colors.reset}`);
  console.error(`${colors.yellow}STRIPE_SECRET_KEY=sk_test_xxx node scripts/start-mcp-server.js${colors.reset}`);
  process.exit(1);
}

// Configurar argumentos adicionales
const additionalArgs = process.argv.slice(2);
const defaultArgs = ['--tools=all'];

// Combinar argumentos
const args = [...defaultArgs, `--api-key=${stripeApiKey}`, ...additionalArgs];

// Mostrar comando completo para depuración (ocultando la API key)
const debugCommand = `npx -y @stripe/mcp ${defaultArgs.join(' ')} --api-key=sk_test_****** ${additionalArgs.join(' ')}`;
console.log(`${colors.cyan}Comando a ejecutar: ${debugCommand}${colors.reset}`);

console.log(`${colors.blue}=== Iniciando Servidor MCP de Stripe ===${colors.reset}\n`);
console.log(`${colors.cyan}Configuración:${colors.reset}`);
console.log(`- API Key: ${stripeApiKey.substring(0, 7)}...${stripeApiKey.substring(stripeApiKey.length - 4)}`);
console.log(`- Argumentos: ${defaultArgs.join(' ')}`);
if (additionalArgs.length > 0) {
  console.log(`- Argumentos adicionales: ${additionalArgs.join(' ')}`);
}
console.log();

// Crear el proceso
console.log(`${colors.yellow}Iniciando servidor...${colors.reset}`);
const mcpProcess = spawn('npx', ['-y', '@stripe/mcp', ...args], {
  stdio: ['inherit', 'pipe', 'pipe'],
  // Asegurarse de que el proceso se inicie correctamente
  detached: false,
  windowsHide: true
});

// Verificar que el proceso se haya iniciado correctamente
if (!mcpProcess.pid) {
  console.error(`${colors.red}Error: No se pudo iniciar el servidor MCP${colors.reset}`);
  process.exit(1);
}

// Crear interfaces de readline para stdout y stderr
const stdoutReader = readline.createInterface({
  input: mcpProcess.stdout,
  terminal: false
});

const stderrReader = readline.createInterface({
  input: mcpProcess.stderr,
  terminal: false
});

// Procesar la salida estándar
stdoutReader.on('line', (line) => {
  // Colorear la salida según el contenido
  if (line.includes('error') || line.includes('Error')) {
    console.log(`${colors.red}${line}${colors.reset}`);
  } else if (line.includes('warn') || line.includes('Warning')) {
    console.log(`${colors.yellow}${line}${colors.reset}`);
  } else if (line.includes('info')) {
    console.log(`${colors.cyan}${line}${colors.reset}`);
  } else if (line.includes('success') || line.includes('ready') || line.includes('started')) {
    console.log(`${colors.green}${line}${colors.reset}`);
  } else {
    console.log(line);
  }
});

// Procesar la salida de error
stderrReader.on('line', (line) => {
  console.error(`${colors.red}${line}${colors.reset}`);
});

// Manejar la finalización del proceso
mcpProcess.on('close', (code) => {
  if (code === 0) {
    console.log(`\n${colors.green}Servidor MCP finalizado correctamente${colors.reset}`);
  } else {
    console.error(`\n${colors.red}Servidor MCP finalizado con código de error: ${code}${colors.reset}`);
  }
});

// Manejar errores del proceso
mcpProcess.on('error', (err) => {
  console.error(`${colors.red}Error al iniciar el servidor MCP: ${err.message}${colors.reset}`);
  process.exit(1);
});

// Manejar señales de terminación
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}Recibida señal SIGINT. Deteniendo servidor MCP...${colors.reset}`);
  mcpProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log(`\n${colors.yellow}Recibida señal SIGTERM. Deteniendo servidor MCP...${colors.reset}`);
  mcpProcess.kill('SIGTERM');
});

// Mostrar mensaje de ayuda
console.log(`\n${colors.magenta}Servidor MCP iniciado. Presiona Ctrl+C para detener.${colors.reset}`);
console.log(`${colors.magenta}El servidor estará disponible en http://localhost:3000/mcp${colors.reset}`);
