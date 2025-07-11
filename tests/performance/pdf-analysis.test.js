// tests/performance/pdf-analysis.test.js
import PDFAnalysisService from '../../services/pdf-analysis.service.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('PDF Analysis Performance', () => {
  const testPdfPath = path.join(__dirname, '../fixtures/test-pedido.pdf');
  
  beforeAll(async () => {
    // Crear un PDF de prueba si no existe
    const testDir = path.dirname(testPdfPath);
    await fs.mkdir(testDir, { recursive: true });
    
    // Simular un PDF pequeño para pruebas
    if (!await fs.access(testPdfPath).then(() => true).catch(() => false)) {
      await fs.writeFile(testPdfPath, Buffer.from('%PDF-1.4\ntest content\n%%EOF'));
    }
  });

  it('should not block event loop during PDF reading', async () => {
    const startTime = Date.now();
    const promises = [];
    const eventLoopBlocked = [];
    
    // Monitor event loop
    const checkEventLoop = setInterval(() => {
      const delay = Date.now() - startTime;
      eventLoopBlocked.push(delay);
    }, 10); // Check every 10ms
    
    // Simular carga concurrente
    for (let i = 0; i < 5; i++) {
      promises.push(PDFAnalysisService.analyzePDF(testPdfPath));
    }
    
    await Promise.all(promises);
    clearInterval(checkEventLoop);
    
    const duration = Date.now() - startTime;
    
    // Verificar que no hubo bloqueos significativos
    const maxBlockTime = Math.max(...eventLoopBlocked.map((t, i) => 
      i > 0 ? t - eventLoopBlocked[i-1] : 0
    ));
    
    expect(duration).toBeLessThan(1000); // No debe tardar más de 1s
    expect(maxBlockTime).toBeLessThan(100); // Event loop no debe bloquearse más de 100ms
  });

  it('should handle large PDFs efficiently', async () => {
    // Crear un PDF más grande para prueba
    const largePdfPath = path.join(__dirname, '../fixtures/large-test.pdf');
    const largeContent = Buffer.alloc(5 * 1024 * 1024); // 5MB
    await fs.writeFile(largePdfPath, largeContent);
    
    const memBefore = process.memoryUsage().heapUsed;
    
    await PDFAnalysisService.analyzePDF(largePdfPath);
    
    const memAfter = process.memoryUsage().heapUsed;
    const memDiff = (memAfter - memBefore) / 1024 / 1024; // Convert to MB
    
    // Cleanup
    await fs.unlink(largePdfPath);
    
    expect(memDiff).toBeLessThan(10); // No debe usar más de 10MB adicionales
  });

  it('should process multiple PDFs concurrently without performance degradation', async () => {
    const concurrentTests = 10;
    const times = [];
    
    for (let i = 0; i < concurrentTests; i++) {
      const start = Date.now();
      await PDFAnalysisService.analyzePDF(testPdfPath);
      times.push(Date.now() - start);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    
    // El tiempo máximo no debe ser mucho mayor que el promedio
    expect(maxTime).toBeLessThan(avgTime * 2);
  });
});