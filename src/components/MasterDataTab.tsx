import { FormEvent, useState } from 'react';
import { User } from 'firebase/auth';
import { ExternalLink, FilePlus2, FileText, Link2, LogOut, RefreshCw, SlidersHorizontal, UploadCloud } from 'lucide-react';
import { DEPT_CATALOG, getDeptColor } from '../data/seedData';
import { DepartmentId, Employee, EmployeeStatus, ScheduleRecord, ShiftDef, ShiftGroup } from '../types/warehouse';
import {
  buildAutoShiftCode,
  classifySosShiftSide,
  formatShiftGroupLabel,
  getShiftEffectiveStdHours,
  parseTimeRangeMinutes,
} from '../utils/analytics';
import { getAccessToken } from '../utils/googleAuth';
import {
  createTemplateGoogleSheet,
  extractSpreadsheetId,
  getSpreadsheetUrl,
  pushSystemToGoogleSheet,
} from '../utils/googleSheetsSync';
import { exportSummaryCsv } from '../utils/excelSync';

interface MasterDataTabProps {
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  rangeStart: string;
  rangeEnd: string;
  simClock: string;
  googleSheetUrl: string;
  googleUser: User | null;
  hasGoogleToken: boolean;
  isLoggingInGoogle: boolean;
  isSyncingSheet: boolean;
  autoSyncSheet: boolean;
  strictSheetLock: boolean;
  lastSheetSyncInfo: { timeStr: string; title: string; summary: string } | null;
  onChangeGoogleSheetUrl: (url: string) => void;
  onChangeStrictSheetLock: (strict: boolean) => void;
  onToggleAutoSync: (enabled: boolean) => void;
  onGoogleLogin: () => Promise<void>;
  onGoogleLogout: () => Promise<void>;
  onSyncFromGoogleSheet: () => Promise<unknown>;
  onTokenExpired: () => void;
  onSaveEmployee: (emp: Employee, isEdit: boolean) => void;
  onSaveShift: (shift: ShiftDef, isEdit: boolean) => void;
  onImportComplete: (employees: Employee[], records: Record<string, ScheduleRecord>) => void;
  onResetDemoData: () => void;
  onSelectEmployee: (empId: string) => void;
  onToast: (msg: string, tone: 'positive' | 'warning' | 'error' | 'neutral') => void;
}

export function MasterDataTab({
  employees,
  shifts,
  records,
  rangeStart,
  rangeEnd,
  googleSheetUrl,
  googleUser,
  hasGoogleToken,
  isLoggingInGoogle,
  isSyncingSheet,
  autoSyncSheet,
  strictSheetLock,
  lastSheetSyncInfo,
  onChangeGoogleSheetUrl,
  onChangeStrictSheetLock,
  onToggleAutoSync,
  onGoogleLogin,
  onGoogleLogout,
  onSyncFromGoogleSheet,
  onTokenExpired,
  onSaveEmployee,
  onSaveShift,
  onResetDemoData,
  onSelectEmployee,
  onToast,
}: MasterDataTabProps) {
  const [sheetActionBusy, setSheetActionBusy] = useState(false);
  const [sheetFeedback, setSheetFeedback] = useState<{ msg: string; tone: 'positive' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    mode: 'catalog_only' | 'full_overwrite';
    spreadsheetId: string;
  } | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  // Employee form state
  const [empEditId, setEmpEditId] = useState<string | null>(null);
  const [empId, setEmpId] = useState('');
  const [empName, setEmpName] = useState('');
  const [empDept, setEmpDept] = useState<DepartmentId>('Pick');
  const [empRole, setEmpRole] = useState('Picker FTE');
  const [empStatus, setEmpStatus] = useState<EmployeeStatus>('Active');

  // Shift form state
  const [shiftEditCode, setShiftEditCode] = useState<string | null>(null);
  const [shiftGroup, setShiftGroup] = useState<ShiftGroup>('Mid');
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('18:00');
  const [shiftShort, setShiftShort] = useState('');

  const computedTimeRange = shiftGroup === 'Off' ? '—' : `${shiftStart}-${shiftEnd}`;
  const computedAutoCode = shiftEditCode || buildAutoShiftCode(shiftGroup, shiftStart, shiftEnd);
  const parsedShiftRange = shiftGroup === 'Off' ? null : parseTimeRangeMinutes(computedTimeRange);
  const computedSosHours = parsedShiftRange ? parsedShiftRange.durationHours : 0;
  const computedSosSide = shiftGroup === 'SOS' ? classifySosShiftSide(computedTimeRange) : 'Day';
  const computedStdHours =
    shiftGroup === 'Off' ? 0 : shiftGroup === 'Night' ? 8 : shiftGroup === 'SOS' ? computedSosHours : 9;
  const computedStdLabel =
    shiftGroup === 'SOS'
      ? 'Scan Out Sớm'
      : shiftGroup === 'Off'
        ? '0h'
        : `${computedStdHours}h`;

  const currentDeptRoles = DEPT_CATALOG.find((d) => d.id === empDept)?.roles || ['Picker FTE'];

  const handleDeptChange = (nextDept: DepartmentId) => {
    setEmpDept(nextDept);
    const roles = DEPT_CATALOG.find((d) => d.id === nextDept)?.roles || [];
    if (!roles.includes(empRole) && roles[0]) {
      setEmpRole(roles[0]);
    }
  };

  const handleEmpSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanId = empId.trim().toUpperCase();
    const cleanName = empName.trim();
    if (!cleanId || !cleanName) return;
    if (!empEditId && employees.some((x) => x.id === cleanId)) {
      onToast(`Mã nhân viên ${cleanId} đã tồn tại. Vui lòng chọn mã khác hoặc nhấn Sửa.`, 'error');
      return;
    }
    onSaveEmployee(
      { id: empEditId || cleanId, name: cleanName, dept: empDept, role: empRole, status: empStatus },
      Boolean(empEditId)
    );
    setEmpEditId(null);
    setEmpId('');
    setEmpName('');
  };

  const startEditEmployee = (emp: Employee) => {
    setEmpEditId(emp.id);
    setEmpId(emp.id);
    setEmpName(emp.name);
    setEmpDept(emp.dept);
    setEmpRole(emp.role);
    setEmpStatus(emp.status);
  };

  const cancelEmpEdit = () => {
    setEmpEditId(null);
    setEmpId('');
    setEmpName('');
  };

  const handleShiftGroupChange = (nextGroup: ShiftGroup) => {
    setShiftGroup(nextGroup);
    if (!shiftEditCode) {
      if (nextGroup === 'Day') {
        setShiftStart('06:00');
        setShiftEnd('15:00');
      } else if (nextGroup === 'Night') {
        setShiftStart('21:00');
        setShiftEnd('05:00');
      } else if (nextGroup === 'Mid') {
        setShiftStart('09:00');
        setShiftEnd('18:00');
      } else if (nextGroup === 'SOS') {
        setShiftStart('08:00');
        setShiftEnd('12:00');
      }
    }
  };

  const handleShiftSubmit = (e: FormEvent) => {
    e.preventDefault();
    const finalCode = computedAutoCode.trim().toUpperCase().replace(/\s+/g, '_');
    if (!finalCode) return;
    if (!shiftEditCode && shifts.some((s) => s.code === finalCode)) {
      onToast(`Mã ca ${finalCode} đã tồn tại.`, 'error');
      return;
    }

    const groupPrefix = formatShiftGroupLabel(shiftGroup);
    const autoName =
      shiftGroup === 'Off' ? 'OFF' : `${groupPrefix} (${shiftStart}-${shiftEnd})`;
    const defaultShort =
      shiftGroup === 'Off'
        ? 'OFF'
        : shiftGroup === 'SOS'
          ? 'SOS'
          : `${groupPrefix.slice(0, 1)}${shiftStart.slice(0, 2)}`;

    onSaveShift(
      {
        code: finalCode,
        name: autoName,
        shortCode: shiftShort.trim().toUpperCase() || defaultShort,
        timeRange: computedTimeRange,
        group: shiftGroup,
        stdHours: computedStdHours,
      },
      Boolean(shiftEditCode)
    );
    setShiftEditCode(null);
    setShiftShort('');
  };

  const startEditShift = (s: ShiftDef) => {
    setShiftEditCode(s.code);
    setShiftGroup(s.group);
    setShiftShort(s.shortCode);
    const parsed = parseTimeRangeMinutes(s.timeRange);
    if (parsed) {
      setShiftStart(parsed.startStr);
      setShiftEnd(parsed.endStr);
    } else if (s.group === 'Night') {
      setShiftStart('21:00');
      setShiftEnd('05:00');
    } else {
      setShiftStart('06:00');
      setShiftEnd('15:00');
    }
  };

  const cancelShiftEdit = () => {
    setShiftEditCode(null);
    setShiftGroup('Mid');
    setShiftStart('09:00');
    setShiftEnd('18:00');
    setShiftShort('');
  };

  const parsedSpreadsheetId = extractSpreadsheetId(googleSheetUrl);

  const handleCreateNewSheet = async () => {
    const token = getAccessToken();
    if (!token) {
      onToast('Vui lòng đăng nhập Google trước khi tạo Google Sheet.', 'warning');
      return;
    }
    setSheetActionBusy(true);
    setSheetFeedback(null);
    try {
      const created = await createTemplateGoogleSheet({
        accessToken: token,
        employees,
        shifts,
        records,
        rangeStart,
        rangeEnd,
      });
      onChangeGoogleSheetUrl(created.spreadsheetUrl);
      const msg = `Đã tạo Google Sheet mới "${created.title}" với công thức VLOOKUP Tên NV và Dropdown (Task, Vị trí, Ca làm, Giờ làm).`;
      setSheetFeedback({ msg, tone: 'positive' });
      onToast('Đã tạo & liên kết Google Sheet mẫu mới thành công.', 'positive');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể tạo Google Sheet mới.';
      if (msg.includes('hết hạn')) onTokenExpired();
      setSheetFeedback({ msg, tone: 'error' });
      onToast(msg, 'error');
    } finally {
      setSheetActionBusy(false);
    }
  };

  const requestPushToSheet = (mode: 'catalog_only' | 'full_overwrite') => {
    if (!hasGoogleToken || !getAccessToken()) {
      onToast('Vui lòng đăng nhập Google trước khi cập nhật Google Sheet.', 'warning');
      return;
    }
    if (!parsedSpreadsheetId) {
      onToast('Vui lòng dán link Google Sheet hợp lệ trước.', 'warning');
      return;
    }
    setConfirmModal({ mode, spreadsheetId: parsedSpreadsheetId });
  };

  const executeConfirmedPush = async () => {
    if (!confirmModal) return;
    const token = getAccessToken();
    if (!token) {
      setConfirmModal(null);
      onTokenExpired();
      onToast('Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại.', 'error');
      return;
    }

    const writeScheduleRows = confirmModal.mode === 'full_overwrite';
    const targetId = confirmModal.spreadsheetId;
    setConfirmModal(null);
    setSheetActionBusy(true);
    setSheetFeedback(null);

    try {
      const res = await pushSystemToGoogleSheet({
        spreadsheetId: targetId,
        accessToken: token,
        employees,
        shifts,
        records,
        rangeStart,
        rangeEnd,
        writeScheduleRows,
      });
      const msg = writeScheduleRows
        ? `Đã ghi đè toàn bộ Lịch Phân Ca (${res.rowCount} dòng) cùng Master Data, VLOOKUP Tên NV và Dropdown lên Google Sheet "${res.title}".`
        : `Đã cập nhật Master Data & Danh mục Dropdown (Task, Vị trí, Ca làm, Giờ làm) lên Google Sheet "${res.title}" (giữ nguyên dữ liệu lịch đang nhập).`;
      setSheetFeedback({ msg, tone: 'positive' });
      onToast(msg, 'positive');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi cập nhật Google Sheet.';
      if (msg.includes('hết hạn')) onTokenExpired();
      setSheetFeedback({ msg, tone: 'error' });
      onToast(msg, 'error');
    } finally {
      setSheetActionBusy(false);
    }
  };

  const handleManualSyncFromSheet = async () => {
    setSheetFeedback(null);
    try {
      const res = (await onSyncFromGoogleSheet()) as
        | { title: string; schedUpdated: number; masterUpdated: number; skippedLocked: number; unmatchedRows: number }
        | null
        | undefined;
      if (res) {
        setSheetFeedback({
          msg: `Đã đọc Google Sheet "${res.title}": cập nhật ${res.schedUpdated} dòng lịch, ${res.masterUpdated} nhân sự${
            res.skippedLocked > 0 ? `, bỏ qua ${res.skippedLocked} dòng bị khóa theo luật D-1 / D+2` : ''
          }${res.unmatchedRows > 0 ? `, ${res.unmatchedRows} dòng chưa khớp Mã NV / Ca làm` : ''}.`,
          tone: 'positive',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể đồng bộ từ Google Sheet.';
      setSheetFeedback({ msg, tone: 'error' });
    }
  };

  const handleExportCsv = () => {
    const fn = exportSummaryCsv(employees, shifts, records, rangeStart, rangeEnd);
    onToast(`Đã xuất báo cáo CSV: ${fn}`, 'positive');
  };

  const handleResetClick = () => {
    if (!resetArmed) {
      setResetArmed(true);
      setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    setResetArmed(false);
    onResetDemoData();
  };

  return (
    <div className="grid gap-5 sm:gap-6 [&>*]:min-w-0">
      {/* Confirmation Modal for Updating User Google Sheet */}
      {confirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheet-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#161616]/60 p-4"
        >
          <div className="w-full max-w-lg border border-[#e0e0e0] bg-white p-5 shadow-lg">
            <h3 id="sheet-confirm-title" className="text-base font-semibold text-[#161616]">
              {confirmModal.mode === 'full_overwrite'
                ? 'Xác nhận ghi đè toàn bộ Lịch lên Google Sheet?'
                : 'Xác nhận cập nhật Danh mục & Dropdown lên Google Sheet?'}
            </h3>
            <p className="mt-2 text-sm text-[#525252]">
              {confirmModal.mode === 'full_overwrite' ? (
                <>
                  Thao tác này sẽ <strong>ghi đè toàn bộ dữ liệu</strong> trên 3 trang tính{' '}
                  <span className="font-mono-num">Lịch Phân Ca</span>,{' '}
                  <span className="font-mono-num">Master Data</span> và{' '}
                  <span className="font-mono-num">Danh mục Hệ thống</span> của Google Sheet đang liên kết bằng lịch hiện
                  tại từ <span className="font-mono-num">{rangeStart}</span> đến{' '}
                  <span className="font-mono-num">{rangeEnd}</span>.
                </>
              ) : (
                <>
                  Thao tác này sẽ cập nhật trang tính <span className="font-mono-num">Master Data</span>,{' '}
                  <span className="font-mono-num">Danh mục Hệ thống</span> và thiết lập lại{' '}
                  <strong>Dropdown chọn nhanh</strong> (Mã NV, Task, Vị trí, Ca làm, Giờ làm) trên trang{' '}
                  <span className="font-mono-num">Lịch Phân Ca</span> (không xóa các dòng lịch bạn đã nhập).
                </>
              )}
            </p>
            <div className="mt-3 border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
              ID bảng tính: <span className="font-mono-num font-medium text-[#0f172a]">{confirmModal.spreadsheetId}</span>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="h-9 cursor-pointer border border-[#cbd5e1] bg-white px-4 text-xs font-medium text-[#0f172a] hover:bg-[#f8fafc]"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={executeConfirmedPush}
                className="h-9 cursor-pointer bg-[#0f62fe] px-4 text-xs font-medium text-white hover:bg-[#0353e9]"
              >
                Xác nhận cập nhật Google Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Sheets Link Sync Center */}
      <div className="grid min-w-0 gap-4 border border-[#e2e8f0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e2e8f0] pb-3 sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#0f172a] sm:text-xl">
              Đồng bộ Lịch qua Link Google Sheets
            </h2>
            <p className="mt-0.5 text-[13px] text-[#64748b]">
              VLOOKUP Tên NV từ Mã NV · Dropdown Task, Vị trí, Ca làm, Giờ làm đồng bộ theo hệ thống.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {!hasGoogleToken ? (
              <button
                type="button"
                onClick={onGoogleLogin}
                disabled={isLoggingInGoogle}
                className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2.5 rounded border border-[#747775] bg-white px-4 text-sm font-medium whitespace-nowrap text-[#1f1f1f] transition-colors hover:bg-[#f8f9fa] disabled:opacity-60 sm:w-auto"
              >
                <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>{isLoggingInGoogle ? 'Đang kết nối Google...' : 'Sign in with Google'}</span>
              </button>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-between gap-2 border border-[#198038]/30 bg-[#defbe6] px-3 py-1.5 text-xs text-[#161616] sm:w-auto">
                <span>
                  Đã kết nối: <strong>{googleUser?.email || googleUser?.displayName || 'Google Sheets'}</strong>
                </span>
                <button
                  type="button"
                  onClick={onGoogleLogout}
                  className="inline-flex cursor-pointer items-center gap-1 px-2 py-1 font-medium text-[#525252] hover:bg-white/60 hover:text-[#161616]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Đăng xuất
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border border-[#0f62fe] bg-white px-4 text-sm font-medium whitespace-nowrap text-[#0f62fe] hover:bg-[#d0e2ff] sm:w-auto"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Xuất Báo cáo CSV
            </button>

          </div>
        </div>

        {/* Google Sheet URL + Lock Mode */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex flex-col gap-1 lg:col-span-7">
            <label htmlFor="google-sheet-url" className="text-xs font-medium text-[#525252]">
              Link Google Sheet làm việc (dán URL hoặc ID bảng tính)
            </label>
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <div className="relative min-w-0 flex-1">
                <Link2
                  className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-[#525252]"
                  aria-hidden="true"
                />
                <input
                  type="url"
                  id="google-sheet-url"
                  value={googleSheetUrl}
                  onChange={(e) => onChangeGoogleSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="h-10 w-full border-0 border-b border-[#8d8d8d] bg-white pr-3 pl-9 text-sm text-[#161616]"
                />
              </div>
              {parsedSpreadsheetId && (
                <a
                  href={getSpreadsheetUrl(parsedSpreadsheetId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 border border-[#8d8d8d] bg-white px-3 text-xs font-medium whitespace-nowrap text-[#161616] hover:bg-[#e0e0e0] sm:w-auto"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Mở Google Sheet
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1 lg:col-span-5">
            <label htmlFor="sheet-respect-lock" className="text-xs font-medium text-[#525252]">
              Chế độ kiểm tra khóa khi Đồng bộ từ Google Sheet
            </label>
            <select
              id="sheet-respect-lock"
              value={strictSheetLock ? 'strict' : 'override'}
              onChange={(e) => onChangeStrictSheetLock(e.target.value === 'strict')}
              className="h-10 w-full border-0 border-b border-[#8d8d8d] bg-white px-2.5 text-sm"
            >
              <option value="strict">Tuân thủ Khóa thời gian (D-1 15:00 &amp; D+2 23:59)</option>
              <option value="override">Cho phép Admin ghi đè dữ liệu lịch sử từ Google Sheet</option>
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleManualSyncFromSheet}
            disabled={!hasGoogleToken || !parsedSpreadsheetId || isSyncingSheet || sheetActionBusy}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 bg-[#0f62fe] px-4 text-xs font-medium whitespace-nowrap text-white hover:bg-[#0353e9] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:text-sm"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncingSheet ? 'animate-spin' : ''}`} aria-hidden="true" />
            {isSyncingSheet ? 'Đang đồng bộ từ Sheet...' : 'Đồng bộ Lịch từ Google Sheet ngay'}
          </button>

          <button
            type="button"
            onClick={handleCreateNewSheet}
            disabled={!hasGoogleToken || sheetActionBusy}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border border-[#0f62fe] bg-white px-3.5 text-xs font-medium whitespace-nowrap text-[#0f62fe] hover:bg-[#d0e2ff] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            Tạo Link Google Sheet Mới
          </button>

          <button
            type="button"
            onClick={() => requestPushToSheet('catalog_only')}
            disabled={!hasGoogleToken || !parsedSpreadsheetId || sheetActionBusy}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border border-[#8d8d8d] bg-white px-3.5 text-xs font-medium whitespace-nowrap text-[#161616] hover:bg-[#e0e0e0] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Cập nhật Dropdown &amp; Master Data lên Sheet
          </button>

          <button
            type="button"
            onClick={() => requestPushToSheet('full_overwrite')}
            disabled={!hasGoogleToken || !parsedSpreadsheetId || sheetActionBusy}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border border-[#8d8d8d] bg-white px-3.5 text-xs font-medium whitespace-nowrap text-[#161616] hover:bg-[#e0e0e0] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            Đẩy toàn bộ Lịch lên Sheet
          </button>
        </div>

        {/* Auto-sync toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] pt-3 text-xs text-[#64748b]">
          <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-[#0f172a]">
            <input
              type="checkbox"
              checked={autoSyncSheet}
              disabled={!hasGoogleToken || !parsedSpreadsheetId}
              onChange={(e) => onToggleAutoSync(e.target.checked)}
              className="h-4 w-4 accent-[#0f62fe]"
            />
            <span>Tự động đồng bộ mỗi 15 giây</span>
          </label>

          {lastSheetSyncInfo && (
            <span className="font-mono-num text-[11px] text-[#198038]">
              Lần cuối {lastSheetSyncInfo.timeStr}: {lastSheetSyncInfo.summary}
            </span>
          )}
        </div>

        {sheetFeedback && (
          <div
            className={`border px-3.5 py-2.5 text-sm ${
              sheetFeedback.tone === 'positive'
                ? 'border-[#198038]/30 bg-[#defbe6] text-[#0f172a]'
                : 'border-[#da1e28]/30 bg-[#fff1f1] text-[#0f172a]'
            }`}
          >
            {sheetFeedback.msg}
          </div>
        )}
      </div>

      {/* Master Data CRUD Grid */}
      <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {/* Employee Master Data */}
        <div className="grid min-w-0 gap-4 border border-[#e2e8f0] bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#e2e8f0] pb-2">
            <h3 className="text-base font-semibold text-[#0f172a]">Quản lý Nhân sự (6 Task &amp; Vị trí)</h3>
            <button
              type="button"
              onClick={handleResetClick}
              className="cursor-pointer px-2.5 py-1 text-xs font-medium whitespace-nowrap text-[#0f62fe] hover:bg-[#eff6ff]"
            >
              {resetArmed ? 'Nhấn lần nữa để xác nhận' : 'Khôi phục dữ liệu mẫu'}
            </button>
          </div>

          <form onSubmit={handleEmpSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="emp-id-input" className="text-xs font-medium text-[#475569]">
                Mã NV
              </label>
              <input
                type="text"
                id="emp-id-input"
                value={empId}
                disabled={Boolean(empEditId)}
                onChange={(e) => setEmpId(e.target.value)}
                placeholder="VD: OB-030"
                required
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm disabled:bg-[#e2e8f0]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="emp-name-input" className="text-xs font-medium text-[#475569]">
                Họ và Tên NV
              </label>
              <input
                type="text"
                id="emp-name-input"
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                placeholder="VD: Nguyễn Văn Bình"
                required
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="emp-dept-input" className="text-xs font-medium text-[#475569]">
                Task
              </label>
              <select
                id="emp-dept-input"
                value={empDept}
                onChange={(e) => handleDeptChange(e.target.value as DepartmentId)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              >
                {DEPT_CATALOG.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="emp-role-input" className="text-xs font-medium text-[#475569]">
                Vị trí làm việc
              </label>
              <select
                id="emp-role-input"
                value={empRole}
                onChange={(e) => setEmpRole(e.target.value)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              >
                {currentDeptRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="emp-active-input" className="text-xs font-medium text-[#475569]">
                Trạng thái
              </label>
              <select
                id="emp-active-input"
                value={empStatus}
                onChange={(e) => setEmpStatus(e.target.value as EmployeeStatus)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              >
                <option value="Active">Đang làm việc (Active)</option>
                <option value="Inactive">Tạm nghỉ (Inactive)</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="h-9 cursor-pointer bg-[#0f62fe] px-4 text-xs font-medium whitespace-nowrap text-white hover:bg-[#0353e9]"
              >
                {empEditId ? 'Lưu thay đổi' : 'Thêm nhân sự'}
              </button>
              {empEditId && (
                <button
                  type="button"
                  onClick={cancelEmpEdit}
                  className="h-9 cursor-pointer px-3 text-xs font-medium whitespace-nowrap text-[#475569] hover:bg-[#f1f5f9]"
                >
                  Hủy
                </button>
              )}
            </div>
          </form>

          <div className="max-h-[440px] overflow-auto border border-[#e2e8f0] bg-white">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-[#f8fafc] font-mono text-[11px] uppercase text-[#475569]">
                <tr>
                  <th className="px-2.5 py-2 whitespace-nowrap">Mã NV</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Tên nhân viên</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Task</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Vị trí</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Trạng thái</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, idx) => (
                  <tr
                    key={emp.id}
                    className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'}`}
                  >
                    <td className="font-mono-num px-2.5 py-2 whitespace-nowrap">{emp.id}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectEmployee(emp.id)}
                        className="cursor-pointer font-semibold text-[#0f62fe] hover:underline"
                      >
                        {emp.name}
                      </button>
                    </td>
                    <td className="px-2.5 py-2 font-semibold whitespace-nowrap" style={{ color: getDeptColor(emp.dept) }}>
                      {emp.dept}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap">{emp.role}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 text-[11px] font-medium ${
                          emp.status === 'Active' ? 'bg-[#defbe6] text-[#198038]' : 'bg-[#e2e8f0] text-[#475569]'
                        }`}
                      >
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startEditEmployee(emp)}
                        className="cursor-pointer text-xs font-medium text-[#0f62fe] hover:underline"
                      >
                        Sửa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Shift Categories Master Data */}
        <div className="grid min-w-0 gap-4 border border-[#e2e8f0] bg-white p-4">
          <div className="border-b border-[#e2e8f0] pb-2">
            <h3 className="text-base font-semibold text-[#0f172a]">Danh mục Ca làm việc</h3>
          </div>

          <form onSubmit={handleShiftSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="shift-code-input" className="text-xs font-medium text-[#475569]">
                Mã Ca (tự động)
              </label>
              <input
                type="text"
                id="shift-code-input"
                value={computedAutoCode}
                readOnly
                className="font-mono-num h-9 w-full border border-[#cbd5e1] bg-[#f1f5f9] px-2.5 text-sm font-medium text-[#0f172a]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="shift-group-input" className="text-xs font-medium text-[#475569]">
                Nhóm ca
              </label>
              <select
                id="shift-group-input"
                value={shiftGroup}
                onChange={(e) => handleShiftGroupChange(e.target.value as ShiftGroup)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              >
                <option value="Day">Day</option>
                <option value="Night">Night</option>
                <option value="Mid">MID</option>
                <option value="SOS">SOS</option>
                <option value="Off">OFF</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="shift-start-input" className="text-xs font-medium text-[#475569]">
                Giờ bắt đầu
              </label>
              <input
                type="time"
                id="shift-start-input"
                value={shiftStart}
                disabled={shiftGroup === 'Off'}
                onChange={(e) => setShiftStart(e.target.value)}
                required={shiftGroup !== 'Off'}
                className="font-mono-num h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm disabled:bg-[#e2e8f0]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="shift-end-input" className="text-xs font-medium text-[#475569]">
                Giờ kết thúc
              </label>
              <input
                type="time"
                id="shift-end-input"
                value={shiftEnd}
                disabled={shiftGroup === 'Off'}
                onChange={(e) => setShiftEnd(e.target.value)}
                required={shiftGroup !== 'Off'}
                className="font-mono-num h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm disabled:bg-[#e2e8f0]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="shift-hours-input" className="text-xs font-medium text-[#475569]">
                Giờ chuẩn
              </label>
              <input
                type="text"
                id="shift-hours-input"
                value={computedStdLabel}
                readOnly
                className="font-mono-num h-9 w-full border border-[#cbd5e1] bg-[#f1f5f9] px-2.5 text-sm font-semibold text-[#0f172a]"
              />
              {shiftGroup === 'SOS' && (
                <span className="text-[11px] text-[#b45309]">
                  {computedSosHours}h thực tế · Tính vào {computedSosSide} (out {computedSosSide === 'Day' ? 'trước' : 'từ'} 18:00)
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="shift-short-input" className="text-xs font-medium text-[#475569]">
                Ký hiệu bảng
              </label>
              <input
                type="text"
                id="shift-short-input"
                value={shiftShort}
                maxLength={5}
                onChange={(e) => setShiftShort(e.target.value)}
                placeholder={
                  shiftGroup === 'Off'
                    ? 'OFF'
                    : shiftGroup === 'SOS'
                      ? 'SOS'
                      : `${formatShiftGroupLabel(shiftGroup).slice(0, 1)}${shiftStart.slice(0, 2)}`
                }
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              />
            </div>

            <div className="flex items-end gap-2 sm:col-span-2">
              <button
                type="submit"
                className="h-9 cursor-pointer bg-[#0f62fe] px-4 text-xs font-medium whitespace-nowrap text-white hover:bg-[#0353e9]"
              >
                {shiftEditCode ? 'Lưu ca' : 'Thêm ca'}
              </button>
              {shiftEditCode && (
                <button
                  type="button"
                  onClick={cancelShiftEdit}
                  className="h-9 cursor-pointer px-3 text-xs font-medium whitespace-nowrap text-[#475569] hover:bg-[#f1f5f9]"
                >
                  Hủy
                </button>
              )}
            </div>
          </form>

          <div className="overflow-auto border border-[#e2e8f0] bg-white">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-[#f8fafc] font-mono text-[11px] uppercase text-[#475569]">
                <tr>
                  <th className="px-2.5 py-2 whitespace-nowrap">Mã Ca</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Khung giờ</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Ký hiệu</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Nhóm ca</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ chuẩn</th>
                  <th className="px-2.5 py-2 whitespace-nowrap">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s, idx) => {
                  const grpCls =
                    s.group === 'Day'
                      ? 'bg-[#d0e2ff] text-[#161616]'
                      : s.group === 'Night'
                        ? 'bg-[#262626] text-[#f4f4f4]'
                        : s.group === 'Mid'
                          ? 'bg-[#f6f2ff] text-[#6929c4]'
                          : s.group === 'SOS'
                            ? 'bg-[#fef3c7] text-[#b45309]'
                            : 'bg-[#e2e8f0] text-[#475569]';
                  const effStd = getShiftEffectiveStdHours(s);
                  const stdDisplay =
                    s.group === 'SOS'
                      ? `Scan Out Sớm (${effStd}h · ${classifySosShiftSide(s.timeRange)})`
                      : `${effStd}h`;
                  return (
                    <tr
                      key={s.code}
                      className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'}`}
                    >
                      <td className="font-mono-num px-2.5 py-2 font-medium whitespace-nowrap text-[#0f172a]">
                        {s.code}
                      </td>
                      <td className="font-mono-num px-2.5 py-2 whitespace-nowrap text-[#475569]">{s.timeRange}</td>
                      <td className="font-mono-num px-2.5 py-2 whitespace-nowrap">{s.shortCode}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 text-[11px] font-medium ${grpCls}`}>
                          {formatShiftGroupLabel(s.group)}
                        </span>
                      </td>
                      <td className="font-mono-num px-2.5 py-2 text-right whitespace-nowrap">{stdDisplay}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => startEditShift(s)}
                          className="cursor-pointer text-xs font-medium text-[#0f62fe] hover:underline"
                        >
                          Sửa
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
