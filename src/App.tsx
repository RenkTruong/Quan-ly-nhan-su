import { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { BarChart3, CalendarClock, FileSpreadsheet, Table2 } from 'lucide-react';
import { DashboardTab } from './components/DashboardTab';
import { MasterDataTab } from './components/MasterDataTab';
import { MonthlyMatrixTab } from './components/MonthlyMatrixTab';
import { ScheduleEditorTab } from './components/ScheduleEditorTab';
import { buildSeedSchedule, DEFAULT_EMPLOYEES, DEFAULT_SHIFTS } from './data/seedData';
import { AppState, DepartmentId, Employee, ScheduleRecord, ShiftDef, TabId } from './types/warehouse';
import {
  computeRangeAnalytics,
  formatShortVNDate,
  formatVNDate,
  formatYMD,
  isOtLocked,
  isShiftLocked,
  parseYMD,
} from './utils/analytics';
import { clearCachedToken, getAccessToken, googleSignIn, initAuth, logout } from './utils/googleAuth';
import { extractSpreadsheetId, syncFromGoogleSheet } from './utils/googleSheetsSync';

const STORAGE_KEY = 'ob_warehouse_ops_state_v1';

function getLiveClockString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mi}`;
}

function normalizeStoredShifts(stored: unknown): ShiftDef[] {
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_SHIFTS;

  const mapped: ShiftDef[] = stored.map((raw) => {
    const s = raw as ShiftDef;
    if (s.code === 'DAY') {
      const wasOldEightHour = s.timeRange === '06:00-14:00' || Number(s.stdHours) === 8;
      return {
        ...s,
        name: wasOldEightHour ? 'Ca Day (06:00-15:00)' : s.name,
        timeRange: wasOldEightHour ? '06:00-15:00' : s.timeRange,
        group: 'Day',
        stdHours: 9,
      };
    }
    if (s.code === 'NIGHT') {
      const wasOldNight = s.timeRange === '22:00-07:00' || s.timeRange === '22:00-06:00' || s.name.includes('Ca Đêm');
      return {
        ...s,
        name: wasOldNight ? 'Ca Night (21:00-05:00)' : s.name,
        timeRange: wasOldNight ? '21:00-05:00' : s.timeRange,
        group: 'Night',
        stdHours: 8,
      };
    }
    if (s.group === 'Mid') {
      const upgradedRange =
        s.timeRange === '10:00-18:00'
          ? '10:00-19:00'
          : s.timeRange === '11:00-19:00'
            ? '11:00-20:00'
            : s.timeRange === '12:00-20:00'
              ? '12:00-21:00'
              : s.timeRange;
      const cleanName = s.name
        .replace(/Ca Giữa\s*/gi, 'MID ')
        .replace(/\(Ca linh hoạt[^)]*\)/gi, '')
        .replace(/10:00-18:00/g, '10:00-19:00')
        .replace(/11:00-19:00/g, '11:00-20:00')
        .replace(/12:00-20:00/g, '12:00-21:00')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        ...s,
        name: cleanName || `MID (${upgradedRange})`,
        timeRange: upgradedRange,
        stdHours: 9,
      };
    }
    if (s.group === 'Day') {
      return { ...s, stdHours: 9 };
    }
    if (s.group === 'Night') {
      return { ...s, stdHours: 8 };
    }
    return s;
  });

  if (!mapped.some((s) => s.group === 'SOS')) {
    const defaultSos = DEFAULT_SHIFTS.find((s) => s.group === 'SOS');
    if (defaultSos) {
      const offIdx = mapped.findIndex((s) => s.group === 'Off');
      if (offIdx >= 0) mapped.splice(offIdx, 0, defaultSos);
      else mapped.push(defaultSos);
    }
  }
  return mapped;
}

function createInitialState(): AppState {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.employees) && parsed.employees.length > 0) {
          return {
            employees: parsed.employees,
            shifts: normalizeStoredShifts(parsed.shifts),
            records: parsed.records || buildSeedSchedule(parsed.employees),
            rangeStart: parsed.rangeStart || '2026-11-01',
            rangeEnd: parsed.rangeEnd || '2026-11-21',
            activeTab: parsed.activeTab || 'dashboard',
            schedDate: parsed.schedDate || '2026-11-18',
            drilldown: parsed.drilldown || { mode: 'all', id: 'OB' },
            googleSheetUrl: parsed.googleSheetUrl || '',
          };
        }
      }
    } catch {
      // Fallback to default state
    }
  }
  return {
    employees: DEFAULT_EMPLOYEES,
    shifts: DEFAULT_SHIFTS,
    records: buildSeedSchedule(DEFAULT_EMPLOYEES),
    rangeStart: '2026-11-01',
    rangeEnd: '2026-11-21',
    activeTab: 'dashboard',
    schedDate: '2026-11-18',
    drilldown: { mode: 'all', id: 'OB' },
    googleSheetUrl: '',
  };
}

export default function App() {
  const [state, setState] = useState<AppState>(createInitialState);
  const [liveClock, setLiveClock] = useState<string>(getLiveClockString);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    tone: 'neutral' | 'positive' | 'warning' | 'error';
  }>({
    text: 'Sẵn sàng · Dữ liệu vận hành Kho OB tháng 11/2026.',
    tone: 'neutral',
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveClock(getLiveClockString());
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  // Client-side Google Auth & Sheets Auto-Sync state (token strictly in memory)
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [isLoggingInGoogle, setIsLoggingInGoogle] = useState(false);
  const [autoSyncSheet, setAutoSyncSheet] = useState(false);
  const [strictSheetLock, setStrictSheetLock] = useState(true);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [lastSheetSyncInfo, setLastSheetSyncInfo] = useState<{
    timeStr: string;
    title: string;
    summary: string;
  } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }, [state]);

  useEffect(() => {
    const unsub = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setHasGoogleToken(Boolean(token));
      },
      (user) => {
        setGoogleUser(user);
        setHasGoogleToken(false);
        setAutoSyncSheet(false);
      }
    );
    return () => unsub();
  }, []);

  const analytics = useMemo(
    () => computeRangeAnalytics(state.employees, state.shifts, state.records, state.rangeStart, state.rangeEnd),
    [state.employees, state.shifts, state.records, state.rangeStart, state.rangeEnd]
  );

  const showToast = (text: string, tone: 'neutral' | 'positive' | 'warning' | 'error' = 'neutral') => {
    setStatusMessage({ text, tone });
  };

  const handleRangeChange = (nextStart: string, nextEnd: string) => {
    const safeEnd = nextStart && nextEnd && nextStart > nextEnd ? nextStart : nextEnd;
    setState((prev) => ({ ...prev, rangeStart: nextStart, rangeEnd: safeEnd }));
  };

  const handleToggleDept = (deptId: DepartmentId) => {
    setState((prev) => {
      if (prev.drilldown.mode === 'dept' && prev.drilldown.id === deptId) {
        return { ...prev, drilldown: { mode: 'all', id: 'OB' } };
      }
      return { ...prev, drilldown: { mode: 'dept', id: deptId, prevDeptId: deptId } };
    });
  };

  const handleClearSelection = () => {
    setState((prev) => ({
      ...prev,
      drilldown: { mode: 'all', id: 'OB' },
    }));
  };

  const handleSelectEmployee = (empId: string) => {
    setState((prev) => ({
      ...prev,
      activeTab: 'dashboard',
      drilldown: {
        mode: 'employee',
        id: empId,
        prevDeptId: prev.drilldown.mode === 'dept' ? (prev.drilldown.id as DepartmentId) : undefined,
      },
    }));
  };

  const handleJumpToScheduleDate = (dateYmd: string) => {
    setState((prev) => ({
      ...prev,
      activeTab: 'schedule',
      schedDate: dateYmd,
    }));
    showToast(`Đã chuyển đến bảng phân ca & chấm OT ngày ${formatVNDate(dateYmd)}.`, 'neutral');
  };

  const handleUpdateShift = (dateYmd: string, empId: string, shiftCode: string) => {
    const lock = isShiftLocked(dateYmd, liveClock);
    if (lock.locked) {
      showToast(lock.message, 'error');
      return;
    }
    setState((prev) => {
      const key = `${dateYmd}|${empId}`;
      const existing = prev.records[key] || { shiftCode: 'OFF', otHours: 0, note: '' };
      return {
        ...prev,
        records: {
          ...prev.records,
          [key]: { ...existing, shiftCode },
        },
      };
    });
    const shiftInfo = state.shifts.find((s) => s.code === shiftCode);
    const label = shiftInfo ? `${shiftInfo.code} (${shiftInfo.timeRange})` : shiftCode;
    showToast(`Đã cập nhật giờ làm ${label} cho ${empId} ngày ${formatVNDate(dateYmd)}.`, 'positive');
  };

  const handleUpdateOt = (dateYmd: string, empId: string, otHours: number) => {
    const lock = isOtLocked(dateYmd, liveClock);
    if (lock.locked) {
      showToast(`Không thể sửa OT ngày ${formatVNDate(dateYmd)} vì đã quá hạn 23:59:59 ngày D+2 (${lock.deadlineStr}).`, 'error');
      return;
    }
    const clamped = Math.max(0, Math.min(12, Number(otHours) || 0));
    setState((prev) => {
      const key = `${dateYmd}|${empId}`;
      const existing = prev.records[key] || { shiftCode: 'OFF', otHours: 0, note: '' };
      return {
        ...prev,
        records: {
          ...prev.records,
          [key]: { ...existing, otHours: clamped },
        },
      };
    });
    showToast(`Đã cập nhật ${clamped}h OT cho ${empId} ngày ${formatVNDate(dateYmd)}.`, 'positive');
  };

  const handleUpdateRole = (dateYmd: string, empId: string, role: string) => {
    const lock = isShiftLocked(dateYmd, liveClock);
    if (lock.locked) {
      showToast(lock.message, 'error');
      return;
    }
    const normalizedRole = role.trim();
    if (!normalizedRole) {
      showToast('Vị trí không được để trống.', 'warning');
      return;
    }
    setState((prev) => {
      const key = `${dateYmd}|${empId}`;
      const existing = prev.records[key] || { shiftCode: 'OFF', otHours: 0, note: '' };
      return {
        ...prev,
        records: {
          ...prev.records,
          [key]: { ...existing, role: normalizedRole },
        },
      };
    });
    showToast(`Đã cập nhật vị trí ${normalizedRole} cho ${empId} ngày ${formatVNDate(dateYmd)}.`, 'positive');
  };

  const handleCopyPrevDay = (dateYmd: string) => {
    const lock = isShiftLocked(dateYmd, liveClock);
    if (lock.locked) {
      showToast(`Ngày ${formatVNDate(dateYmd)} đã khóa phân ca (quá 15:00 ngày D-1), không thể sao chép.`, 'error');
      return;
    }
    const dt = parseYMD(dateYmd);
    if (!dt) return;
    dt.setDate(dt.getDate() - 1);
    const prevYmd = formatYMD(dt);

    let copied = 0;
    setState((prev) => {
      const nextRecords = { ...prev.records };
      prev.employees
        .filter((e) => e.status === 'Active')
        .forEach((emp) => {
          const prevRec = prev.records[`${prevYmd}|${emp.id}`] || { shiftCode: 'OFF', otHours: 0, note: '' };
          const curRec = prev.records[`${dateYmd}|${emp.id}`] || { shiftCode: 'OFF', otHours: 0, note: '' };
          nextRecords[`${dateYmd}|${emp.id}`] = {
            shiftCode: prevRec.shiftCode,
            otHours: curRec.otHours || 0,
            role: prevRec.role || emp.role,
            note: curRec.note || '',
          };
          copied++;
        });
      return { ...prev, records: nextRecords };
    });
    showToast(
      `Đã sao chép phân ca từ ${formatVNDate(prevYmd)} sang ${formatVNDate(dateYmd)} cho ${copied} nhân sự.`,
      'positive'
    );
  };

  const handleSaveEmployee = (emp: Employee, isEdit: boolean) => {
    setState((prev) => {
      const existsIdx = prev.employees.findIndex((e) => e.id === emp.id);
      const nextEmps = [...prev.employees];
      if (isEdit && existsIdx >= 0) nextEmps[existsIdx] = emp;
      else nextEmps.push(emp);
      return { ...prev, employees: nextEmps };
    });
    showToast(
      isEdit
        ? `Đã cập nhật nhân sự ${emp.id} – ${emp.name}.`
        : `Đã thêm nhân sự mới ${emp.id} – ${emp.name} (${emp.dept} / ${emp.role}).`,
      'positive'
    );
  };

  const handleSaveShift = (shift: ShiftDef, isEdit: boolean) => {
    setState((prev) => {
      const idx = prev.shifts.findIndex((s) => s.code === shift.code);
      const nextShifts = [...prev.shifts];
      if (isEdit && idx >= 0) nextShifts[idx] = shift;
      else nextShifts.push(shift);
      return { ...prev, shifts: nextShifts };
    });
    showToast(
      isEdit ? `Đã cập nhật ca làm việc ${shift.code} (${shift.timeRange}).` : `Đã thêm ca làm việc mới ${shift.code}: ${shift.name}.`,
      'positive'
    );
  };

  const handleImportComplete = (employees: Employee[], records: Record<string, ScheduleRecord>) => {
    setState((prev) => ({ ...prev, employees, records }));
  };

  const handleChangeGoogleSheetUrl = (url: string) => {
    setState((prev) => ({ ...prev, googleSheetUrl: url }));
  };

  const handleGoogleLogin = async () => {
    setIsLoggingInGoogle(true);
    try {
      const { user, accessToken } = await googleSignIn();
      setGoogleUser(user);
      setHasGoogleToken(Boolean(accessToken));
      showToast(`Đã kết nối Google Sheets với tài khoản ${user.email || user.displayName || 'Google'}.`, 'positive');
    } catch (err) {
      const errorCode = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
      const msg =
        errorCode === 'auth/unauthorized-domain'
          ? `Tên miền ${window.location.hostname} chưa được cho phép trong Firebase Authentication. Hãy thêm tên miền này tại Firebase Console > Authentication > Settings > Authorized domains, rồi thử lại.`
          : err instanceof Error
            ? err.message
            : 'Đăng nhập Google không thành công.';
      showToast(msg, 'error');
    } finally {
      setIsLoggingInGoogle(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setGoogleUser(null);
    setHasGoogleToken(false);
    setAutoSyncSheet(false);
    showToast('Đã ngắt kết nối tài khoản Google.', 'neutral');
  };

  const handleSyncFromGoogleSheet = useCallback(
    async (silent = false) => {
      const spreadsheetId = extractSpreadsheetId(state.googleSheetUrl || '');
      const token = getAccessToken();
      if (!spreadsheetId || !token) {
        if (!silent) {
          showToast('Vui lòng đăng nhập Google và nhập link Google Sheet hợp lệ.', 'warning');
        }
        return null;
      }

      setIsSyncingSheet(true);
      try {
        const res = await syncFromGoogleSheet({
          spreadsheetId,
          accessToken: token,
          employees: state.employees,
          shifts: state.shifts,
          records: state.records,
          simClock: liveClock,
          strictLock: strictSheetLock,
        });

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
          2,
          '0'
        )}:${String(now.getSeconds()).padStart(2, '0')}`;
        const summary = `Cập nhật ${res.schedUpdated} dòng lịch, ${res.masterUpdated} nhân sự${
          res.skippedLocked > 0 ? `, bỏ qua ${res.skippedLocked} dòng đã khóa` : ''
        }${res.unmatchedRows > 0 ? `, ${res.unmatchedRows} dòng chưa khớp mã` : ''}`;

        setLastSheetSyncInfo({ timeStr, title: res.title, summary });

        if (res.schedUpdated > 0 || res.masterUpdated > 0) {
          setState((prev) => ({ ...prev, employees: res.employees, records: res.records }));
          showToast(`Google Sheets (${res.title}): ${summary}.`, 'positive');
        } else if (!silent) {
          showToast(`Đã kiểm tra Google Sheets (${res.title}) — dữ liệu đã mới nhất.`, 'neutral');
        }
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi đồng bộ Google Sheet.';
        if (msg.includes('hết hạn')) {
          clearCachedToken();
          setHasGoogleToken(false);
          setAutoSyncSheet(false);
        }
        if (!silent) {
          showToast(msg, 'error');
        }
        throw err;
      } finally {
        setIsSyncingSheet(false);
      }
    },
    [state.googleSheetUrl, state.employees, state.shifts, state.records, liveClock, strictSheetLock]
  );

  useEffect(() => {
    if (!autoSyncSheet || !hasGoogleToken) return;
    const spreadsheetId = extractSpreadsheetId(state.googleSheetUrl || '');
    if (!spreadsheetId) return;

    const timer = window.setInterval(() => {
      handleSyncFromGoogleSheet(true).catch(() => {
        // Handled inside handleSyncFromGoogleSheet
      });
    }, 15000);

    return () => window.clearInterval(timer);
  }, [autoSyncSheet, hasGoogleToken, state.googleSheetUrl, handleSyncFromGoogleSheet]);

  const handleResetDemoData = () => {
    setState((prev) => ({
      ...prev,
      employees: DEFAULT_EMPLOYEES,
      shifts: DEFAULT_SHIFTS,
      records: buildSeedSchedule(DEFAULT_EMPLOYEES),
    }));
    showToast('Đã khôi phục toàn bộ dữ liệu mẫu Kho OB tháng 11/2026.', 'positive');
  };

  const otPct = analytics.ob.totalHours > 0 ? ((analytics.ob.otHours / analytics.ob.totalHours) * 100).toFixed(1) : '0.0';
  const avgDaily = analytics.dates.length > 0 ? (analytics.ob.totalShifts / analytics.dates.length).toFixed(1) : '0';

  const statusToneClasses =
    statusMessage.tone === 'positive'
      ? 'border-[#198038]/30 bg-[#defbe6]'
      : statusMessage.tone === 'warning'
        ? 'border-[#8a6100]/30 bg-[#fcf4d6]'
        : statusMessage.tone === 'error'
          ? 'border-[#da1e28]/30 bg-[#fff1f1]'
          : 'border-[#e2e8f0] bg-white';

  const tabs: Array<{ id: TabId; label: string; icon: typeof BarChart3 }> = [
    { id: 'dashboard', label: 'Báo cáo & Chi tiết', icon: BarChart3 },
    { id: 'schedule', label: 'Phân ca & Chấm OT', icon: CalendarClock },
    { id: 'matrix', label: 'Lịch tháng (PNG)', icon: Table2 },
    { id: 'master', label: 'Nhân sự & Google Sheets', icon: FileSpreadsheet },
  ];

  return (
    <div className="mx-auto grid max-w-[1440px] gap-4 p-3 sm:gap-5 sm:p-4 md:gap-6 md:p-6 [&>*]:min-w-0">
      {/* MASTHEAD */}
      <header className="grid grid-cols-1 items-end gap-4 border-b border-[#e2e8f0] pb-4 md:gap-6 md:pb-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <div className="font-mono-num text-[11px] font-medium tracking-wider text-[#64748b] uppercase sm:text-xs">
            Hệ thống Điều hành Kho Outbound (OB)
          </div>
          <h1 className="mt-1 text-xl leading-tight font-normal text-balance text-[#0f172a] sm:text-2xl md:text-[32px]">
            Quản lý Phân ca &amp; <strong className="font-semibold">Báo cáo Vận hành Kho OB</strong>
          </h1>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2.5 border border-[#e2e8f0] bg-white p-3 sm:p-3.5 lg:col-span-4">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="range-start" className="text-xs font-medium text-[#475569]">
              Từ ngày
            </label>
            <input
              type="date"
              id="range-start"
              value={state.rangeStart}
              onChange={(e) => handleRangeChange(e.target.value, state.rangeEnd)}
              className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2 text-xs text-[#0f172a] sm:text-sm"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="range-end" className="text-xs font-medium text-[#475569]">
              Đến ngày
            </label>
            <input
              type="date"
              id="range-end"
              value={state.rangeEnd}
              onChange={(e) => handleRangeChange(state.rangeStart, e.target.value)}
              className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2 text-xs text-[#0f172a] sm:text-sm"
            />
          </div>
        </div>
      </header>

      {/* STATUS BAR */}
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-xs text-[#0f172a] sm:px-4 sm:text-sm ${statusToneClasses}`}
      >
        <span className="min-w-0 break-words">{statusMessage.text}</span>
      </div>

      {/* 5-TILE KPI STRIP */}
      <section aria-label="Chỉ số tổng quan kho Outbound" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 flex flex-col gap-1 border border-[#e2e8f0] border-b-2 border-b-[#0f62fe] bg-white p-3.5 sm:p-4 lg:col-span-1">
          <span className="font-mono-num text-[11px] font-medium tracking-wider text-[#64748b] uppercase">
            Tổng giờ vận hành
          </span>
          <span className="font-mono-num text-2xl font-semibold text-[#0f172a] sm:text-3xl">
            {analytics.ob.totalHours.toLocaleString('vi-VN')}h
          </span>
          <span className="text-xs text-[#64748b]">
            {analytics.ob.baseHours}h ca chuẩn + {analytics.ob.otHours}h OT
          </span>
        </div>

        <div className="flex flex-col gap-1 border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
          <span className="font-mono-num text-[11px] font-medium tracking-wider text-[#64748b] uppercase">
            Tổng lượt ca
          </span>
          <span className="font-mono-num text-2xl font-semibold text-[#0f172a] sm:text-3xl">
            {analytics.ob.totalShifts.toLocaleString('vi-VN')}
          </span>
          <span className="text-xs text-[#64748b]">
            {analytics.dates.length} ngày ({formatShortVNDate(state.rangeStart)}–{formatShortVNDate(state.rangeEnd)})
          </span>
        </div>

        <div className="flex flex-col gap-1 border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
          <span className="font-mono-num text-[11px] font-medium tracking-wider text-[#64748b] uppercase">
            Day / Night Shift
          </span>
          <span className="font-mono-num text-2xl font-semibold text-[#0f172a] sm:text-3xl">
            {analytics.ob.convDay} / {analytics.ob.convNight}
          </span>
          <span className="text-xs text-[#64748b]">
            Day: {analytics.ob.dayHours.toLocaleString('vi-VN')}h · Night: {analytics.ob.nightHours.toLocaleString('vi-VN')}h
          </span>
        </div>

        <div className="flex flex-col gap-1 border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
          <span className="font-mono-num text-[11px] font-medium tracking-wider text-[#64748b] uppercase">
            Tổng giờ OT
          </span>
          <span className="font-mono-num text-2xl font-semibold text-[#0f172a] sm:text-3xl">
            {analytics.ob.otHours.toLocaleString('vi-VN')}h
          </span>
          <span className="text-xs text-[#64748b]">Chiếm {otPct}% tổng giờ VH</span>
        </div>

        <div className="flex flex-col gap-1 border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
          <span className="font-mono-num text-[11px] font-medium tracking-wider text-[#64748b] uppercase">
            Nhân sự Active
          </span>
          <span className="font-mono-num text-2xl font-semibold text-[#0f172a] sm:text-3xl">{analytics.activeEmps.length}</span>
          <span className="text-xs text-[#64748b]">TB {avgDaily} người/ngày · 6 Task</span>
        </div>
      </section>

      {/* NAVIGATION TABS */}
      <nav
        aria-label="Phân hệ quản lý kho OB"
        className="flex overflow-x-auto border-b border-[#e2e8f0] bg-white px-1 sm:flex-wrap"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = state.activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setState((prev) => ({ ...prev, activeTab: t.id }))}
              className={`inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 border-b-2 px-4 py-2.5 text-xs whitespace-nowrap transition-colors sm:px-5 sm:text-sm ${
                isActive
                  ? 'border-[#0f62fe] font-semibold text-[#0f172a]'
                  : 'border-transparent text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* TAB PANELS */}
      {state.activeTab === 'dashboard' && (
        <DashboardTab
          analytics={analytics}
          employees={state.employees}
          shifts={state.shifts}
          records={state.records}
          rangeStart={state.rangeStart}
          rangeEnd={state.rangeEnd}
          simClock={liveClock}
          drilldown={state.drilldown}
          onSelectDept={handleToggleDept}
          onClearSelection={handleClearSelection}
          onSelectEmployee={handleSelectEmployee}
          onJumpToScheduleDate={handleJumpToScheduleDate}
          onUpdateShift={handleUpdateShift}
        />
      )}

      {state.activeTab === 'schedule' && (
        <ScheduleEditorTab
          employees={state.employees}
          shifts={state.shifts}
          records={state.records}
          schedDate={state.schedDate}
          simClock={liveClock}
          onChangeSchedDate={(dateYmd) => setState((prev) => ({ ...prev, schedDate: dateYmd }))}
          onUpdateShift={handleUpdateShift}
          onUpdateOt={handleUpdateOt}
          onUpdateRole={handleUpdateRole}
          onCopyPrevDay={handleCopyPrevDay}
          onSelectEmployee={handleSelectEmployee}
        />
      )}

      {state.activeTab === 'matrix' && (
        <MonthlyMatrixTab
          employees={state.employees}
          shifts={state.shifts}
          records={state.records}
          simClock={liveClock}
          onUpdateShift={handleUpdateShift}
          onToast={showToast}
        />
      )}

      {state.activeTab === 'master' && (
        <MasterDataTab
          employees={state.employees}
          shifts={state.shifts}
          records={state.records}
          rangeStart={state.rangeStart}
          rangeEnd={state.rangeEnd}
          simClock={liveClock}
          googleSheetUrl={state.googleSheetUrl || ''}
          googleUser={googleUser}
          hasGoogleToken={hasGoogleToken}
          isLoggingInGoogle={isLoggingInGoogle}
          isSyncingSheet={isSyncingSheet}
          autoSyncSheet={autoSyncSheet}
          strictSheetLock={strictSheetLock}
          lastSheetSyncInfo={lastSheetSyncInfo}
          onChangeGoogleSheetUrl={handleChangeGoogleSheetUrl}
          onChangeStrictSheetLock={setStrictSheetLock}
          onToggleAutoSync={setAutoSyncSheet}
          onGoogleLogin={handleGoogleLogin}
          onGoogleLogout={handleGoogleLogout}
          onSyncFromGoogleSheet={() => handleSyncFromGoogleSheet(false)}
          onTokenExpired={() => {
            clearCachedToken();
            setHasGoogleToken(false);
            setAutoSyncSheet(false);
          }}
          onSaveEmployee={handleSaveEmployee}
          onSaveShift={handleSaveShift}
          onImportComplete={handleImportComplete}
          onResetDemoData={handleResetDemoData}
          onSelectEmployee={handleSelectEmployee}
          onToast={showToast}
        />
      )}
    </div>
  );
}
