import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseMifToTree, parseParagraphs, parseSemanticTree, parseTables, parseTextRects } from '../parser/mifParser.js';
import { transformMifToSplitXmlByTag, transformMifToXml } from '../transform/mapper.js';
import { logger } from '../utils/logger.js';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function listMifFiles(mifDir) {
  const entries = await fs.readdir(mifDir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mif')).map((e) => path.join(mifDir, e.name));
}

export async function convertOneMif({ mifPath, outputDir, inferredSchema }) {
  const raw = await fs.readFile(mifPath, 'utf8');
  logger.info('Parsing MIF file', { mifPath, bytes: raw.length });

  const tree = parseMifToTree(raw);
  const paragraphs = parseParagraphs(tree);
  const textRects = parseTextRects(tree);
  const tables = parseTables(tree);
  const semanticTree = parseSemanticTree(tree);

  logger.debug('Parsed structure summary', {
    paragraphs: paragraphs.length,
    textRects: textRects.length,
    tables: tables.length,
  });

  const parsed = { paragraphs, textRects, tables, semanticTree };
  const splitCases = transformMifToSplitXmlByTag(parsed, 'TCase');

  if (splitCases.length) {
    const sourceBaseName = path.basename(mifPath, path.extname(mifPath));
    const outputs = [];

    for (const [index, splitCase] of splitCases.entries()) {
      const rawCaseId = splitCase.id ? String(splitCase.id).trim() : '';
      const safeCaseId = rawCaseId.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
      const suffix = safeCaseId || `TCase_${index + 1}`;
      const outputName = `${sourceBaseName}_${suffix}.xml`;
      const outputPath = path.join(outputDir, outputName);
      await fs.writeFile(outputPath, splitCase.xml, 'utf8');
      outputs.push(outputPath);
    }

    return {
      outputPath: outputs[0],
      outputPaths: outputs,
      splitByTag: 'TCase',
      splitCount: outputs.length,
      paragraphs: paragraphs.length,
      textRects: textRects.length,
      tables: tables.length,
    };
  }

  const xml = transformMifToXml(parsed, inferredSchema, path.basename(mifPath));

  const outputName = `${path.basename(mifPath, path.extname(mifPath))}.xml`;
  const outputPath = path.join(outputDir, outputName);
  await fs.writeFile(outputPath, xml, 'utf8');

  return { outputPath, outputPaths: [outputPath], paragraphs: paragraphs.length, textRects: textRects.length, tables: tables.length };
}
