import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSampleXmlDir } from './analysis/sampleAnalyzer.js';
import { convertOneMif, ensureDir, listMifFiles } from './io/filePipeline.js';
import { logger } from './utils/logger.js';

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');

  const mifDir = path.join(root, 'mif');
  const sampleDir = path.join(root, 'sample');
  const outputDir = path.join(root, 'output');

  await ensureDir(outputDir);

  logger.info('Analyzing sample XML files for dynamic mapping rules');
  const inferredSchema = await analyzeSampleXmlDir(sampleDir);
  logger.info('Inferred schema', inferredSchema);

  const mifFiles = await listMifFiles(mifDir);
  if (!mifFiles.length) {
    logger.warn('No MIF files found.');
    return;
  }

  for (const mifPath of mifFiles) {
    try {
      const result = await convertOneMif({ mifPath, outputDir, inferredSchema });
      logger.info('Converted MIF to XML', result);
    } catch (error) {
      logger.error('Conversion failed for file', {
        mifPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

main().catch((error) => {
  logger.error('Fatal pipeline error', { error: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
});
