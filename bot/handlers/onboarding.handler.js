// bot/handlers/onboarding.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import prisma from '../../lib/prisma.js';
import { config } from '../../config/index.js';
import { encryptApiKey } from '../../core/utils/encryption.js';
import TenantService from '../../core/tenant/tenant.service.js';
import CustomerSetupService from '../../services/customer-setup.service.js';


// Estados del proceso de registro
const RegistrationState = {
  // Fase 1: Creación de organización
  CREATE_ORGANIZATION: 'org_create',
  
  // Fase 2: Registro de empresa (datos básicos)
  BUSINESS_NAME: 'reg_business_name',
  RFC: 'reg_rfc',
  EMAIL: 'reg_email',
  PHONE: 'reg_phone',
  CONTACT_NAME: 'reg_contact_name',
  
  // Fase 3: Datos adicionales para FacturAPI
  TAX_SYSTEM: 'reg_tax_system',
  ZIP: 'reg_zip',
  NAME: 'reg_name',
  ADDRESS_STREET: 'reg_addr_street',
  ADDRESS_EXTERIOR: 'reg_addr_exterior',
  ADDRESS_INTERIOR: 'reg_addr_interior',
  ADDRESS_NEIGHBORHOOD: 'reg_addr_neighborhood',
  ADDRESS_CITY: 'reg_addr_city',
  ADDRESS_MUNICIPALITY: 'reg_addr_municipality',
  ADDRESS_STATE: 'reg_addr_state',
  
  // Confirmación final
  CONFIRM: 'reg_confirm'
};

/**
 * Crea una organización en FacturAPI
 * @param {string} name - Nombre de la organización
 * @returns {Promise<Object>} - Datos de la organización creada
 */
async function createFacturapiOrganization(name) {
  const FACTURAPI_USER_KEY = process.env.FACTURAPI_USER_KEY;
  if (!FACTURAPI_USER_KEY) {
    throw new Error('FACTURAPI_USER_KEY no está configurada en las variables de entorno');
  }

  console.log(`Intentando crear organización con nombre: "${name}"`);
  console.log(`Usando FACTURAPI_USER_KEY: ${FACTURAPI_USER_KEY.substring(0, 10)}...`);

  try {
    const response = await axios.post('https://www.facturapi.io/v2/organizations', 
      { name }, 
      {
        headers: {
          'Authorization': `Bearer ${FACTURAPI_USER_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Verificar que la respuesta contenga un ID
    if (!response.data || !response.data.id) {
      console.error('Respuesta incompleta de FacturAPI:', response.data);
      throw new Error('La respuesta de FacturAPI no contiene un ID de organización válido');
    }
    
    console.log(`Organización creada exitosamente: ${JSON.stringify(response.data)}`);
    console.log(`ID de organización: ${response.data.id}`);
    
    return response.data;
  } catch (error) {
    console.error('Error al crear organización en FacturAPI:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Datos:', error.response.data);
    } else if (error.request) {
      console.error('No se recibió respuesta del servidor');
    } else {
      console.error('Error:', error.message);
    }
    throw error;
  }
}

/**
 * Registra los manejadores para el proceso de onboarding
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerOnboardingHandler(bot) {
  // Acción para iniciar la creación de organización
  bot.action('create_organization', async (ctx) => {
    await ctx.answerCbQuery();
    console.log("Botón de creación de organización presionado. Estado actual:", ctx.userState);
    
    // Asegurar que userState existe
    ctx.userState = ctx.userState || {};
    
    // Iniciar el proceso de creación de organización
    ctx.userState.organizationData = {};
    ctx.userState.esperando = RegistrationState.CREATE_ORGANIZATION;
    
    if (!process.env.FACTURAPI_USER_KEY) {
      return ctx.reply(
        '❌ Error de configuración: La clave de usuario de FacturAPI no está configurada.\n\n' +
        'Por favor, contacta al administrador del sistema.',
        { parse_mode: 'Markdown' }
      );
    }
    
    ctx.reply(
      '📝 *Creación de Organización en FacturAPI*\n\n' +
      'Para comenzar, por favor ingresa el nombre comercial de la organización:',
      { parse_mode: 'Markdown' }
    );
  });

  // Acción para iniciar el registro
  bot.action('start_registration', async (ctx) => {
    await ctx.answerCbQuery();
    console.log("Botón de registro presionado. Estado actual:", ctx.userState);
    
    // Asegurar que userState existe
    ctx.userState = ctx.userState || {};
    
    // Verificar si ya hay una organización creada
    if (!ctx.userState.facturapiOrganizationId) {
      return ctx.reply(
        '❌ Primero debes crear una organización en FacturAPI.\n\n' +
        'Por favor, usa el botón "Crear organización" primero.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')]
        ])
      );
    }
    
    // Iniciar el proceso de registro
    ctx.userState.registrationData = {
      facturapiOrganizationId: ctx.userState.facturapiOrganizationId
    };
    ctx.userState.esperando = RegistrationState.BUSINESS_NAME;
    
    ctx.reply(
      '¡Bienvenido al proceso de registro!\n\n' +
      'Para comenzar, por favor ingresa el nombre fiscal de tu empresa (Razón Social):'
    );
  });

  // Por compatibilidad mantenemos el comando, pero se recomienda usar el botón
  bot.command('registro', (ctx) => {
    console.log("Comando registro recibido. Estado actual:", ctx.userState);

    // Asegurar que userState existe
    ctx.userState = ctx.userState || {};
    
    // Verificar si ya hay una organización creada
    if (!ctx.userState.facturapiOrganizationId) {
      return ctx.reply(
        '❌ Primero debes crear una organización en FacturAPI.\n\n' +
        'Por favor, usa el botón "Crear organización" primero.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')]
        ])
      );
    }
    
    // Ahora es seguro asignar propiedades
    ctx.userState.registrationData = {
      facturapiOrganizationId: ctx.userState.facturapiOrganizationId
    };
    ctx.userState.esperando = RegistrationState.BUSINESS_NAME;
    
    ctx.reply(
      '¡Bienvenido al proceso de registro!\n\n' +
      'Para comenzar, por favor ingresa el nombre fiscal de tu empresa (Razón Social):'
    );
  });

  // Procesar el nombre de la organización
  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    console.log(`Mensaje recibido: "${text}"`);
    console.log(`Estado actual: ${JSON.stringify(ctx.userState)}`);
    
    // Si no estamos en proceso de registro o creación de organización, pasar al siguiente manejador
    if (!ctx.userState || !ctx.userState.esperando) {
      console.log("No hay estado de espera, pasando al siguiente manejador");
      return next();
    }
    
    if (ctx.userState.esperando === RegistrationState.CREATE_ORGANIZATION) {
      console.log("Procesando nombre de organización");
      
      if (text.length < 3) {
        return ctx.reply('El nombre de la organización debe tener al menos 3 caracteres. Inténtalo de nuevo:');
      }
      
      await ctx.reply('⏳ Creando organización en FacturAPI, por favor espera...');
      
      try {
        // Crear la organización usando la función separada
        const organization = await createFacturapiOrganization(text);
        
        // Guardar el ID de la organización en el estado del usuario
        const organizationId = organization.id;
        ctx.userState.facturapiOrganizationId = organizationId;
        
        console.log(`Organización creada con ID: ${organizationId}`);
        
        await ctx.reply(
          `✅ *¡Organización creada exitosamente!*\n\n` +
          `Nombre: *${text}*\n` +
          `ID: \`${organizationId}\`\n\n` +
          `Si deseas continuar para realizar pruebas de facturación, registra tu empresa.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📝 Registrar mi empresa', 'start_registration')]
            ])
          }
        );
      } catch (error) {
        console.error("Error al crear organización en FacturAPI:", error.response?.data || error.message);
        
        const errorMessage = error.response?.data?.message || error.message;
        
        await ctx.reply(
          `❌ Error al crear la organización: ${errorMessage}\n\n` +
          `Por favor, intenta de nuevo o contacta a soporte.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Volver', 'back_to_start')]
          ])
        );
      }
      
      return; // Detener el procesamiento
    }
    
    // Si es parte del proceso de registro, pero no es creación de organización, pasar al siguiente
    if (!ctx.userState.esperando.startsWith('reg_')) {
      console.log("No es parte del proceso de registro, pasando al siguiente manejador");
      return next();
    }
    
    console.log(`Procesando mensaje en el flujo: estado=${ctx.userState.esperando}`);
    
    // Si el usuario escribe "cancelar" en cualquier momento, se cancela el proceso
    if (text.toLowerCase() === 'cancelar') {
      delete ctx.userState.registrationData;
      delete ctx.userState.organizationData;
      delete ctx.userState.esperando;
      
      await ctx.reply(
        'Proceso cancelado. Puedes iniciarlo nuevamente usando los botones del menú principal.',
        Markup.inlineKeyboard([[Markup.button.callback('Volver al menú', 'menu_principal')]])
      );
      return; // Importante: terminar aquí
    }
  
    // Procesar según el estado actual
    switch (ctx.userState.esperando) {
      case RegistrationState.BUSINESS_NAME:
        console.log("Procesando nombre de empresa");
        if (text.length < 3) {
          await ctx.reply('El nombre de la empresa debe tener al menos 3 caracteres. Inténtalo de nuevo:');
        } else {
          // Guardar el nombre y actualizar estado
          ctx.userState.registrationData.businessName = text;
          ctx.userState.esperando = RegistrationState.RFC;
          
          console.log(`Nombre registrado: "${text}". Nuevo estado: ${ctx.userState.esperando}`);
          
          await ctx.reply(
            '✅ Nombre registrado correctamente.\n\n' +
            'Ahora, ingresa el RFC de tu empresa (debe ser válido para facturación):'
          );
        }
        break;
        
      case RegistrationState.RFC:
        console.log("Procesando RFC");
        // Validación simple de RFC
        if (!validateRfc(text)) {
          await ctx.reply(
            '❌ El RFC ingresado no es válido. Debe tener el formato correcto para personas físicas (13 caracteres) o morales (12 caracteres).\n\n' +
            'Por favor, intenta nuevamente:'
          );
          break;
        }
        
        try {
          // Verificar si ya existe un tenant con ese RFC
          const existingTenant = await TenantService.findTenantByRfc(text.toUpperCase());
          if (existingTenant) {
            await ctx.reply(
              '❌ Ya existe una empresa registrada con ese RFC. Si eres parte de esta empresa, solicita una invitación al administrador.\n\n' +
              'Si crees que es un error, por favor contacta a soporte.\n\n' +
              'Ingresa un RFC diferente o escribe "cancelar" para salir:'
            );
            break;
          }
          
          // RFC válido, guardar y continuar
          ctx.userState.registrationData.rfc = text.toUpperCase();
          ctx.userState.esperando = RegistrationState.EMAIL;
          
          console.log(`RFC registrado: "${text.toUpperCase()}". Nuevo estado: ${ctx.userState.esperando}`);
          
          await ctx.reply(
            '✅ RFC registrado correctamente.\n\n' +
            'Ahora, ingresa el correo electrónico principal de tu empresa:'
          );
        } catch (error) {
          console.error("Error al verificar RFC:", error);
          await ctx.reply('❌ Ocurrió un error al verificar el RFC. Por favor, intenta nuevamente.');
        }
        break;
        
      case RegistrationState.EMAIL:
        console.log("Procesando email");
        if (!validateEmail(text)) {
          await ctx.reply(
            '❌ El correo electrónico no es válido. Por favor, ingresa una dirección de correo válida:'
          );
          break;
        }
        
        // Email válido, guardar y continuar
        ctx.userState.registrationData.email = text;
        ctx.userState.esperando = RegistrationState.PHONE;
        
        console.log(`Email registrado: "${text}". Nuevo estado: ${ctx.userState.esperando}`);
        
        await ctx.reply(
          '✅ Correo registrado correctamente.\n\n' +
          'Ahora, ingresa un número telefónico de contacto (opcional, puedes escribir "N/A" para omitir):'
        );
        break;
        
      case RegistrationState.PHONE:
        console.log("Procesando teléfono");
        if (text.toLowerCase() !== 'n/a' && !validatePhone(text)) {
          await ctx.reply(
            '❌ El número telefónico no es válido. Debe tener al menos 10 dígitos.\n\n' +
            'Inténtalo nuevamente o escribe "N/A" para omitir este paso:'
          );
          break;
        }
        
        // Teléfono válido, guardar y continuar
        ctx.userState.registrationData.phone = text.toLowerCase() === 'n/a' ? null : text;
        ctx.userState.esperando = RegistrationState.CONTACT_NAME;
        
        console.log(`Teléfono registrado: "${text}". Nuevo estado: ${ctx.userState.esperando}`);
        
        await ctx.reply(
          '✅ Teléfono registrado correctamente.\n\n' +
          'Por último, ingresa el nombre completo de la persona de contacto principal:'
        );
        break;
        
      case RegistrationState.CONTACT_NAME:
        console.log("Procesando nombre de contacto");
        if (text.length < 3) {
          await ctx.reply(
            '❌ El nombre de contacto debe tener al menos 3 caracteres. Inténtalo de nuevo:'
          );
          break;
        }
        
        // Nombre de contacto válido, guardar y continuar a los datos fiscales
        ctx.userState.registrationData.contactName = text;
        ctx.userState.esperando = RegistrationState.ZIP;
        
        console.log(`Nombre de contacto registrado: "${text}". Nuevo estado: ${ctx.userState.esperando}`);
        
        await ctx.reply(
          '✅ Nombre de contacto registrado correctamente.\n\n' +
          'Ahora necesitamos algunos datos fiscales adicionales para completar tu registro.\n\n' +
          'Por favor, ingresa el código postal de tu empresa (5 dígitos):'
        );
        break;

      case RegistrationState.ZIP:
        console.log("Procesando código postal");
        if (!validateZip(text)) {
          await ctx.reply(
            '❌ El código postal no es válido. Debe tener 5 dígitos.\n\n' +
            'Por favor, intenta nuevamente:'
          );
          break;
        }
        
        // Guardar el código postal y continuar
        ctx.userState.registrationData.zip = text;
        ctx.userState.esperando = RegistrationState.NAME;
        
        await ctx.reply(
          '✅ Código postal registrado correctamente.\n\n' +
          'Ahora, ingresa el nombre comercial de tu empresa (puede ser diferente al nombre fiscal, opcional):'
        );
        break;
      // Añadir después del case RegistrationState.ZIP:
      case RegistrationState.NAME:
        console.log("Procesando nombre comercial");
        // Guardar el nombre comercial 
        ctx.userState.registrationData.name = text;
        ctx.userState.esperando = RegistrationState.ADDRESS_STREET;
        
        console.log(`Nombre comercial registrado: "${text}". Nuevo estado: ${ctx.userState.esperando}`);
        
        await ctx.reply(
          '✅ Nombre comercial registrado correctamente.\n\n' +
          'Ahora, ingresa la calle de la dirección fiscal:'
        );
        break;

      case RegistrationState.ADDRESS_STREET:
        console.log("Procesando calle");
        // Guardar la calle
        ctx.userState.registrationData.street = text;
        ctx.userState.esperando = RegistrationState.ADDRESS_EXTERIOR;
        
        await ctx.reply(
          '✅ Calle registrada correctamente.\n\n' +
          'Ahora, ingresa el número exterior:'
        );
        break;

      case RegistrationState.ADDRESS_EXTERIOR:
        console.log("Procesando número exterior");
        // Guardar el número exterior
        ctx.userState.registrationData.exterior = text;
        ctx.userState.esperando = RegistrationState.ADDRESS_INTERIOR;
        
        await ctx.reply(
          '✅ Número exterior registrado correctamente.\n\n' +
          'Ahora, ingresa el número interior (o escribe "N/A" si no aplica):'
        );
        break;

      case RegistrationState.ADDRESS_INTERIOR:
        console.log("Procesando número interior");
        // Guardar el número interior
        ctx.userState.registrationData.interior = text.toLowerCase() === 'n/a' ? '' : text;
        ctx.userState.esperando = RegistrationState.ADDRESS_NEIGHBORHOOD;
        
        await ctx.reply(
          '✅ Número interior registrado correctamente.\n\n' +
          'Ahora, ingresa la colonia:'
        );
        break;

      case RegistrationState.ADDRESS_NEIGHBORHOOD:
        console.log("Procesando colonia");
        // Guardar la colonia
        ctx.userState.registrationData.neighborhood = text;
        ctx.userState.esperando = RegistrationState.ADDRESS_CITY;
        
        await ctx.reply(
          '✅ Colonia registrada correctamente.\n\n' +
          'Ahora, ingresa la ciudad:'
        );
        break;

      case RegistrationState.ADDRESS_CITY:
        console.log("Procesando ciudad");
        // Guardar la ciudad
        ctx.userState.registrationData.city = text;
        ctx.userState.esperando = RegistrationState.ADDRESS_MUNICIPALITY;
        
        await ctx.reply(
          '✅ Ciudad registrada correctamente.\n\n' +
          'Ahora, ingresa el municipio o alcaldía:'
        );
        break;

      case RegistrationState.ADDRESS_MUNICIPALITY:
        console.log("Procesando municipio");
        // Guardar el municipio
        ctx.userState.registrationData.municipality = text;
        ctx.userState.esperando = RegistrationState.ADDRESS_STATE;
        
        await ctx.reply(
          '✅ Municipio registrado correctamente.\n\n' +
          'Ahora, ingresa el estado:'
        );
        break;

      case RegistrationState.ADDRESS_STATE:
        console.log("Procesando estado");
        // Guardar el estado
        ctx.userState.registrationData.state = text;
        ctx.userState.esperando = RegistrationState.CONFIRM;
        
        // Preparar mensaje de confirmación con todos los datos
        const data = ctx.userState.registrationData;
        const confirmationMessage = 
          `📋 *Resumen de datos ingresados*\n\n` +
          `*Datos principales*\n` +
          `• Nombre fiscal: ${data.businessName}\n` +
          `• RFC: ${data.rfc}\n` +
          `• Email: ${data.email}\n` +
          `• Teléfono: ${data.phone || 'No especificado'}\n` +
          `• Contacto: ${data.contactName}\n\n` +
          
          `*Datos de dirección*\n` +
          `• CP: ${data.zip}\n` +
          `• Nombre comercial: ${data.name || data.businessName}\n` +
          `• Calle: ${data.street}\n` +
          `• Exterior: ${data.exterior}\n` +
          `• Interior: ${data.interior || 'N/A'}\n` +
          `• Colonia: ${data.neighborhood}\n` +
          `• Ciudad: ${data.city}\n` +
          `• Municipio: ${data.municipality}\n` +
          `• Estado: ${data.state}\n\n` +
          
          `¿Los datos son correctos? Confirma para finalizar el registro.`;
        
        await ctx.reply(
          confirmationMessage,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Confirmar Registro', 'confirm_registration')],
              [Markup.button.callback('❌ Cancelar', 'cancel_registration')]
            ])
          }
        );
        break;
      // Continuar procesando el resto de los campos...
      
      default:
        // Si llega aquí, posiblemente sea otro tipo de mensaje que debe manejar otro handler
        return next();
    }
  });

  // Confirmar el registro
  bot.action('confirm_registration', async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!ctx.userState || !ctx.userState.registrationData) {
        return ctx.reply(
            '❌ Ha ocurrido un error. La sesión de registro ha expirado. Por favor, inicia nuevamente el registro.',
            Markup.inlineKeyboard([[
                Markup.button.callback('📝 Crear organización', 'create_organization')
            ]])
        );
    }
    
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => {
            console.log('Error al eliminar teclado:', e.message);
        });
        
        await ctx.reply('⏳ Procesando registro, por favor espera...');
        
        const data = ctx.userState.registrationData;
        
        // Obtener el organizationId directamente de ctx.userState
        const organizationId = ctx.userState.facturapiOrganizationId;
        
        if (!organizationId) {
            console.error("No se encontró ID de organización en ctx.userState:", ctx.userState);
            throw new Error('ID de organización no encontrado. Debes crear una organización primero.');
        }
        
        console.log(`Usando organizationId desde ctx.userState: ${organizationId}`);
        
        // Construir objeto de dirección completo
        const address = {
            street: data.street,
            exterior: data.exterior,
            interior: data.interior || "",
            neighborhood: data.neighborhood,
            zip: data.zip,
            city: data.city,
            municipality: data.municipality,
            state: data.state
        };
        
        // Obtener la API Key Test
        let apiKeyTest = null;
        try {
            await ctx.reply('⏳ Obteniendo API Key de pruebas...');
            
            const FACTURAPI_USER_KEY = process.env.FACTURAPI_USER_KEY;
            if (!FACTURAPI_USER_KEY) {
                console.error('Error: FACTURAPI_USER_KEY no está configurada en las variables de entorno');
                throw new Error('Clave de usuario de FacturAPI no configurada');
            }
            
            // Validaciones adicionales
            console.log(`Verificando organizationId antes de obtener API key: "${organizationId}"`);
            
            if (!organizationId || typeof organizationId !== 'string' || organizationId.length < 20) {
                console.error(`ID de organización inválido o sospechoso: "${organizationId}"`);
                throw new Error('El ID de organización parece ser inválido');
            }
            
            console.log(`Intentando obtener API Key para organización: ${organizationId}`);
            console.log(`Usando FACTURAPI_USER_KEY: ${FACTURAPI_USER_KEY.substring(0, 10)}...`);
            
            // Obtener la API key
            const apiKeyResponse = await axios.get(
                `https://www.facturapi.io/v2/organizations/${organizationId}/apikeys/test`,
                {
                    headers: {
                        'Authorization': `Bearer ${FACTURAPI_USER_KEY}`
                    }
                }
            );
            
            // La respuesta debe ser un string directamente
            apiKeyTest = apiKeyResponse.data;
            
            console.log(`API Key Test obtenida: ${apiKeyTest?.substring(0, 8)}...`);
            
            // Verificar que la API key obtenida es válida
            if (!apiKeyTest || typeof apiKeyTest !== 'string' || apiKeyTest.length < 10) {
                console.error('API Key obtenida inválida:', apiKeyTest);
                throw new Error('La API Key obtenida no tiene un formato válido');
            }
            
        } catch (apiKeyError) {
            console.error('Error al obtener API Key Test:', apiKeyError.message);
            
            // Mostrar detalles completos del error
            if (apiKeyError.response) {
                console.error('Status:', apiKeyError.response.status);
                console.error('Datos:', JSON.stringify(apiKeyError.response.data));
            } else if (apiKeyError.request) {
                console.error('No se recibió respuesta del servidor');
            }
            
            return ctx.reply(
                '❌ No se pudo obtener la API Key de pruebas. Esto es necesario para generar facturas.\n\n' +
                `Error: ${apiKeyError.message}\n\n` +
                'Por favor, intenta nuevamente o contacta a soporte técnico.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('↩️ Volver', 'back_to_start')]
                ])
            );
        }
        
        // Usar la API key directamente sin encriptar
        let facturapiApiKey = null;
        if (apiKeyTest) {
            facturapiApiKey = apiKeyTest;
            console.log('API Key preparada correctamente');
        } else {
            throw new Error('No se pudo obtener una API Key válida para este tenant');
        }
        
        // Crear el tenant en el sistema
        await ctx.reply('⏳ Creando registro en base de datos...');
        
        const tenant = await TenantService.createTenant({
            businessName: data.businessName,
            rfc: data.rfc,
            email: data.email,
            phone: data.phone,
            contactName: data.contactName,
            facturapiOrganizationId: organizationId,
            facturapiApiKey: facturapiApiKey, // Usar directamente la API key
            facturapiEnv: 'test',
            address: JSON.stringify(address)
        });
        
        console.log('Tenant creado con ID:', tenant.id, 'y API Key configurada:', !!facturapiApiKey);
        
        // Después de crear el tenant, configurar los datos legales en FacturAPI
        try {
          const facturapIService = await import('../../services/facturapi.service.js').then(m => m.default);
          
          // Construir los datos legales
          const legalData = {
            legal_name: data.businessName,
            tax_id: data.rfc,
            tax_system: "601", // General de Ley Personas Morales
            address: {
              street: data.street,
              exterior: data.exterior,
              interior: data.interior || "",
              neighborhood: data.neighborhood,
              zip: data.zip,
              city: data.city,
              municipality: data.municipality,
              state: data.state,
              country: "MEX"
            },
            phone: data.phone || "",
            email: data.email
          };
          
          await ctx.reply('⏳ Configurando datos fiscales en FacturAPI...');
          await facturapIService.updateOrganizationLegal(organizationId, legalData);
          await ctx.reply('✅ Datos fiscales configurados correctamente');
        } catch (legalError) {
          console.error('Error al configurar datos fiscales:', legalError);
          await ctx.reply('⚠️ Hubo un problema al configurar los datos fiscales. Podrás configurarlos más tarde desde el menú.');
        }
        
        // Crear suscripción de prueba para el tenant
        try {
            await ctx.reply('⏳ Activando período de prueba de 14 días...');
            
            // Obtener el primer plan activo disponible
            const SubscriptionService = await import('../../core/subscription/subscription.service.js').then(m => m.default);
            const plans = await SubscriptionService.getPlans(true);
            
            if (plans && plans.length > 0) {
                // Crear la suscripción usando el primer plan disponible
                const subscription = await SubscriptionService.createSubscription(
                    tenant.id,
                    plans[0].id,
                    { trialDays: 14, status: 'trial' }
                );
                
                console.log(`Suscripción de prueba creada con ID: ${subscription.id}, vence: ${subscription.trialEndsAt}`);
                
                // Informar al usuario
                await ctx.reply(
                    `✅ Período de prueba activado. Tienes 14 días para probar todas las funcionalidades.`
                );
            } else {
                console.error('No se encontraron planes de suscripción activos');
                await ctx.reply(
                    `⚠️ No se pudo activar el período de prueba. Por favor, contacta al administrador.`
                );
            }
        } catch (subscriptionError) {
            console.error('Error al crear suscripción:', subscriptionError);
            await ctx.reply(
                `⚠️ No se pudo activar el período de prueba automáticamente. Esto no afectará tu registro, pero deberás contactar al soporte.`
            );
        }

        // Crear un usuario para el tenant
        await TenantService.createTenantUser({
          tenantId: tenant.id,
          telegramId: ctx.from.id,
          firstName: ctx.from.first_name || 'Usuario',
          lastName: ctx.from.last_name || '',
          username: ctx.from.username || null,
          role: 'admin',
          isAuthorized: true
        });
        
        // Añadir este bloque para configurar los clientes automáticamente
        try {
          await ctx.reply('⏳ Configurando clientes predefinidos...');
          
          const clientSetupResults = await CustomerSetupService.setupPredefinedCustomers(tenant.id, true);
          const successCount = clientSetupResults.filter(r => r.success).length;
          
          if (successCount > 0) {
            await ctx.reply(
              `✅ Se han configurado automáticamente ${successCount} clientes para tu empresa.`
            );
          } else {
            await ctx.reply(
              `⚠️ No se pudieron configurar los clientes automáticamente. Podrás hacerlo manualmente después.`
            );
          }
        } catch (clientError) {
          console.error('Error al configurar clientes predefinidos:', clientError);
          await ctx.reply(
            `⚠️ No se pudieron configurar los clientes automáticamente. Podrás hacerlo manualmente después.`
          );
        }
        
        // Actualizar el estado del usuario con el tenant
        ctx.userState.tenantId = tenant.id;
        ctx.userState.tenantName = tenant.businessName;
        ctx.userState.userStatus = 'authorized';
        ctx.userState.newRegistration = true; // Marcar como nuevo registro para activar la configuración

        // Limpiar datos de registro pero mantener el ID de la organización
        delete ctx.userState.registrationData;
        delete ctx.userState.esperando;

        // Variables para controlar el estado de la suscripción
        let subscriptionCreated = false;
        let subscriptionEndDate = null;

        // Intentar obtener la suscripción recién creada
        try {
            const SubscriptionService = await import('../../core/subscription/subscription.service.js').then(m => m.default);
            const subscription = await SubscriptionService.getCurrentSubscription(tenant.id);
            
            if (subscription && subscription.trialEndsAt) {
                subscriptionCreated = true;
                subscriptionEndDate = subscription.trialEndsAt.toLocaleDateString();
            }
        } catch (error) {
            console.error('Error al obtener información de suscripción:', error);
        }

        // Mensaje de éxito
        let finalMessage = `✅ *¡Registro completado exitosamente!*\n\n` +
            `Tu empresa "${tenant.businessName}" ha sido registrada correctamente y tu cuenta está configurada como administrador.\n\n` +
            (subscriptionCreated 
                ? `*Plan de prueba:* Se ha activado tu período de prueba de 14 días, el cual vence el ${subscriptionEndDate}.\n\n` 
                : `*Plan de prueba:* No se pudo activar el período de prueba automáticamente. Por favor, contacta al soporte para activarlo.\n\n`) +
            `Puedes comenzar a utilizar el sistema ahora mismo.`;

        await ctx.reply(
            finalMessage,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🚀 Comenzar a facturar', 'volver_menu_principal')]
                ])
            }
        );
        
    } catch (error) {
        console.error('Error en el proceso de registro:', error);
        
        await ctx.reply(
            `❌ Lo sentimos, ha ocurrido un error durante el registro: ${error.message}\n\n` +
            `Por favor, intenta nuevamente más tarde o contacta a soporte.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('↩️ Volver al inicio', 'menu_principal')]
            ])
        );
        
        // Limpiar datos de registro
        delete ctx.userState.registrationData;
        delete ctx.userState.esperando;
    }
  });

  // Cancelar el registro
  bot.action('cancel_registration', async (ctx) => {
    await ctx.answerCbQuery();
    
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => {
        console.log('Error al eliminar teclado:', e.message);
      });
      
      // Limpiar datos de registro
      delete ctx.userState.registrationData;
      delete ctx.userState.esperando;
      
      await ctx.reply(
        '❌ Proceso de registro cancelado. Puedes iniciarlo nuevamente cuando lo desees.',
        Markup.inlineKeyboard([[Markup.button.callback('Volver al menú', 'menu_principal')]])
      );
    } catch (error) {
      console.error('Error al cancelar registro:', error);
    }
  });
}

/**
 * Valida un RFC mexicano básico
 * @param {string} rfc - RFC a validar
 * @returns {boolean} - true si es válido
 */
function validateRfc(rfc) {
  // Patrón básico para RFC mexicano
  const pattern = /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
  return pattern.test(rfc.toUpperCase());
}

/**
 * Valida un correo electrónico
 * @param {string} email - Correo a validar
 * @returns {boolean} - true si es válido
 */
function validateEmail(email) {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
}

/**
 * Valida un número telefónico
 * @param {string} phone - Teléfono a validar
 * @returns {boolean} - true si es válido
 */
function validatePhone(phone) {
  // Eliminar espacios, guiones y paréntesis
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  // Debe tener al menos 10 dígitos
  return /^\d{10,15}$/.test(cleanPhone);
}

/**
 * Valida un código postal mexicano
 * @param {string} zip - Código postal a validar
 * @returns {boolean} - true si es válido
 */
function validateZip(zip) {
  // Código postal mexicano: 5 dígitos
  return /^\d{5}$/.test(zip);
}