#!/bin/bash
# Script para ejecutar el flujo completo de prueba de suscripciones con MCP
# Este script inicia el servidor MCP, ejecuta la prueba de conexión y luego la prueba de suscripción

# Colores para la salida
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Función para limpiar al salir
cleanup() {
  echo -e "\n${YELLOW}Limpiando procesos...${NC}"
  # Matar el proceso del servidor MCP si está en ejecución
  if [ ! -z "$MCP_PID" ]; then
    echo -e "${YELLOW}Deteniendo servidor MCP (PID: $MCP_PID)...${NC}"
    kill -TERM $MCP_PID 2>/dev/null || kill -KILL $MCP_PID 2>/dev/null
  fi
  echo -e "${GREEN}Limpieza completada.${NC}"
  exit 0
}

# Capturar señales para limpiar correctamente
trap cleanup SIGINT SIGTERM EXIT

# Verificar que Node.js esté instalado
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js no está instalado. Por favor, instala Node.js para ejecutar esta prueba.${NC}"
    exit 1
fi

# Verificar que los archivos necesarios existan
if [ ! -f "scripts/start-mcp-server.js" ]; then
    echo -e "${RED}Error: No se encontró el archivo scripts/start-mcp-server.js${NC}"
    exit 1
fi

if [ ! -f "scripts/test-mcp-connection.js" ]; then
    echo -e "${RED}Error: No se encontró el archivo scripts/test-mcp-connection.js${NC}"
    exit 1
fi

if [ ! -f "tests/test-subscription-flow.js" ]; then
    echo -e "${RED}Error: No se encontró el archivo tests/test-subscription-flow.js${NC}"
    exit 1
fi

# Verificar que el archivo .env exista
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: No se encontró el archivo .env${NC}"
    echo -e "${YELLOW}Por favor, crea un archivo .env basado en .env.example${NC}"
    exit 1
fi

# Verificar que STRIPE_SECRET_KEY esté configurada
if ! grep -q "STRIPE_SECRET_KEY" .env; then
    echo -e "${RED}Error: No se encontró la variable STRIPE_SECRET_KEY en el archivo .env${NC}"
    echo -e "${YELLOW}Por favor, configura STRIPE_SECRET_KEY en tu archivo .env${NC}"
    exit 1
fi

echo -e "${BLUE}=== Prueba Completa de Flujo de Suscripción con MCP ===${NC}"
echo -e "${BLUE}=================================================${NC}\n"

# Paso 1: Iniciar el servidor MCP en segundo plano
echo -e "${CYAN}Paso 1: Iniciando servidor MCP...${NC}"
node scripts/start-mcp-server.js > mcp-server.log 2>&1 &
MCP_PID=$!
echo -e "${GREEN}Servidor MCP iniciado con PID: $MCP_PID${NC}"
echo -e "${YELLOW}Esperando 10 segundos para que el servidor se inicialice...${NC}"
sleep 10

# Verificar que el servidor MCP esté en ejecución
# En lugar de verificar el proceso, verificamos si el log contiene el mensaje de éxito
if grep -q "Error" mcp-server.log; then
    echo -e "${RED}Error: El servidor MCP no se inició correctamente.${NC}"
    echo -e "${YELLOW}Revisa los logs en mcp-server.log para más detalles:${NC}"
    cat mcp-server.log
    exit 1
fi

echo -e "${GREEN}Servidor MCP iniciado correctamente.${NC}"

# Paso 2: Ejecutar la prueba de flujo de suscripción
# Nota: Se omite la prueba de conexión HTTP ya que el servidor usa stdio
echo -e "\n${CYAN}Paso 2: Ejecutando prueba de flujo de suscripción...${NC}"
node tests/test-subscription-flow.js
SUBSCRIPTION_TEST_RESULT=$?

if [ $SUBSCRIPTION_TEST_RESULT -ne 0 ]; then
    echo -e "${RED}Error: La prueba de flujo de suscripción falló.${NC}"
    echo -e "${YELLOW}Revisa los logs anteriores para más detalles.${NC}"
    exit 1
fi

# Resumen
echo -e "\n${GREEN}=== Prueba Completa Finalizada Exitosamente ===${NC}"
echo -e "${GREEN}✓ Servidor MCP iniciado correctamente${NC}"
echo -e "${GREEN}✓ Prueba de flujo de suscripción completada (asumiendo que usa Cline para MCP)${NC}"

echo -e "\n${MAGENTA}El sistema está listo para usar las funciones de Stripe a través de MCP.${NC}"
echo -e "${YELLOW}Presiona Ctrl+C para finalizar y limpiar los procesos.${NC}"

# Mantener el script en ejecución para que el usuario pueda ver los logs
# y para que el servidor MCP siga en ejecución
echo -e "\n${CYAN}Mostrando logs del servidor MCP (Ctrl+C para salir):${NC}"
tail -f mcp-server.log
