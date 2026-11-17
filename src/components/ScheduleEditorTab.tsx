import { useMemo, useState } from 'react';
import { Copy, Lock, CheckCircle2 } from 'lucide-react';
import { DEPT_CATALOG, getDeptColor } from '../data/seedData';
import { DepartmentId, Employee, ScheduleRecord, ShiftDef } from '../types/warehouse';
import {
  computeRangeAnalytics,
  formatShiftGroupLabel,
  formatShortVNDate,
  formatVNDate,
  getRecord,
  getShiftDef,
  getShiftEffectiveStdHours,
  getVNWeekday,
  isOtLocked,
  isShiftLocked,
} from '../utils/analytics';

interface ScheduleEditorTabProps {
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  schedDate: string;
  simClock: string;
  onChangeSchedDate: (dateYmd: string) => void;
  onUpdateShift: (dateYmd: string, empId: string, shiftCode: string) => void;
  onUpdateOt: (dateYmd: string, empId: string, otHours: number) => void;
  onCopyPrevDay: (dateYmd: string) => void;
  onSelectEmployee: (empId: string) => void;
}

export function ScheduleEditorTab({
  employees,
  shifts,
  records,
  schedDate,
  simClock,
  onChangeSchedDate,
  onUpdateShift,
  onUpdateOt,
  onCopyPrevDay,
  onSelectEmployee,
}: ScheduleEditorTabProps) {
  const [deptFilter, setDeptFilter] = useState<'ALL' | DepartmentId>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const sLock = useMemo(() => isShiftLocked(schedDate, simClock), [schedDate, simClock]);
  const oLock = useMemo(() => isOtLocked(schedDate, simClock), [schedDate, simClock]);

  const dayAnalytics = useMemo(
    () => computeRangeAnalytics(employees, shifts, records, schedDate, schedDate),
    [employees, shifts, records, schedDate]
  );

  const filteredEmps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((e) => {
      if (e.status !== 'Active') return false;
      if (deptFilter !== 'ALL' && e.dept !== deptFilter) return false;
      if (q && !e.id.toLowerCase().includes(q) && !e.name.toLowerCase().includes(q) && !e.role.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [employees, deptFilter, searchQuery]);

  const obDay = dayAnalytics.ob;

  return (
    <div className="grid gap-5 sm:gap-6 [&>*]:min-w-0">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e2e8f0] pb-3 sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[#0f172a] sm:text-xl">Phân ca &amp; Nhập giờ OT</h2>
        </div>
        <button
          type="button"
          onClick={() => onCopyPrevDay(schedDate)}
          disabled={sLock.locked}
          className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 border border-[#0f62fe] bg-white px-3.5 text-xs font-medium whitespace-nowrap text-[#0f62fe] transition-colors hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Sao chép ca từ ngày D-1
        </button>
      </div>

      {/* Controls & Lock Status Banner */}
      <div className="grid min-w-0 gap-4 border border-[#e2e8f0] bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="sched-date" className="text-xs font-medium text-[#475569]">
              Ngày làm việc (D)
            </label>
            <input
              type="date"
              id="sched-date"
              value={schedDate}
              onChange={(e) => onChangeSchedDate(e.target.value)}
              className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm text-[#0f172a]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="sched-dept-filter" className="text-xs font-medium text-[#475569]">
              Chọn Task
            </label>
            <select
              id="sched-dept-filter"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value as 'ALL' | DepartmentId)}
              className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm text-[#0f172a]"
            >
              <option value="ALL">Tất cả 6 Task</option>
              {DEPT_CATALOG.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.roles.join(', ')})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="sched-search" className="text-xs font-medium text-[#475569]">
              Tìm Mã NV hoặc Tên NV
            </label>
            <input
              type="text"
              id="sched-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="VD: OB-001 hoặc An"
              className="h-9 w-full border border-[#cbd5e1] bg-[#f8fafc] px-2.5 text-sm text-[#0f172a]"
            />
          </div>
        </div>

        <div
          className={`flex flex-wrap items-center justify-between gap-2 border px-3.5 py-2 text-xs sm:text-sm ${
            sLock.locked && oLock.locked
              ? 'border-[#da1e28]/30 bg-[#fff1f1] text-[#0f172a]'
              : sLock.locked || oLock.locked
                ? 'border-[#8a6100]/30 bg-[#fcf4d6] text-[#0f172a]'
                : 'border-[#198038]/30 bg-[#defbe6] text-[#0f172a]'
          }`}
        >
          <span>
            <strong>Ngày {formatVNDate(schedDate)}:</strong> Phân ca{' '}
            {sLock.locked ? 'Đã khóa' : `Mở (trước ${sLock.deadlineStr})`} · Chấm OT{' '}
            {oLock.locked ? 'Đã khóa' : `Mở (đến ${oLock.deadlineStr})`}
          </span>
        </div>
      </div>

      {/* Daily Headcount & Operating Hours Summary (Day Shift / Night Shift) */}
      <div className="min-w-0 border border-[#e2e8f0] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-[#e2e8f0] pb-2.5">
          <h3 className="text-base font-semibold text-[#0f172a]">
            Tổng hợp Quân số &amp; Giờ Vận hành ·{' '}
            <span className="font-mono-num">
              {formatVNDate(schedDate)} ({getVNWeekday(schedDate)})
            </span>
          </h3>
          <span className="font-mono-num text-xs font-medium text-[#475569]">
            Toàn kho: Day Shift {obDay.convDay} NV ({obDay.dayHours.toFixed(1)}h) · Night Shift {obDay.convNight} NV (
            {obDay.nightHours.toFixed(1)}h)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] font-mono text-[11px] font-medium text-[#475569] uppercase">
                <th className="px-2.5 py-2 whitespace-nowrap">Task</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">SL Day Shift</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">SL Night Shift</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">Tổng SL</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ VH Day</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ VH Night</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">Tổng giờ OT</th>
                <th className="px-2.5 py-2 text-right whitespace-nowrap">Tổng giờ VH</th>
              </tr>
            </thead>
            <tbody>
              {DEPT_CATALOG.map((d, idx) => {
                const st = dayAnalytics.deptStats[d.id];
                return (
                  <tr
                    key={d.id}
                    className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'}`}
                  >
                    <td className="px-2.5 py-2 font-semibold whitespace-nowrap" style={{ color: d.color }}>
                      {d.name}
                    </td>
                    <td className="font-mono-num px-2.5 py-2 text-right font-semibold">{st.convDay}</td>
                    <td className="font-mono-num px-2.5 py-2 text-right font-semibold">{st.convNight}</td>
                    <td className="font-mono-num px-2.5 py-2 text-right">{st.totalShifts}</td>
                    <td className="font-mono-num px-2.5 py-2 text-right">{st.dayHours.toFixed(1)}h</td>
                    <td className="font-mono-num px-2.5 py-2 text-right">{st.nightHours.toFixed(1)}h</td>
                    <td className="font-mono-num px-2.5 py-2 text-right">{st.otHours.toFixed(1)}h</td>
                    <td className="font-mono-num px-2.5 py-2 text-right font-semibold">{st.totalHours.toFixed(1)}h</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-[#cbd5e1] bg-[#f8fafc] font-semibold text-[#0f172a]">
                <td className="px-2.5 py-2.5 whitespace-nowrap">TỔNG KHO OB</td>
                <td className="font-mono-num px-2.5 py-2.5 text-right">{obDay.convDay}</td>
                <td className="font-mono-num px-2.5 py-2.5 text-right">{obDay.convNight}</td>
                <td className="font-mono-num px-2.5 py-2.5 text-right">{obDay.totalShifts}</td>
                <td className="font-mono-num px-2.5 py-2.5 text-right">{obDay.dayHours.toFixed(1)}h</td>
                <td className="font-mono-num px-2.5 py-2.5 text-right">{obDay.nightHours.toFixed(1)}h</td>
                <td className="font-mono-num px-2.5 py-2.5 text-right">{obDay.otHours.toFixed(1)}h</td>
                <td className="font-mono-num px-2.5 py-2.5 text-right">{obDay.totalHours.toFixed(1)}h</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Stacked Card Editor (<768px) */}
      <div className="grid gap-2.5 md:hidden">
        {filteredEmps.length === 0 ? (
          <div className="border border-[#e2e8f0] bg-white px-4 py-8 text-center text-sm text-[#64748b]">
            Không tìm thấy nhân sự phù hợp bộ lọc.
          </div>
        ) : (
          filteredEmps.map((emp) => {
            const rec = getRecord(records, schedDate, emp.id);
            const sDef = getShiftDef(shifts, rec.shiftCode);
            const ot = Number(rec.otHours) || 0;
            const stdHrs = getShiftEffectiveStdHours(sDef);

            return (
              <div key={emp.id} className="grid gap-3 border border-[#e2e8f0] bg-white p-3">
                <div className="flex items-start justify-between gap-2 border-b border-[#f1f5f9] pb-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelectEmployee(emp.id)}
                      className="cursor-pointer text-left text-sm font-semibold text-[#0f62fe] hover:underline"
                    >
                      {emp.name}
                    </button>
                    <div className="font-mono-num mt-0.5 text-[11px] text-[#64748b]">
                      {emp.id} ·{' '}
                      <span className="font-semibold" style={{ color: getDeptColor(emp.dept) }}>
                        {emp.dept}
                      </span>{' '}
                      · {emp.role}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono-num text-[10px] text-[#64748b] uppercase">Giờ VH</div>
                    <div className="font-mono-num text-sm font-semibold text-[#0f172a]">
                      {(stdHrs + ot).toFixed(1)}h
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-2.5">
                  <div className="col-span-7 flex flex-col gap-1">
                    <label
                      htmlFor={`mob-shift-${emp.id}`}
                      className="flex items-center justify-between text-[11px] font-medium text-[#525252]"
                    >
                      <span>Ca làm việc</span>
                      {sLock.locked ? (
                        <span className="font-mono-num inline-flex items-center gap-0.5 text-[10px] text-[#da1e28]">
                          <Lock className="h-2.5 w-2.5" aria-hidden="true" /> Khóa
                        </span>
                      ) : (
                        <span className="font-mono-num inline-flex items-center gap-0.5 text-[10px] text-[#198038]">
                          <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" /> Mở
                        </span>
                      )}
                    </label>
                    <select
                      id={`mob-shift-${emp.id}`}
                      disabled={sLock.locked}
                      value={rec.shiftCode}
                      onChange={(e) => onUpdateShift(schedDate, emp.id, e.target.value)}
                      className="h-11 w-full border-0 border-b border-[#8d8d8d] bg-[#f4f4f4] px-2 text-xs disabled:cursor-not-allowed disabled:bg-[#e0e0e0] disabled:text-[#525252]"
                    >
                      {shifts.map((s) => (
                        <option key={s.code} value={s.code}>
                          {formatShiftGroupLabel(s.group)} · {s.timeRange}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-5 flex flex-col gap-1">
                    <label
                      htmlFor={`mob-ot-${emp.id}`}
                      className="flex items-center justify-between text-[11px] font-medium text-[#525252]"
                    >
                      <span>Giờ OT</span>
                      {oLock.locked ? (
                        <span className="font-mono-num inline-flex items-center gap-0.5 text-[10px] text-[#da1e28]">
                          <Lock className="h-2.5 w-2.5" aria-hidden="true" /> Khóa
                        </span>
                      ) : (
                        <span className="font-mono-num inline-flex items-center gap-0.5 text-[10px] text-[#198038]">
                          <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" /> Mở
                        </span>
                      )}
                    </label>
                    <input
                      id={`mob-ot-${emp.id}`}
                      type="number"
                      min={0}
                      max={12}
                      step={0.5}
                      disabled={oLock.locked}
                      value={ot}
                      onChange={(e) => onUpdateOt(schedDate, emp.id, Number(e.target.value) || 0)}
                      className="font-mono-num h-11 w-full border-0 border-b border-[#8d8d8d] bg-[#f4f4f4] px-2.5 text-right text-sm disabled:cursor-not-allowed disabled:bg-[#e0e0e0] disabled:text-[#525252]"
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop / Tablet Inline Shift + OT Table (>=768px) */}
      <div className="hidden overflow-x-auto border border-[#e2e8f0] bg-white md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] font-mono text-[11px] font-medium text-[#475569] uppercase">
              <th className="px-3 py-2.5 whitespace-nowrap">Mã NV</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Họ và Tên</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Task</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Vị trí</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Ca làm việc</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Trạng thái Ca</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Giờ OT</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Trạng thái OT</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Giờ VH</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmps.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-[#64748b]">
                  Không tìm thấy nhân sự phù hợp bộ lọc.
                </td>
              </tr>
            ) : (
              filteredEmps.map((emp, idx) => {
                const rec = getRecord(records, schedDate, emp.id);
                const sDef = getShiftDef(shifts, rec.shiftCode);
                const ot = Number(rec.otHours) || 0;
                const stdHrs = getShiftEffectiveStdHours(sDef);

                return (
                  <tr
                    key={emp.id}
                    className={`border-t border-[#e2e8f0] transition-colors hover:bg-[#f8fafc] ${
                      idx % 2 === 1 ? 'bg-[#fcfcfd]' : 'bg-white'
                    }`}
                  >
                    <td className="font-mono-num px-3 py-2">{emp.id}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onSelectEmployee(emp.id)}
                        className="cursor-pointer font-semibold text-[#0f62fe] hover:underline"
                      >
                        {emp.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-semibold" style={{ color: getDeptColor(emp.dept) }}>
                      {emp.dept}
                    </td>
                    <td className="px-3 py-2">{emp.role}</td>
                    <td className="px-3 py-2">
                      <select
                        disabled={sLock.locked}
                        value={rec.shiftCode}
                        onChange={(e) => onUpdateShift(schedDate, emp.id, e.target.value)}
                        aria-label={`Ca làm việc cho ${emp.name}`}
                        className="h-8 min-w-[170px] border-0 border-b border-[#8d8d8d] bg-white px-1.5 text-[13px] disabled:cursor-not-allowed disabled:bg-[#e0e0e0] disabled:text-[#525252]"
                      >
                        {shifts.map((s) => (
                          <option key={s.code} value={s.code}>
                            {formatShiftGroupLabel(s.group)} · {s.timeRange}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {sLock.locked ? (
                        <span className="font-mono-num inline-flex items-center gap-1 text-xs text-[#da1e28]">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          Khóa (&gt;{sLock.deadlineStr})
                        </span>
                      ) : (
                        <span className="font-mono-num inline-flex items-center gap-1 text-xs text-[#198038]">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Mở trước {sLock.deadlineStr}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        max={12}
                        step={0.5}
                        disabled={oLock.locked}
                        value={ot}
                        onChange={(e) => onUpdateOt(schedDate, emp.id, Number(e.target.value) || 0)}
                        aria-label={`Giờ OT cho ${emp.name}`}
                        className="font-mono-num h-8 w-[72px] border-0 border-b border-[#8d8d8d] bg-white px-1.5 text-right text-sm disabled:cursor-not-allowed disabled:bg-[#e0e0e0] disabled:text-[#525252]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {oLock.locked ? (
                        <span className="font-mono-num inline-flex items-center gap-1 text-xs text-[#da1e28]">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          Khóa (&gt;{oLock.deadlineStr})
                        </span>
                      ) : (
                        <span className="font-mono-num inline-flex items-center gap-1 text-xs text-[#198038]">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Mở đến {oLock.deadlineStr}
                        </span>
                      )}
                    </td>
                    <td className="font-mono-num px-3 py-2 text-right font-semibold">{(stdHrs + ot).toFixed(1)}h</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
