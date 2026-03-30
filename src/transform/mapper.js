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

export function transformMifToXml(parsed, inferredSchema, sourceName) {
  const { textRects, tables } = parsed;

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
