/**
 * Gerador mínimo de .xlsx (Office Open XML) sem dependência externa.
 *
 * Um .xlsx é um zip de arquivos XML. Aqui o zip é montado "sem compressão"
 * (método 0, store) — não precisa de lib de deflate e o Excel abre normal; o
 * arquivo só fica um pouco maior, o que não pesa pra uma planilha de tarefas.
 * Evita adicionar dependência (e mexer em bun.lock/package-lock.json) só pra
 * exportar uma tabela.
 */

export type XlsxCell =
  | string
  | number
  | null
  | undefined
  /** 'YYYY-MM-DD' (ou ISO — só a data é usada). Vira data de verdade no Excel, filtrável/ordenável. */
  | { date: string }
  /** Timestamp ISO. Vira data+hora (horário local do navegador). */
  | { datetime: string };

export type XlsxColumn = { header: string; width?: number };

export type XlsxSheet = { name: string; columns: XlsxColumn[]; rows: XlsxCell[][] };

const EPOCH_1899 = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** Limite de caracteres por célula do Excel é 32.767. */
const MAX_CELL_CHARS = 32_000;

const STYLE_HEADER = 1;
const STYLE_DATE = 2;
const STYLE_DATETIME = 3;

function escapeXml(s: string): string {
  return (
    s
      // caracteres de controle (exceto tab/LF/CR) são inválidos em XML 1.0 e corrompem o arquivo
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function dateSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EPOCH_1899) / DAY_MS;
}

function datetimeSerial(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getTime() - d.getTimezoneOffset() * 60_000 - EPOCH_1899) / DAY_MS;
}

function cellXml(ref: string, cell: XlsxCell): string {
  if (cell === null || cell === undefined || cell === "") return "";
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? `<c r="${ref}"><v>${cell}</v></c>` : "";
  }
  if (typeof cell === "string") {
    const text = cell.length > MAX_CELL_CHARS ? `${cell.slice(0, MAX_CELL_CHARS)}…` : cell;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }
  if ("date" in cell) {
    const serial = dateSerial(cell.date);
    return serial === null ? cellXml(ref, cell.date) : `<c r="${ref}" s="${STYLE_DATE}"><v>${serial}</v></c>`;
  }
  const serial = datetimeSerial(cell.datetime);
  return serial === null ? cellXml(ref, cell.datetime) : `<c r="${ref}" s="${STYLE_DATETIME}"><v>${serial}</v></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const colCount = sheet.columns.length;
  const lastCol = colLetter(Math.max(colCount - 1, 0));
  const lastRow = sheet.rows.length + 1;

  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join("");

  const header =
    `<row r="1" ht="30" customHeight="1">` +
    sheet.columns
      .map(
        (c, i) =>
          `<c r="${colLetter(i)}1" s="${STYLE_HEADER}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(c.header)}</t></is></c>`,
      )
      .join("") +
    `</row>`;

  const body = sheet.rows
    .map((row, r) => {
      const rowNum = r + 2;
      const cells = row.map((cell, c) => cellXml(`${colLetter(c)}${rowNum}`, cell)).join("");
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${header}${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function safeSheetName(name: string): string {
  return name.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Planilha";
}

/* ---------------- zip (store, sem compressão) ---------------- */

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const entries = files.map((f) => ({
    nameBytes: enc.encode(f.name),
    data: f.data,
    crc: crc32(f.data),
    offset: 0,
  }));

  let size = 22;
  for (const e of entries) size += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let pos = 0;

  for (const e of entries) {
    e.offset = pos;
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true); // versão necessária
    view.setUint16(pos + 6, 0x0800, true); // flag: nomes em UTF-8
    view.setUint16(pos + 8, 0, true); // método 0 = store
    view.setUint16(pos + 10, dosTime, true);
    view.setUint16(pos + 12, dosDate, true);
    view.setUint32(pos + 14, e.crc, true);
    view.setUint32(pos + 18, e.data.length, true);
    view.setUint32(pos + 22, e.data.length, true);
    view.setUint16(pos + 26, e.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(e.nameBytes, pos + 30);
    out.set(e.data, pos + 30 + e.nameBytes.length);
    pos += 30 + e.nameBytes.length + e.data.length;
  }

  const centralStart = pos;
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true); // versão de criação
    view.setUint16(pos + 6, 20, true); // versão necessária
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, dosTime, true);
    view.setUint16(pos + 14, dosDate, true);
    view.setUint32(pos + 16, e.crc, true);
    view.setUint32(pos + 20, e.data.length, true);
    view.setUint32(pos + 24, e.data.length, true);
    view.setUint16(pos + 28, e.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true); // extra
    view.setUint16(pos + 32, 0, true); // comentário
    view.setUint16(pos + 34, 0, true); // disco
    view.setUint16(pos + 36, 0, true); // atributos internos
    view.setUint32(pos + 38, 0, true); // atributos externos
    view.setUint32(pos + 42, e.offset, true);
    out.set(e.nameBytes, pos + 46);
    pos += 46 + e.nameBytes.length;
  }

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

/** Monta o arquivo .xlsx (bytes) com uma planilha. */
export function buildXlsx(sheet: XlsxSheet): Uint8Array {
  const enc = new TextEncoder();
  const name = safeSheetName(sheet.name);
  const lastCol = colLetter(Math.max(sheet.columns.length - 1, 0));
  const lastRow = sheet.rows.length + 1;

  const files = [
    {
      name: "[Content_Types].xml",
      text:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      text:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${escapeXml(name.replace(/'/g, "''"))}'!$A$1:$${lastCol}$${lastRow}</definedName></definedNames>` +
        `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/styles.xml", text: STYLES_XML },
    { name: "xl/worksheets/sheet1.xml", text: sheetXml(sheet) },
  ];

  return zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
}

/** Baixa os bytes como arquivo .xlsx no navegador. */
export function downloadXlsx(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
