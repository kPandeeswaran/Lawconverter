# Lawconverter (MIF → XML)

Node.js pipeline to convert Adobe FrameMaker MIF files into structured XML using sample XML files as a dynamic schema guide.

## Project structure

- `mif/` → input `.mif`
- `sample/` → reference XML files
- `output/` → generated XML
- `src/parser/mifParser.js` → MIF structural parser utilities
- `src/analysis/sampleAnalyzer.js` → dynamic sample XML rule inference
- `src/transform/mapper.js` → MIF AST → XML transformation
- `src/io/filePipeline.js` → file read/write orchestration
- `src/index.js` → executable conversion script

## Parsing strategy

### 1) MIF structure interpretation

MIF uses nested angle-bracket records:

- Block start: `<Para` / `<ParaLine` / `<ElementBegin` ...
- Inline value records: `<String `text'>`, `<PgfTag `s10'>`, `<TextRectID 128>`
- Block end: `>`

The parser does a single pass with a stack and builds a tree.

### 2) Reusable parser functions

Implemented in `src/parser/mifParser.js`:

- `parseTextRects()`
- `parseParagraphs()`
- `parseParaLines()`
- `extractStrings()`
- plus `parseTables()` for table support

Hierarchy preserved:

`TextRect → Para → ParaLine → String`

### 3) Dynamic mapping from sample XML

`src/analysis/sampleAnalyzer.js` scans every sample XML file and infers:

- dominant root tag (`preferredRoot`)
- preferred narrative container (`preferredBodyTag`)
- common tag vocabulary

This avoids hardcoding to a single XML skeleton.

### 4) Transformation

`src/transform/mapper.js`:

- maps paragraph styles (`Para`, `Para2`, `Para3`, numbering/quotation styles)
- preserves inline text and line boundaries
- emits table rows/cells if present
- escapes XML special characters and writes UTF-8

### 5) Scalability and robustness

- single-pass parsing (O(n) line scan)
- modular pipeline for easy parallelization later
- error handling per-file so one bad input doesn't stop batch processing
- leveled logs (`LOG_LEVEL=debug` for deep diagnostics)

## Run

```bash
npm run convert
```

Debug mode:

```bash
npm run convert:debug
```

## Example

Input: `mif/133_1.mif`

Output: `output/133_1.xml`

The output root/body tags are inferred from `sample/*.xml`, then filled with converted MIF paragraphs and tables.

## Semantic split mode

When semantic markup contains `ElementBegin` records whose `ETag` is `TCase`, the converter now treats `TCase` as a base split tag and writes one XML file per case.

- Naming pattern: `<mif-basename>_<TCase.ID>.xml`
- If `ID` is missing/unsafe, fallback naming is `<mif-basename>_TCase_<n>.xml`
