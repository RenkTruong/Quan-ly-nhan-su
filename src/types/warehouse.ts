export type DepartmentId = 'Pick' | 'Check' | 'Pack' | 'Dispatch' | 'TBS' | 'NVL';

export type ShiftGroup = 'Day' | 'Night' | 'Mid' | 'SOS' | 'Off';

export type EmployeeStatus = 'Active' | 'Inactive';

export type TabId = 'dashboard' | 'schedule' | 'matrix' | 'master';

export interface DepartmentDef {
  id: DepartmentId;
  name: string;
  roles: string[];
  color: string;
}

export interface ShiftDef {
  code: string;
  name: string;
  shortCode: string;
  timeRange: string;
  group: ShiftGroup;
  stdHours: number;
}

export interface Employee {
  id: string;
  name: string;
  dept: DepartmentId;
  role: string;
  status: EmployeeStatus;
}

export interface ScheduleRecord {
  shiftCode: string;
  otHours: number;
  role?: string;
  note?: string;
}

export interface DrilldownState {
  mode: 'all' | 'dept' | 'employee';
  id: string;
  prevDeptId?: DepartmentId;
}

export interface AppState {
  employees: Employee[];
  shifts: ShiftDef[];
  records: Record<string, ScheduleRecord>;
  rangeStart: string;
  rangeEnd: string;
  activeTab: TabId;
  schedDate: string;
  drilldown: DrilldownState;
  googleSheetUrl?: string;
}

export interface DailyDeptStats {
  date: string;
  rawDay: number;
  rawNight: number;
  rawMid: number;
  midToDay: number;
  midToNight: number;
  convDay: number;
  convNight: number;
  totalShifts: number;
  baseHours: number;
  otHours: number;
  totalHours: number;
  dayHours: number;
  nightHours: number;
}

export interface DeptAggregateStats {
  dept: DepartmentId;
  rawDay: number;
  rawNight: number;
  rawMid: number;
  midToDay: number;
  midToNight: number;
  convDay: number;
  convNight: number;
  totalShifts: number;
  baseHours: number;
  otHours: number;
  totalHours: number;
  dayHours: number;
  nightHours: number;
  daily: Record<string, DailyDeptStats>;
}

export interface DailyWarehouseTotal {
  date: string;
  rawDay: number;
  rawNight: number;
  rawMid: number;
  midToDay: number;
  midToNight: number;
  convDay: number;
  convNight: number;
  totalShifts: number;
  baseHours: number;
  otHours: number;
  totalHours: number;
  dayHours: number;
  nightHours: number;
  deptOt: Record<DepartmentId, number>;
}

export interface RangeAnalytics {
  dates: string[];
  activeEmps: Employee[];
  deptStats: Record<DepartmentId, DeptAggregateStats>;
  dailyTotals: DailyWarehouseTotal[];
  ob: {
    rawDay: number;
    rawNight: number;
    rawMid: number;
    midToDay: number;
    midToNight: number;
    convDay: number;
    convNight: number;
    totalShifts: number;
    baseHours: number;
    otHours: number;
    totalHours: number;
    dayHours: number;
    nightHours: number;
  };
}
