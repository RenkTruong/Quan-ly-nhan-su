import { DEPT_CATALOG } from '../data/seedData';
import { DepartmentId, Employee, ScheduleRecord, ShiftDef } from '../types/warehouse';
import { getDatesInRange, getRecord, getShiftDef, isOtLocked, isShiftLocked } from './analytics';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const SHEET_TAB_SCHEDULE = 'Lịch Phân Ca';
export const SHEET_TAB_MASTER = 'Master Data';
export const SHEET_TAB_CATALOG = 'Danh mục Hệ thống';

export function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = (urlOrId || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

export function getSpreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

function normalizeDateString(val: unknown): string {
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
  const ymdSlash = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymdSlash) {
    return `${ymdSlash[1]}-${ymdSlash[2].padStart(2, '0')}-${ymdSlash[3].padStart(2, '0')}`;
  }
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return '';
}

async function sheetsFetch<T>(url: string, accessToken: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const apiMsg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại bằng Google.');
    }
    if (res.status === 403) {
      throw new Error(`Không có quyền truy cập Google Sheet này (${apiMsg}). Hãy chắc chắn tài khoản Google có quyền Chỉnh sửa file.`);
    }
    if (res.status === 404) {
      throw new Error('Không tìm thấy Google Sheet. Vui lòng kiểm tra lại đường link.');
    }
    throw new Error(apiMsg);
  }
  return data as T;
}

interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties?: { title?: string };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      index?: number;
    };
  }>;
}

export async function fetchSpreadsheetInfo(spreadsheetId: string, accessToken: string): Promise<SpreadsheetMetadata> {
  return sheetsFetch<SpreadsheetMetadata>(
    `${SHEETS_API}/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title,index)`,
    accessToken
  );
}

function buildCatalogRows(employees: Employee[], shifts: ShiftDef[]): string[][] {
  const empIds = employees.map((e) => e.id);
  const depts = DEPT_CATALOG.map((d) => d.id);
  const roleSet = new Set<string>();
  DEPT_CATALOG.forEach((d) => d.roles.forEach((r) => roleSet.add(r)));
  employees.forEach((e) => {
    if (e.role) roleSet.add(e.role);
  });
  const roles = Array.from(roleSet);
  const shiftNames = shifts.map((s) => s.name);
  const shiftTimes = Array.from(new Set(shifts.map((s) => s.timeRange).filter(Boolean)));

  const maxLen = Math.max(empIds.length, depts.length, roles.length, shiftNames.length, shiftTimes.length, 1);
  const rows: string[][] = [['Mã NV', 'Task', 'Vị trí', 'Ca làm', 'Giờ làm']];

  for (let i = 0; i < maxLen; i++) {
    rows.push([
      empIds[i] ?? '',
      depts[i] ?? '',
      roles[i] ?? '',
      shiftNames[i] ?? '',
      shiftTimes[i] ?? '',
    ]);
  }
  return rows;
}

function buildMasterRows(employees: Employee[]): string[][] {
  const rows: string[][] = [['Mã NV', 'Tên NV', 'Task', 'Vị trí', 'Trạng thái']];
  employees.forEach((emp) => {
    rows.push([emp.id, emp.name, emp.dept, emp.role, emp.status]);
  });
  return rows;
}

function buildScheduleRows(
  employees: Employee[],
  shifts: ShiftDef[],
  records: Record<string, ScheduleRecord>,
  rangeStart: string,
  rangeEnd: string
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    [
      'Ngày (YYYY-MM-DD)',
      'Mã NV',
      'Tên NV (Tự động theo Mã NV)',
      'Task',
      'Vị trí',
      'Ca làm',
      'Giờ làm',
      'Giờ OT',
      'Ghi chú',
    ],
  ];

  const dates = getDatesInRange(rangeStart, rangeEnd);
  const activeEmps = employees.filter((e) => e.status === 'Active');
  let rowNum = 2;

  dates.forEach((d) => {
    activeEmps.forEach((emp) => {
      const rec = getRecord(records, d, emp.id);
      const sDef = getShiftDef(shifts, rec.shiftCode);
      rows.push([
        d,
        emp.id,
        `=IFERROR(VLOOKUP(B${rowNum},'${SHEET_TAB_MASTER}'!$A$2:$E$500,2,FALSE),"")`,
        emp.dept,
        rec.role || emp.role,
        sDef.name,
        sDef.timeRange,
        Number(rec.otHours || 0),
        rec.note || '',
      ]);
      rowNum++;
    });
  });

  // Add 50 ready-to-fill rows with VLOOKUP formulas & dropdown formatting
  for (let i = 0; i < 50; i++) {
    rows.push([
      '',
      '',
      `=IFERROR(VLOOKUP(B${rowNum},'${SHEET_TAB_MASTER}'!$A$2:$E$500,2,FALSE),"")`,
      '',
      '',
      '',
      '',
      0,
      '',
    ]);
    rowNum++;
  }

  return rows;
}

function buildDropdownAndStyleRequests(params: {
  schedSheetId: number;
  masterSheetId: number;
  catalogSheetId: number;
  maxSchedRows: number;
  maxMasterRows: number;
  catalogEmpCount: number;
  catalogDeptCount: number;
  catalogRoleCount: number;
  catalogShiftCount: number;
  catalogTimeCount: number;
}): Array<Record<string, unknown>> {
  const {
    schedSheetId,
    masterSheetId,
    catalogSheetId,
    maxSchedRows,
    maxMasterRows,
    catalogEmpCount,
    catalogDeptCount,
    catalogRoleCount,
    catalogShiftCount,
    catalogTimeCount,
  } = params;

  const makeRangeRule = (rangeA1: string) => ({
    condition: {
      type: 'ONE_OF_RANGE',
      values: [{ userEnteredValue: `='${SHEET_TAB_CATALOG}'!${rangeA1}` }],
    },
    showCustomUi: true,
    strict: false,
  });

  const empEnd = Math.max(2, catalogEmpCount + 1);
  const deptEnd = Math.max(2, catalogDeptCount + 1);
  const roleEnd = Math.max(2, catalogRoleCount + 1);
  const shiftEnd = Math.max(2, catalogShiftCount + 1);
  const timeEnd = Math.max(2, catalogTimeCount + 1);

  const headerStyle = (sheetId: number, colCount: number) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.059, green: 0.384, blue: 0.996 },
          textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
    },
  });

  const freezeHeader = (sheetId: number) => ({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  const setColWidth = (sheetId: number, startIndex: number, endIndex: number, pixelSize: number) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex, endIndex },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  });

  return [
    freezeHeader(schedSheetId),
    freezeHeader(masterSheetId),
    freezeHeader(catalogSheetId),
    headerStyle(schedSheetId, 9),
    headerStyle(masterSheetId, 5),
    headerStyle(catalogSheetId, 5),
    // Column widths for Schedule tab
    setColWidth(schedSheetId, 0, 1, 130),
    setColWidth(schedSheetId, 1, 2, 100),
    setColWidth(schedSheetId, 2, 3, 210),
    setColWidth(schedSheetId, 3, 4, 120),
    setColWidth(schedSheetId, 4, 5, 160),
    setColWidth(schedSheetId, 5, 6, 190),
    setColWidth(schedSheetId, 6, 7, 130),
    setColWidth(schedSheetId, 7, 8, 90),
    setColWidth(schedSheetId, 8, 9, 180),
    // Column widths for Master & Catalog
    setColWidth(masterSheetId, 0, 1, 100),
    setColWidth(masterSheetId, 1, 2, 200),
    setColWidth(masterSheetId, 2, 5, 150),
    setColWidth(catalogSheetId, 0, 5, 180),
    // Dropdowns on Lịch Phân Ca: Mã NV (col 1), Công đoạn (col 3), Vị trí (col 4), Ca làm (col 5), Giờ làm (col 6)
    {
      setDataValidation: {
        range: { sheetId: schedSheetId, startRowIndex: 1, endRowIndex: maxSchedRows, startColumnIndex: 1, endColumnIndex: 2 },
        rule: makeRangeRule(`$A$2:$A$${empEnd + 100}`),
      },
    },
    {
      setDataValidation: {
        range: { sheetId: schedSheetId, startRowIndex: 1, endRowIndex: maxSchedRows, startColumnIndex: 3, endColumnIndex: 4 },
        rule: makeRangeRule(`$B$2:$B$${deptEnd + 20}`),
      },
    },
    {
      setDataValidation: {
        range: { sheetId: schedSheetId, startRowIndex: 1, endRowIndex: maxSchedRows, startColumnIndex: 4, endColumnIndex: 5 },
        rule: makeRangeRule(`$C$2:$C$${roleEnd + 30}`),
      },
    },
    {
      setDataValidation: {
        range: { sheetId: schedSheetId, startRowIndex: 1, endRowIndex: maxSchedRows, startColumnIndex: 5, endColumnIndex: 6 },
        rule: makeRangeRule(`$D$2:$D$${shiftEnd + 30}`),
      },
    },
    {
      setDataValidation: {
        range: { sheetId: schedSheetId, startRowIndex: 1, endRowIndex: maxSchedRows, startColumnIndex: 6, endColumnIndex: 7 },
        rule: makeRangeRule(`$E$2:$E$${timeEnd + 30}`),
      },
    },
    // Dropdowns on Master Data: Công đoạn (col 2), Vị trí (col 3), Trạng thái (col 4)
    {
      setDataValidation: {
        range: { sheetId: masterSheetId, startRowIndex: 1, endRowIndex: maxMasterRows, startColumnIndex: 2, endColumnIndex: 3 },
        rule: makeRangeRule(`$B$2:$B$${deptEnd + 20}`),
      },
    },
    {
      setDataValidation: {
        range: { sheetId: masterSheetId, startRowIndex: 1, endRowIndex: maxMasterRows, startColumnIndex: 3, endColumnIndex: 4 },
        rule: makeRangeRule(`$C$2:$C$${roleEnd + 30}`),
      },
    },
    {
      setDataValidation: {
        range: { sheetId: masterSheetId, startRowIndex: 1, endRowIndex: maxMasterRows, startColumnIndex: 4, endColumnIndex: 5 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [{ userEnteredValue: 'Active' }, { userEnteredValue: 'Inactive' }],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    },
  ];
}

async function applySystemSheetsStructure(params: {
  spreadsheetId: string;
  accessToken: string;
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  rangeStart: string;
  rangeEnd: string;
  writeScheduleRows: boolean;
}): Promise<{ title: string; rowCount: number }> {
  const { spreadsheetId, accessToken, employees, shifts, records, rangeStart, rangeEnd, writeScheduleRows } = params;

  const meta = await fetchSpreadsheetInfo(spreadsheetId, accessToken);
  const existingSheets = meta.sheets || [];
  const findSheetId = (name: string) =>
    existingSheets.find((s) => s.properties?.title === name)?.properties?.sheetId;

  let schedSheetId = findSheetId(SHEET_TAB_SCHEDULE);
  let masterSheetId = findSheetId(SHEET_TAB_MASTER);
  let catalogSheetId = findSheetId(SHEET_TAB_CATALOG);

  const createRequests: Array<Record<string, unknown>> = [];
  if (schedSheetId === undefined) {
    createRequests.push({ addSheet: { properties: { title: SHEET_TAB_SCHEDULE, index: 0 } } });
  }
  if (masterSheetId === undefined) {
    createRequests.push({ addSheet: { properties: { title: SHEET_TAB_MASTER, index: 1 } } });
  }
  if (catalogSheetId === undefined) {
    createRequests.push({ addSheet: { properties: { title: SHEET_TAB_CATALOG, index: 2 } } });
  }

  if (createRequests.length > 0) {
    const batchRes = await sheetsFetch<{ replies: Array<{ addSheet?: { properties?: { sheetId?: number; title?: string } } }> }>(
      `${SHEETS_API}/${spreadsheetId}:batchUpdate`,
      accessToken,
      { method: 'POST', body: JSON.stringify({ requests: createRequests }) }
    );
    batchRes.replies?.forEach((rep) => {
      const p = rep.addSheet?.properties;
      if (!p) return;
      if (p.title === SHEET_TAB_SCHEDULE) schedSheetId = p.sheetId;
      if (p.title === SHEET_TAB_MASTER) masterSheetId = p.sheetId;
      if (p.title === SHEET_TAB_CATALOG) catalogSheetId = p.sheetId;
    });
  }

  const catalogRows = buildCatalogRows(employees, shifts);
  const masterRows = buildMasterRows(employees);
  const schedRows = writeScheduleRows
    ? buildScheduleRows(employees, shifts, records, rangeStart, rangeEnd)
    : [];

  // Clear Catalog & Master Data (and Schedule tab only when writeScheduleRows=true)
  const rangesToClear = [`'${SHEET_TAB_CATALOG}'!A:E`, `'${SHEET_TAB_MASTER}'!A:E`];
  if (writeScheduleRows) {
    rangesToClear.push(`'${SHEET_TAB_SCHEDULE}'!A:I`);
  }

  await sheetsFetch(`${SHEETS_API}/${spreadsheetId}/values:batchClear`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ ranges: rangesToClear }),
  });

  const valueUpdates: Array<{ range: string; values: Array<Array<string | number>> }> = [
    { range: `'${SHEET_TAB_CATALOG}'!A1`, values: catalogRows },
    { range: `'${SHEET_TAB_MASTER}'!A1`, values: masterRows },
  ];

  if (writeScheduleRows) {
    valueUpdates.push({ range: `'${SHEET_TAB_SCHEDULE}'!A1`, values: schedRows });
  }

  await sheetsFetch(`${SHEETS_API}/${spreadsheetId}/values:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: valueUpdates,
    }),
  });

  const roleSet = new Set<string>();
  DEPT_CATALOG.forEach((d) => d.roles.forEach((r) => roleSet.add(r)));
  employees.forEach((e) => {
    if (e.role) roleSet.add(e.role);
  });
  const uniqueTimeCount = new Set(shifts.map((s) => s.timeRange).filter(Boolean)).size;

  const styleAndDropdownRequests = buildDropdownAndStyleRequests({
    schedSheetId: schedSheetId!,
    masterSheetId: masterSheetId!,
    catalogSheetId: catalogSheetId!,
    maxSchedRows: Math.max(1000, schedRows.length + 100),
    maxMasterRows: Math.max(500, masterRows.length + 100),
    catalogEmpCount: employees.length,
    catalogDeptCount: DEPT_CATALOG.length,
    catalogRoleCount: roleSet.size,
    catalogShiftCount: shifts.length,
    catalogTimeCount: uniqueTimeCount,
  });

  await sheetsFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ requests: styleAndDropdownRequests }),
  });

  return {
    title: meta.properties?.title || 'Bảng Phân Ca Kho OB',
    rowCount: writeScheduleRows ? Math.max(0, schedRows.length - 1) : masterRows.length - 1,
  };
}

export async function createTemplateGoogleSheet(params: {
  accessToken: string;
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  rangeStart: string;
  rangeEnd: string;
}): Promise<{ spreadsheetId: string; spreadsheetUrl: string; title: string }> {
  const { accessToken, employees, shifts, records, rangeStart, rangeEnd } = params;
  const title = `Lịch Phân Ca Kho OB (${rangeStart} → ${rangeEnd})`;

  const created = await sheetsFetch<SpreadsheetMetadata>(SHEETS_API, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title, locale: 'vi_VN' },
      sheets: [
        { properties: { title: SHEET_TAB_SCHEDULE, index: 0, gridProperties: { rowCount: 1500, columnCount: 12 } } },
        { properties: { title: SHEET_TAB_MASTER, index: 1, gridProperties: { rowCount: 600, columnCount: 8 } } },
        { properties: { title: SHEET_TAB_CATALOG, index: 2, gridProperties: { rowCount: 300, columnCount: 8 } } },
      ],
    }),
  });

  await applySystemSheetsStructure({
    spreadsheetId: created.spreadsheetId,
    accessToken,
    employees,
    shifts,
    records,
    rangeStart,
    rangeEnd,
    writeScheduleRows: true,
  });

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: getSpreadsheetUrl(created.spreadsheetId),
    title,
  };
}

export async function pushSystemToGoogleSheet(params: {
  spreadsheetId: string;
  accessToken: string;
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  rangeStart: string;
  rangeEnd: string;
  writeScheduleRows: boolean;
}): Promise<{ title: string; rowCount: number }> {
  return applySystemSheetsStructure(params);
}

function resolveShiftFromCells(params: {
  shiftCell: string;
  timeCell: string;
  shifts: ShiftDef[];
  currentShiftCode: string;
}): ShiftDef | undefined {
  const { shiftCell, timeCell, shifts, currentShiftCode } = params;
  const norm = (v: string) => v.trim().toLowerCase();
  const sClean = norm(shiftCell);
  const tClean = norm(timeCell);

  const byShiftCell = sClean
    ? shifts.find(
        (s) =>
          norm(s.code) === sClean ||
          norm(s.shortCode) === sClean ||
          norm(s.name) === sClean ||
          sClean.startsWith(norm(s.code) + ' ') ||
          sClean.includes(`(${norm(s.code)})`)
      )
    : undefined;

  const byTimeCell = tClean
    ? shifts.find((s) => norm(s.timeRange) === tClean || norm(s.timeRange).startsWith(tClean))
    : undefined;

  if (byShiftCell && byTimeCell) {
    if (byShiftCell.code === byTimeCell.code) return byShiftCell;
    // If one of the two dropdowns was updated from currentShiftCode, prefer the changed one
    if (byShiftCell.code !== currentShiftCode && byTimeCell.code === currentShiftCode) {
      return byShiftCell;
    }
    if (byTimeCell.code !== currentShiftCode && byShiftCell.code === currentShiftCode) {
      return byTimeCell;
    }
    return byShiftCell;
  }

  return byShiftCell || byTimeCell;
}

export async function syncFromGoogleSheet(params: {
  spreadsheetId: string;
  accessToken: string;
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  simClock: string;
  strictLock: boolean;
}): Promise<{
  title: string;
  employees: Employee[];
  records: Record<string, ScheduleRecord>;
  masterUpdated: number;
  schedUpdated: number;
  skippedLocked: number;
  unmatchedRows: number;
}> {
  const { spreadsheetId, accessToken, shifts, simClock, strictLock } = params;
  const meta = await fetchSpreadsheetInfo(spreadsheetId, accessToken);
  const title = meta.properties?.title || 'Google Sheet';
  const sheetTitles = (meta.sheets || []).map((s) => s.properties?.title || '').filter(Boolean);

  const nextEmployees = params.employees.map((e) => ({ ...e }));
  const nextRecords: Record<string, ScheduleRecord> = { ...params.records };

  const schedTabName =
    sheetTitles.find((t) => t === SHEET_TAB_SCHEDULE) ||
    sheetTitles.find((t) => t.toLowerCase().includes('lịch') || t.toLowerCase().includes('lich')) ||
    sheetTitles[0];

  const masterTabName =
    sheetTitles.find((t) => t === SHEET_TAB_MASTER) ||
    sheetTitles.find((t) => t.toLowerCase().includes('master'));

  const rangesToGet: string[] = [];
  if (masterTabName) rangesToGet.push(`'${masterTabName}'!A1:E600`);
  if (schedTabName) rangesToGet.push(`'${schedTabName}'!A1:I2500`);

  if (rangesToGet.length === 0) {
    throw new Error('Không tìm thấy trang tính dữ liệu trong Google Sheet.');
  }

  const query = rangesToGet.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const valRes = await sheetsFetch<{
    valueRanges?: Array<{ range?: string; values?: string[][] }>;
  }>(`${SHEETS_API}/${spreadsheetId}/values:batchGet?${query}`, accessToken);

  const valueRanges = valRes.valueRanges || [];
  let masterUpdated = 0;
  let schedUpdated = 0;
  let skippedLocked = 0;
  let unmatchedRows = 0;

  let rangeCursor = 0;

  if (masterTabName && valueRanges[rangeCursor]?.values) {
    const mRows = valueRanges[rangeCursor].values || [];
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
        role: empRole || (validDept?.roles[0] || 'Picker FTE'),
        status: empStatus === 'Inactive' ? 'Inactive' : 'Active',
      };
      if (idx >= 0) {
        const cur = nextEmployees[idx];
        if (cur.name !== obj.name || cur.dept !== obj.dept || cur.role !== obj.role || cur.status !== obj.status) {
          nextEmployees[idx] = obj;
          masterUpdated++;
        }
      } else {
        nextEmployees.push(obj);
        masterUpdated++;
      }
    }
    rangeCursor++;
  }

  if (schedTabName && valueRanges[rangeCursor]?.values) {
    const sRows = valueRanges[rangeCursor].values || [];
    if (sRows.length > 0) {
      const headers = (sRows[0] || []).map((h) => String(h || '').trim().toLowerCase());
      const findCol = (keywords: string[], fallbackIdx: number) => {
        const idx = headers.findIndex((h) => keywords.some((k) => h.includes(k)));
        return idx >= 0 ? idx : fallbackIdx;
      };

      const colDate = findCol(['ngày', 'ngay', 'date'], 0);
      const colId = findCol(['mã nv', 'ma nv', 'id'], 1);
      const colName = findCol(['tên nv', 'ten nv', 'họ'], 2);
      const colDept = findCol(['task', 'công đoạn', 'cong doan', 'dept'], 3);
      const colRole = findCol(['vị trí', 'vi tri', 'role'], 4);
      const colShift = findCol(['ca làm', 'ca lam', 'mã ca', 'shift'], 5);
      const colTime = findCol(['giờ làm', 'gio lam', 'khung giờ', 'time'], 6);
      const colOt = findCol(['ot', 'tăng ca'], 7);
      const colNote = findCol(['ghi chú', 'ghi chu', 'note'], 8);

      for (let i = 1; i < sRows.length; i++) {
        const r = sRows[i];
        if (!r || r.length === 0) continue;

        const dateYmd = normalizeDateString(r[colDate]);
        const empId = String(r[colId] || '').trim().toUpperCase();
        const empName = String(r[colName] || '').trim();
        const deptCell = String(r[colDept] || '').trim();
        const roleCell = String(r[colRole] || '').trim();
        const shiftCell = String(r[colShift] || '').trim();
        const timeCell = String(r[colTime] || '').trim();
        const otVal = r[colOt] !== undefined && r[colOt] !== '' ? Math.max(0, Math.min(12, Number(r[colOt]) || 0)) : 0;
        const noteCell = String(r[colNote] || '').trim();

        if (!dateYmd || !empId) continue;

        // Schedule rows can introduce an employee or update their task.
        let empIdx = nextEmployees.findIndex((e) => e.id === empId);
        const validDept = DEPT_CATALOG.find((d) => d.id.toLowerCase() === deptCell.toLowerCase());

        if (empIdx === -1) {
          if (empName) {
            nextEmployees.push({
              id: empId,
              name: empName,
              dept: validDept ? validDept.id : 'Pick',
              role: roleCell || validDept?.roles[0] || 'Picker FTE',
              status: 'Active',
            });
            empIdx = nextEmployees.length - 1;
            masterUpdated++;
          } else {
            unmatchedRows++;
            continue;
          }
        } else {
          const curEmp = nextEmployees[empIdx];
          if (validDept && validDept.id !== curEmp.dept) {
            nextEmployees[empIdx] = { ...curEmp, dept: validDept.id };
            masterUpdated++;
          }
        }

        const curRec = getRecord(nextRecords, dateYmd, empId);
        const resolvedShift = resolveShiftFromCells({
          shiftCell,
          timeCell,
          shifts,
          currentShiftCode: curRec.shiftCode,
        });

        if (!resolvedShift && !shiftCell && !timeCell) {
          continue;
        }
        if (!resolvedShift) {
          unmatchedRows++;
          continue;
        }

        const sLock = isShiftLocked(dateYmd, simClock);
        const oLock = isOtLocked(dateYmd, simClock);
        const effectiveRole = curRec.role || nextEmployees[empIdx].role;
        const nextRole = strictLock && sLock.locked ? effectiveRole : roleCell || effectiveRole;

        const nextShiftCode = strictLock && sLock.locked ? curRec.shiftCode : resolvedShift.code;
        const nextOtHours = strictLock && oLock.locked ? curRec.otHours : otVal;

        if (strictLock && sLock.locked && oLock.locked) {
          if (
            curRec.shiftCode !== resolvedShift.code ||
            curRec.otHours !== otVal ||
            (roleCell && roleCell !== effectiveRole)
          ) {
            skippedLocked++;
          }
          continue;
        }

        const changed =
          curRec.shiftCode !== nextShiftCode ||
          curRec.otHours !== nextOtHours ||
          curRec.role !== nextRole ||
          (noteCell && curRec.note !== noteCell);

        nextRecords[`${dateYmd}|${empId}`] = {
          shiftCode: nextShiftCode,
          otHours: nextOtHours,
          role: nextRole,
          note: noteCell || curRec.note || '',
        };

        if (changed || !params.records[`${dateYmd}|${empId}`]) {
          schedUpdated++;
        }
      }
    }
  }

  return {
    title,
    employees: nextEmployees,
    records: nextRecords,
    masterUpdated,
    schedUpdated,
    skippedLocked,
    unmatchedRows,
  };
}
