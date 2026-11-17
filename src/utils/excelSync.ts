import { DEPT_CATALOG } from '../data/seedData';
import { DepartmentId, Employee, ScheduleRecord, ShiftDef } from '../types/warehouse';
import {
  assignDailyShiftBucket,
  computeRangeAnalytics,
  formatShiftGroupLabel,
  getDatesInRange,
  getRecord,
  getShiftDef,
  getShiftEffectiveStdHours,
  getShiftStartTimeLabel,
  getVNWeekday,
  isOtLocked,
  isShiftLocked,
} from './analytics';

function xmlEscape(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colIndexToLetter(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function letterToColIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipUint8Array(entries: Array<{ name: string; content: string | Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localParts.push(lh, dataBytes);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    centralParts.push(ch);
    offset += lh.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  localParts.forEach((p) => {
    out.set(p, pos);
    pos += p.length;
  });
  centralParts.forEach((p) => {
    out.set(p, pos);
    pos += p.length;
  });
  out.set(eocd, pos);
  return out;
}

type CellValue = string | number | { formula: string; cached?: string | number };

function buildCellXml(rIdx: number, cIdx: number, val: CellValue, styleIdx: number): string {
  const ref = `${colIndexToLetter(cIdx)}${rIdx + 1}`;
  const sAttr = styleIdx ? ` s="${styleIdx}"` : '';
  if (val && typeof val === 'object' && 'formula' in val) {
    const cached = val.cached !== undefined && val.cached !== null ? String(val.cached) : '';
    return `<c r="${ref}"${sAttr} t="str"><f>${xmlEscape(val.formula)}</f><v>${xmlEscape(cached)}</v></c>`;
  }
  if (typeof val === 'number' && !isNaN(val)) {
    return `<c r="${ref}"${sAttr}><v>${val}</v></c>`;
  }
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t>${xmlEscape(val ?? '')}</t></is></c>`;
}

function buildWorksheetXml(rows: CellValue[][]): string {
  let rowsXml = '';
  rows.forEach((row, rIdx) => {
    let cellsXml = '';
    row.forEach((val, cIdx) => {
      if (val !== undefined && val !== null && val !== '') {
        cellsXml += buildCellXml(rIdx, cIdx, val, rIdx === 0 ? 1 : 0);
      } else if (rIdx === 0) {
        cellsXml += buildCellXml(rIdx, cIdx, '', 1);
      }
    });
    rowsXml += `<row r="${rIdx + 1}">${cellsXml}</row>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="20"/>` +
    `<cols>` +
    `<col min="1" max="1" width="16" customWidth="1"/>` +
    `<col min="2" max="2" width="14" customWidth="1"/>` +
    `<col min="3" max="3" width="24" customWidth="1"/>` +
    `<col min="4" max="5" width="18" customWidth="1"/>` +
    `<col min="6" max="8" width="16" customWidth="1"/>` +
    `</cols>` +
    `<sheetData>${rowsXml}</sheetData>` +
    `</worksheet>`
  );
}

export function downloadTemplateXlsx(
  employees: Employee[],
  records: Record<string, ScheduleRecord>,
  rangeStart: string,
  rangeEnd: string
) {
  const masterRows: CellValue[][] = [['Mã NV', 'Tên NV', 'Task', 'Vị trí', 'Trạng thái']];
  employees.forEach((emp) => {
    masterRows.push([emp.id, emp.name, emp.dept, emp.role, emp.status]);
  });

  const schedRows: CellValue[][] = [
    [
      'Ngày (YYYY-MM-DD)',
      'Mã NV',
      'Tên NV (VLOOKUP)',
      'Task (VLOOKUP)',
      'Vị trí (VLOOKUP)',
      'Mã Ca',
      'Giờ OT',
      'Ghi chú',
    ],
  ];

  const dates = getDatesInRange(rangeStart, rangeEnd);
  const activeEmps = employees.filter((e) => e.status === 'Active');
  let excelRow = 2;

  dates.forEach((d) => {
    activeEmps.forEach((emp) => {
      const rec = getRecord(records, d, emp.id);
      schedRows.push([
        d,
        emp.id,
        { formula: `IFERROR(VLOOKUP(B${excelRow},'Master Data'!$A$2:$E$500,2,FALSE),"")`, cached: emp.name },
        { formula: `IFERROR(VLOOKUP(B${excelRow},'Master Data'!$A$2:$E$500,3,FALSE),"")`, cached: emp.dept },
        { formula: `IFERROR(VLOOKUP(B${excelRow},'Master Data'!$A$2:$E$500,4,FALSE),"")`, cached: emp.role },
        rec.shiftCode,
        Number(rec.otHours || 0),
        rec.note || '',
      ]);
      excelRow++;
    });
  });

  for (let extra = 0; extra < 30; extra++) {
    schedRows.push([
      '',
      '',
      { formula: `IFERROR(VLOOKUP(B${excelRow},'Master Data'!$A$2:$E$500,2,FALSE),"")`, cached: '' },
      { formula: `IFERROR(VLOOKUP(B${excelRow},'Master Data'!$A$2:$E$500,3,FALSE),"")`, cached: '' },
      { formula: `IFERROR(VLOOKUP(B${excelRow},'Master Data'!$A$2:$E$500,4,FALSE),"")`, cached: '' },
      '',
      0,
      '',
    ]);
    excelRow++;
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    `<sheet name="Master Data" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Lịch Phân Ca" sheetId="2" r:id="rId2"/>` +
    `</sheets>` +
    `<calcPr calcId="191029" fullCalcOnLoad="1"/>` +
    `</workbook>`;

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F62FE"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>` +
    `</styleSheet>`;

  const zipBytes = buildZipUint8Array([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', content: buildWorksheetXml(masterRows) },
    { name: 'xl/worksheets/sheet2.xml', content: buildWorksheetXml(schedRows) },
  ]);

  const blob = new Blob([zipBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mau_phan_ca_kho_OB.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSummaryCsv(
  employees: Employee[],
  shifts: ShiftDef[],
  records: Record<string, ScheduleRecord>,
  rangeStart: string,
  rangeEnd: string
): string {
  const analytics = computeRangeAnalytics(employees, shifts, records, rangeStart, rangeEnd);
  const lines = ['Ngay,MaNV,TenNV,CongDoan,ViTri,MaCa,TenCa,NhomCa,GioChuan,GioOT,TongGioVH'];
  analytics.dates.forEach((d) => {
    analytics.activeEmps.forEach((emp) => {
      const rec = getRecord(records, d, emp.id);
      const sDef = getShiftDef(shifts, rec.shiftCode);
      const std = getShiftEffectiveStdHours(sDef);
      const ot = Number(rec.otHours || 0);
      lines.push(
        [
          d,
          emp.id,
          `"${emp.name.replace(/"/g, '""')}"`,
          emp.dept,
          `"${emp.role}"`,
          rec.shiftCode,
          `"${sDef.name}"`,
          formatShiftGroupLabel(sDef.group),
          std,
          ot,
          std + ot,
        ].join(',')
      );
    });
  });

  const csvContent = '\uFEFF' + lines.join('\n');
  const filename = `bao_cao_phan_ca_OB_${rangeStart}_${rangeEnd}.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

async function extractZipEntries(arrayBuffer: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error('File không phải định dạng ZIP/XLSX hợp lệ.');

  const totalEntries = dv.getUint16(eocdPos + 10, true);
  const cdOffset = dv.getUint32(eocdPos + 16, true);
  const decoder = new TextDecoder('utf-8');
  const files: Record<string, Uint8Array> = {};
  let ptr = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const compression = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localHeaderOffset = dv.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    const lhNameLen = dv.getUint16(localHeaderOffset + 26, true);
    const lhExtraLen = dv.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const rawSlice = bytes.subarray(dataStart, dataStart + compSize);

    if (compression === 0) {
      files[name] = rawSlice;
    } else if (compression === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Trình duyệt không hỗ trợ giải nén deflate-raw.');
      }
      const ds = new DecompressionStream('deflate-raw');
      const copySlice = new Uint8Array(rawSlice);
      const decompressed = await new Response(new Blob([copySlice.buffer]).stream().pipeThrough(ds)).arrayBuffer();
      files[name] = new Uint8Array(decompressed);
    }
  }
  return files;
}

function normalizeExcelDate(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number' || /^\d{5}(\.\d+)?$/.test(String(val).trim())) {
    const serial = Number(val);
    if (serial > 30000 && serial < 70000) {
      const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
      const dt = new Date(utc);
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
        dt.getUTCDate()
      ).padStart(2, '0')}`;
    }
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return '';
}

function parseWorksheetRows(xmlStr: string, sharedStrings: string[]): Array<Array<string | number>> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'application/xml');
  const rowNodes = Array.from(doc.getElementsByTagName('row'));
  const rows: Array<Array<string | number>> = [];
  rowNodes.forEach((rNode) => {
    const rowArr: Array<string | number> = [];
    const cells = Array.from(rNode.getElementsByTagName('c'));
    cells.forEach((cNode) => {
      const ref = cNode.getAttribute('r') || '';
      const colMatch = ref.match(/^([A-Z]+)/i);
      const cIdx = colMatch ? letterToColIndex(colMatch[1].toUpperCase()) : rowArr.length;
      const t = cNode.getAttribute('t') || 'n';
      let val: string | number = '';

      if (t === 'inlineStr') {
        const tNode = cNode.getElementsByTagName('t')[0];
        val = tNode ? tNode.textContent || '' : '';
      } else {
        const vNode = cNode.getElementsByTagName('v')[0];
        const raw = vNode ? vNode.textContent || '' : '';
        if (t === 's') {
          val = sharedStrings[Number(raw)] !== undefined ? sharedStrings[Number(raw)] : '';
        } else if (t === 'str' || t === 'b' || t === 'e') {
          val = raw;
        } else {
          val = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
        }
      }
      rowArr[cIdx] = val;
    });
    rows.push(rowArr);
  });
  return rows;
}

export async function parseAndImportScheduleFile(params: {
  file: File;
  employees: Employee[];
  records: Record<string, ScheduleRecord>;
  simClock: string;
  strictLock: boolean;
}): Promise<{
  employees: Employee[];
  records: Record<string, ScheduleRecord>;
  masterUpdated: number;
  schedUpdated: number;
  skippedLocked: number;
}> {
  const { file, simClock, strictLock } = params;
  const nextEmployees = params.employees.map((e) => ({ ...e }));
  const nextRecords: Record<string, ScheduleRecord> = { ...params.records };
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let masterUpdated = 0;
  let schedUpdated = 0;
  let skippedLocked = 0;

  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const dateYmd = normalizeExcelDate(cols[0]);
      const empId = (cols[1] || '').toUpperCase();
      const shiftCode = (cols[5] || cols[2] || '').toUpperCase();
      const otHours = Number(cols[9] !== undefined ? cols[9] : cols[6]) || 0;
      if (!dateYmd || !empId || !shiftCode) continue;

      const sLock = isShiftLocked(dateYmd, simClock);
      const oLock = isOtLocked(dateYmd, simClock);
      const cur = getRecord(nextRecords, dateYmd, empId);
      const nextShift = strictLock && sLock.locked ? cur.shiftCode : shiftCode;
      const nextOt = strictLock && oLock.locked ? cur.otHours : otHours;
      if (strictLock && sLock.locked && oLock.locked) {
        skippedLocked++;
      } else {
        nextRecords[`${dateYmd}|${empId}`] = { shiftCode: nextShift, otHours: nextOt, note: 'Import CSV' };
        schedUpdated++;
      }
    }
  } else {
    const files = await extractZipEntries(buf);
    const decoder = new TextDecoder('utf-8');
    const parser = new DOMParser();

    const sharedStrings: string[] = [];
    if (files['xl/sharedStrings.xml']) {
      const ssDoc = parser.parseFromString(decoder.decode(files['xl/sharedStrings.xml']), 'application/xml');
      Array.from(ssDoc.getElementsByTagName('si')).forEach((si) => {
        const tParts = Array.from(si.getElementsByTagName('t')).map((t) => t.textContent || '');
        sharedStrings.push(tParts.join(''));
      });
    }

    const sheetFiles: Record<string, string> = {};
    if (files['xl/workbook.xml'] && files['xl/_rels/workbook.xml.rels']) {
      const wbDoc = parser.parseFromString(decoder.decode(files['xl/workbook.xml']), 'application/xml');
      const relDoc = parser.parseFromString(decoder.decode(files['xl/_rels/workbook.xml.rels']), 'application/xml');
      const relMap: Record<string, string> = {};
      Array.from(relDoc.getElementsByTagName('Relationship')).forEach((r) => {
        const id = r.getAttribute('Id');
        const target = r.getAttribute('Target');
        if (id && target) relMap[id] = target;
      });
      Array.from(wbDoc.getElementsByTagName('sheet')).forEach((s) => {
        const sName = (s.getAttribute('name') || '').trim();
        const rId = s.getAttribute('r:id');
        const target = rId ? relMap[rId] : '';
        if (target) {
          sheetFiles[sName] = target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
        }
      });
    }

    const masterPath = sheetFiles['Master Data'] || 'xl/worksheets/sheet1.xml';
    const schedPath = sheetFiles['Lịch Phân Ca'] || 'xl/worksheets/sheet2.xml';

    if (files[masterPath]) {
      const mRows = parseWorksheetRows(decoder.decode(files[masterPath]), sharedStrings);
      for (let i = 1; i < mRows.length; i++) {
        const r = mRows[i];
        const empId = String(r[0] || '').trim().toUpperCase();
        const empName = String(r[1] || '').trim();
        const empDept = String(r[2] || '').trim();
        const empRole = String(r[3] || '').trim();
        const empStatus = String(r[4] || 'Active').trim();
        if (!empId || !empName) continue;
        const validDept = DEPT_CATALOG.find((d) => d.id.toLowerCase() === empDept.toLowerCase());
        const finalDept: DepartmentId = validDept ? validDept.id : 'Pick';
        const idx = nextEmployees.findIndex((e) => e.id === empId);
        const obj: Employee = {
          id: empId,
          name: empName,
          dept: finalDept,
          role: empRole || 'Picker FTE',
          status: empStatus === 'Inactive' ? 'Inactive' : 'Active',
        };
        if (idx >= 0) nextEmployees[idx] = obj;
        else nextEmployees.push(obj);
        masterUpdated++;
      }
    }

    if (files[schedPath]) {
      const sRows = parseWorksheetRows(decoder.decode(files[schedPath]), sharedStrings);
      for (let i = 1; i < sRows.length; i++) {
        const r = sRows[i];
        const dateYmd = normalizeExcelDate(r[0]);
        const empId = String(r[1] || '').trim().toUpperCase();
        const shiftCode = String(r[5] || '').trim().toUpperCase();
        const otHours = Math.max(0, Number(r[6]) || 0);
        const note = String(r[7] || '').trim();
        if (!dateYmd || !empId || !shiftCode) continue;

        const masterEmp = nextEmployees.find((e) => e.id === empId);
        if (!masterEmp) continue;

        const sLock = isShiftLocked(dateYmd, simClock);
        const oLock = isOtLocked(dateYmd, simClock);
        const cur = getRecord(nextRecords, dateYmd, empId);

        if (strictLock && sLock.locked && oLock.locked) {
          skippedLocked++;
          continue;
        }

        nextRecords[`${dateYmd}|${empId}`] = {
          shiftCode: strictLock && sLock.locked ? cur.shiftCode : shiftCode,
          otHours: strictLock && oLock.locked ? cur.otHours : otHours,
          note,
        };
        schedUpdated++;
      }
    }
  }

  return {
    employees: nextEmployees,
    records: nextRecords,
    masterUpdated,
    schedUpdated,
    skippedLocked,
  };
}

export function downloadMatrixPng(params: {
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  deptId: DepartmentId;
  shiftSide: 'Day' | 'Night';
  ym: string;
  dFrom: number;
  dTo: number;
}): string {
  const { employees, shifts, records, deptId, shiftSide, ym, dFrom, dTo } = params;
  const [yy, mm] = ym.split('-').map(Number);
  const dates: string[] = [];
  for (let d = dFrom; d <= dTo; d++) {
    dates.push(`${ym}-${String(d).padStart(2, '0')}`);
  }
  const deptEmps = employees.filter((e) => e.status === 'Active' && e.dept === deptId);
  const dailyBuckets: Record<string, Record<string, 'Day' | 'Night' | 'Off'>> = {};
  dates.forEach((d) => {
    dailyBuckets[d] = assignDailyShiftBucket(employees, shifts, records, deptId, d);
  });
  const empsInTable = deptEmps.filter((emp) => dates.some((d) => dailyBuckets[d][emp.id] === shiftSide));

  const leftColsW = 290;
  const cellW = 46;
  const rowH = 30;
  const headerH = 74;
  const pad = 20;
  const width = pad * 2 + leftColsW + dates.length * cellW;
  const height = pad * 2 + headerH + (empsInTable.length + 2) * rowH;

  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(scale, scale);

  const bgCol = '#ffffff';
  const inkCol = '#161616';
  const mutedCol = '#6f6f6f';
  const surfCol = '#f4f4f4';
  const lineCol = '#e0e0e0';
  const primaryCol = '#0f62fe';
  const primarySoft = '#d0e2ff';
  const nightBg = '#262626';
  const nightInk = '#f4f4f4';
  const midSoft = '#f6f2ff';
  const midInk = '#6929c4';
  const sosSoft = '#fef3c7';
  const sosInk = '#b45309';

  ctx.fillStyle = bgCol;
  ctx.fillRect(0, 0, width, height);

  // Header Banner
  ctx.fillStyle = shiftSide === 'Day' ? primarySoft : nightBg;
  ctx.fillRect(pad, pad, width - pad * 2, 42);
  ctx.fillStyle = shiftSide === 'Day' ? inkCol : nightInk;
  ctx.font = '600 14px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(
    `LỊCH LÀM VIỆC CA ${shiftSide.toUpperCase()} — TASK ${deptId.toUpperCase()} (${String(mm).padStart(2, '0')}/${yy})`,
    pad + 12,
    pad + 26
  );

  // Table Column Header
  const y0 = pad + 46;
  ctx.fillStyle = surfCol;
  ctx.fillRect(pad, y0, width - pad * 2, rowH);
  ctx.strokeStyle = lineCol;
  ctx.strokeRect(pad, y0, width - pad * 2, rowH);

  ctx.fillStyle = inkCol;
  ctx.font = '600 11px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Mã NV', pad + 8, y0 + 19);
  ctx.fillText('Họ và Tên', pad + 72, y0 + 19);
  ctx.fillText('Vị trí', pad + 204, y0 + 19);

  dates.forEach((d, idx) => {
    const cx = pad + leftColsW + idx * cellW;
    ctx.strokeStyle = lineCol;
    ctx.strokeRect(cx, y0, cellW, rowH);
    ctx.textAlign = 'center';
    ctx.fillStyle = inkCol;
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillText(d.slice(8, 10), cx + cellW / 2, y0 + 13);
    ctx.font = '400 9px "IBM Plex Mono", monospace';
    ctx.fillStyle = mutedCol;
    ctx.fillText(getVNWeekday(d), cx + cellW / 2, y0 + 25);
  });

  // Employee Rows (Showing ONLY Shift Start Time HH:MM or OFF)
  empsInTable.forEach((emp, rIdx) => {
    const ry = y0 + (rIdx + 1) * rowH;
    ctx.fillStyle = rIdx % 2 === 1 ? surfCol : bgCol;
    ctx.fillRect(pad, ry, width - pad * 2, rowH);
    ctx.strokeStyle = lineCol;
    ctx.strokeRect(pad, ry, width - pad * 2, rowH);

    ctx.textAlign = 'left';
    ctx.fillStyle = inkCol;
    ctx.font = '400 11px "IBM Plex Mono", monospace';
    ctx.fillText(emp.id, pad + 8, ry + 19);
    ctx.font = '600 11px "IBM Plex Sans", sans-serif';
    ctx.fillText(emp.name.slice(0, 18), pad + 72, ry + 19);
    ctx.font = '400 10px "IBM Plex Sans", sans-serif';
    ctx.fillText(emp.role.slice(0, 12), pad + 204, ry + 19);

    dates.forEach((d, cIdx) => {
      const cx = pad + leftColsW + cIdx * cellW;
      const belong = dailyBuckets[d][emp.id] === shiftSide;
      const rec = getRecord(records, d, emp.id);
      const sDef = getShiftDef(shifts, rec.shiftCode);
      ctx.strokeStyle = lineCol;
      ctx.strokeRect(cx, ry, cellW, rowH);

      ctx.textAlign = 'center';
      if (belong && sDef.group !== 'Off') {
        const startLabel = getShiftStartTimeLabel(sDef);
        ctx.fillStyle =
          sDef.group === 'Day'
            ? primarySoft
            : sDef.group === 'Night'
              ? nightBg
              : sDef.group === 'SOS'
                ? sosSoft
                : midSoft;
        ctx.fillRect(cx + 2, ry + 2, cellW - 4, rowH - 4);
        ctx.fillStyle =
          sDef.group === 'Day'
            ? inkCol
            : sDef.group === 'Night'
              ? nightInk
              : sDef.group === 'SOS'
                ? sosInk
                : midInk;
        ctx.font = '600 11px "IBM Plex Mono", monospace';
        ctx.fillText(startLabel, cx + cellW / 2, ry + 19);
      } else if (sDef.group === 'Off') {
        ctx.fillStyle = mutedCol;
        ctx.font = '500 10px "IBM Plex Mono", monospace';
        ctx.fillText('OFF', cx + cellW / 2, ry + 19);
      } else {
        ctx.fillStyle = '#b0b0b0';
        ctx.font = '400 11px "IBM Plex Mono", monospace';
        ctx.fillText('—', cx + cellW / 2, ry + 19);
      }
    });
  });

  // Footer Headcount Row
  const fy = y0 + (empsInTable.length + 1) * rowH;
  ctx.fillStyle = surfCol;
  ctx.fillRect(pad, fy, width - pad * 2, rowH);
  ctx.strokeStyle = primaryCol;
  ctx.strokeRect(pad, fy, width - pad * 2, rowH);
  ctx.textAlign = 'left';
  ctx.fillStyle = inkCol;
  ctx.font = '600 11px "IBM Plex Sans", sans-serif';
  ctx.fillText(`Tổng quân số ${shiftSide} (${deptId})`, pad + 8, fy + 19);

  dates.forEach((d, cIdx) => {
    const cx = pad + leftColsW + cIdx * cellW;
    const cnt = deptEmps.filter((emp) => dailyBuckets[d][emp.id] === shiftSide).length;
    ctx.textAlign = 'center';
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillText(String(cnt), cx + cellW / 2, fy + 19);
  });

  const filename = `lich_${deptId}_${shiftSide}_${ym}.png`;
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return filename;
}
