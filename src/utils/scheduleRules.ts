import { ScheduleRecord, ShiftDef } from '../types/warehouse';
import { formatYMD, getRecord, parseYMD } from './analytics';

const MIN_REST_MINUTES = 12 * 60;

interface ShiftInterval {
  start: number;
  end: number;
}

export interface ShiftRestViolation {
  direction: 'before' | 'after';
  adjacentDate: string;
  adjacentShift: ShiftDef;
  restMinutes: number;
}

function getShiftInterval(shift: ShiftDef): ShiftInterval | null {
  if (shift.group === 'Off') return null;

  const match = shift.timeRange.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  if (
    startHour > 23 ||
    startMinute > 59 ||
    endHour > 23 ||
    endMinute > 59
  ) {
    return null;
  }

  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

export function findShiftRestViolation(
  dateYmd: string,
  empId: string,
  proposedShiftCode: string,
  shifts: ShiftDef[],
  records: Record<string, ScheduleRecord>
): ShiftRestViolation | null {
  const date = parseYMD(dateYmd);
  const proposedShift = shifts.find((shift) => shift.code === proposedShiftCode);
  const proposedInterval = proposedShift ? getShiftInterval(proposedShift) : null;
  if (!date || !proposedShift || !proposedInterval) return null;

  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);
  const previousDateYmd = formatYMD(previousDate);
  const previousShift = shifts.find((shift) => shift.code === getRecord(records, previousDateYmd, empId).shiftCode);
  const previousInterval = previousShift ? getShiftInterval(previousShift) : null;
  if (previousShift && previousInterval) {
    const restMinutes = 24 * 60 + proposedInterval.start - previousInterval.end;
    if (restMinutes < MIN_REST_MINUTES) {
      return {
        direction: 'before',
        adjacentDate: previousDateYmd,
        adjacentShift: previousShift,
        restMinutes,
      };
    }
  }

  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateYmd = formatYMD(nextDate);
  const nextShift = shifts.find((shift) => shift.code === getRecord(records, nextDateYmd, empId).shiftCode);
  const nextInterval = nextShift ? getShiftInterval(nextShift) : null;
  if (nextShift && nextInterval) {
    const restMinutes = 24 * 60 + nextInterval.start - proposedInterval.end;
    if (restMinutes < MIN_REST_MINUTES) {
      return {
        direction: 'after',
        adjacentDate: nextDateYmd,
        adjacentShift: nextShift,
        restMinutes,
      };
    }
  }

  return null;
}
