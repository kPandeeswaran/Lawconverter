function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const rawXml = (xml) => ({ __rawXml: xml });

function buildXml(tag, attrs = {}, children = [], indent = 0) {
  const pad = '  '.repeat(indent);
  const attrEntries = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const attrText = attrEntries.length
    ? ` ${attrEntries.map(([k, v]) => `${k}="${escapeXml(String(v))}"`).join(' ')}`
    : '';

  if (!children.length) return `${pad}<${tag}${attrText}/>`;

  const body = children
    .map((c) => {
      if (typeof c === 'string') return `${'  '.repeat(indent + 1)}${escapeXml(c)}`;
      if (c && typeof c === 'object' && '__rawXml' in c) return c.__rawXml;
      return `${'  '.repeat(indent + 1)}${escapeXml(String(c ?? ''))}`;
    })
    .join('\n');

  return `${pad}<${tag}${attrText}>\n${body}\n${pad}</${tag}>`;
}

function classifyParagraphTag(style) {
  if (/^para3$/i.test(style) || /^quotation/i.test(style)) return 'Para3';
  if (/^para2$/i.test(style) || /^numbered/i.test(style)) return 'Para2';
  return 'Para';
}

function collectText(node) {
  return (node.children ?? [])
    .map((child) => (typeof child === 'string' ? child : collectText(child)))
    .join('');
}

function findChildren(node, tag) {
  return (node.children ?? []).filter((child) => typeof child === 'object' && child.tag === tag);
}

function findFirstChild(node, tag) {
  return findChildren(node, tag)[0] ?? null;
}

function findFirstDescendant(node, predicate) {
  for (const child of node.children ?? []) {
    if (typeof child !== 'object') continue;
    if (predicate(child)) return child;
    const nested = findFirstDescendant(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function normalizeSpace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanBenchText(text) {
  return normalizeSpace(text.replace(/\]/g, '').replace(/^\s*[—-]\s*/, ''));
}

function renderSemanticNode(node, indent = 1) {
  const childNodes = [];
  let pendingText = '';

  for (const child of node.children ?? []) {
    if (typeof child === 'string') {
      if (node.tag === 'ApellantGroup' && normalizeSpace(child).toLowerCase() === 'v.') continue;
      pendingText += child;
      continue;
    }
    if (pendingText.trim()) childNodes.push(normalizeSpace(pendingText));
    pendingText = '';
    childNodes.push(rawXml(renderSemanticNode(child, indent + 1)));
  }
  if (pendingText.trim()) childNodes.push(normalizeSpace(pendingText));

  return buildXml(node.tag, node.attrs ?? {}, childNodes, indent);
}

function mapSemanticNode(semanticTree, tagName, requiredAttrs = []) {
  const semanticNode = findFirstDescendant(
    semanticTree,
    (node) =>
      node.tag === tagName &&
      requiredAttrs.every((attr) => {
        const value = node.attrs?.[attr];
        return value !== undefined && value !== null && String(value).trim() !== '';
      }),
  );

  if (!semanticNode) return null;

  const mappedChildren = (semanticNode.children ?? [])
    .filter((child) => typeof child === 'object')
    .map((child) => rawXml(renderSemanticNode(child, 1)));

  return buildXml(tagName, { ...semanticNode.attrs, Appendix: semanticNode.attrs?.Appendix ?? 'N' }, mappedChildren, 0);
}

function mapSemanticNodesByTag(semanticTree, tagName, requiredAttrs = []) {
  const nodes = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      node.tag === tagName &&
      requiredAttrs.every((attr) => {
        const value = node.attrs?.[attr];
        return value !== undefined && value !== null && String(value).trim() !== '';
      })
    ) {
      nodes.push(node);
    }
    for (const child of node.children ?? []) {
      if (typeof child === 'object') walk(child);
    }
  };

  walk(semanticTree);

  return nodes.map((semanticNode) => {
    const mappedChildren = (semanticNode.children ?? [])
      .filter((child) => typeof child === 'object')
      .map((child) => rawXml(renderSemanticNode(child, 1)));

    return {
      id: semanticNode.attrs?.ID,
      tag: tagName,
      xml: `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml(tagName, { ...semanticNode.attrs, Appendix: semanticNode.attrs?.Appendix ?? 'N' }, mappedChildren, 0)}\n`,
    };
  });
}

export function transformMifToXml(parsed, inferredSchema, sourceName) {
  const { textRects, tables, semanticTree } = parsed;

  const semanticXml = semanticTree
    ? mapSemanticNode(semanticTree, 'TCase', ['ID', 'Shtitle']) ?? mapSemanticNode(semanticTree, 'Case', ['ID'])
    : null;
  if (semanticXml) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${semanticXml}\n`;
  }

  const textRectNodes = textRects.map((rect) => {
    const paraNodes = rect.paragraphs
      .filter((p) => p.text.length)
      .map((p) => {
        const lineNodes = p.paraLines
          .filter((l) => l.strings.trim().length)
          .map((l) => rawXml(buildXml('ParaLine', { index: l.index }, [rawXml(buildXml('String', {}, [l.strings], 5))], 4)));

        const tagName = classifyParagraphTag(p.style);
        return rawXml(buildXml(tagName, { style: p.style }, lineNodes.length ? lineNodes : [p.text], 3));
      });

    return rawXml(buildXml('TextRect', { id: rect.textRectId }, paraNodes, 2));
  });

  const tableNodes = tables.map((t) =>
    rawXml(
      buildXml(
        'Table',
        { index: t.index },
        t.rows.map((row) =>
          rawXml(
            buildXml(
              'Row',
              { index: row.rowIndex },
              row.cells.map((cell) => rawXml(buildXml('Cell', { index: cell.cellIndex }, cell.text ? [cell.text] : [], 5))),
              4,
            ),
          ),
        ),
        2,
      ),
    ),
  );

  const bodyChildren = [...textRectNodes, ...tableNodes];

  const body = rawXml(
    buildXml(
      inferredSchema.preferredBodyTag,
      inferredSchema.preferredBodyTag === 'JudgmentGroup' ? { Title: 'Converted from MIF' } : {},
      bodyChildren,
      1,
    ),
  );

  const root = buildXml(
    inferredSchema.preferredRoot,
    {
      source: sourceName,
      generatedBy: 'lawconverter-node',
      schemaMode: 'inferred-from-sample',
    },
    [body],
    0,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n`;
}

export function transformMifToSplitXmlByTag(parsed, baseTag) {
  if (!parsed?.semanticTree) return [];

  const splitTags = Array.isArray(baseTag) ? baseTag : [baseTag];
  const normalizedTags = splitTags.map((tag) => String(tag ?? '').trim()).filter(Boolean);

  for (const tag of normalizedTags) {
    const requiredAttrs = tag === 'TCase' ? ['ID', 'Shtitle'] : tag === 'Case' ? ['ID'] : [];
    const splitNodes = mapSemanticNodesByTag(parsed.semanticTree, tag, requiredAttrs);
    if (splitNodes.length) return splitNodes;
  }

  return [];
}
