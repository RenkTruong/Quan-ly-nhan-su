import { useMemo, useState } from 'react';
import { Camera, Check, Clock, Download, Lock, X } from 'lucide-react';
import { DEPT_CATALOG } from '../data/seedData';
import { DepartmentId, Employee, ScheduleRecord, ShiftDef } from '../types/warehouse';
import {
  assignDailyShiftBucket,
  classifySosShiftSide,
  formatShiftGroupLabel,
  formatVNDate,
  getRecord,
  getShiftDef,
  getShiftEffectiveStdHours,
  getShiftStartTimeLabel,
  getVNWeekday,
  isShiftLocked,
} from '../utils/analytics';
import { downloadMatrixPng } from '../utils/excelSync';

interface MonthlyMatrixTabProps {
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  simClock: string;
  onUpdateShift: (dateYmd: string, empId: string, shiftCode: string) => void;
  onToast: (msg: string, tone: 'positive' | 'warning' | 'error' | 'neutral') => void;
}

export function MonthlyMatrixTab({
  employees,
  shifts,
  records,
  simClock,
  onUpdateShift,
  onToast,
}: MonthlyMatrixTabProps) {
  const [monthYm, setMonthYm] = useState('2026-11');
  const [dayFrom, setDayFrom] = useState(1);
  const [dayTo, setDayTo] = useState(21);
  const [deptFilter, setDeptFilter] = useState<'ALL' | DepartmentId>('ALL');
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [cellDisplayMode, setCellDisplayMode] = useState<'start_time' | 'code_ot'>('start_time');
  const [editingCell, setEditingCell] = useState<{
    emp: Employee;
    date: string;
    currentShiftCode: string;
  } | null>(null);

  const { yy, mm, dates } = useMemo(() => {
    const [y, m] = (monthYm || '2026-11').split('-').map(Number);
    const maxDay = new Date(y, m, 0).getDate();
    const safeFrom = Math.max(1, Math.min(maxDay, dayFrom || 1));
    const safeTo = Math.max(safeFrom, Math.min(maxDay, dayTo || 21));
    const arr: string[] = [];
    for (let d = safeFrom; d <= safeTo; d++) {
      arr.push(`${monthYm}-${String(d).padStart(2, '0')}`);
    }
    return { yy: y, mm: m, dates: arr };
  }, [monthYm, dayFrom, dayTo]);

  const deptsToRender = useMemo(
    () => (deptFilter === 'ALL' ? DEPT_CATALOG : DEPT_CATALOG.filter((d) => d.id === deptFilter)),
    [deptFilter]
  );

  const handleDownloadPng = (deptId: DepartmentId, shiftSide: 'Day' | 'Night') => {
    const filename = downloadMatrixPng({
      employees,
      shifts,
      records,
      deptId,
      shiftSide,
      ym: monthYm,
      dFrom: Number(dates[0]?.slice(8, 10) || 1),
      dTo: Number(dates[dates.length - 1]?.slice(8, 10) || 21),
    });
    if (filename) {
      onToast(`Đã xuất ảnh lịch ${filename}.`, 'positive');
    }
  };

  const handleCellClick = (emp: Employee, dateYmd: string, currentShiftCode: string) => {
    if (screenshotMode) return;
    const lock = isShiftLocked(dateYmd, simClock);
    if (lock.locked) {
      onToast(lock.message, 'warning');
      return;
    }
    setEditingCell({ emp, date: dateYmd, currentShiftCode });
  };

  const handleSelectShiftForCell = (shiftCode: string) => {
    if (!editingCell) return;
    onUpdateShift(editingCell.date, editingCell.emp.id, shiftCode);
    setEditingCell(null);
  };

  return (
    <div className="grid gap-5 sm:gap-6 [&>*]:min-w-0">
      {/* Inline Hour / Shift Picker Modal */}
      {editingCell && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cell-shift-picker-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#161616]/60 p-4"
        >
          <div className="w-full max-w-md border border-[#e0e0e0] bg-white p-4 shadow-lg sm:p-5">
            <div className="flex items-start justify-between gap-3 border-b border-[#e0e0e0] pb-3">
              <div className="min-w-0">
                <div className="font-mono-num text-[11px] font-medium text-[#0f62fe] uppercase">
                  Đổi giờ làm trực tiếp · {editingCell.emp.id} ({editingCell.emp.dept})
                </div>
                <h3 id="cell-shift-picker-title" className="mt-0.5 text-base font-semibold text-[#161616]">
                  {editingCell.emp.name} — {formatVNDate(editingCell.date)} ({getVNWeekday(editingCell.date)})
                </h3>
                <p className="mt-0.5 text-xs text-[#525252]">
                  {isShiftLocked(editingCell.date, simClock).message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                aria-label="Đóng hộp chọn giờ làm"
                className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center text-[#525252] hover:bg-[#f4f4f4] hover:text-[#161616]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-3 grid max-h-[360px] gap-1.5 overflow-y-auto pr-0.5">
              {shifts.map((s) => {
                const isSelected = s.code === editingCell.currentShiftCode;
                const badgeCls =
                  s.group === 'Day'
                    ? 'bg-[#d0e2ff] text-[#161616]'
                    : s.group === 'Night'
                      ? 'bg-[#262626] text-[#f4f4f4]'
                      : s.group === 'Mid'
                        ? 'bg-[#f6f2ff] text-[#6929c4]'
                        : s.group === 'SOS'
                          ? 'bg-[#fef3c7] text-[#b45309]'
                          : 'bg-[#e0e0e0] text-[#525252]';
                const effStd = getShiftEffectiveStdHours(s);
                const stdSummary =
                  s.group === 'Off'
                    ? 'Nghỉ'
                    : s.group === 'SOS'
                      ? `Scan Out Sớm (${effStd}h · tính vào ${classifySosShiftSide(s.timeRange)})`
                      : `${effStd}h chuẩn`;
                return (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => handleSelectShiftForCell(s.code)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-3 border px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'border-[#0f62fe] bg-[#d0e2ff]/35'
                        : 'border-[#e0e0e0] bg-white hover:border-[#0f62fe] hover:bg-[#f4f4f4]'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`font-mono-num inline-flex min-w-[46px] items-center justify-center px-1.5 py-1 text-xs font-semibold ${badgeCls}`}
                      >
                        {getShiftStartTimeLabel(s)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono-num truncate text-sm font-semibold text-[#161616]">{s.code}</div>
                        <div className="font-mono-num text-xs text-[#525252]">
                          {formatShiftGroupLabel(s.group)} · {s.timeRange} · {stdSummary}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-[#0f62fe]" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!screenshotMode && (
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e2e8f0] pb-3 sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#0f172a] sm:text-xl">Lịch Tháng theo Task &amp; Ca</h2>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="inline-flex w-full border border-[#e2e8f0] bg-white p-0.5 sm:w-auto">
              <button
                type="button"
                onClick={() => setCellDisplayMode('start_time')}
                className={`flex-1 cursor-pointer px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors sm:flex-none sm:px-3 sm:py-1.5 ${
                  cellDisplayMode === 'start_time' ? 'bg-[#0f62fe] text-white' : 'text-[#475569] hover:text-[#0f172a]'
                }`}
              >
                Giờ bắt đầu ca (PNG)
              </button>
              <button
                type="button"
                onClick={() => setCellDisplayMode('code_ot')}
                className={`flex-1 cursor-pointer px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors sm:flex-none sm:px-3 sm:py-1.5 ${
                  cellDisplayMode === 'code_ot' ? 'bg-[#0f62fe] text-white' : 'text-[#475569] hover:text-[#0f172a]'
                }`}
              >
                Mã ca &amp; OT
              </button>
            </div>
            <button
              type="button"
              onClick={() => setScreenshotMode(true)}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 border border-[#0f62fe] bg-white px-3.5 text-xs font-medium whitespace-nowrap text-[#0f62fe] transition-colors hover:bg-[#eff6ff] sm:h-9 sm:w-auto"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              Chế độ Chụp
            </button>
          </div>
        </div>
      )}

      {screenshotMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[#198038]/40 bg-[#defbe6] px-4 py-2.5 text-sm text-[#161616]">
          <span>
            Đang ở <strong>Chế độ Chụp Màn Hình</strong> — Hiển thị gọn giờ bắt đầu ca gửi cho nhân viên.
          </span>
          <button
            type="button"
            onClick={() => setScreenshotMode(false)}
            className="cursor-pointer bg-[#0f62fe] px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white hover:bg-[#0353e9]"
          >
            Thoát chế độ Chụp
          </button>
        </div>
      )}

      {!screenshotMode && (
        <div className="grid min-w-0 gap-3 border border-[#e2e8f0] bg-white p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="matrix-month" className="text-xs font-medium text-[#475569]">
                Tháng hiển thị
              </label>
              <input
                type="month"
                id="matrix-month"
                value={monthYm}
                onChange={(e) => setMonthYm(e.target.value)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="matrix-day-from" className="text-xs font-medium text-[#475569]">
                Từ ngày
              </label>
              <input
                type="number"
                id="matrix-day-from"
                min={1}
                max={31}
                value={dayFrom}
                onChange={(e) => setDayFrom(Number(e.target.value) || 1)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="matrix-day-to" className="text-xs font-medium text-[#475569]">
                Đến ngày
              </label>
              <input
                type="number"
                id="matrix-day-to"
                min={1}
                max={31}
                value={dayTo}
                onChange={(e) => setDayTo(Number(e.target.value) || 21)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="matrix-dept-filter" className="text-xs font-medium text-[#475569]">
                Chọn Task
              </label>
              <select
                id="matrix-dept-filter"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value as 'ALL' | DepartmentId)}
                className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm"
              >
                <option value="ALL">Tất cả 6 Task</option>
                {DEPT_CATALOG.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.roles.join(', ')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#475569]">
            <span>
              <strong className="bg-[#d0e2ff] px-1.5 py-0.5 text-[#161616]">06:00</strong> Day (9h)
            </span>
            <span>
              <strong className="bg-[#262626] px-1.5 py-0.5 text-[#f4f4f4]">21:00</strong> Night (8h)
            </span>
            <span>
              <strong className="bg-[#f6f2ff] px-1.5 py-0.5 text-[#6929c4]">10:00–12:00</strong> MID (9h)
            </span>
            <span>
              <strong className="bg-[#fef3c7] px-1.5 py-0.5 text-[#b45309]">SOS</strong> Scan Out Sớm
            </span>
            <span>
              <strong className="bg-[#e0e0e0] px-1.5 py-0.5 text-[#525252]">OFF</strong> Nghỉ
            </span>
            <span className="inline-flex items-center gap-1 text-[#0f62fe]">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Sửa trực tiếp ô giờ làm (D+1 trước 15:00)
            </span>
            <span className="inline-flex items-center gap-1 text-[#64748b]">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Đã khóa
            </span>
          </div>
        </div>
      )}

      {/* Matrices per Task */}
      <div className="grid min-w-0 gap-8 [&>*]:min-w-0">
        {deptsToRender.map((deptObj) => {
          const deptEmps = employees.filter((e) => e.status === 'Active' && e.dept === deptObj.id);
          if (deptEmps.length === 0) return null;

          const dailyBuckets: Record<string, Record<string, 'Day' | 'Night' | 'Off'>> = {};
          dates.forEach((d) => {
            dailyBuckets[d] = assignDailyShiftBucket(employees, shifts, records, deptObj.id, d);
          });

          return (
            <div key={deptObj.id} className="grid min-w-0 gap-4 border-b border-[#e2e8f0] pb-6 [&>*]:min-w-0">
              <div
                style={{ borderBottomColor: deptObj.color }}
                className="flex flex-wrap items-end justify-between gap-2 border-b-2 pb-2"
              >
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[#0f172a] sm:text-lg">
                    <span style={{ color: deptObj.color }}>{deptObj.name.toUpperCase()}</span> — LỊCH PHÂN CA THÁNG{' '}
                    {String(mm).padStart(2, '0')}/{yy}
                  </h3>
                  <p className="text-[13px] text-[#64748b]">
                    {deptObj.roles.join(' · ')} · {dates[0]?.slice(8, 10)}/{String(mm).padStart(2, '0')} –{' '}
                    {dates[dates.length - 1]?.slice(8, 10)}/{String(mm).padStart(2, '0')}
                  </p>
                </div>
              </div>

              {(['Day', 'Night'] as const).map((shiftSide) => {
                const isDay = shiftSide === 'Day';
                const empsInTable = deptEmps.filter((emp) => dates.some((d) => dailyBuckets[d][emp.id] === shiftSide));

                return (
                  <div key={shiftSide} className="min-w-0 border border-[#e0e0e0] bg-white">
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4 ${
                        isDay
                          ? 'border-b-2 border-[#0f62fe] bg-[#d0e2ff] text-[#161616]'
                          : 'border-b-2 border-[#6929c4] bg-[#262626] text-[#f4f4f4]'
                      }`}
                    >
                      <div className="text-xs sm:text-sm">
                        <strong>
                          {isDay ? 'BẢNG 1: CA DAY (CA NGÀY)' : 'BẢNG 2: CA NIGHT (CA ĐÊM)'} — {deptObj.name.toUpperCase()}
                        </strong>
                        <span className="ml-2 text-xs opacity-90">
                          ({empsInTable.length} nhân sự có lịch {shiftSide} trong kỳ)
                        </span>
                      </div>

                      {!screenshotMode && (
                        <button
                          type="button"
                          onClick={() => handleDownloadPng(deptObj.id, shiftSide)}
                          className={`inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 px-3 text-xs font-medium whitespace-nowrap sm:h-8 sm:w-auto ${
                            isDay
                              ? 'bg-[#0f62fe] text-white hover:bg-[#0353e9]'
                              : 'border border-white/40 bg-white text-[#161616] hover:bg-[#f4f4f4]'
                          }`}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          Tải ảnh PNG bảng này
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-center text-xs">
                        <thead>
                          <tr className="bg-[#f4f4f4] font-mono text-[11px] font-semibold">
                            <th className="hidden border border-[#e0e0e0] bg-white px-2 py-1.5 text-left whitespace-nowrap md:table-cell">
                              Mã NV
                            </th>
                            <th className="sticky left-0 z-10 border border-[#e0e0e0] bg-white px-2 py-1.5 text-left whitespace-nowrap shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] md:static md:shadow-none">
                              Họ và Tên
                            </th>
                            <th className="hidden border border-[#e0e0e0] bg-white px-2 py-1.5 text-left whitespace-nowrap md:table-cell">
                              Vị trí
                            </th>
                            <th className="border border-[#e0e0e0] px-2 py-1.5 whitespace-nowrap">Công</th>
                            {dates.map((d) => {
                              const wd = getVNWeekday(d);
                              const isWknd = wd === 'CN' || wd === 'T7';
                              return (
                                <th
                                  key={d}
                                  className={`border border-[#e0e0e0] px-1 py-1 ${isWknd ? 'bg-[#e0e0e0]' : 'bg-[#f4f4f4]'}`}
                                >
                                  <div>{d.slice(8, 10)}</div>
                                  <div className="font-normal text-[#525252]">{wd}</div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {empsInTable.length === 0 ? (
                            <tr>
                              <td colSpan={dates.length + 4} className="px-4 py-4 text-[#525252]">
                                Không có nhân sự được phân vào bảng {shiftSide} trong khoảng ngày này.
                              </td>
                            </tr>
                          ) : (
                            empsInTable.map((emp) => {
                              return (
                                <tr key={emp.id}>
                                  <td className="font-mono-num hidden border border-[#e0e0e0] bg-white px-2 py-1 text-left whitespace-nowrap md:table-cell">
                                    {emp.id}
                                  </td>
                                  <td className="sticky left-0 z-10 border border-[#e0e0e0] bg-white px-2 py-1 text-left font-semibold whitespace-nowrap shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] md:static md:shadow-none">
                                    <div>{emp.name}</div>
                                    <div className="font-mono-num text-[10px] font-normal text-[#525252] md:hidden">
                                      {emp.id} · {emp.role}
                                    </div>
                                  </td>
                                  <td className="hidden border border-[#e0e0e0] bg-white px-2 py-1 text-left whitespace-nowrap md:table-cell">
                                    {emp.role}
                                  </td>
                                  <td className="font-mono-num border border-[#e0e0e0] px-2 py-1 font-semibold">
                                    {dates.filter((d) => {
                                      const belongHere = dailyBuckets[d][emp.id] === shiftSide;
                                      const rec = getRecord(records, d, emp.id);
                                      const sDef = getShiftDef(shifts, rec.shiftCode);
                                      return belongHere && sDef.group !== 'Off';
                                    }).length}
                                  </td>
                                  {dates.map((d) => {
                                    const belongHere = dailyBuckets[d][emp.id] === shiftSide;
                                    const rec = getRecord(records, d, emp.id);
                                    const sDef = getShiftDef(shifts, rec.shiftCode);
                                    const showStartOnly = screenshotMode || cellDisplayMode === 'start_time';
                                    const sLock = isShiftLocked(d, simClock);
                                    const interactiveBtnCls = !screenshotMode
                                      ? sLock.locked
                                        ? 'cursor-not-allowed'
                                        : 'cursor-pointer hover:ring-2 hover:ring-[#0f62fe] hover:ring-inset'
                                      : '';
                                    const tooltipText = screenshotMode
                                      ? `${sDef.code} (${sDef.timeRange})`
                                      : sLock.locked
                                        ? sLock.message
                                        : `Click để đổi giờ làm ngày ${formatVNDate(d)} (${sDef.code} · ${sDef.timeRange})`;

                                    let cellContent = (
                                      <span className="text-[#8d8d8d]">{showStartOnly ? '—' : '·'}</span>
                                    );

                                    if (belongHere && sDef.group !== 'Off') {
                                      const cls =
                                        sDef.group === 'Day'
                                          ? 'bg-[#d0e2ff] text-[#161616]'
                                          : sDef.group === 'Night'
                                            ? 'bg-[#262626] text-[#f4f4f4]'
                                            : sDef.group === 'SOS'
                                              ? 'bg-[#fef3c7] text-[#b45309]'
                                              : 'bg-[#f6f2ff] text-[#6929c4]';

                                      if (showStartOnly) {
                                        cellContent = (
                                          <span
                                            className={`font-mono-num inline-flex min-w-[38px] items-center justify-center px-1.5 py-1 text-[11px] font-semibold ${cls}`}
                                          >
                                            {getShiftStartTimeLabel(sDef)}
                                          </span>
                                        );
                                      } else {
                                        cellContent = (
                                          <span
                                            className={`font-mono-num inline-flex min-w-[28px] flex-col items-center px-1 py-0.5 text-[11px] leading-tight font-semibold ${cls}`}
                                          >
                                            <span>{sDef.shortCode}</span>
                                            {rec.otHours > 0 && (
                                              <span className="text-[9px] font-semibold text-[#da1e28]">
                                                +{rec.otHours}h
                                              </span>
                                            )}
                                          </span>
                                        );
                                      }
                                    } else if (showStartOnly && sDef.group === 'Off') {
                                      cellContent = (
                                        <span className="font-mono-num text-[10px] font-medium text-[#6f6f6f]">OFF</span>
                                      );
                                    }

                                    return (
                                      <td key={d} className="border border-[#e0e0e0] p-0.5">
                                        {screenshotMode ? (
                                          <div title={tooltipText} className="flex items-center justify-center p-0.5">
                                            {cellContent}
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            title={tooltipText}
                                            onClick={() => handleCellClick(emp, d, rec.shiftCode)}
                                            aria-label={`${emp.name} ngày ${formatVNDate(d)}: ${sDef.timeRange}`}
                                            className={`flex w-full items-center justify-center p-0.5 transition-shadow ${interactiveBtnCls}`}
                                          >
                                            {cellContent}
                                          </button>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })
                          )}
                          <tr className="bg-[#f4f4f4] font-semibold">
                            <td className="hidden border border-[#e0e0e0] bg-[#f4f4f4] px-2 py-1.5 md:table-cell" />
                            <td className="sticky left-0 z-10 border border-[#e0e0e0] bg-[#f4f4f4] px-2 py-1.5 text-left whitespace-nowrap shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] md:static md:shadow-none">
                              Tổng quân số {shiftSide} ({deptObj.name})
                            </td>
                            <td className="hidden border border-[#e0e0e0] bg-[#f4f4f4] px-2 py-1.5 md:table-cell" />
                            <td className="font-mono-num border border-[#e0e0e0] px-2 py-1.5">—</td>
                            {dates.map((d) => {
                              const cnt = deptEmps.filter((emp) => dailyBuckets[d][emp.id] === shiftSide).length;
                              return (
                                <td key={d} className="font-mono-num border border-[#e0e0e0] px-1 py-1.5">
                                  {cnt}
                                </td>
                              );
                            })}
                          </tr>
                          {!screenshotMode && (
                            <tr className="bg-[#fafafa] text-[11px] font-medium text-[#525252]">
                              <td className="hidden border border-[#e0e0e0] bg-[#fafafa] px-2 py-1.5 md:table-cell" />
                              <td className="sticky left-0 z-10 border border-[#e0e0e0] bg-[#fafafa] px-2 py-1.5 text-left whitespace-nowrap shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] md:static md:shadow-none">
                                Tổng giờ VH {shiftSide} (h)
                              </td>
                              <td className="hidden border border-[#e0e0e0] bg-[#fafafa] px-2 py-1.5 md:table-cell" />
                              <td className="font-mono-num border border-[#e0e0e0] px-2 py-1.5 font-semibold text-[#161616]">
                                {Math.round(
                                  dates.reduce((acc, d) => {
                                    return (
                                      acc +
                                      deptEmps.reduce((dAcc, emp) => {
                                        if (dailyBuckets[d][emp.id] !== shiftSide) return dAcc;
                                        const rec = getRecord(records, d, emp.id);
                                        const sDef = getShiftDef(shifts, rec.shiftCode);
                                        return sDef.group !== 'Off'
                                          ? dAcc + getShiftEffectiveStdHours(sDef) + (rec.otHours || 0)
                                          : dAcc;
                                      }, 0)
                                    );
                                  }, 0) * 10
                                ) / 10}
                                h
                              </td>
                              {dates.map((d) => {
                                const hrs = deptEmps.reduce((dAcc, emp) => {
                                  if (dailyBuckets[d][emp.id] !== shiftSide) return dAcc;
                                  const rec = getRecord(records, d, emp.id);
                                  const sDef = getShiftDef(shifts, rec.shiftCode);
                                  return sDef.group !== 'Off'
                                    ? dAcc + getShiftEffectiveStdHours(sDef) + (rec.otHours || 0)
                                    : dAcc;
                                }, 0);
                                return (
                                  <td key={d} className="font-mono-num border border-[#e0e0e0] px-1 py-1.5">
                                    {Math.round(hrs * 10) / 10}
                                  </td>
                                );
                              })}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
