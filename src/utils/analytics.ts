import { DEPT_CATALOG } from '../data/seedData';
import {
  DepartmentId,
  DeptAggregateStats,
  Employee,
  RangeAnalytics,
  ScheduleRecord,
  ShiftDef,
  ShiftGroup,
} from '../types/warehouse';

export function parseYMD(ymd: string): Date | null {
  const parts = String(ymd || '')
    .split('-')
    .map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
}

export function formatYMD(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatVNDate(ymd: string): string {
  const parts = String(ymd || '').split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatShortVNDate(ymd: string): string {
  const parts = String(ymd || '').split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}`;
}

export function getVNWeekday(ymd: string): string {
  const dt = parseYMD(ymd);
  if (!dt) return '';
  const names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return names[dt.getDay()];
}

export function getDatesInRange(startYmd: string, endYmd: string): string[] {
  const s = parseYMD(startYmd);
  const e = parseYMD(endYmd);
  if (!s || !e || s > e) return [];
  const arr: string[] = [];
  const cur = new Date(s.getTime());
  let safety = 0;
  while (cur <= e && safety < 120) {
    arr.push(formatYMD(cur));
    cur.setDate(cur.getDate() + 1);
    safety++;
  }
  return arr;
}

export function getSystemNow(simClock: string): Date {
  const raw = simClock || '2026-11-17T14:30';
  const dt = new Date(raw);
  return isNaN(dt.getTime()) ? new Date(2026, 10, 17, 14, 30, 0) : dt;
}

export function formatClockDisplay(simClock: string): string {
  const now = getSystemNow(simClock);
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

// Shift lock: Day D editable only if D > today AND current time < 15:00 on D-1
export function isShiftLocked(
  dateYmd: string,
  simClock: string
): { locked: boolean; deadlineStr: string; reason: 'past_or_today' | 'after_15h' | 'open'; message: string } {
  const d = parseYMD(dateYmd);
  if (!d) {
    return { locked: true, deadlineStr: '', reason: 'past_or_today', message: 'Ngày không hợp lệ.' };
  }
  const now = getSystemNow(simClock);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayYmd = formatYMD(today);
  const deadline = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 15, 0, 0, 0);
  const deadlineStr = `${formatShortVNDate(formatYMD(deadline))} 15:00`;

  if (d.getTime() <= today.getTime()) {
    return {
      locked: true,
      deadlineStr,
      reason: 'past_or_today',
      message: `Không thể đổi giờ làm ngày ${formatVNDate(dateYmd)}: ngày được chỉnh phải lớn hơn ngày hiện tại (${formatVNDate(todayYmd)}).`,
    };
  }

  if (now.getTime() >= deadline.getTime()) {
    return {
      locked: true,
      deadlineStr,
      reason: 'after_15h',
      message: `Không thể đổi giờ làm ngày kế tiếp (${formatVNDate(dateYmd)}): phải chỉnh trước 15:00 ngày hiện tại (${deadlineStr}).`,
    };
  }

  return {
    locked: false,
    deadlineStr,
    reason: 'open',
    message: `Đang mở chỉnh sửa (hạn trước ${deadlineStr}).`,
  };
}

// OT lock: Day D editable until 23:59:59 on D+2
export function isOtLocked(dateYmd: string, simClock: string): { locked: boolean; deadlineStr: string } {
  const d = parseYMD(dateYmd);
  if (!d) return { locked: true, deadlineStr: '' };
  const deadline = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2, 23, 59, 59, 999);
  const now = getSystemNow(simClock);
  return {
    locked: now.getTime() > deadline.getTime(),
    deadlineStr: `${formatShortVNDate(formatYMD(deadline))} 23:59:59`,
  };
}

export function getShiftDef(shifts: ShiftDef[], code: string): ShiftDef {
  return (
    shifts.find((s) => s.code === code) || {
      code: code || 'OFF',
      name: code || 'Nghỉ',
      shortCode: code ? code.slice(0, 3) : 'OFF',
      timeRange: '—',
      group: 'Off',
      stdHours: 0,
    }
  );
}

export function getShiftStartTimeLabel(shift: ShiftDef): string {
  if (shift.group === 'Off') return 'OFF';
  const match = String(shift.timeRange || '').match(/(\d{1,2}:\d{2})/);
  if (match) {
    const [hh, mm] = match[1].split(':');
    return `${hh.padStart(2, '0')}:${mm}`;
  }
  return shift.shortCode || 'OFF';
}

export function parseTimeRangeMinutes(
  timeRange: string
): { startStr: string; endStr: string; startMin: number; endMin: number; durationHours: number } | null {
  const matches = String(timeRange || '').match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!matches) return null;
  const sh = Number(matches[1]);
  const sm = Number(matches[2]);
  const eh = Number(matches[3]);
  const em = Number(matches[4]);
  if ([sh, sm, eh, em].some(isNaN) || sh > 23 || eh > 23 || sm > 59 || em > 59) return null;

  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;
  const durationHours = Math.round((diff / 60) * 100) / 100;
  return {
    startStr: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
    endStr: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`,
    startMin,
    endMin,
    durationHours,
  };
}

export function classifySosShiftSide(timeRange: string): 'Day' | 'Night' {
  const parsed = parseTimeRangeMinutes(timeRange);
  if (!parsed) return 'Day';
  // Crosses midnight (e.g. 21:00-01:00) -> Night
  if (parsed.endMin < parsed.startMin) return 'Night';
  // Out before 18:00 -> Day; out at or after 18:00 -> Night
  return parsed.endMin < 18 * 60 ? 'Day' : 'Night';
}

export function getShiftEffectiveStdHours(shift: ShiftDef): number {
  if (shift.group === 'Off') return 0;
  if (shift.group === 'SOS') {
    const parsed = parseTimeRangeMinutes(shift.timeRange);
    if (parsed && parsed.durationHours > 0) return parsed.durationHours;
    return Math.max(0, Number(shift.stdHours) || 0);
  }
  if (shift.group === 'Night') return Number(shift.stdHours) > 0 ? Number(shift.stdHours) : 8;
  return Number(shift.stdHours) > 0 ? Number(shift.stdHours) : 9;
}

export function formatShiftGroupLabel(group: ShiftGroup): string {
  if (group === 'Mid') return 'MID';
  if (group === 'Off') return 'OFF';
  return group;
}

export function buildAutoShiftCode(group: ShiftGroup, startTime: string, endTime: string): string {
  const prefix = group === 'Mid' ? 'MID' : group === 'Off' ? 'OFF' : group.toUpperCase();
  if (group === 'Off') return 'OFF';
  const cleanStart = (startTime || '06:00').trim();
  const cleanEnd = (endTime || '15:00').trim();
  return `${prefix}_${cleanStart}_${cleanEnd}`;
}

export function getRecord(records: Record<string, ScheduleRecord>, dateYmd: string, empId: string): ScheduleRecord {
  return records[`${dateYmd}|${empId}`] || { shiftCode: 'OFF', otHours: 0, note: '' };
}

export function convertMidCounts(rawDay: number, rawNight: number, rawMid: number) {
  const midToDay = Math.ceil(rawMid / 2);
  const midToNight = Math.floor(rawMid / 2);
  return {
    rawDay,
    rawNight,
    rawMid,
    midToDay,
    midToNight,
    convDay: rawDay + midToDay,
    convNight: rawNight + midToNight,
  };
}

export function computeRangeAnalytics(
  employees: Employee[],
  shifts: ShiftDef[],
  records: Record<string, ScheduleRecord>,
  startYmd: string,
  endYmd: string
): RangeAnalytics {
  const dates = getDatesInRange(startYmd, endYmd);
  const activeEmps = employees.filter((e) => e.status === 'Active');

  const deptStats = {} as Record<DepartmentId, DeptAggregateStats>;
  DEPT_CATALOG.forEach((d) => {
    deptStats[d.id] = {
      dept: d.id,
      rawDay: 0,
      rawNight: 0,
      rawMid: 0,
      midToDay: 0,
      midToNight: 0,
      convDay: 0,
      convNight: 0,
      totalShifts: 0,
      baseHours: 0,
      otHours: 0,
      totalHours: 0,
      dayHours: 0,
      nightHours: 0,
      daily: {},
    };
  });

  const dailyTotals: RangeAnalytics['dailyTotals'] = [];
  let obRawDay = 0,
    obRawNight = 0,
    obRawMid = 0;
  let obConvDay = 0,
    obConvNight = 0;
  let obTotalShifts = 0,
    obBaseHours = 0,
    obOtHours = 0,
    obTotalHours = 0,
    obDayHours = 0,
    obNightHours = 0;

  dates.forEach((d) => {
    let dRawDay = 0,
      dRawNight = 0,
      dRawMid = 0;
    let dShifts = 0,
      dBaseHours = 0,
      dOtHours = 0,
      dDayHours = 0,
      dNightHours = 0,
      dConvDay = 0,
      dConvNight = 0;

    const dDeptOt = {} as Record<DepartmentId, number>;
    const bucketsByDept = {} as Record<DepartmentId, Record<string, 'Day' | 'Night' | 'Off'>>;
    DEPT_CATALOG.forEach((dept) => {
      dDeptOt[dept.id] = 0;
      bucketsByDept[dept.id] = assignDailyShiftBucket(employees, shifts, records, dept.id, d);
      deptStats[dept.id].daily[d] = {
        date: d,
        rawDay: 0,
        rawNight: 0,
        rawMid: 0,
        midToDay: 0,
        midToNight: 0,
        convDay: 0,
        convNight: 0,
        totalShifts: 0,
        baseHours: 0,
        otHours: 0,
        totalHours: 0,
        dayHours: 0,
        nightHours: 0,
      };
    });

    activeEmps.forEach((emp) => {
      const rec = getRecord(records, d, emp.id);
      const sDef = getShiftDef(shifts, rec.shiftCode);
      const ot = Number(rec.otHours) || 0;
      const dObj = deptStats[emp.dept]?.daily[d];
      if (!dObj) return;

      const bucket = bucketsByDept[emp.dept]?.[emp.id] || 'Off';

      if (sDef.group !== 'Off') {
        const std = getShiftEffectiveStdHours(sDef);
        const empTotalHrs = std + ot;
        dObj.totalShifts += 1;
        dObj.baseHours += std;
        dObj.otHours += ot;
        dObj.totalHours += empTotalHrs;

        if (bucket === 'Day') {
          dObj.dayHours += empTotalHrs;
          dDayHours += empTotalHrs;
        } else if (bucket === 'Night') {
          dObj.nightHours += empTotalHrs;
          dNightHours += empTotalHrs;
        }

        dShifts += 1;
        dBaseHours += std;
        dOtHours += ot;
        dDeptOt[emp.dept] += ot;

        if (sDef.group === 'Day') {
          dObj.rawDay += 1;
          dRawDay += 1;
        } else if (sDef.group === 'Night') {
          dObj.rawNight += 1;
          dRawNight += 1;
        } else if (sDef.group === 'Mid') {
          dObj.rawMid += 1;
          dRawMid += 1;
        } else if (sDef.group === 'SOS') {
          if (bucket === 'Day') {
            dObj.rawDay += 1;
            dRawDay += 1;
          } else {
            dObj.rawNight += 1;
            dRawNight += 1;
          }
        }
      } else if (ot > 0) {
        dObj.otHours += ot;
        dObj.totalHours += ot;
        dObj.dayHours += ot;
        dDayHours += ot;
        dOtHours += ot;
        dDeptOt[emp.dept] += ot;
      }
    });

    DEPT_CATALOG.forEach((dept) => {
      const dd = deptStats[dept.id].daily[d];
      const conv = convertMidCounts(dd.rawDay, dd.rawNight, dd.rawMid);
      dd.midToDay = conv.midToDay;
      dd.midToNight = conv.midToNight;
      dd.convDay = conv.convDay;
      dd.convNight = conv.convNight;

      dConvDay += dd.convDay;
      dConvNight += dd.convNight;

      const agg = deptStats[dept.id];
      agg.rawDay += dd.rawDay;
      agg.rawNight += dd.rawNight;
      agg.rawMid += dd.rawMid;
      agg.midToDay += dd.midToDay;
      agg.midToNight += dd.midToNight;
      agg.convDay += dd.convDay;
      agg.convNight += dd.convNight;
      agg.totalShifts += dd.totalShifts;
      agg.baseHours += dd.baseHours;
      agg.otHours += dd.otHours;
      agg.totalHours += dd.totalHours;
      agg.dayHours += dd.dayHours;
      agg.nightHours += dd.nightHours;
    });

    obRawDay += dRawDay;
    obRawNight += dRawNight;
    obRawMid += dRawMid;
    obConvDay += dConvDay;
    obConvNight += dConvNight;
    obTotalShifts += dShifts;
    obBaseHours += dBaseHours;
    obOtHours += dOtHours;
    obTotalHours += dBaseHours + dOtHours;
    obDayHours += dDayHours;
    obNightHours += dNightHours;

    dailyTotals.push({
      date: d,
      rawDay: dRawDay,
      rawNight: dRawNight,
      rawMid: dRawMid,
      midToDay: dConvDay - dRawDay,
      midToNight: dConvNight - dRawNight,
      convDay: dConvDay,
      convNight: dConvNight,
      totalShifts: dShifts,
      baseHours: dBaseHours,
      otHours: dOtHours,
      totalHours: dBaseHours + dOtHours,
      dayHours: dDayHours,
      nightHours: dNightHours,
      deptOt: dDeptOt,
    });
  });

  return {
    dates,
    activeEmps,
    deptStats,
    dailyTotals,
    ob: {
      rawDay: obRawDay,
      rawNight: obRawNight,
      rawMid: obRawMid,
      midToDay: obConvDay - obRawDay,
      midToNight: obConvNight - obRawNight,
      convDay: obConvDay,
      convNight: obConvNight,
      totalShifts: obTotalShifts,
      baseHours: obBaseHours,
      otHours: obOtHours,
      totalHours: obTotalHours,
      dayHours: obDayHours,
      nightHours: obNightHours,
    },
  };
}

export function assignDailyShiftBucket(
  employees: Employee[],
  shifts: ShiftDef[],
  records: Record<string, ScheduleRecord>,
  deptId: DepartmentId,
  dateYmd: string
): Record<string, 'Day' | 'Night' | 'Off'> {
  const deptEmps = employees.filter((e) => e.status === 'Active' && e.dept === deptId);
  const midEmps: string[] = [];
  const bucket: Record<string, 'Day' | 'Night' | 'Off'> = {};

  deptEmps.forEach((emp) => {
    const rec = getRecord(records, dateYmd, emp.id);
    const sDef = getShiftDef(shifts, rec.shiftCode);
    if (sDef.group === 'Day') bucket[emp.id] = 'Day';
    else if (sDef.group === 'Night') bucket[emp.id] = 'Night';
    else if (sDef.group === 'SOS') bucket[emp.id] = classifySosShiftSide(sDef.timeRange);
    else if (sDef.group === 'Mid') midEmps.push(emp.id);
    else bucket[emp.id] = 'Off';
  });

  const dayQuota = Math.ceil(midEmps.length / 2);
  midEmps.forEach((empId, idx) => {
    bucket[empId] = idx < dayQuota ? 'Day' : 'Night';
  });

  return bucket;
}
