/**
 * Lightweight MIF parser.
 *
 * MIF is an angle-bracket based format (<Tag value>) with nested blocks opened by
 * `<Tag` on one line and closed by a standalone `>` line (often with comments like
 * `# end of Tag`).
 *
 * We avoid heavyweight dependencies and do a single-pass scan with a small stack.
 */

/** @typedef {{name: string, rawValue: string, value: string | null, children: MifNode[], line: number}} MifNode */

const SOFT_HYPHEN = '\u00AD';

function unquoteMifValue(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('\'')) {
    return trimmed.slice(1, -1);
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeLine(line) {
  const noBom = line.replace(/^\uFEFF/, '');
  const commentIdx = noBom.indexOf('#');
  return (commentIdx >= 0 ? noBom.slice(0, commentIdx) : noBom).trim();
}

export function parseMifToTree(mifContent) {
  const root = { name: '__root__', rawValue: '', value: null, children: [], line: 0 };
  const stack = [root];
  const lines = mifContent.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const cleaned = normalizeLine(lines[i]);
    const lineNo = i + 1;
    if (!cleaned) continue;

    if (cleaned === '>') {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const match = cleaned.match(/^<([^\s>]+)\s*(.*?)>?\s*$/);
    if (!match) continue;

    const [, name, rest = ''] = match;
    const hasExplicitClose = cleaned.endsWith('>');
    const rawValue = rest.replace(/>\s*$/, '').trim();
    const node = { name, rawValue, value: unquoteMifValue(rawValue), children: [], line: lineNo };

    stack[stack.length - 1].children.push(node);

    // Block nodes are usually `<Tag` with no terminating `>` token on the same line.
    if (!hasExplicitClose) {
      stack.push(node);
    }
  }

  return root;
}

function collectByName(node, targetName, out = []) {
  if (node.name === targetName) out.push(node);
  for (const child of node.children ?? []) collectByName(child, targetName, out);
  return out;
}

export function extractStrings(paraLineNode) {
  const strings = [];
  for (const child of paraLineNode.children ?? []) {
    if (child.name === 'String' && child.value !== null) strings.push(child.value);
    if (child.name === 'Char') {
      if (child.value === 'HardReturn') strings.push('\n');
      if (child.value === 'SoftHyphen') strings.push(SOFT_HYPHEN);
      if (child.value === 'DiscHyphen') strings.push('-');
    }
  }
  return strings.join('');
}

export function parseParaLines(paraNode) {
  return (paraNode.children ?? [])
    .filter((child) => child.name === 'ParaLine')
    .map((lineNode, index) => {
      const textRect = lineNode.children.find((x) => x.name === 'TextRectID')?.value ?? null;
      return {
        index,
        line: lineNode.line,
        textRectId: textRect,
        strings: extractStrings(lineNode),
        rawNode: lineNode,
      };
    });
}

export function parseParagraphs(tree) {
  const paras = collectByName(tree, 'Para');
  return paras.map((paraNode, index) => {
    const pgfTag = paraNode.children.find((x) => x.name === 'PgfTag')?.value ?? 'Unknown';
    const paraLines = parseParaLines(paraNode);
    return {
      index,
      line: paraNode.line,
      style: pgfTag,
      paraLines,
      text: paraLines.map((l) => l.strings).join(' ').replace(/\s+/g, ' ').trim(),
      rawNode: paraNode,
    };
  });
}

export function parseTextRects(tree) {
  // We infer TextRect assignment from ParaLine-level TextRectID markers.
  const paragraphs = parseParagraphs(tree);
  const map = new Map();
  let currentRect = 'UNSCOPED';

  for (const para of paragraphs) {
    for (const line of para.paraLines) {
      if (line.textRectId) currentRect = line.textRectId;
      if (!map.has(currentRect)) map.set(currentRect, []);
    }
    map.get(currentRect)?.push(para);
  }

  return Array.from(map.entries()).map(([textRectId, paras], index) => ({
    index,
    textRectId,
    paragraphs: paras,
  }));
}

export function parseTables(tree) {
  const tables = collectByName(tree, 'Tbl');
  return tables.map((tblNode, index) => {
    const rows = tblNode.children.filter((child) => child.name === 'Row');
    return {
      index,
      line: tblNode.line,
      rows: rows.map((rowNode, rIdx) => {
        const cells = rowNode.children.filter((c) => c.name === 'Cell');
        return {
          rowIndex: rIdx,
          cells: cells.map((cellNode, cIdx) => {
            const paragraphs = cellNode.children.filter((c) => c.name === 'Para');
            const text = paragraphs
              .flatMap((p) => parseParaLines(p).map((l) => l.strings))
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            return { cellIndex: cIdx, text };
          }),
        };
      }),
    };
  });
}

function parseElementBegin(elementBeginNode) {
  const tag = elementBeginNode.children.find((c) => c.name === 'ETag')?.value ?? null;
  const attrsNode = elementBeginNode.children.find((c) => c.name === 'Attributes');
  const attrs = {};

  for (const child of attrsNode?.children ?? []) {
    if (child.name !== 'Attribute') continue;
    const name = child.children.find((x) => x.name === 'AttrName')?.value;
    const value = child.children.find((x) => x.name === 'AttrValue')?.value ?? '';
    if (name) attrs[name] = value;
  }

  return { tag, attrs };
}

function appendText(node, text) {
  if (!text) return;
  const last = node.children[node.children.length - 1];
  if (typeof last === 'string') {
    node.children[node.children.length - 1] = `${last}${text}`;
  } else {
    node.children.push(text);
  }
}

export function parseSemanticTree(tree) {
  const root = { tag: '__root__', attrs: {}, children: [] };
  const stack = [root];
  const paraLines = collectByName(tree, 'ParaLine');
  const fnoteMap = new Map();
  let fnoteCounter = 0;

  for (const paraLine of paraLines) {
    for (const token of paraLine.children ?? []) {
      if (token.name === 'ElementBegin') {
        const parsed = parseElementBegin(token);
        if (!parsed.tag) continue;
        const node = { tag: parsed.tag, attrs: parsed.attrs, children: [] };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      } else if (token.name === 'ElementEnd') {
        const closeTag = token.value;
        if (!closeTag) continue;
        while (stack.length > 1 && stack[stack.length - 1].tag !== closeTag) stack.pop();
        if (stack.length > 1) stack.pop();
      } else if (token.name === 'String') {
        appendText(stack[stack.length - 1], token.value ?? '');
      } else if (token.name === 'Char') {
        if (token.value === 'HardReturn') appendText(stack[stack.length - 1], '\n');
        if (token.value === 'DiscHyphen') appendText(stack[stack.length - 1], '-');
      } else if (token.name === 'FNote') {
        const raw = token.value ?? '';
        if (!fnoteMap.has(raw)) {
          fnoteCounter += 1;
          fnoteMap.set(raw, String(fnoteCounter));
        }
        stack[stack.length - 1].children.push({ tag: 'Footnote', attrs: {}, children: [fnoteMap.get(raw)] });
      }
    }
  }

  return root;
}
