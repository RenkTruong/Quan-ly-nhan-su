import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ScheduleRecord, ShiftDef } from '../types/warehouse';
import { findShiftRestViolation } from './scheduleRules';

const shifts: ShiftDef[] = [
  { code: 'LONG', name: 'Long Shift', shortCode: 'L', timeRange: '09:00-21:00', group: 'Day', stdHours: 12 },
  { code: 'DAY', name: 'Day Shift', shortCode: 'D', timeRange: '06:00-15:00', group: 'Day', stdHours: 9 },
  { code: 'NIGHT', name: 'Night Shift', shortCode: 'N', timeRange: '21:00-05:00', group: 'Night', stdHours: 8 },
  { code: 'OFF', name: 'Off', shortCode: 'OFF', timeRange: '—', group: 'Off', stdHours: 0 },
];

describe('findShiftRestViolation', () => {
  it('rejects a next-day shift with less than 12 hours of rest', () => {
    const records: Record<string, ScheduleRecord> = {
      '2026-11-17|OB-001': { shiftCode: 'LONG', otHours: 0 },
    };

    assert.deepEqual(findShiftRestViolation('2026-11-18', 'OB-001', 'DAY', shifts, records), {
      direction: 'before',
      adjacentDate: '2026-11-17',
      adjacentShift: shifts[0],
      restMinutes: 9 * 60,
    });
  });

  it('allows exactly 12 hours between shifts', () => {
    const shiftsWithTwelveHourRest = [
      { ...shifts[0], timeRange: '06:00-18:00' },
      shifts[1],
      shifts[2],
    ];
    const records: Record<string, ScheduleRecord> = {
      '2026-11-17|OB-001': { shiftCode: 'LONG', otHours: 0 },
    };

    assert.equal(
      findShiftRestViolation('2026-11-18', 'OB-001', 'DAY', shiftsWithTwelveHourRest, records),
      null
    );
  });

  it('rejects a shift that leaves less than 12 hours before the next day', () => {
    const records: Record<string, ScheduleRecord> = {
      '2026-11-18|OB-001': { shiftCode: 'DAY', otHours: 0 },
    };

    assert.deepEqual(findShiftRestViolation('2026-11-17', 'OB-001', 'LONG', shifts, records), {
      direction: 'after',
      adjacentDate: '2026-11-18',
      adjacentShift: shifts[1],
      restMinutes: 9 * 60,
    });
  });

  it('accounts for overnight shifts when calculating the next day rest period', () => {
    const records: Record<string, ScheduleRecord> = {
      '2026-11-18|OB-001': { shiftCode: 'DAY', otHours: 0 },
    };

    const violation = findShiftRestViolation('2026-11-17', 'OB-001', 'NIGHT', shifts, records);
    assert.equal(violation?.direction, 'after');
    assert.equal(violation?.restMinutes, 60);
  });

  it('ignores off shifts when checking rest periods', () => {
    const records: Record<string, ScheduleRecord> = {
      '2026-11-17|OB-001': { shiftCode: 'OFF', otHours: 0 },
    };

    assert.equal(findShiftRestViolation('2026-11-18', 'OB-001', 'DAY', shifts, records), null);
  });
});
