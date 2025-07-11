import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Configuración del Entorno ---
// Simula la carga de variables de entorno para la base de datos
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.example') });

// --- Importaciones de Módulos Reales ---
import prisma from '../lib/prisma.js';
import * as invoiceHandler from '../bot/handlers/invoice.handler.js';
import * as pdfAnalysisService from '../services/pdf-analysis.service.js';
import * as invoiceService from '../services/invoice.service.js';
import * as clientService from '../services/client.service.js';
import * as tenantService from '../services/tenant.service.js';
import * as facturapiService from '../services/facturapi.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Mock del Contexto de Telegram (ctx) ---
const createMockCtx = (filePath) => ({
    chat: { id: 12345 }, // ID de chat de prueba
    message: {
        document: {
            file_id: 'dummy_file_id',
            file_name: path.basename(filePath),
        },
    },
    reply: (message) => {
        // console.log(`BOT-REPLY: ${message}`);
    },
    scene: {
        enter: (sceneName) => {
            // console.log(`Entering scene: ${sceneName}`);
        }
    }
});

// --- Flujo de Diagnóstico con Código Real ---
const runRealCodeBenchmark = async (pdfPath) => {
    const timings = {};
    let start, end;
    const ctx = createMockCtx(pdfPath);

    // --- 1. Resolución de Tenant ---
    start = performance.now();
    const tenant = await tenantService.findOrCreateTenant(ctx.chat.id);
    end = performance.now();
    timings['1_Find_or_Create_Tenant'] = end - start;

    // --- 2. Simulación de Descarga y Lectura de PDF ---
    // En el bot real, esto implicaría una llamada a la API de Telegram
    start = performance.now();
    const pdfBuffer = fs.readFileSync(pdfPath);
    end = performance.now();
    timings['2_Read_PDF_File'] = end - start;

    // --- 3. Extracción y Análisis del PDF ---
    start = performance.now();
    const extractedData = await pdfAnalysisService.extractDataFromPdf(pdfBuffer);
    if (!extractedData || !extractedData.rfc) {
        throw new Error("Fallo en la extracción de datos del PDF.");
    }
    end = performance.now();
    timings['3_PDF_Extraction_Analysis'] = end - start;

    // --- 4. Resolución de Cliente ---
    start = performance.now();
    const client = await clientService.findClientByRfc(tenant.id, extractedData.rfc);
    if (!client) {
        // Simula el flujo donde el cliente no se encuentra
        // console.log("Cliente no encontrado, se simula la creación o el error.");
        await new Promise(res => setTimeout(res, 10)); // Simulación pequeña
    }
    end = performance.now();
    timings['4_Find_Client_by_RFC'] = end - start;

    // --- 5. Creación de Factura (Lógica de Servicio) ---
    start = performance.now();
    // Esta función interna de invoiceService arma el objeto y lo guarda en DB
    const preliminaryInvoice = await invoiceService.createInvoiceRecord(tenant.id, extractedData, client.id, 'pending');
    end = performance.now();
    timings['5.1_Create_Preliminary_Invoice_DB'] = end - start;

    // --- 5.2 Timbrado (Llamada a API) ---
    start = performance.now();
    // Se simula solo la llamada a la API para no generar facturas reales
    // const facturapiResponse = await facturapiService.createInvoice(tenant, preliminaryInvoice.jsonData);
    await new Promise(res => setTimeout(res, 4000)); // Simulación de 4s de la API
    const facturapiResponse = { id: 'inv-real-simulated', status: 'valid' };
    end = performance.now();
    timings['5.2_FacturaAPI_Call_(Simulated)'] = end - start;


    // --- 6. Post-procesamiento ---
    start = performance.now();
    await invoiceService.updateInvoiceStatus(preliminaryInvoice.id, 'processed', facturapiResponse.id);
    end = performance.now();
    timings['6_Update_Invoice_Status_DB'] = end - start;


    const totalTime = Object.values(timings).reduce((a, b) => a + b, 0);
    return { timings, totalTime };
};

const runBenchmark = async () => {
    const results = [];
    const mockPdfPath = path.join(__dirname, '..', 'test', 'data', 'sample.pdf');

    if (!fs.existsSync(mockPdfPath)) {
        fs.mkdirSync(path.dirname(mockPdfPath), { recursive: true });
        fs.writeFileSync(mockPdfPath, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000113 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n162\n%%EOF');
    }

    console.log('--- Iniciando Benchmark con Código Real (20 ejecuciones) ---');

    try {
        for (let i = 0; i < 20; i++) {
            const result = await runRealCodeBenchmark(mockPdfPath);
            results.push(result);
            console.log(`Ejecución ${i + 1}: Tiempo Total = ${result.totalTime.toFixed(2)} ms`);
            // Pausa breve para no sobrecargar la DB en el benchmark
            await new Promise(res => setTimeout(res, 100));
        }
    } catch (error) {
        console.error("Error durante el benchmark:", error);
        return;
    } finally {
        await prisma.$disconnect();
    }


    console.log('\n--- Análisis de Resultados ---');
    const analysis = results.reduce((acc, result) => {
        for (const key in result.timings) {
            if (!acc[key]) acc[key] = [];
            acc[key].push(result.timings[key]);
        }
        if (!acc['totalTime']) acc['totalTime'] = [];
        acc['totalTime'].push(result.totalTime);
        return acc;
    }, {});

    console.log('Métricas por Etapa (Promedio, Mín, Máx) en ms:\n');
    console.log('Etapa                                     | Promedio   | Mín        | Máx');
    console.log('------------------------------------------|------------|------------|------------');

    for (const key in analysis) {
        const times = analysis[key];
        const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2);
        const min = Math.min(...times).toFixed(2);
        const max = Math.max(...times).toFixed(2);
        console.log(`${key.padEnd(41)}| ${avg.padStart(10)} | ${min.padStart(10)} | ${max.padStart(10)}`);
    }
};

runBenchmark().catch(console.error);