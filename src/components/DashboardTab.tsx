import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartConfiguration } from 'chart.js';
import { ArrowLeft, CalendarClock, X } from 'lucide-react';
import { DEPT_CATALOG, getDeptColor } from '../data/seedData';
import { DepartmentId, DrilldownState, Employee, RangeAnalytics, ScheduleRecord, ShiftDef } from '../types/warehouse';
import {
  classifySosShiftSide,
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
import { ChartCanvas } from './ChartCanvas';

interface DashboardTabProps {
  analytics: RangeAnalytics;
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  rangeStart: string;
  rangeEnd: string;
  simClock: string;
  drilldown: DrilldownState;
  onSelectDept: (deptId: DepartmentId) => void;
  onClearSelection: () => void;
  onSelectEmployee: (empId: string) => void;
  onJumpToScheduleDate: (dateYmd: string) => void;
  onUpdateShift: (dateYmd: string, empId: string, shiftCode: string) => void;
}

export function DashboardTab({
  analytics,
  employees,
  shifts,
  records,
  rangeStart,
  rangeEnd,
  simClock,
  drilldown,
  onSelectDept,
  onClearSelection,
  onSelectEmployee,
  onJumpToScheduleDate,
  onUpdateShift,
}: DashboardTabProps) {
  const drilldownRef = useRef<HTMLDivElement | null>(null);
  const [otChartMode, setOtChartMode] = useState<'stacked_ot' | 'base_vs_ot'>('stacked_ot');
  const [selectedDailyDate, setSelectedDailyDate] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const activeSelectedDate = useMemo(() => {
    if (selectedDailyDate && analytics.dailyTotals.some((d) => d.date === selectedDailyDate)) {
      return selectedDailyDate;
    }
    if (analytics.dailyTotals.length === 0) return null;
    // Default highlight peak OT day
    const peak = analytics.dailyTotals.reduce((best, cur) => (cur.otHours > best.otHours ? cur : best), analytics.dailyTotals[0]);
    return peak.date;
  }, [selectedDailyDate, analytics.dailyTotals]);

  const selectedDayDetail = useMemo(
    () => analytics.dailyTotals.find((d) => d.date === activeSelectedDate) || null,
    [analytics.dailyTotals, activeSelectedDate]
  );

  const handleDeptClick = (deptId: DepartmentId) => {
    onSelectDept(deptId);
    setTimeout(() => {
      drilldownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const handleEmpClick = (empId: string) => {
    onSelectEmployee(empId);
    setTimeout(() => {
      drilldownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  // 1. Overall Day vs Night Doughnut Config
  const obDayNightConfig = useMemo<ChartConfiguration<'doughnut'>>(() => {
    const dTot = analytics.ob.convDay;
    const nTot = analytics.ob.convNight;
    return {
      type: 'doughnut',
      data: {
        labels: ['Day Shift', 'Night Shift'],
        datasets: [
          {
            data: [dTot, nTot],
            backgroundColor: ['#0284c7', '#1e293b'],
            borderWidth: 2,
            borderColor: '#ffffff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'top',
            align: 'start',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
              color: '#475569',
            },
          },
        },
      },
    };
  }, [analytics.ob.convDay, analytics.ob.convNight]);

  // 2. Task Headcount Stacked Bar Config
  const deptHeadcountConfig = useMemo<ChartConfiguration>(() => {
    const labels = DEPT_CATALOG.map((d) => d.name);
    const dayVals = DEPT_CATALOG.map((d) => analytics.deptStats[d.id].convDay);
    const nightVals = DEPT_CATALOG.map((d) => analytics.deptStats[d.id].convNight);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Day Shift', data: dayVals, backgroundColor: '#0284c7', borderRadius: 0 },
          { label: 'Night Shift', data: nightVals, backgroundColor: '#1e293b', borderRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
          if (elements && elements.length > 0) {
            const dept = DEPT_CATALOG[elements[0].index];
            if (dept) handleDeptClick(dept.id);
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              color: (ctx) => DEPT_CATALOG[ctx.index]?.color || '#475569',
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: 600 },
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: '#e2e8f0' },
            ticks: { color: '#475569', font: { family: "'IBM Plex Mono', monospace", size: 11 } },
          },
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'start',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
              color: '#475569',
            },
          },
        },
      },
    };
  }, [analytics.deptStats]);

  // 3. Task Share Pie Config
  const deptShareConfig = useMemo<ChartConfiguration>(() => {
    return {
      type: 'pie',
      data: {
        labels: DEPT_CATALOG.map((d) => d.name),
        datasets: [
          {
            data: DEPT_CATALOG.map((d) => analytics.deptStats[d.id].totalShifts),
            backgroundColor: DEPT_CATALOG.map((d) => d.color),
            borderWidth: 2,
            borderColor: '#ffffff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_evt, elements) => {
          if (elements && elements.length > 0) {
            const dept = DEPT_CATALOG[elements[0].index];
            if (dept) handleDeptClick(dept.id);
          }
        },
        plugins: {
          legend: {
            position: isMobile ? 'bottom' : 'right',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: 600 },
              color: '#334155',
            },
          },
        },
      },
    };
  }, [analytics.deptStats, isMobile]);

  // 4. Daily OT by Department & Total Operating Hours Combo Chart
  const dailyOtConfig = useMemo<ChartConfiguration>(() => {
    const labels = analytics.dailyTotals.map((d) => formatShortVNDate(d.date));
    const maxDailyOt = Math.max(10, ...analytics.dailyTotals.map((d) => d.otHours));
    const maxTotalHrs = Math.max(40, ...analytics.dailyTotals.map((d) => d.totalHours));

    if (otChartMode === 'base_vs_ot') {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              type: 'bar',
              label: 'Giờ Ca chuẩn',
              data: analytics.dailyTotals.map((d) => d.baseHours),
              backgroundColor: '#0284c7',
              stack: 'hrsStack',
            },
            {
              type: 'bar',
              label: 'Giờ Tăng ca (OT)',
              data: analytics.dailyTotals.map((d) => d.otHours),
              backgroundColor: '#dc2626',
              stack: 'hrsStack',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (_evt, elements) => {
            if (elements && elements.length > 0) {
              const dayItem = analytics.dailyTotals[elements[0].index];
              if (dayItem) setSelectedDailyDate(dayItem.date);
            }
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: '#475569' } },
            y: {
              stacked: true,
              beginAtZero: true,
              title: { display: true, text: 'Tổng giờ vận hành (h)', color: '#475569' },
              grid: { color: '#e2e8f0' },
              ticks: { color: '#475569' },
            },
          },
          plugins: {
            legend: {
              position: 'top',
              align: 'start',
              labels: { boxWidth: 12, boxHeight: 12, color: '#475569', font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 } },
            },
            tooltip: {
              callbacks: {
                footer: (items) => {
                  const idx = items[0]?.dataIndex;
                  if (idx === undefined) return '';
                  const d = analytics.dailyTotals[idx];
                  return `Tổng vận hành: ${d.totalHours.toFixed(1)}h (${d.totalShifts} ca)`;
                },
              },
            },
          },
        },
      };
    }

    const datasets: ChartConfiguration['data']['datasets'] = DEPT_CATALOG.map((dept) => ({
      type: 'bar' as const,
      label: `OT ${dept.name}`,
      data: analytics.dailyTotals.map((d) => d.deptOt[dept.id] || 0),
      backgroundColor: dept.color,
      stack: 'otStack',
      yAxisID: 'yOt',
    }));

    datasets.push({
      type: 'line' as const,
      label: 'Tổng giờ VH (Ca chuẩn + OT)',
      data: analytics.dailyTotals.map((d) => d.totalHours),
      borderColor: '#0f172a',
      backgroundColor: '#0f172a',
      borderWidth: 2,
      pointRadius: 3.5,
      pointHoverRadius: 5,
      tension: 0,
      yAxisID: 'yTotal',
    });

    return {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onClick: (_evt, elements) => {
          if (elements && elements.length > 0) {
            const dayItem = analytics.dailyTotals[elements[0].index];
            if (dayItem) setSelectedDailyDate(dayItem.date);
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#475569' } },
          yOt: {
            type: 'linear',
            position: 'left',
            stacked: true,
            beginAtZero: true,
            suggestedMax: Math.ceil(maxDailyOt * 1.45),
            title: { display: true, text: 'Giờ OT theo Task (h)', color: '#475569' },
            grid: { color: '#e2e8f0' },
            ticks: { color: '#475569' },
          },
          yTotal: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            suggestedMax: Math.ceil(maxTotalHrs * 1.12),
            title: { display: true, text: 'Tổng Giờ Vận hành (h)', color: '#0f172a' },
            grid: { drawOnChartArea: false },
            ticks: { color: '#0f172a' },
          },
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'start',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
              color: '#475569',
            },
          },
          tooltip: {
            callbacks: {
              footer: (items) => {
                const idx = items[0]?.dataIndex;
                if (idx === undefined) return '';
                const d = analytics.dailyTotals[idx];
                return `Tổng OT: ${d.otHours.toFixed(1)}h · Ca chuẩn: ${d.baseHours}h · Tổng VH: ${d.totalHours.toFixed(1)}h`;
              },
            },
          },
        },
      },
    };
  }, [analytics.dailyTotals, otChartMode]);

  // 5. Mini Doughnut Configs for the 6 Tasks (memoized in balanced 3x2 grid)
  const miniDoughnutConfigs = useMemo(() => {
    const map = {} as Record<DepartmentId, ChartConfiguration<'doughnut'>>;
    DEPT_CATALOG.forEach((dept) => {
      const st = analytics.deptStats[dept.id];
      map[dept.id] = {
        type: 'doughnut',
        data: {
          labels: ['Day Shift', 'Night Shift'],
          datasets: [
            {
              data: [st.convDay, st.convNight],
              backgroundColor: [dept.color, '#1e293b'],
              borderWidth: 2,
              borderColor: '#ffffff',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '60%',
          plugins: {
            legend: { display: false },
          },
        },
      };
    });
    return map;
  }, [analytics.deptStats]);

  const obTotalDN = analytics.ob.convDay + analytics.ob.convNight;
  const obDayPct = obTotalDN ? ((analytics.ob.convDay / obTotalDN) * 100).toFixed(1) : '0.0';
  const obNightPct = obTotalDN ? ((analytics.ob.convNight / obTotalDN) * 100).toFixed(1) : '0.0';

  // Drill-down data calculations
  const selectedEmployee = useMemo(
    () => (drilldown.mode === 'employee' ? employees.find((e) => e.id === drilldown.id) || null : null),
    [drilldown, employees]
  );

  const selectedDeptDef = useMemo(
    () => (drilldown.mode === 'dept' ? DEPT_CATALOG.find((d) => d.id === drilldown.id) || null : null),
    [drilldown]
  );

  const employeeDrillData = useMemo(() => {
    if (!selectedEmployee) return null;
    let workDays = 0;
    let dayCount = 0;
    let nightCount = 0;
    let midCount = 0;
    let sosCount = 0;
    let baseHrs = 0;
    let otHrs = 0;
    const rows = analytics.dates.map((d) => {
      const rec = getRecord(records, d, selectedEmployee.id);
      const sDef = getShiftDef(shifts, rec.shiftCode);
      const ot = Number(rec.otHours) || 0;
      const isWork = sDef.group !== 'Off';
      const std = getShiftEffectiveStdHours(sDef);
      if (isWork) {
        workDays += 1;
        if (sDef.group === 'Day') dayCount += 1;
        if (sDef.group === 'Night') nightCount += 1;
        if (sDef.group === 'Mid') midCount += 1;
        if (sDef.group === 'SOS') sosCount += 1;
      }
      baseHrs += std;
      otHrs += ot;
      return { date: d, rec, sDef, std, ot, total: std + ot };
    });
    return {
      workDays,
      dayCount,
      nightCount,
      midCount,
      sosCount,
      baseHrs,
      otHrs,
      totalHrs: baseHrs + otHrs,
      rows,
    };
  }, [selectedEmployee, analytics.dates, records, shifts]);

  const deptEmps = useMemo(() => {
    return analytics.activeEmps
      .filter((e) => (selectedDeptDef ? e.dept === selectedDeptDef.id : true))
      .map((emp) => {
        let eDays = 0;
        let eBase = 0;
        let eOt = 0;
        analytics.dates.forEach((d) => {
          const rec = getRecord(records, d, emp.id);
          const sDef = getShiftDef(shifts, rec.shiftCode);
          if (sDef.group !== 'Off') {
            eDays += 1;
            eBase += getShiftEffectiveStdHours(sDef);
          }
          eOt += Number(rec.otHours) || 0;
        });
        return { emp, eDays, eBase, eOt, eTotal: eBase + eOt };
      });
  }, [analytics.activeEmps, analytics.dates, records, shifts, selectedDeptDef]);

  return (
    <div className="grid gap-5 md:gap-6 [&>*]:min-w-0">
      {/* Section Heading */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] pb-3">
        <h2 className="text-lg font-semibold text-[#0f172a] sm:text-xl">Báo cáo Tổng quan Kho OB</h2>
        {drilldown.mode !== 'all' && (
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 border border-[#cbd5e1] bg-white px-3 py-1 text-xs font-medium whitespace-nowrap text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
          >
            <X className="h-3.5 w-3.5 text-[#64748b]" aria-hidden="true" />
            Bỏ chọn · Xem tổng OB
          </button>
        )}
      </div>

      {/* Row 1: Summary Table + OB Day vs Night Doughnut */}
      <div className="grid grid-cols-1 gap-5 md:gap-6 lg:grid-cols-12">
        <div className="min-w-0 border border-[#e2e8f0] bg-white p-4 sm:p-5 lg:col-span-7">
          <div className="mb-3 border-b border-[#e2e8f0] pb-2.5">
            <h3 className="text-base font-semibold text-[#0f172a]">Tổng hợp 6 Task</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] font-mono text-[11px] font-medium tracking-wider text-[#475569] uppercase">
                  <th className="px-2.5 py-2 whitespace-nowrap">Task</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">SL Day Shift</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">SL Night Shift</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">Tổng SL</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ VH Day</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ VH Night</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ OT</th>
                  <th className="px-2.5 py-2 text-right whitespace-nowrap">Tổng giờ VH</th>
                </tr>
              </thead>
              <tbody>
                {DEPT_CATALOG.map((d) => {
                  const st = analytics.deptStats[d.id];
                  const isSel = drilldown.mode === 'dept' && drilldown.id === d.id;
                  return (
                    <tr
                      key={d.id}
                      style={isSel ? { backgroundColor: `${d.color}12` } : undefined}
                      className="border-t border-[#e2e8f0] transition-colors hover:bg-[#f8fafc]"
                    >
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleDeptClick(d.id)}
                          style={{ color: d.color }}
                          className="cursor-pointer font-semibold hover:underline"
                        >
                          {d.name}
                        </button>
                      </td>
                      <td className="font-mono-num px-2.5 py-2 text-right font-semibold text-[#0f172a]">{st.convDay}</td>
                      <td className="font-mono-num px-2.5 py-2 text-right font-semibold text-[#0f172a]">{st.convNight}</td>
                      <td className="font-mono-num px-2.5 py-2 text-right text-[#475569]">{st.totalShifts}</td>
                      <td className="font-mono-num px-2.5 py-2 text-right text-[#475569]">{st.dayHours.toFixed(1)}h</td>
                      <td className="font-mono-num px-2.5 py-2 text-right text-[#475569]">{st.nightHours.toFixed(1)}h</td>
                      <td className="font-mono-num px-2.5 py-2 text-right text-[#475569]">{st.otHours.toFixed(1)}h</td>
                      <td className="font-mono-num px-2.5 py-2 text-right font-semibold text-[#0f172a]">
                        {st.totalHours.toFixed(1)}h
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-[#cbd5e1] bg-[#f8fafc] font-semibold text-[#0f172a]">
                  <td className="px-2.5 py-2.5 whitespace-nowrap">TỔNG KHO OB</td>
                  <td className="font-mono-num px-2.5 py-2.5 text-right">{analytics.ob.convDay}</td>
                  <td className="font-mono-num px-2.5 py-2.5 text-right">{analytics.ob.convNight}</td>
                  <td className="font-mono-num px-2.5 py-2.5 text-right">{analytics.ob.totalShifts}</td>
                  <td className="font-mono-num px-2.5 py-2.5 text-right">{analytics.ob.dayHours.toFixed(1)}h</td>
                  <td className="font-mono-num px-2.5 py-2.5 text-right">{analytics.ob.nightHours.toFixed(1)}h</td>
                  <td className="font-mono-num px-2.5 py-2.5 text-right">{analytics.ob.otHours.toFixed(1)}h</td>
                  <td className="font-mono-num px-2.5 py-2.5 text-right">{analytics.ob.totalHours.toFixed(1)}h</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-3 border border-[#e2e8f0] bg-white p-4 sm:p-5 lg:col-span-5">
          <div>
            <h3 className="text-base font-semibold text-[#0f172a]">Tỷ trọng Day Shift / Night Shift</h3>
            <p className="font-mono-num text-xs text-[#64748b]">Phân bổ lượt nhân sự &amp; giờ vận hành</p>
          </div>
          <ChartCanvas
            config={obDayNightConfig}
            className="h-[220px] w-full sm:h-[250px]"
            ariaLabel="Tỷ trọng Day Shift và Night Shift"
          />
          <p className="text-[13px] text-[#475569]">
            Day Shift:{' '}
            <span className="font-mono-num font-semibold text-[#0f172a]">
              {analytics.ob.convDay} ({obDayPct}%) · {analytics.ob.dayHours.toFixed(1)}h
            </span>{' '}
            · Night Shift:{' '}
            <span className="font-mono-num font-semibold text-[#0f172a]">
              {analytics.ob.convNight} ({obNightPct}%) · {analytics.ob.nightHours.toFixed(1)}h
            </span>
          </p>
        </div>
      </div>

      {/* Row 2: Stacked Headcount Bar + Task Share Pie */}
      <div className="grid grid-cols-1 gap-5 md:gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-3 border border-[#e2e8f0] bg-white p-4 sm:p-5 lg:col-span-7">
          <div>
            <h3 className="text-base font-semibold text-[#0f172a]">Quân số theo Task</h3>
            <p className="font-mono-num text-xs text-[#64748b]">Day Shift vs Night Shift</p>
          </div>
          <ChartCanvas
            config={deptHeadcountConfig}
            className="h-[230px] w-full sm:h-[260px]"
            ariaLabel="Tổng lượt nhân sự theo Task"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3 border border-[#e2e8f0] bg-white p-4 sm:p-5 lg:col-span-5">
          <div>
            <h3 className="text-base font-semibold text-[#0f172a]">Tỷ trọng nhân lực theo Task</h3>
            <p className="font-mono-num text-xs text-[#64748b]">Tổng lượt ca theo Task (%)</p>
          </div>
          <ChartCanvas
            config={deptShareConfig}
            className="h-[240px] w-full sm:h-[260px]"
            ariaLabel="Tỷ trọng nhân lực các Task"
          />
        </div>
      </div>

      {/* Row 3: Daily OT by Task & Total Operating Hours Combo Chart */}
      <div className="flex min-w-0 flex-col gap-4 border border-[#e2e8f0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e2e8f0] pb-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#0f172a]">
              Giờ Tăng ca (OT) theo Task &amp; Tổng Giờ Vận hành
            </h3>
            <p className="font-mono-num text-xs text-[#64748b]">
              {otChartMode === 'stacked_ot'
                ? 'OT theo 6 Task (trái) · Tổng giờ VH Ca chuẩn + OT (phải)'
                : 'Giờ Ca chuẩn vs Giờ Tăng ca (OT) hàng ngày'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <div className="inline-flex max-w-full flex-wrap border border-[#e2e8f0] bg-[#f8fafc] p-0.5">
              <button
                type="button"
                onClick={() => setOtChartMode('stacked_ot')}
                className={`min-h-[32px] cursor-pointer px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors sm:px-3 ${
                  otChartMode === 'stacked_ot' ? 'bg-[#0f62fe] text-white' : 'text-[#475569] hover:text-[#0f172a]'
                }`}
              >
                OT theo Task
              </button>
              <button
                type="button"
                onClick={() => setOtChartMode('base_vs_ot')}
                className={`min-h-[32px] cursor-pointer px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors sm:px-3 ${
                  otChartMode === 'base_vs_ot' ? 'bg-[#0f62fe] text-white' : 'text-[#475569] hover:text-[#0f172a]'
                }`}
              >
                Ca chuẩn vs OT
              </button>
            </div>
            <span className="font-mono-num text-xs font-semibold text-[#0f172a]">
              Tổng VH: {analytics.ob.totalHours.toLocaleString('vi-VN')}h · OT: {analytics.ob.otHours.toLocaleString('vi-VN')}h
            </span>
          </div>
        </div>

        <ChartCanvas
          config={dailyOtConfig}
          className="h-[260px] w-full sm:h-[300px]"
          ariaLabel="Biểu đồ Giờ Tăng ca hàng ngày theo Task và Tổng Giờ Vận hành"
        />

        {selectedDayDetail && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-[#e2e8f0] bg-[#f8fafc] px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[#0f172a]">
              <span className="font-semibold">
                {formatVNDate(selectedDayDetail.date)} ({getVNWeekday(selectedDayDetail.date)})
              </span>
              <span className="font-mono-num text-[#475569]">
                Tổng VH: <strong className="text-[#0f172a]">{selectedDayDetail.totalHours.toFixed(1)}h</strong> (
                {selectedDayDetail.baseHours}h ca chuẩn + {selectedDayDetail.otHours.toFixed(1)}h OT)
              </span>
              <span className="text-[#cbd5e1]" aria-hidden="true">
                |
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-num">
                {DEPT_CATALOG.map((d) => (
                  <span key={d.id}>
                    <span className="font-semibold" style={{ color: d.color }}>
                      {d.name}:
                    </span>{' '}
                    <strong className="text-[#0f172a]">{(selectedDayDetail.deptOt[d.id] || 0).toFixed(1)}h</strong>
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onJumpToScheduleDate(selectedDayDetail.date)}
              className="inline-flex cursor-pointer items-center gap-1.5 border border-[#0f62fe] bg-white px-2.5 py-1 text-xs font-medium whitespace-nowrap text-[#0f62fe] transition-colors hover:bg-[#eff6ff]"
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Mở phân ca {formatShortVNDate(selectedDayDetail.date)}
            </button>
          </div>
        )}
      </div>

      {/* Row 4: 6 Task Cards */}
      <div>
        <div className="mb-3 flex items-center justify-between border-b border-[#e2e8f0] pb-2">
          <h3 className="text-base font-semibold text-[#0f172a]">Phân bổ Day – Night theo Task</h3>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEPT_CATALOG.map((dept) => {
            const st = analytics.deptStats[dept.id];
            const total = st.convDay + st.convNight;
            const dayPct = total ? Math.round((st.convDay / total) * 100) : 0;
            const nightPct = total ? 100 - dayPct : 0;
            const isSel = drilldown.mode === 'dept' && drilldown.id === dept.id;

            return (
              <button
                key={dept.id}
                type="button"
                onClick={() => handleDeptClick(dept.id)}
                style={isSel ? { borderColor: dept.color, boxShadow: `0 0 0 1px ${dept.color}` } : undefined}
                className="group flex w-full min-w-0 cursor-pointer flex-col justify-between gap-3 border border-[#e2e8f0] bg-white p-4 text-left transition-colors hover:bg-[#f8fafc]"
              >
                <div className="flex w-full items-baseline justify-between gap-2 border-b border-[#e2e8f0] pb-2">
                  <span className="text-base font-semibold group-hover:underline" style={{ color: dept.color }}>
                    {dept.name}
                  </span>
                  <span className="font-mono-num text-xs whitespace-nowrap text-[#64748b]">
                    {st.totalShifts} ca · {st.totalHours.toFixed(0)}h VH
                  </span>
                </div>

                <div className="flex w-full items-center gap-3 sm:gap-4">
                  <div className="h-[104px] w-[104px] shrink-0 sm:h-[112px] sm:w-[112px] lg:h-[120px] lg:w-[120px]">
                    <ChartCanvas
                      config={miniDoughnutConfigs[dept.id]}
                      className="h-full w-full"
                      ariaLabel={`Tỷ lệ Day Night ${dept.name}`}
                    />
                  </div>

                  <div className="grid min-w-0 flex-1 gap-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">SL Day Shift</span>
                      <span className="font-mono-num font-semibold text-[#0f172a]">
                        {st.convDay} ({dayPct}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">Giờ VH Day</span>
                      <span className="font-mono-num text-[#0f172a]">{st.dayHours.toFixed(1)}h</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">SL Night Shift</span>
                      <span className="font-mono-num font-semibold text-[#0f172a]">
                        {st.convNight} ({nightPct}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">Giờ VH Night</span>
                      <span className="font-mono-num text-[#0f172a]">{st.nightHours.toFixed(1)}h</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-[#e2e8f0] pt-1">
                      <span className="text-[#64748b]">Giờ OT</span>
                      <span className="font-mono-num font-semibold text-[#da1e28]">{st.otHours.toFixed(1)}h</span>
                    </div>
                  </div>
                </div>

                <div className="w-full">
                  <div className="flex h-1.5 w-full overflow-hidden bg-[#e2e8f0]">
                    <div style={{ width: `${dayPct}%`, backgroundColor: dept.color }} />
                    <div style={{ width: `${nightPct}%`, backgroundColor: '#1e293b' }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 5: Interactive Drill-down Panel */}
      <div
        ref={drilldownRef}
        style={{
          borderTopColor: selectedEmployee
            ? getDeptColor(selectedEmployee.dept)
            : selectedDeptDef
              ? selectedDeptDef.color
              : '#0f62fe',
        }}
        className="grid min-w-0 gap-4 border border-[#e2e8f0] border-t-2 bg-white p-4 sm:p-5 [&>*]:min-w-0"
      >
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e2e8f0] pb-3">
          <div className="min-w-0">
            <div className="font-mono-num text-xs font-medium tracking-wider text-[#64748b] uppercase">
              {selectedEmployee ? (
                <>
                  Chi tiết nhân sự · {selectedEmployee.id} ·{' '}
                  <span className="font-semibold" style={{ color: getDeptColor(selectedEmployee.dept) }}>
                    {selectedEmployee.dept}
                  </span>{' '}
                  ({selectedEmployee.role})
                </>
              ) : selectedDeptDef ? (
                <>
                  Chi tiết Task{' '}
                  <span className="font-semibold" style={{ color: selectedDeptDef.color }}>
                    {selectedDeptDef.name}
                  </span>{' '}
                  · Vị trí: {selectedDeptDef.roles.join(' · ')}
                </>
              ) : (
                'Tổng hợp Vận hành Toàn Kho Outbound (6 Task)'
              )}
            </div>
            <h3 className="text-lg font-semibold text-[#0f172a] sm:text-xl">
              {selectedEmployee ? (
                `Lịch làm việc & Hiệu suất: ${selectedEmployee.name}`
              ) : selectedDeptDef ? (
                <>
                  Chi tiết Vận hành{' '}
                  <span style={{ color: selectedDeptDef.color }}>{selectedDeptDef.name}</span> ({formatShortVNDate(rangeStart)} –{' '}
                  {formatShortVNDate(rangeEnd)})
                </>
              ) : (
                `Báo cáo Tổng Kho OB (${formatShortVNDate(rangeStart)} – ${formatShortVNDate(rangeEnd)})`
              )}
            </h3>
          </div>
          {selectedEmployee ? (
            <div className="flex flex-wrap items-center gap-2">
              {drilldown.prevDeptId && (
                <button
                  type="button"
                  onClick={() => onSelectDept(drilldown.prevDeptId!)}
                  style={{
                    color: getDeptColor(drilldown.prevDeptId),
                    borderColor: getDeptColor(drilldown.prevDeptId),
                  }}
                  className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 border bg-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-[#f8fafc]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Quay lại {drilldown.prevDeptId}
                </button>
              )}
              <button
                type="button"
                onClick={onClearSelection}
                className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-medium whitespace-nowrap text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
              >
                <X className="h-3.5 w-3.5 text-[#64748b]" aria-hidden="true" />
                Tổng cả OB
              </button>
            </div>
          ) : selectedDeptDef ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-medium whitespace-nowrap text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
            >
              <X className="h-3.5 w-3.5 text-[#64748b]" aria-hidden="true" />
              Bỏ chọn Task · Xem tổng OB
            </button>
          ) : null}
        </div>

        {selectedEmployee && employeeDrillData ? (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
              <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Tổng số ngày làm việc</div>
                <div className="font-mono-num mt-1 text-2xl font-semibold text-[#0f172a]">
                  {employeeDrillData.workDays} ngày
                </div>
                <div className="text-xs text-[#64748b]">Trong {analytics.dates.length} ngày xem báo cáo</div>
              </div>
              <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Tổng giờ vận hành tích lũy</div>
                <div className="font-mono-num mt-1 text-2xl font-semibold text-[#0f172a]">
                  {employeeDrillData.totalHrs.toFixed(1)}h
                </div>
                <div className="text-xs text-[#64748b]">
                  {employeeDrillData.baseHrs}h ca chuẩn + {employeeDrillData.otHrs.toFixed(1)}h OT
                </div>
              </div>
              <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Phân bổ ca cá nhân</div>
                <div className="font-mono-num mt-1 text-2xl font-semibold text-[#0f172a]">
                  {employeeDrillData.dayCount}D / {employeeDrillData.nightCount}N / {employeeDrillData.midCount}M
                  {employeeDrillData.sosCount > 0 ? ` / ${employeeDrillData.sosCount}S` : ''}
                </div>
                <div className="text-xs text-[#64748b]">
                  Day / Night / MID{employeeDrillData.sosCount > 0 ? ' / SOS' : ''}
                </div>
              </div>
              <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Tổng giờ OT cá nhân</div>
                <div className="font-mono-num mt-1 text-2xl font-semibold text-[#0f172a]">
                  {employeeDrillData.otHrs.toFixed(1)}h
                </div>
                <div className="text-xs text-[#64748b]">
                  TB{' '}
                  {employeeDrillData.workDays
                    ? (employeeDrillData.otHrs / employeeDrillData.workDays).toFixed(2)
                    : '0.00'}
                  h OT/ngày
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border border-[#e2e8f0] bg-white">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] font-mono text-[11px] font-medium tracking-wider text-[#475569] uppercase">
                    <th className="px-3 py-2">Ngày</th>
                    <th className="px-3 py-2">Thứ</th>
                    <th className="px-3 py-2">Mã Ca</th>
                    <th className="px-3 py-2">Khung giờ</th>
                    <th className="px-3 py-2">Nhóm</th>
                    <th className="px-3 py-2 text-right">Giờ ca</th>
                    <th className="px-3 py-2 text-right">Giờ OT</th>
                    <th className="px-3 py-2 text-right">Tổng giờ VH</th>
                    <th className="px-3 py-2">Khóa Ca / OT</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeDrillData.rows.map((r, idx) => {
                    const sLock = isShiftLocked(r.date, simClock);
                    const oLock = isOtLocked(r.date, simClock);
                    const badgeStyle =
                      r.sDef.group === 'Day'
                        ? 'bg-[#d0e2ff] text-[#161616]'
                        : r.sDef.group === 'Night'
                          ? 'bg-[#262626] text-[#f4f4f4]'
                          : r.sDef.group === 'Mid'
                            ? 'bg-[#f6f2ff] text-[#6929c4]'
                            : r.sDef.group === 'SOS'
                              ? 'bg-[#fef3c7] text-[#b45309]'
                              : 'bg-[#e0e0e0] text-[#525252]';
                    return (
                      <tr
                        key={r.date}
                        className={`border-t border-[#e0e0e0] ${idx % 2 === 1 ? 'bg-[#f8f8f8]' : 'bg-white'}`}
                      >
                        <td className="font-mono-num px-3 py-2 whitespace-nowrap">{formatVNDate(r.date)}</td>
                        <td className="font-mono-num px-3 py-2">{getVNWeekday(r.date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`font-mono-num inline-block px-2 py-0.5 text-xs font-medium ${badgeStyle}`}>
                            {r.sDef.code}
                          </span>
                        </td>
                        <td className="font-mono-num px-3 py-2 whitespace-nowrap">
                          {!sLock.locked ? (
                            <select
                              value={r.rec.shiftCode}
                              onChange={(e) => onUpdateShift(r.date, selectedEmployee.id, e.target.value)}
                              aria-label={`Chọn giờ làm ngày ${formatVNDate(r.date)} cho ${selectedEmployee.name}`}
                              title={`Click để chọn giờ làm ngày ${formatVNDate(r.date)} (${sLock.message})`}
                              className="font-mono-num h-8 cursor-pointer border-0 border-b border-[#0f62fe] bg-[#f4f4f4] px-2 text-xs font-medium text-[#161616] hover:bg-[#d0e2ff]/50"
                            >
                              {shifts.map((s) => (
                                <option key={s.code} value={s.code}>
                                  {formatShiftGroupLabel(s.group)} · {s.timeRange}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span title={sLock.message} className="text-[#525252]">
                              {r.sDef.timeRange}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.sDef.group === 'SOS'
                            ? `SOS (${classifySosShiftSide(r.sDef.timeRange)})`
                            : formatShiftGroupLabel(r.sDef.group)}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right">
                          {r.sDef.group === 'SOS' ? `Scan Out Sớm (${r.std}h)` : `${r.std}h`}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right">{r.ot.toFixed(1)}h</td>
                        <td className="font-mono-num px-3 py-2 text-right font-semibold">{r.total.toFixed(1)}h</td>
                        <td className="font-mono-num px-3 py-2 text-xs whitespace-nowrap text-[#525252]" title={sLock.message}>
                          Ca: {sLock.locked ? 'Đã khóa' : 'Đang mở'} · OT: {oLock.locked ? 'Đã khóa' : 'Đang mở'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {(() => {
              const st = selectedDeptDef ? analytics.deptStats[selectedDeptDef.id] : analytics.ob;
              return (
                <>
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                    <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                      <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Tổng số lượng nhân sự</div>
                      <div className="font-mono-num mt-1 text-xl font-semibold text-[#0f172a] sm:text-2xl">
                        {st.totalShifts} lượt
                      </div>
                      <div className="text-xs text-[#64748b]">
                        Day Shift: {st.convDay} · Night Shift: {st.convNight}
                      </div>
                    </div>
                    <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                      <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Giờ VH Day Shift</div>
                      <div className="font-mono-num mt-1 text-xl font-semibold text-[#0f172a] sm:text-2xl">
                        {st.dayHours.toFixed(1)}h
                      </div>
                      <div className="text-xs text-[#64748b]">{st.convDay} lượt Day Shift</div>
                    </div>
                    <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                      <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Giờ VH Night Shift</div>
                      <div className="font-mono-num mt-1 text-xl font-semibold text-[#0f172a] sm:text-2xl">
                        {st.nightHours.toFixed(1)}h
                      </div>
                      <div className="text-xs text-[#64748b]">{st.convNight} lượt Night Shift</div>
                    </div>
                    <div className="border border-[#e2e8f0] bg-[#f8fafc] p-3">
                      <div className="font-mono-num text-[11px] text-[#64748b] uppercase">Tổng giờ VH &amp; Nhân sự</div>
                      <div className="font-mono-num mt-1 text-xl font-semibold text-[#0f172a] sm:text-2xl">
                        {st.totalHours.toFixed(1)}h
                      </div>
                      <div className="text-xs text-[#64748b]">
                        {st.otHours.toFixed(1)}h OT · {deptEmps.length} NV
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 md:gap-6 lg:grid-cols-12 [&>*]:min-w-0">
                    <div className="min-w-0 lg:col-span-7">
                      <h4 className="mb-2 text-sm font-semibold text-[#0f172a]">
                        Chi tiết theo ngày —{' '}
                        {selectedDeptDef ? (
                          <span style={{ color: selectedDeptDef.color }}>{selectedDeptDef.name}</span>
                        ) : (
                          <span>Toàn Kho OB</span>
                        )}
                      </h4>
                      <div className="max-h-[360px] overflow-auto border border-[#e2e8f0] bg-white">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="sticky top-0 bg-[#f8fafc] font-mono text-[11px] uppercase text-[#475569]">
                            <tr>
                              <th className="px-2.5 py-2 whitespace-nowrap">Ngày</th>
                              <th className="px-2 py-2 text-right whitespace-nowrap">SL Day Shift</th>
                              <th className="px-2 py-2 text-right whitespace-nowrap">SL Night Shift</th>
                              <th className="px-2 py-2 text-right whitespace-nowrap">Tổng SL</th>
                              <th className="px-2 py-2 text-right whitespace-nowrap">Giờ VH Day</th>
                              <th className="px-2 py-2 text-right whitespace-nowrap">Giờ VH Night</th>
                              <th className="px-2 py-2 text-right whitespace-nowrap">OT</th>
                              <th className="px-2 py-2 text-right whitespace-nowrap">Tổng VH</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedDeptDef
                              ? analytics.dates.map((d, idx) => {
                                  const td = analytics.deptStats[selectedDeptDef.id].daily[d];
                                  return (
                                    <tr
                                      key={d}
                                      className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'}`}
                                    >
                                      <td className="font-mono-num px-2.5 py-1.5 whitespace-nowrap">
                                        {formatVNDate(d)} ({getVNWeekday(d)})
                                      </td>
                                      <td className="font-mono-num px-2.5 py-1.5 text-right font-semibold">{td.convDay}</td>
                                      <td className="font-mono-num px-2.5 py-1.5 text-right font-semibold">{td.convNight}</td>
                                      <td className="font-mono-num px-2.5 py-1.5 text-right">{td.totalShifts}</td>
                                      <td className="font-mono-num px-2.5 py-1.5 text-right">{td.dayHours.toFixed(1)}h</td>
                                      <td className="font-mono-num px-2.5 py-1.5 text-right">{td.nightHours.toFixed(1)}h</td>
                                      <td className="font-mono-num px-2.5 py-1.5 text-right">{td.otHours.toFixed(1)}h</td>
                                      <td className="font-mono-num px-2.5 py-1.5 text-right font-semibold">
                                        {td.totalHours.toFixed(1)}h
                                      </td>
                                    </tr>
                                  );
                                })
                              : analytics.dailyTotals.map((td, idx) => (
                                  <tr
                                    key={td.date}
                                    className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f8fafc]' : 'bg-white'}`}
                                  >
                                    <td className="font-mono-num px-2.5 py-1.5 whitespace-nowrap">
                                      {formatVNDate(td.date)} ({getVNWeekday(td.date)})
                                    </td>
                                    <td className="font-mono-num px-2.5 py-1.5 text-right font-semibold">{td.convDay}</td>
                                    <td className="font-mono-num px-2.5 py-1.5 text-right font-semibold">{td.convNight}</td>
                                    <td className="font-mono-num px-2.5 py-1.5 text-right">{td.totalShifts}</td>
                                    <td className="font-mono-num px-2.5 py-1.5 text-right">{td.dayHours.toFixed(1)}h</td>
                                    <td className="font-mono-num px-2.5 py-1.5 text-right">{td.nightHours.toFixed(1)}h</td>
                                    <td className="font-mono-num px-2.5 py-1.5 text-right">{td.otHours.toFixed(1)}h</td>
                                    <td className="font-mono-num px-2.5 py-1.5 text-right font-semibold">
                                      {td.totalHours.toFixed(1)}h
                                    </td>
                                  </tr>
                                ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="min-w-0 lg:col-span-5">
                      <h4 className="mb-2 text-sm font-semibold text-[#0f172a]">
                        Nhân sự{' '}
                        {selectedDeptDef ? (
                          <span style={{ color: selectedDeptDef.color }}>{selectedDeptDef.name}</span>
                        ) : (
                          <span>Toàn Kho OB</span>
                        )}
                      </h4>
                      <div className="max-h-[360px] overflow-auto border border-[#e0e0e0] bg-white">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="sticky top-0 bg-[#e0e0e0] font-mono text-[11px] uppercase">
                            <tr>
                              <th className="px-2.5 py-2 whitespace-nowrap">Mã NV</th>
                              <th className="px-2.5 py-2 whitespace-nowrap">Tên nhân viên</th>
                              {!selectedDeptDef && <th className="px-2.5 py-2 whitespace-nowrap">Task</th>}
                              <th className="px-2.5 py-2 whitespace-nowrap">Vị trí</th>
                              <th className="px-2.5 py-2 text-right whitespace-nowrap">Số ngày</th>
                              <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ ca</th>
                              <th className="px-2.5 py-2 text-right whitespace-nowrap">Giờ OT</th>
                              <th className="px-2.5 py-2 text-right whitespace-nowrap">Tổng VH</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deptEmps.map((item, idx) => (
                              <tr
                                key={item.emp.id}
                                className={`border-t border-[#e0e0e0] ${idx % 2 === 1 ? 'bg-[#f8f8f8]' : 'bg-white'}`}
                              >
                                <td className="font-mono-num px-2.5 py-1.5 whitespace-nowrap">{item.emp.id}</td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => handleEmpClick(item.emp.id)}
                                    className="cursor-pointer font-semibold text-[#0f62fe] hover:underline"
                                  >
                                    {item.emp.name}
                                  </button>
                                </td>
                                {!selectedDeptDef && (
                                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleDeptClick(item.emp.dept)}
                                      style={{ color: getDeptColor(item.emp.dept) }}
                                      className="cursor-pointer font-semibold hover:underline"
                                    >
                                      {item.emp.dept}
                                    </button>
                                  </td>
                                )}
                                <td className="px-2.5 py-1.5 whitespace-nowrap">{item.emp.role}</td>
                                <td className="font-mono-num px-2.5 py-1.5 text-right">{item.eDays}</td>
                                <td className="font-mono-num px-2.5 py-1.5 text-right">{item.eBase}h</td>
                                <td className="font-mono-num px-2.5 py-1.5 text-right">{item.eOt.toFixed(1)}h</td>
                                <td className="font-mono-num px-2.5 py-1.5 text-right font-semibold">
                                  {item.eTotal.toFixed(1)}h
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
