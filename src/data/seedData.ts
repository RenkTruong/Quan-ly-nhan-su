import { DepartmentDef, Employee, ScheduleRecord, ShiftDef } from '../types/warehouse';

export const DEPT_CATALOG: DepartmentDef[] = [
  { id: 'Pick', name: 'Pick', roles: ['Picker FTE', 'Picker PT', 'Control', 'CAP Pick', 'Control Line'], color: '#0f62fe' },
  { id: 'Check', name: 'Check', roles: ['Checker FTE', 'Checker PT', 'CAP Check'], color: '#6929c4' },
  { id: 'Pack', name: 'Pack', roles: ['Packer FTE', 'Packer PT', 'CAP Pack'], color: '#005d5d' },
  { id: 'Dispatch', name: 'Dispatch', roles: ['DP FTE', 'DP PT'], color: '#9f1853' },
  { id: 'TBS', name: 'TBS', roles: ['TBS'], color: '#198038' },
  { id: 'NVL', name: 'NVL', roles: ['CONSUMABLE'], color: '#c2410c' },
];

export function getDeptColor(deptId: string): string {
  return DEPT_CATALOG.find((d) => d.id === deptId)?.color || '#161616';
}

export const DEFAULT_SHIFTS: ShiftDef[] = [
  { code: 'DAY', name: 'Ca Day (06:00-15:00)', shortCode: 'D', timeRange: '06:00-15:00', group: 'Day', stdHours: 9 },
  { code: 'NIGHT', name: 'Ca Night (21:00-05:00)', shortCode: 'N', timeRange: '21:00-05:00', group: 'Night', stdHours: 8 },
  { code: 'MID_10_19', name: 'MID (10:00-19:00)', shortCode: 'M10', timeRange: '10:00-19:00', group: 'Mid', stdHours: 9 },
  { code: 'MID_11_20', name: 'MID (11:00-20:00)', shortCode: 'M11', timeRange: '11:00-20:00', group: 'Mid', stdHours: 9 },
  { code: 'MID_12_21', name: 'MID (12:00-21:00)', shortCode: 'M12', timeRange: '12:00-21:00', group: 'Mid', stdHours: 9 },
  { code: 'SOS_08:00_12:00', name: 'SOS (08:00-12:00)', shortCode: 'SOS', timeRange: '08:00-12:00', group: 'SOS', stdHours: 4 },
  { code: 'OFF', name: 'Nghỉ (OFF)', shortCode: 'OFF', timeRange: '—', group: 'Off', stdHours: 0 },
];

export const DEFAULT_EMPLOYEES: Employee[] = [
  { id: 'OB-001', name: 'Nguyễn Văn An', dept: 'Pick', role: 'CAP Pick', status: 'Active' },
  { id: 'OB-002', name: 'Trần Thị Bình', dept: 'Pick', role: 'Control', status: 'Active' },
  { id: 'OB-003', name: 'Lê Hoàng Cường', dept: 'Pick', role: 'Control Line', status: 'Active' },
  { id: 'OB-004', name: 'Phạm Minh Dũng', dept: 'Pick', role: 'Picker FTE', status: 'Active' },
  { id: 'OB-005', name: 'Hoàng Thị Em', dept: 'Pick', role: 'Picker FTE', status: 'Active' },
  { id: 'OB-006', name: 'Vũ Quốc Hùng', dept: 'Pick', role: 'Picker FTE', status: 'Active' },
  { id: 'OB-007', name: 'Đặng Ngọc Khoa', dept: 'Pick', role: 'Picker PT', status: 'Active' },
  { id: 'OB-008', name: 'Bùi Thanh Lan', dept: 'Pick', role: 'Picker PT', status: 'Active' },

  { id: 'OB-009', name: 'Đỗ Văn Minh', dept: 'Check', role: 'CAP Check', status: 'Active' },
  { id: 'OB-010', name: 'Ngô Thị Nga', dept: 'Check', role: 'Checker FTE', status: 'Active' },
  { id: 'OB-011', name: 'Dương Quang Phát', dept: 'Check', role: 'Checker FTE', status: 'Active' },
  { id: 'OB-012', name: 'Lý Hải Quân', dept: 'Check', role: 'Checker FTE', status: 'Active' },
  { id: 'OB-013', name: 'Trương Mỹ Tâm', dept: 'Check', role: 'Checker PT', status: 'Active' },
  { id: 'OB-014', name: 'Võ Tấn Tài', dept: 'Check', role: 'Checker PT', status: 'Active' },

  { id: 'OB-015', name: 'Huỳnh Thị Uyên', dept: 'Pack', role: 'CAP Pack', status: 'Active' },
  { id: 'OB-016', name: 'Phan Văn Vinh', dept: 'Pack', role: 'Packer FTE', status: 'Active' },
  { id: 'OB-017', name: 'Trịnh Xuân Yến', dept: 'Pack', role: 'Packer FTE', status: 'Active' },
  { id: 'OB-018', name: 'Cao Đức Anh', dept: 'Pack', role: 'Packer FTE', status: 'Active' },
  { id: 'OB-019', name: 'Mai Thị Bích', dept: 'Pack', role: 'Packer FTE', status: 'Active' },
  { id: 'OB-020', name: 'Tạ Hữu Cảnh', dept: 'Pack', role: 'Packer PT', status: 'Active' },
  { id: 'OB-021', name: 'Lâm Ngọc Diệp', dept: 'Pack', role: 'Packer PT', status: 'Active' },

  { id: 'OB-022', name: 'Kiều Văn Giang', dept: 'Dispatch', role: 'DP FTE', status: 'Active' },
  { id: 'OB-023', name: 'Chu Thị Hà', dept: 'Dispatch', role: 'DP FTE', status: 'Active' },
  { id: 'OB-024', name: 'Đoàn Nhật Khánh', dept: 'Dispatch', role: 'DP PT', status: 'Active' },
  { id: 'OB-025', name: 'Lương Minh Long', dept: 'Dispatch', role: 'DP PT', status: 'Active' },

  { id: 'OB-026', name: 'Mạc Thu Phương', dept: 'TBS', role: 'TBS', status: 'Active' },
  { id: 'OB-027', name: 'Nghiêm Quốc Sơn', dept: 'TBS', role: 'TBS', status: 'Active' },

  { id: 'OB-028', name: 'Quách Thị Trang', dept: 'NVL', role: 'CONSUMABLE', status: 'Active' },
  { id: 'OB-029', name: 'Thân Văn Tuấn', dept: 'NVL', role: 'CONSUMABLE', status: 'Active' },
];

export function buildSeedSchedule(employees: Employee[]): Record<string, ScheduleRecord> {
  const records: Record<string, ScheduleRecord> = {};
  const midCodes = ['MID_10_19', 'MID_11_20', 'MID_12_21'];

  for (let day = 1; day <= 21; day++) {
    const dStr = `2026-11-${String(day).padStart(2, '0')}`;
    const isPeak = day === 11 || day === 12 || day === 15 || day === 16;

    employees.forEach((emp, idx) => {
      const offMatch = (day + idx) % 7 === 0;
      let shiftCode = 'DAY';
      let otHours = 0;

      if (offMatch && !isPeak) {
        shiftCode = 'OFF';
      } else {
        if (emp.dept === 'Pick' || emp.dept === 'Check' || emp.dept === 'Pack') {
          if (idx % 4 === 1) shiftCode = 'NIGHT';
          else if (idx % 4 === 2) shiftCode = midCodes[(day + idx) % midCodes.length];
          else if (idx % 4 === 3 && day % 2 === 0) shiftCode = 'NIGHT';
          else shiftCode = 'DAY';
        } else if (emp.dept === 'Dispatch') {
          shiftCode = idx % 2 === 1 ? 'NIGHT' : day % 3 === 0 ? 'MID_11_20' : 'DAY';
        } else {
          shiftCode = idx % 2 === 1 ? 'NIGHT' : 'DAY';
        }

        if (shiftCode !== 'OFF') {
          if (day === 11) {
            otHours = idx % 3 === 0 ? 3 : 2;
          } else if (isPeak && idx % 2 === 0) {
            otHours = 2;
          } else if ((day + idx) % 5 === 0) {
            otHours = 1.5;
          } else if ((day + idx) % 6 === 0) {
            otHours = 1;
          }
        }
      }

      records[`${dStr}|${emp.id}`] = {
        shiftCode,
        otHours,
        role: emp.role,
        note: isPeak && otHours > 0 ? 'Cao điểm' : '',
      };
    });
  }
  return records;
}
