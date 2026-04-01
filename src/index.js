import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertMifFolder } from './conversionService.js';
import { logger } from './utils/logger.js';

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');

  const mifDir = path.join(root, 'mif');
  const sampleDir = path.join(root, 'sample');
  const outputDir = path.join(root, 'output');

  logger.info('Starting MIF to XML conversion', { mifDir, sampleDir, outputDir });
  const report = await convertMifFolder({ mifDir, sampleDir, outputDir });

  if (!report.totalFiles) {
    logger.warn('No MIF files found.', { mifDir });
    return;
  }

  logger.info('Conversion finished', {
    totalFiles: report.totalFiles,
    successCount: report.successCount,
    failureCount: report.failureCount,
    logPath: report.logPath,
  });
}

main().catch((error) => {
  logger.error('Fatal pipeline error', { error: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
});
