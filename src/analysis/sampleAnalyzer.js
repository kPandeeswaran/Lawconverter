import { promises as fs } from 'node:fs';
import path from 'node:path';

function extractTagSequence(xml) {
  const tags = [];
  const re = /<\/?([A-Za-z_][\w.:-]*)(?:\s+[^<>]*?)?\s*\/?>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const [full, tagName] = match;
    if (full.startsWith('<?') || full.startsWith('<!')) continue;
    tags.push({
      type: full.startsWith('</') ? 'close' : 'open',
      selfClose: full.endsWith('/>'),
      name: tagName,
    });
  }
  return tags;
}

function analyzeOne(xml) {
  const seq = extractTagSequence(xml);
  const root = seq.find((x) => x.type === 'open')?.name ?? 'Document';
  const tagFrequency = new Map();
  const parentChild = new Map();

  const stack = [];
  for (const tag of seq) {
    if (tag.type === 'open') {
      tagFrequency.set(tag.name, (tagFrequency.get(tag.name) ?? 0) + 1);
      const parent = stack[stack.length - 1];
      if (parent) {
        const key = `${parent}>${tag.name}`;
        parentChild.set(key, (parentChild.get(key) ?? 0) + 1);
      }
      if (!tag.selfClose) stack.push(tag.name);
    } else if (tag.type === 'close') {
      while (stack.length && stack[stack.length - 1] !== tag.name) stack.pop();
      if (stack[stack.length - 1] === tag.name) stack.pop();
    }
  }

  return { root, tagFrequency, parentChild };
}

export async function analyzeSampleXmlDir(sampleDir) {
  const entries = await fs.readdir(sampleDir, { withFileTypes: true });
  const xmlFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.xml'));
  const analyses = [];

  for (const file of xmlFiles) {
    const absolute = path.join(sampleDir, file.name);
    const xml = await fs.readFile(absolute, 'utf8');
    analyses.push(analyzeOne(xml));
  }

  const rootVotes = new Map();
  const tagFrequency = new Map();

  for (const a of analyses) {
    rootVotes.set(a.root, (rootVotes.get(a.root) ?? 0) + 1);
    for (const [k, v] of a.tagFrequency.entries()) {
      tagFrequency.set(k, (tagFrequency.get(k) ?? 0) + v);
    }
  }

  const preferredRoot = [...rootVotes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'Document';

  // Infer common narrative containers dynamically from sample plurality.
  const preferredBodyTag = ['JudgmentGroup', 'HeadNote', 'Body', 'ParaGroup'].find((candidate) =>
    tagFrequency.has(candidate),
  ) ?? 'Body';

  return {
    sampleCount: analyses.length,
    preferredRoot,
    preferredBodyTag,
    commonTags: [...tagFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name]) => name),
  };
}
