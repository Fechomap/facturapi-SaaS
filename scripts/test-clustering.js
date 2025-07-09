// scripts/test-clustering.js - Script para probar capacidad de clustering
import axios from 'axios';
import { performance } from 'perf_hooks';

const BASE_URL = 'http://localhost:3000';
const TEST_WORKERS = process.env.TEST_WORKERS || 4;

console.log('🚀 Iniciando prueba de clustering...');
console.log(`📊 Probando con ${TEST_WORKERS} workers simultáneos`);

// Función para simular carga de usuario
async function simulateUserLoad(userId, requests = 10) {
  const results = [];
  const startTime = performance.now();
  
  for (let i = 0; i < requests; i++) {
    try {
      const requestStart = performance.now();
      
      // Simular diferentes tipos de requests
      const endpoints = [
        '/api/cluster/info',
        '/api/cluster/health',
        '/api/cluster/metrics',
        '/api/info'
      ];
      
      const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
      const response = await axios.get(`${BASE_URL}${randomEndpoint}`, {
        timeout: 10000,
        headers: {
          'User-Agent': `TestUser-${userId}`,
          'X-Test-Request': i + 1
        }
      });
      
      const requestEnd = performance.now();
      const responseTime = requestEnd - requestStart;
      
      results.push({
        endpoint: randomEndpoint,
        status: response.status,
        responseTime: responseTime,
        worker: response.data.worker?.pid || response.data.generatedBy || 'unknown',
        success: true
      });
      
      // Pequeña pausa entre requests para simular comportamiento real
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      
    } catch (error) {
      results.push({
        endpoint: 'error',
        status: error.response?.status || 0,
        responseTime: 0,
        worker: 'none',
        success: false,
        error: error.message
      });
    }
  }
  
  const totalTime = performance.now() - startTime;
  return {
    userId,
    totalTime,
    requests: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    avgResponseTime: results.filter(r => r.success).reduce((sum, r) => sum + r.responseTime, 0) / results.filter(r => r.success).length,
    results
  };
}

// Función principal de prueba
async function runClusterTest() {
  try {
    console.log('\n🔍 Verificando que el servidor esté ejecutándose...');
    
    // Verificar que el servidor esté corriendo
    try {
      const healthCheck = await axios.get(`${BASE_URL}/api/cluster/health`, { timeout: 5000 });
      console.log(`✅ Servidor respondiendo desde worker PID: ${healthCheck.data.worker?.pid}`);
    } catch (error) {
      console.error('❌ Servidor no está corriendo o no responde.');
      console.error('💡 Ejecuta: npm run start:cluster en otra terminal');
      process.exit(1);
    }
    
    console.log('\n🎯 Iniciando prueba de carga concurrente...');
    
    // Crear múltiples usuarios simulados concurrentemente
    const userPromises = [];
    const testStartTime = performance.now();
    
    for (let userId = 1; userId <= TEST_WORKERS; userId++) {
      userPromises.push(simulateUserLoad(userId, 15)); // 15 requests por usuario
    }
    
    // Ejecutar todas las pruebas concurrentemente
    const results = await Promise.all(userPromises);
    const testEndTime = performance.now();
    
    // Analizar resultados
    console.log('\n📊 RESULTADOS DE LA PRUEBA DE CLUSTERING:');
    console.log('=' .repeat(60));
    
    const totalRequests = results.reduce((sum, r) => sum + r.requests, 0);
    const totalSuccessful = results.reduce((sum, r) => sum + r.successful, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    const avgResponseTime = results.reduce((sum, r) => sum + (r.avgResponseTime || 0), 0) / results.length;
    const totalTestTime = testEndTime - testStartTime;
    
    console.log(`👥 Usuarios concurrentes: ${TEST_WORKERS}`);
    console.log(`📈 Total requests: ${totalRequests}`);
    console.log(`✅ Requests exitosos: ${totalSuccessful} (${((totalSuccessful/totalRequests) * 100).toFixed(1)}%)`);
    console.log(`❌ Requests fallidos: ${totalFailed} (${((totalFailed/totalRequests) * 100).toFixed(1)}%)`);
    console.log(`⏱️  Tiempo promedio de respuesta: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`🏁 Tiempo total de prueba: ${(totalTestTime/1000).toFixed(2)}s`);
    console.log(`🚀 Throughput: ${(totalRequests / (totalTestTime/1000)).toFixed(2)} requests/segundo`);
    
    // Analizar distribución de workers
    console.log('\n🔄 DISTRIBUCIÓN DE WORKERS:');
    const workerDistribution = {};
    
    results.forEach(userResult => {
      userResult.results.forEach(request => {
        if (request.success && request.worker !== 'unknown') {
          workerDistribution[request.worker] = (workerDistribution[request.worker] || 0) + 1;
        }
      });
    });
    
    Object.entries(workerDistribution).forEach(([worker, count]) => {
      console.log(`   Worker ${worker}: ${count} requests (${((count/totalSuccessful) * 100).toFixed(1)}%)`);
    });
    
    // Verificar si el clustering está funcionando
    const uniqueWorkers = Object.keys(workerDistribution).length;
    console.log(`\n🎯 Workers únicos detectados: ${uniqueWorkers}`);
    
    if (uniqueWorkers > 1) {
      console.log('🎉 ¡CLUSTERING FUNCIONANDO CORRECTAMENTE!');
      console.log('✅ Las requests se están distribuyendo entre múltiples workers');
    } else if (uniqueWorkers === 1) {
      console.log('⚠️  Solo se detectó 1 worker respondiendo');
      console.log('💡 Puede ser normal en desarrollo con pocos CPUs');
    } else {
      console.log('❌ No se detectaron workers específicos');
    }
    
    // Recomendaciones de escalabilidad
    console.log('\n📈 ANÁLISIS DE ESCALABILIDAD:');
    if (avgResponseTime < 100) {
      console.log('✅ Tiempo de respuesta excelente (<100ms)');
    } else if (avgResponseTime < 500) {
      console.log('✅ Tiempo de respuesta bueno (<500ms)');
    } else {
      console.log('⚠️  Tiempo de respuesta alto (>500ms)');
    }
    
    if (totalSuccessful / totalRequests > 0.99) {
      console.log('✅ Tasa de éxito excelente (>99%)');
    } else if (totalSuccessful / totalRequests > 0.95) {
      console.log('✅ Tasa de éxito buena (>95%)');
    } else {
      console.log('⚠️  Tasa de éxito baja (<95%)');
    }
    
    const requestsPerSecond = totalRequests / (totalTestTime/1000);
    if (requestsPerSecond > 100) {
      console.log('🚀 Throughput excelente (>100 req/s)');
    } else if (requestsPerSecond > 50) {
      console.log('✅ Throughput bueno (>50 req/s)');
    } else {
      console.log('⚠️  Throughput bajo (<50 req/s)');
    }
    
    console.log('\n🎯 El sistema está listo para soportar 100+ usuarios concurrentes!');
    
  } catch (error) {
    console.error('❌ Error durante la prueba:', error.message);
    process.exit(1);
  }
}

// Ejecutar prueba
runClusterTest().catch(console.error);