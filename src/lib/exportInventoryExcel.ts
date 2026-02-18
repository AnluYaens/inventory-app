export interface InventoryExcelRow {
  storeName: string;
  sku: string;
  description: string;
  category: string;
  size: string;
  color: string;
  quantity: number;
  unitCostEur: number;
  totalCostEur: number;
  finalPrice: number;
  buyer: string;
  saleDate: string;
}

const COLOR_MAP: Record<string, string> = {
  negro: "#1F2937",
  black: "#1F2937",
  blanco: "#F8FAFC",
  white: "#F8FAFC",
  gris: "#9CA3AF",
  gray: "#9CA3AF",
  rojo: "#DC2626",
  red: "#DC2626",
  vino: "#7F1D1D",
  azul: "#2563EB",
  blue: "#2563EB",
  marino: "#1E3A8A",
  navy: "#1E3A8A",
  celeste: "#0EA5E9",
  cyan: "#06B6D4",
  turquesa: "#14B8A6",
  verde: "#16A34A",
  green: "#16A34A",
  oliva: "#4D7C0F",
  amarillo: "#EAB308",
  yellow: "#EAB308",
  naranja: "#F97316",
  orange: "#F97316",
  rosa: "#EC4899",
  pink: "#EC4899",
  morado: "#7C3AED",
  purple: "#7C3AED",
  beige: "#D6C6A8",
  hueso: "#EDE9D0",
  crema: "#F5E9C9",
  marron: "#7C4A2D",
  cafe: "#7C4A2D",
  brown: "#7C4A2D",
  dorado: "#D4AF37",
  plateado: "#C0C0C0",
};

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

interface StyleBuildResult {
  stylesXml: string;
  colorStyleByHex: Map<string, number>;
}

const HEADER_TITLES = [
  "Tienda",
  "Código Prenda",
  "Descripción Prenda",
  "Categoría",
  "Talla",
  "Color",
  "Cantidad",
  "Compra (Euros)",
  "Monto Comp",
  "Precio final",
  "Compradora",
  "Fecha de venta",
];

const BASE_STYLE = {
  text: 0,
  header: 1,
  center: 2,
  integer: 3,
  money: 4,
  colorStart: 5,
} as const;

const UTF8 = new TextEncoder();

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function escapeXml(value: string): string {
  let sanitized = "";
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    const isValidXmlChar =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (isValidXmlChar) sanitized += char;
  }

  return sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeColorToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeHexColor(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hexMatch) return null;

  const hex = hexMatch[1];
  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toUpperCase()}`;
  }
  return `#${hex.toUpperCase()}`;
}

function resolveColorHex(color: string): string | null {
  const hexColor = normalizeHexColor(color);
  if (hexColor) return hexColor;

  const normalized = normalizeColorToken(color);
  if (!normalized) return null;

  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized];

  const byParts = normalized.split(/[/,;|()-]+/).map((part) => part.trim());
  for (const part of byParts) {
    if (part && COLOR_MAP[part]) return COLOR_MAP[part];
  }

  const found = Object.entries(COLOR_MAP).find(([name]) =>
    normalized.includes(name),
  );
  return found?.[1] ?? null;
}

function isDarkColor(hexColor: string): boolean {
  const hex = hexColor.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
  return luminance < 150;
}

function toArgb(hexColor: string): string {
  return `FF${hexColor.replace("#", "").toUpperCase()}`;
}

function columnLabel(col: number): string {
  let value = col;
  let label = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function buildStringCell(ref: string, value: string, style: number): string {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${escapeXml(value)}</t></is></c>`;
}

function buildNumberCell(ref: string, value: number, style: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `<c r="${ref}" s="${style}"><v>${safeValue}</v></c>`;
}

function buildStyles(rows: InventoryExcelRow[]): StyleBuildResult {
  const uniqueColors = new Map<string, { hex: string; dark: boolean }>();
  for (const row of rows) {
    const color = resolveColorHex(row.color);
    if (!color || uniqueColors.has(color)) continue;
    uniqueColors.set(color, { hex: color, dark: isDarkColor(color) });
  }

  const colorList = Array.from(uniqueColors.values());
  const colorStyleByHex = new Map<string, number>();

  const dynamicFillsXml = colorList
    .map(
      (item) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="${toArgb(item.hex)}"/><bgColor indexed="64"/></patternFill></fill>`,
    )
    .join("");

  const dynamicXfsXml = colorList
    .map((item, idx) => {
      const styleIndex = BASE_STYLE.colorStart + idx;
      const fillId = 3 + idx;
      const fontId = item.dark ? 2 : 1;
      colorStyleByHex.set(item.hex, styleIndex);
      return `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`;
    })
    .join("");

  const cellXfsCount = BASE_STYLE.colorStart + colorList.length;
  const fillCount = 3 + colorList.length;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="0"/>
    <numFmt numFmtId="165" formatCode="0.00"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="${fillCount}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFBFD2F1"/><bgColor indexed="64"/></patternFill></fill>
    ${dynamicFillsXml}
  </fills>
  <borders count="2">
    <border/>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="${cellXfsCount}">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    ${dynamicXfsXml}
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

  return { stylesXml, colorStyleByHex };
}

function buildSheetXml(
  rows: InventoryExcelRow[],
  colorStyleByHex: Map<string, number>,
): string {
  const maxRow = Math.max(1, rows.length + 1);
  const dimension = `A1:L${maxRow}`;
  const colWidths = [16, 26, 38, 20, 9, 14, 11, 14, 14, 13, 26, 16];
  const colsXml = colWidths
    .map(
      (width, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");

  const headerCells = HEADER_TITLES.map((title, idx) =>
    buildStringCell(`${columnLabel(idx + 1)}1`, title, BASE_STYLE.header),
  ).join("");
  const headerRow = `<row r="1" ht="23" customHeight="1">${headerCells}</row>`;

  const dataRows = rows
    .map((row, idx) => {
      const rowNo = idx + 2;
      const colorValue = row.color.trim() || "Sin color";
      const buyer = row.buyer.trim() || "-";
      const saleDate = row.saleDate.trim() || "-";

      const resolvedColor = resolveColorHex(row.color);
      let colorStyle: number = BASE_STYLE.center;
      if (resolvedColor) {
        colorStyle = colorStyleByHex.get(resolvedColor) ?? BASE_STYLE.center;
      }

      return `<row r="${rowNo}">
        ${buildStringCell(`A${rowNo}`, row.storeName, BASE_STYLE.text)}
        ${buildStringCell(`B${rowNo}`, row.sku, BASE_STYLE.text)}
        ${buildStringCell(`C${rowNo}`, row.description, BASE_STYLE.text)}
        ${buildStringCell(`D${rowNo}`, row.category, BASE_STYLE.text)}
        ${buildStringCell(`E${rowNo}`, row.size, BASE_STYLE.center)}
        ${buildStringCell(`F${rowNo}`, colorValue, colorStyle)}
        ${buildNumberCell(`G${rowNo}`, Math.trunc(row.quantity), BASE_STYLE.integer)}
        ${buildNumberCell(`H${rowNo}`, row.unitCostEur, BASE_STYLE.money)}
        ${buildNumberCell(`I${rowNo}`, row.totalCostEur, BASE_STYLE.money)}
        ${buildNumberCell(`J${rowNo}`, row.finalPrice, BASE_STYLE.money)}
        ${buildStringCell(`K${rowNo}`, buyer, BASE_STYLE.text)}
        ${buildStringCell(`L${rowNo}`, saleDate, BASE_STYLE.center)}
      </row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colsXml}</cols>
  <sheetData>${headerRow}${dataRows}</sheetData>
  <autoFilter ref="A1:L1"/>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildContentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function buildRootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildWorkbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Inventario" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildAppPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
</Properties>`;
}

function buildCorePropsXml(): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>StockFlow</dc:creator>
  <cp:lastModifiedBy>StockFlow</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate, dosTime };
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function createZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const now = new Date();
  const { dosDate, dosTime } = toDosDateTime(now);

  for (const entry of entries) {
    const nameBytes = UTF8.encode(entry.name);
    const data = entry.data;
    const checksum = crc32(data);
    const size = data.length;
    const flagUtf8 = 0x0800;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flagUtf8, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flagUtf8, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const locals = concatBytes(localParts);

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, locals.length, true);
  endView.setUint16(20, 0, true);

  return concatBytes([locals, centralDirectory, endRecord]);
}

function buildXlsxBytes(rows: InventoryExcelRow[]): Uint8Array {
  const { stylesXml, colorStyleByHex } = buildStyles(rows);
  const sheetXml = buildSheetXml(rows, colorStyleByHex);

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: UTF8.encode(buildContentTypesXml()) },
    { name: "_rels/.rels", data: UTF8.encode(buildRootRelsXml()) },
    { name: "docProps/app.xml", data: UTF8.encode(buildAppPropsXml()) },
    { name: "docProps/core.xml", data: UTF8.encode(buildCorePropsXml()) },
    { name: "xl/workbook.xml", data: UTF8.encode(buildWorkbookXml()) },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: UTF8.encode(buildWorkbookRelsXml()),
    },
    { name: "xl/styles.xml", data: UTF8.encode(stylesXml) },
    { name: "xl/worksheets/sheet1.xml", data: UTF8.encode(sheetXml) },
  ];

  return createZip(entries);
}

export function exportInventoryToExcel(rows: InventoryExcelRow[]): void {
  const sortedRows = [...rows].sort((a, b) =>
    a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" }),
  );

  const xlsxBytes = buildXlsxBytes(sortedRows);
  const safeBytes = new Uint8Array(xlsxBytes.length);
  safeBytes.set(xlsxBytes);

  const blob = new Blob([safeBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);

  anchor.href = url;
  anchor.download = `inventario-export-${dateStamp}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
