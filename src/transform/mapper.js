function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const rawXml = (xml) => ({ __rawXml: xml });
const FORCE_EXPANDED_TAGS = new Set(['Pagenum']);

function normalizeTagAttributes(tag, attrs = {}) {
  const normalized = { ...attrs };

  if (tag === 'TJudge') {
    normalized.Position1 = normalized.Position1 && String(normalized.Position1).trim() ? normalized.Position1 : 'None';
    normalized.Position2 = normalized.Position2 && String(normalized.Position2).trim() ? normalized.Position2 : 'None';
    return {
      Position1: normalized.Position1,
      Position2: normalized.Position2,
      ...Object.fromEntries(
        Object.entries(normalized).filter(([key]) => key !== 'Position1' && key !== 'Position2'),
      ),
    };
  }

  if (tag === 'Date') {
    return {
      Month: normalized.Month,
      Date: normalized.Date,
      Year: normalized.Year,
      ...Object.fromEntries(
        Object.entries(normalized).filter(([key]) => key !== 'Month' && key !== 'Date' && key !== 'Year'),
      ),
    };
  }

  return normalized;
}

function buildXml(tag, attrs = {}, children = [], indent = 0) {
  const pad = '  '.repeat(indent);
  const attrEntries = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const attrText = attrEntries.length
    ? ` ${attrEntries.map(([k, v]) => `${k}="${escapeXml(String(v))}"`).join(' ')}`
    : '';

  if (!children.length && !FORCE_EXPANDED_TAGS.has(tag)) return `${pad}<${tag}${attrText}/>`;
  if (!children.length && FORCE_EXPANDED_TAGS.has(tag)) return `${pad}<${tag}${attrText}></${tag}>`;

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
  const normalizedAttrs = normalizeTagAttributes(node.tag, node.attrs ?? {});
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

  return buildXml(node.tag, normalizedAttrs, childNodes, indent);
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

  const normalizedAttrs = { ...semanticNode.attrs };
  const orderedCaseAttrs =
    tagName === 'TCase' || tagName === 'Case'
      ? {
          ID: normalizedAttrs.ID,
          Shtitle: normalizedAttrs.Shtitle,
          Appendix: normalizedAttrs.Appendix ?? 'N',
          ...Object.fromEntries(
            Object.entries(normalizedAttrs).filter(([key]) => key !== 'ID' && key !== 'Shtitle' && key !== 'Appendix'),
          ),
        }
      : { ...normalizedAttrs, Appendix: normalizedAttrs.Appendix ?? 'N' };

  return buildXml(tagName, orderedCaseAttrs, mappedChildren, 0);
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

    const normalizedAttrs = { ...semanticNode.attrs };
    const orderedCaseAttrs =
      tagName === 'TCase' || tagName === 'Case'
        ? {
            ID: normalizedAttrs.ID,
            Shtitle: normalizedAttrs.Shtitle,
            Appendix: normalizedAttrs.Appendix ?? 'N',
            ...Object.fromEntries(
              Object.entries(normalizedAttrs).filter(([key]) => key !== 'ID' && key !== 'Shtitle' && key !== 'Appendix'),
            ),
          }
        : { ...normalizedAttrs, Appendix: normalizedAttrs.Appendix ?? 'N' };

    return {
      id: semanticNode.attrs?.ID,
      tag: tagName,
      xml: `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml(tagName, orderedCaseAttrs, mappedChildren, 0)}\n`,
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
        'TABLE',
        { ID: String(t.id ?? t.index + 1), BORDER: '1' },
        t.rows.map((row) =>
          rawXml(
            buildXml(
              'TR',
              {},
              row.cells.map((cell) =>
                rawXml(
                  buildXml(
                    'TD',
                    {
                      ...(cell.rowSpan > 1 ? { ROWSPAN: String(cell.rowSpan) } : {}),
                      ...(cell.colSpan > 1 ? { COLSPAN: String(cell.colSpan) } : {}),
                      ALIGN: 'LEFT',
                      VALIGN: 'TOP',
                    },
                    cell.text ? [rawXml(buildXml('P', {}, [cell.text], 6))] : [],
                    5,
                  ),
                ),
              ),
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
