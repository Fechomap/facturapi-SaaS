// scripts/test-redis.js - Probar conexión y funcionalidad Redis
import redisSessionService from '../../services/redis-session.service.js';
import logger from '../../core/utils/logger.js';

const testLogger = logger.child({ module: 'redis-test' });

async function testRedisConnection() {
  console.log('🔍 PROBANDO CONEXIÓN REDIS');
  console.log('=' .repeat(50));
  
  try {
    // Verificar variables de entorno
    const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
    console.log(`📍 Redis URL configurada: ${redisUrl ? 'SÍ' : 'NO'}`);
    
    if (redisUrl) {
      // Ocultar credenciales para logging seguro
      const safeUrl = redisUrl.replace(/:([^:@]+)@/, ':***@');
      console.log(`🔗 Conectando a: ${safeUrl}`);
    }
    
    // Inicializar servicio Redis
    console.log('\n⚙️ Inicializando servicio Redis...');
    const initResult = await redisSessionService.initialize();
    
    console.log(`✅ Inicialización: ${initResult.success ? 'EXITOSA' : 'FALLÓ'}`);
    console.log(`📦 Tipo de almacenamiento: ${initResult.type}`);
    
    if (initResult.warning) {
      console.log(`⚠️  Advertencia: ${initResult.warning}`);
    }
    
    // Probar operaciones básicas
    console.log('\n🧪 PROBANDO OPERACIONES DE SESIÓN');
    console.log('-' .repeat(40));
    
    const testSessionId = 'test-session-' + Date.now();
    const testData = {
      userId: 'test-user-123',
      tenantId: 'test-tenant-456',
      loginTime: new Date().toISOString(),
      testData: 'Datos de prueba para clustering'
    };
    
    // Test 1: Guardar sesión
    console.log('1️⃣ Guardando sesión de prueba...');
    const saveResult = await redisSessionService.setSession(testSessionId, testData, 60);
    console.log(`   Resultado: ${saveResult.success ? '✅ GUARDADA' : '❌ ERROR'}`);
    
    // Test 2: Recuperar sesión
    console.log('2️⃣ Recuperando sesión...');
    const getResult = await redisSessionService.getSession(testSessionId);
    console.log(`   Resultado: ${getResult.success ? '✅ RECUPERADA' : '❌ NO ENCONTRADA'}`);
    
    if (getResult.success) {
      console.log(`   Datos: Usuario ${getResult.data.userId}, Tenant ${getResult.data.tenantId}`);
    }
    
    // Test 3: Obtener estadísticas
    console.log('3️⃣ Obteniendo estadísticas...');
    const stats = await redisSessionService.getStats();
    console.log(`   Tipo: ${stats.type}`);
    console.log(`   Conectado: ${stats.connected ? '✅ SÍ' : '❌ NO'}`);
    console.log(`   Sesiones activas: ${stats.activeSessions || 0}`);
    
    // Test 4: Eliminar sesión
    console.log('4️⃣ Eliminando sesión de prueba...');
    const deleteResult = await redisSessionService.deleteSession(testSessionId);
    console.log(`   Resultado: ${deleteResult.success ? '✅ ELIMINADA' : '❌ ERROR'}`);
    
    // Test 5: Verificar que fue eliminada
    console.log('5️⃣ Verificando eliminación...');
    const verifyResult = await redisSessionService.getSession(testSessionId);
    console.log(`   Resultado: ${!verifyResult.success ? '✅ CONFIRMADO' : '❌ AÚN EXISTE'}`);
    
    // Resultado final
    console.log('\n📊 RESULTADO FINAL');
    console.log('=' .repeat(50));
    
    if (initResult.type === 'redis' && initResult.success) {
      console.log('🎉 ¡REDIS FUNCIONANDO PERFECTAMENTE!');
      console.log('✅ El clustering tendrá sesiones compartidas');
      console.log('✅ Listo para 100+ usuarios concurrentes');
    } else if (initResult.type === 'memory' && initResult.success) {
      console.log('⚠️  Usando almacenamiento en memoria');
      console.log('❌ Las sesiones NO se comparten entre workers');
      console.log('💡 Para 100+ usuarios: configura Redis en Railway');
    } else {
      console.log('❌ Error en el sistema de sesiones');
      console.log('🚨 El clustering no funcionará correctamente');
    }
    
  } catch (error) {
    console.error('\n💥 ERROR DURANTE LA PRUEBA:');
    console.error(error.message);
    console.error('\n🔧 SOLUCIONES:');
    console.error('1. Verifica que Redis esté corriendo');
    console.error('2. Verifica REDIS_URL en variables de entorno');
    console.error('3. En Railway: agrega Redis service');
  } finally {
    // Limpiar conexión
    await redisSessionService.disconnect();
    console.log('\n🧹 Limpieza completada');
  }
}

// Ejecutar prueba
testRedisConnection().catch(console.error);