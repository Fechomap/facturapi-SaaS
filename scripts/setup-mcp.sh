#!/bin/bash
# Script para configurar el entorno MCP de Stripe
# Este script instala las dependencias necesarias y configura el entorno para usar MCP

# Colores para la salida
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Configuración del Entorno MCP de Stripe ===${NC}"
echo -e "${BLUE}=========================================${NC}\n"

# Verificar que Node.js esté instalado
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js no está instalado. Por favor, instala Node.js v18 o superior.${NC}"
    exit 1
fi

# Verificar la versión de Node.js
NODE_VERSION=$(node -v | cut -d 'v' -f 2)
NODE_MAJOR_VERSION=$(echo $NODE_VERSION | cut -d '.' -f 1)
if [ $NODE_MAJOR_VERSION -lt 18 ]; then
    echo -e "${RED}Error: Se requiere Node.js v18 o superior. Versión actual: $NODE_VERSION${NC}"
    echo -e "${YELLOW}Por favor, actualiza Node.js a una versión más reciente.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js v$NODE_VERSION detectado${NC}"

# Verificar que npm esté instalado
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm no está instalado.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ npm detectado${NC}"

# Verificar que el archivo .env exista
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Advertencia: No se encontró el archivo .env${NC}"
    echo -e "${YELLOW}Creando archivo .env basado en .env.example...${NC}"
    
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}✓ Archivo .env creado${NC}"
    else
        echo -e "${RED}Error: No se encontró el archivo .env.example${NC}"
        exit 1
    fi
fi

# Verificar que STRIPE_SECRET_KEY esté configurada
if ! grep -q "STRIPE_SECRET_KEY" .env || grep -q "STRIPE_SECRET_KEY=\s*$" .env; then
    echo -e "${YELLOW}Advertencia: STRIPE_SECRET_KEY no está configurada en .env${NC}"
    echo -e "${YELLOW}Por favor, configura STRIPE_SECRET_KEY en tu archivo .env antes de usar MCP${NC}"
fi

# Instalar dependencias del proyecto
echo -e "\n${CYAN}Instalando dependencias del proyecto...${NC}"
npm install
echo -e "${GREEN}✓ Dependencias del proyecto instaladas${NC}"

# Instalar el servidor MCP de Stripe globalmente
echo -e "\n${CYAN}Instalando el servidor MCP de Stripe...${NC}"
npm install -g @stripe/mcp
echo -e "${GREEN}✓ Servidor MCP de Stripe instalado${NC}"

# Verificar que los scripts necesarios existan
echo -e "\n${CYAN}Verificando scripts necesarios...${NC}"
MISSING_FILES=0

if [ ! -f "scripts/start-mcp-server.js" ]; then
    echo -e "${RED}Error: No se encontró el archivo scripts/start-mcp-server.js${NC}"
    MISSING_FILES=1
fi

if [ ! -f "scripts/test-mcp-connection.js" ]; then
    echo -e "${RED}Error: No se encontró el archivo scripts/test-mcp-connection.js${NC}"
    MISSING_FILES=1
fi

if [ ! -f "lib/mcpClient.js" ]; then
    echo -e "${RED}Error: No se encontró el archivo lib/mcpClient.js${NC}"
    MISSING_FILES=1
fi

if [ $MISSING_FILES -eq 0 ]; then
    echo -e "${GREEN}✓ Todos los scripts necesarios están presentes${NC}"
else
    echo -e "${RED}Error: Faltan algunos archivos necesarios. Por favor, verifica la instalación.${NC}"
    exit 1
fi

# Hacer ejecutables los scripts de shell
echo -e "\n${CYAN}Haciendo ejecutables los scripts de shell...${NC}"
chmod +x scripts/start-mcp-server.js
chmod +x scripts/run-full-test.sh
echo -e "${GREEN}✓ Scripts de shell ahora son ejecutables${NC}"

# Resumen
echo -e "\n${GREEN}=== Configuración Completada Exitosamente ===${NC}"
echo -e "${GREEN}✓ Node.js y npm verificados${NC}"
echo -e "${GREEN}✓ Dependencias instaladas${NC}"
echo -e "${GREEN}✓ Servidor MCP instalado${NC}"
echo -e "${GREEN}✓ Scripts configurados${NC}"

echo -e "\n${MAGENTA}Para iniciar el servidor MCP:${NC}"
echo -e "  ${CYAN}npm run start:mcp${NC}"

echo -e "\n${MAGENTA}Para probar la conexión con el servidor MCP:${NC}"
echo -e "  ${CYAN}npm run test:mcp${NC}"

echo -e "\n${MAGENTA}Para ejecutar la prueba completa:${NC}"
echo -e "  ${CYAN}npm run test:full${NC}"

echo -e "\n${MAGENTA}Para más información, consulta:${NC}"
echo -e "  ${CYAN}README-MCP-STRIPE.md${NC}"
echo -e "  ${CYAN}docs/mcp-stripe-integration.md${NC}"
