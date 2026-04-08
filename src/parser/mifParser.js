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
      if (child.value === 'SoftHyphen') strings.push('-');
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

  const findDescendantsByName = (node, name, out = []) => {
    for (const child of node.children ?? []) {
      if (child.name === name) out.push(child);
      findDescendantsByName(child, name, out);
    }
    return out;
  };

  const extractCellParagraphs = (cellNode) => {
    const paragraphs = findDescendantsByName(cellNode, 'Para');
    return paragraphs.map((paraNode) => {
      const style = paraNode.children.find((x) => x.name === 'PgfTag')?.value ?? 'Unknown';
      const pgfNode = paraNode.children.find((x) => x.name === 'Pgf');
      const align = pgfNode?.children.find((x) => x.name === 'PgfAlignment')?.value ?? null;
      const cellAlignment = pgfNode?.children.find((x) => x.name === 'PgfCellAlignment')?.value ?? null;
      const text = parseParaLines(paraNode)
        .map((line) => line.strings)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { style, align, cellAlignment, text };
    });
  };

  return tables.map((tblNode, index) => {
    const tableId = tblNode.children.find((child) => child.name === 'TblID')?.value ?? null;
    const rows = findDescendantsByName(tblNode, 'Row');
    return {
      index,
      id: tableId,
      line: tblNode.line,
      rows: rows.map((rowNode, rIdx) => {
        const cells = rowNode.children.filter((c) => c.name === 'Cell');
        return {
          rowIndex: rIdx,
          cells: cells.map((cellNode, cIdx) => {
            const rowSpan = Number.parseInt(cellNode.children.find((c) => c.name === 'CellRows')?.value ?? '1', 10) || 1;
            const colSpan = Number.parseInt(cellNode.children.find((c) => c.name === 'CellColumns')?.value ?? '1', 10) || 1;
            const paragraphs = extractCellParagraphs(cellNode);
            return {
              cellIndex: cIdx,
              rowSpan,
              colSpan,
              text: paragraphs.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim(),
              paragraphs,
            };
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
  const specialCase = elementBeginNode.children.find((c) => c.name === 'SpecialCase')?.value ?? null;

  for (const child of attrsNode?.children ?? []) {
    if (child.name !== 'Attribute') continue;
    const name = child.children.find((x) => x.name === 'AttrName')?.value;
    const value = child.children.find((x) => x.name === 'AttrValue')?.value ?? '';
    if (name) attrs[name] = value;
  }

  if (tag === 'Bench' && specialCase && attrs.Special === undefined) {
    const normalizedSpecialCase = String(specialCase).trim().toLowerCase();
    if (normalizedSpecialCase === 'no') attrs.Special = 'n';
    if (normalizedSpecialCase === 'yes') attrs.Special = 'y';
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

function buildSemanticTableNode(table) {
  const resolveCellFormatting = (cell) => {
    const firstPara = cell.paragraphs?.find((para) => para.text) ?? cell.paragraphs?.[0] ?? null;
    const style = firstPara?.style ?? 'CellBody';
    const paraAlignment = String(firstPara?.align ?? '').toLowerCase();
    const cellAlignment = String(firstPara?.cellAlignment ?? '').toLowerCase();

    if (style === 'CellHeading') {
      if (paraAlignment === 'left') return { align: 'LEFT', valign: 'TOP', italic: true };
      if (cellAlignment === 'top') return { align: 'CENTER', valign: 'TOP', italic: true };
      return { align: 'CENTER', valign: 'CENTER', italic: true };
    }

    if (paraAlignment === 'center') return { align: 'CENTER', valign: 'TOP', italic: false };
    if (paraAlignment === 'right') return { align: 'RIGHT', valign: 'TOP', italic: false };
    return { align: 'LEFT', valign: 'TOP', italic: false };
  };

  const buildCellChildren = (cell, italic) => {
    const paragraphTexts = (cell.paragraphs ?? []).map((para) => para.text).filter(Boolean);
    if (!paragraphTexts.length) return [];

    const formattedContent = [];
    paragraphTexts.forEach((text, index) => {
      if (index > 0) formattedContent.push({ tag: 'BR', attrs: {}, children: [] });
      formattedContent.push(italic ? { tag: 'ITALICS', attrs: {}, children: [text] } : text);
    });

    return [{ tag: 'P', attrs: {}, children: formattedContent }];
  };

  return {
    tag: 'TABLE',
    attrs: { ID: table.id ?? String(table.index + 1), BORDER: '1' },
    children: table.rows.map((row) => ({
      tag: 'TR',
      attrs: {},
      children: row.cells.map((cell) => {
        const { align, valign, italic } = resolveCellFormatting(cell);
        return {
          tag: 'TD',
          attrs: {
            ALIGN: align,
            VALIGN: valign,
            ...(cell.rowSpan > 1 ? { ROWSPAN: String(cell.rowSpan) } : {}),
            ...(cell.colSpan > 1 ? { COLSPAN: String(cell.colSpan) } : {}),
          },
          children: buildCellChildren(cell, italic),
        };
      }),
    })),
  };
}

function extractFootnoteContentMap(tree) {
  const footnoteNodes = collectByName(tree, 'FNote');
  const footnoteContentById = new Map();

  for (const footnoteNode of footnoteNodes) {
    const footnoteId = footnoteNode.children.find((child) => child.name === 'ID')?.value;
    if (!footnoteId) continue;

    const paraNodes = footnoteNode.children.filter((child) => child.name === 'Para');
    if (!paraNodes.length) continue;

    const paragraphs = paraNodes
      .map((paraNode) => parseParaLines(paraNode).map((line) => line.strings).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (!paragraphs.length) continue;
    footnoteContentById.set(String(footnoteId), paragraphs);
  }

  return footnoteContentById;
}

export function parseSemanticTree(tree, tables = []) {
  const root = { tag: '__root__', attrs: {}, children: [] };
  const stack = [root];
  const paraLines = collectByName(tree, 'ParaLine');
  const footnoteContentById = extractFootnoteContentMap(tree);
  const tableMapById = new Map(
    tables
      .filter((table) => table.id !== null && table.id !== undefined)
      .map((table) => [String(table.id), table]),
  );
  const fnoteMap = new Map();
  let fnoteCounter = 0;
  let pendingCasePageCapture = false;
  let nextIncrementalPageNo = null;
  let textRectPageMap = new Map();

  for (const paraLine of paraLines) {
    for (const token of paraLine.children ?? []) {
      if (token.name === 'ElementBegin') {
        const parsed = parseElementBegin(token);
        if (!parsed.tag) continue;
        if (parsed.tag === 'TCase') {
          pendingCasePageCapture = false;
          nextIncrementalPageNo = null;
          textRectPageMap = new Map();
        }
        const node = {
          tag: parsed.tag,
          attrs: parsed.attrs,
          children: [],
          _inSuffix: false,
        };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      } else if (token.name === 'ElementEnd') {
        const closeTag = token.value;
        if (!closeTag) continue;
        while (stack.length > 1 && stack[stack.length - 1].tag !== closeTag) stack.pop();
        if (stack.length > 1) stack.pop();
      } else if (token.name === 'PrefixEnd') {
        const current = stack[stack.length - 1];
        if (current?.children?.length) {
          current.children = current.children.filter((child) => typeof child !== 'string');
        }
      } else if (token.name === 'XRef') {
        const isCurrentCasePageRef = (token.children ?? []).some(
          (child) => child.name === 'XRefName' && child.value === 'CurCasepagenum',
        );
        if (isCurrentCasePageRef) pendingCasePageCapture = true;
      } else if (token.name === 'TextRectID') {
        const textRectId = token.value ?? null;
        if (!textRectId || nextIncrementalPageNo === null || textRectPageMap.has(textRectId)) continue;
        const pageNo = String(nextIncrementalPageNo);
        textRectPageMap.set(textRectId, pageNo);
        stack[stack.length - 1].children.push({ tag: 'page', attrs: { no: pageNo }, children: [] });
        nextIncrementalPageNo += 1;
      } else if (token.name === 'SuffixBegin') {
        const current = stack[stack.length - 1];
        if (current) current._inSuffix = true;
      } else if (token.name === 'String') {
        let consumedAsCasePageRef = false;
        if (pendingCasePageCapture) {
          const parsedPage = Number.parseInt(token.value ?? '', 10);
          if (Number.isFinite(parsedPage)) {
            nextIncrementalPageNo = parsedPage + 1;
            pendingCasePageCapture = false;
            consumedAsCasePageRef = true;
          }
        }
        const current = stack[stack.length - 1];
        if (!current?._inSuffix && !consumedAsCasePageRef) appendText(current, token.value ?? '');
      } else if (token.name === 'Char') {
        const current = stack[stack.length - 1];
        if (current?._inSuffix) continue;
        if (token.value === 'HardReturn') appendText(current, '\n');
        if (token.value === 'DiscHyphen') appendText(current, '-');
      } else if (token.name === 'ATbl') {
        const current = stack[stack.length - 1];
        if (current?._inSuffix) continue;
        const atblId = String(token.value ?? '').trim();
        const table = tableMapById.get(atblId);
        if (table) {
          current.children.push(buildSemanticTableNode(table));
        } else {
          current.children.push({ tag: 'TableRef', attrs: { id: atblId }, children: [] });
        }
      } else if (token.name === 'FNote') {
        const raw = token.value ?? '';
        const paragraphs = footnoteContentById.get(String(raw).trim()) ?? [];
        if (paragraphs.length) {
          stack[stack.length - 1].children.push({
            tag: 'Footnote',
            attrs: {},
            children: paragraphs.map((text) => ({ tag: 'Para', attrs: {}, children: [text] })),
          });
        } else {
          if (!fnoteMap.has(raw)) {
            fnoteCounter += 1;
            fnoteMap.set(raw, String(fnoteCounter));
          }
          stack[stack.length - 1].children.push({ tag: 'Footnote', attrs: {}, children: [fnoteMap.get(raw)] });
        }
      }
    }
  }

  // Strip parser-internal state keys.
  const stripInternal = (node) => {
    if (typeof node !== 'object' || node === null) return node;
    if (Array.isArray(node.children)) node.children = node.children.map(stripInternal);
    delete node._inSuffix;
    return node;
  };
  stripInternal(root);

  return root;
}
