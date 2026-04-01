import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertMifFolder } from './conversionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const defaultMif = path.join(root, 'mif');
const defaultSample = path.join(root, 'sample');
const defaultOutput = path.join(root, 'output');

function parseFormBody(rawBody) {
  const params = new URLSearchParams(rawBody);
  return {
    mifDir: params.get('mifDir')?.trim() || defaultMif,
    sampleDir: params.get('sampleDir')?.trim() || defaultSample,
    outputDir: params.get('outputDir')?.trim() || defaultOutput,
  };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
      const withDefaults = html
        .replace('placeholder="/workspace/Lawconverter/mif"', `value="${defaultMif}"`)
        .replace('placeholder="/workspace/Lawconverter/sample"', `value="${defaultSample}"`)
        .replace('placeholder="/workspace/Lawconverter/output"', `value="${defaultOutput}"`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(withDefaults);
      return;
    }

    if (req.method === 'POST' && req.url === '/convert') {
      const rawBody = await readRequestBody(req);
      const payload = parseFormBody(rawBody);
      const report = await convertMifFolder(payload);
      const logHtml = await fs.readFile(report.logPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(logHtml);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    const message = error instanceof Error ? error.stack : String(error);
    res.end(`Conversion failed\n${message}`);
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  process.stdout.write(`Lawconverter UI running at http://localhost:${port}\n`);
});
