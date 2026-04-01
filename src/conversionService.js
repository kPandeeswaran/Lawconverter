import { promises as fs } from 'node:fs';
import path from 'node:path';
import { analyzeSampleXmlDir } from './analysis/sampleAnalyzer.js';
import { convertOneMif, ensureDir, listMifFiles } from './io/filePipeline.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildConversionLogHtml(report) {
  const rows = report.files
    .map((file) => {
      const outputs = file.outputs.map((output) => `<li><code>${escapeHtml(output)}</code></li>`).join('');
      const errorCell = file.error ? `<span class="error">${escapeHtml(file.error)}</span>` : '<span class="ok">None</span>';
      return `
        <tr>
          <td><code>${escapeHtml(file.mifPath)}</code></td>
          <td>${file.success ? '✅' : '❌'}</td>
          <td>${file.success ? file.splitCount : '-'}</td>
          <td><ul>${outputs || '<li>-</li>'}</ul></td>
          <td>${errorCell}</td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MIF Conversion Log</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; color: #1f2937; }
    h1 { margin-bottom: 0.5rem; }
    .meta { margin: 0.25rem 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #d1d5db; padding: 0.5rem; vertical-align: top; text-align: left; }
    th { background: #f3f4f6; }
    .ok { color: #047857; font-weight: 600; }
    .error { color: #b91c1c; font-weight: 600; }
    code { background: #f9fafb; padding: 0.1rem 0.3rem; border-radius: 4px; }
    ul { margin: 0; padding-left: 1rem; }
  </style>
</head>
<body>
  <h1>MIF to XML Conversion Log</h1>
  <p class="meta"><strong>Started:</strong> ${escapeHtml(report.startedAt)}</p>
  <p class="meta"><strong>Finished:</strong> ${escapeHtml(report.finishedAt)}</p>
  <p class="meta"><strong>MIF Folder:</strong> <code>${escapeHtml(report.mifDir)}</code></p>
  <p class="meta"><strong>Sample Folder:</strong> <code>${escapeHtml(report.sampleDir)}</code></p>
  <p class="meta"><strong>Output Folder:</strong> <code>${escapeHtml(report.outputDir)}</code></p>
  <p class="meta"><strong>Total Files:</strong> ${report.totalFiles} | <strong>Success:</strong> ${report.successCount} | <strong>Failed:</strong> ${report.failureCount}</p>
  <table>
    <thead>
      <tr>
        <th>MIF File</th>
        <th>Status</th>
        <th>Split XML Count</th>
        <th>Generated XML</th>
        <th>Error</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

export async function convertMifFolder({ mifDir, sampleDir, outputDir }) {
  const startedAt = new Date().toISOString();
  await ensureDir(outputDir);

  const inferredSchema = await analyzeSampleXmlDir(sampleDir);
  const mifFiles = await listMifFiles(mifDir);
  const report = {
    startedAt,
    finishedAt: startedAt,
    mifDir,
    sampleDir,
    outputDir,
    totalFiles: mifFiles.length,
    successCount: 0,
    failureCount: 0,
    files: [],
    inferredSchema,
    logPath: '',
  };

  for (const mifPath of mifFiles) {
    try {
      const result = await convertOneMif({ mifPath, outputDir, inferredSchema });
      report.files.push({
        mifPath,
        success: true,
        splitCount: result.splitCount ?? 1,
        outputs: result.outputPaths ?? [],
        error: null,
      });
      report.successCount += 1;
    } catch (error) {
      report.files.push({
        mifPath,
        success: false,
        splitCount: 0,
        outputs: [],
        error: error instanceof Error ? error.message : String(error),
      });
      report.failureCount += 1;
    }
  }

  report.finishedAt = new Date().toISOString();
  const logName = `conversion-log-${report.finishedAt.replaceAll(':', '-').replace('.', '-')}.html`;
  report.logPath = path.join(outputDir, logName);
  const logHtml = buildConversionLogHtml(report);
  await fs.writeFile(report.logPath, logHtml, 'utf8');

  return report;
}
