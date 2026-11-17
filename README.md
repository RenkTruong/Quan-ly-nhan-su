# Hệ thống Quản lý Phân ca & Báo cáo Vận hành Kho Outbound (OB)

Ứng dụng web quản lý lịch làm việc, phân ca, chấm giờ tăng ca (OT), xuất ảnh PNG lịch tháng và đồng bộ Google Sheets cho 6 Task kho Outbound (`Pick`, `Check`, `Pack`, `Dispatch`, `TBS`, `NVL`).

## Tính năng chính

- **Báo cáo Tổng quan Kho OB**:
  - Thống kê lượt ca, giờ vận hành Day Shift / Night Shift, giờ OT theo 6 Task và toàn kho OB.
  - Chọn Task hoặc nhân sự để chỉ xem báo cáo tương ứng; bấm **Tổng cả OB** để trở về báo cáo toàn kho.
- **Phân ca & Chấm OT**:
  - Cố định các cột Mã NV, Họ và Tên, Vị trí khi cuộn ngang; nhập Vị trí riêng theo từng nhân viên/ngày.
  - Khóa chỉnh ca theo quy tắc thời gian thực (`> hôm nay` và trước `15:00` đối với ngày `D+1`), khóa OT sau `23:59:59` ngày `D+2`.
  - Hỗ trợ nhóm ca: `Day` (9h), `Night` (8h), `MID` (9h), `SOS` (`Scan Out Sớm`, tự động phân Day nếu out trước `18:00` và Night nếu out từ `18:00` trở đi), `OFF`.
- **Lịch Tháng & Xuất ảnh PNG**:
  - Chỉnh giờ làm trực tiếp trên ô lịch tháng, xuất ảnh PNG hiển thị giờ bắt đầu ca gửi nhân viên.
- **Đồng bộ Google Sheets**:
  - Tạo file mẫu Google Sheets với VLOOKUP Tên NV theo Mã NV và Dropdown đồng bộ danh mục Task, Vị trí, Ca làm, Giờ làm.
  - Vị trí trên lịch được đồng bộ theo từng ngày; có thể nhập từ Sheet hoặc đẩy toàn bộ lịch từ ứng dụng lên Sheet.

## Cài đặt & Chạy local

```bash
npm install
npm run dev
```

Build production:

```bash
npm run build
```

## Triển khai GitHub Pages

Workflow `.github/workflows/deploy.yml` tự build và deploy khi có commit lên nhánh `main` hoặc được chạy thủ công trong tab Actions. Trong **Settings → Pages**, đặt **Build and deployment → Source** thành **GitHub Actions**. Vite sẽ tự dùng đường dẫn `/Quan-ly-nhan-su/` khi build trên GitHub Actions.

## Cấu hình đăng nhập Google

Trong Firebase Console, mở **Authentication → Settings → Authorized domains** và thêm `renktruong.github.io`. Đồng thời xác nhận Google đã được bật trong **Authentication → Sign-in method**. Nếu thiếu domain, đăng nhập từ GitHub Pages sẽ báo `auth/unauthorized-domain`. Khi chạy local, thêm `localhost` nếu chưa có.

## Hướng dẫn Push lên GitHub

```bash
git init
git add .
git commit -m "Initial commit: OB Warehouse Shift & Operations System"
git branch -M main
git remote add origin https://github.com/<tai-khoan>/<ten-repo>.git
git push -u origin main
```
