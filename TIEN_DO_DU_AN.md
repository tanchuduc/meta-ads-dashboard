# BÁO CÁO TIẾN ĐỘ DỰ ÁN & HƯỚNG DẪN TRIỂN KHAI (PROJECT STATUS)
> **Dự án**: Meta Ads Dashboard (Hệ thống Báo cáo & Dashboard Tự động Meta Ads)  
> **Cập nhật lần cuối**: 10/11/2026  
> **Mục đích tài liệu**: Tài liệu tóm tắt toàn bộ bối cảnh, cấu trúc kiến trúc, tiến độ hiện tại và các bước tiếp theo để khi mở dự án trên bất kỳ máy nào (nhà hoặc công ty), AI Agent (Antigravity) và lập trình viên có thể nắm bắt và tiếp tục công việc ngay lập tức mà không bị gián đoạn.

---

## 1. TỔNG QUAN DỰ ÁN (PROJECT OVERVIEW)

### 1.1. Mục tiêu & Vấn đề giải quyết
- **Vấn đề**: Giao diện Meta Ads Manager thường load chậm, khó lọc sâu, không so sánh chéo linh hoạt giữa 4 tầng dữ liệu (*Campaign → Ad Set → Ad → Creative/Thumbnail*). Các công cụ BI trả phí (Supermetrics, Funnel, Tableau...) lại tốn chi phí định kỳ và phụ thuộc bên thứ ba.
- **Giải pháp**: Xây dựng hệ thống tự phục hồi (**self-healing pipeline**) hoàn toàn miễn phí, sử dụng **Google Apps Script** làm backend/ETL, **Google Sheets** làm cơ sở dữ liệu lưu trữ bền vững, và giao diện web **Single-Page Dashboard** tương tác trực quan (Vanilla HTML/CSS/JS + Chart.js).
- **Quy mô hiện tại**: Đã được nâng cấp để hỗ trợ **8 tài khoản quảng cáo Meta Ads** đồng thời với hàng ngàn ad/ad set/campaign.

---

## 2. KIẾN TRÚC HỆ THỐNG & LUỒNG DỮ LIỆU (ARCHITECTURE & DATA FLOW)

```
Meta Marketing API (v18.0)
       │ (Tự động theo lịch hoặc bấm 1-click)
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Google Apps Script Pipelines (ETL Layer)                   │
│  - Config.gs        : Cấu hình 8 tài khoản + Drive Folder   │
│  - DataPipeline.gs  : Kéo dữ liệu Campaign ("data - by day") │
│  - AdSetPipeline.gs : Kéo dữ liệu AdSet ("data - adset...") │
│  - AdPipeline.gs    : Kéo Ad + Cache Creative Thumbnails    │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (Ghi dữ liệu bền vững, tự động tạo & quản lý qua PropertiesService)
┌─────────────────────────────────────────────────────────────┐
│  3 Google Spreadsheets (Lớp Cơ Sở Dữ Liệu)                 │
│  1. Meta Ads - Campaign Data ("test-fb", "data - by day")   │
│  2. Meta Ads - AdSet Data    ("data - adset - by day")      │
│  3. Meta Ads - Ad & Creative Data ("data - ad...", cache)   │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (Đọc, tổng hợp dữ liệu, chấm điểm hiệu suất Benchmark)
┌─────────────────────────────────────────────────────────────┐
│  Code.gs (Apps Script Web App Backend)                      │
│  - getDashboardData(), getAdSetData(), getAdData()          │
│  - Chấm điểm hiệu quả ad (Poor / Average / Good / Excellent)│
│  - Phân tích chi tiết (Breakdowns: placement, age, gender)  │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (HTML Service Web App)
┌─────────────────────────────────────────────────────────────┐
│  index.html / Dashboard.html (Giao diện Frontend)           │
│  - Dashboard trực quan, Chart.js, KPI cards, bộ lọc đa cấp  │
│  - Tự động chạy chế độ Fake Data Demo nếu chạy offline      │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. THÔNG TIN CẤU HÌNH & TÀI NGUYÊN (RESOURCES & CONFIG)

Tất cả đã được cấu hình sẵn trong file [`apps-script/Config.gs`](file:///f:/1.%20Vibe%20Coding/Meta%20Ads%20Dashboard/apps-script/Config.gs):

1. **Meta Marketing API Token**:
   - Access Token của System User đã được điền sẵn trong `ACCESS_TOKEN` (Meta Graph API v18.0).
2. **Danh sách 8 Tài khoản quảng cáo được phân quyền (`AD_ACCOUNTS`)**:
   - `act_988452388193871`: Alpha 1 GMT +7 20tr - Hoa
   - `act_3863604326993604`: TKQC Alpha 2 GMT-7- Hoa
   - `act_140020454941995`: Alpha 5 GMT -7 - Tấn
   - `act_856434001679007`: Alpha 3 GMT-3 MKT AB - Thảo
   - `act_1855997818105694`: Alpha 6 - GMT -3 - Tấn
   - `act_542081774682636`: Alpha 7 - GMT-3 - HTXB - Phương
   - `act_848982799482573`: Alpha 8 - GMT-4 (11h) - MKT Sống
   - `act_2929843193813956`: TKQC MED - Alpha 10 GMT +7 (0h)
3. **Thư mục Google Drive lưu trữ 3 Sheet**:
   - `DRIVE_FOLDER_ID`: `1WjwUW-4iyNrLLZHfDF9fpooqHrZkSCJg`
4. **Cơ chế lưu trữ ID Sheet**:
   - Lưu trữ tự động trong `PropertiesService.getScriptProperties()` với 3 khóa:
     - `CAMPAIGN_SHEET_ID`
     - `ADSET_SHEET_ID`
     - `AD_SHEET_ID`

---

## 4. TIẾN ĐỘ ĐÃ HOÀN THÀNH (COMPLETED WORK)

### A. Tái cấu trúc & Nâng cấp Hệ thống Đa Tài khoản (Multi-Account)
- [x] **`Config.gs`**:
  - Khai báo mảng `AD_ACCOUNTS` chứa toàn bộ 8 tài khoản quảng cáo.
  - Viết hàm tự động tạo 3 Google Sheets: `initSetupGoogleSheets()`. Hàm này tự tạo 3 file Sheet tương ứng trong đúng thư mục Drive và lưu ID vào `PropertiesService`.
  - Viết hàm `syncTatCaDuLieu()` để kích hoạt 1-click kéo tuần tự cả 4 tầng: Campaign → AdSet → Ad → Creative Cache.
  - Cập nhật hàm `fetchCampaignSettings(accountId)` hỗ trợ truyền ID từng tài khoản để lấy đúng objective, bid strategy và daily budget.
- [x] **`DataPipeline.gs` (Campaign Level)**:
  - Bổ sung 2 cột đầu tiên: `Account ID` và `Account Name` trong `CAMPAIGN_HEADERS_`.
  - Cập nhật hàm `buildRowFromInsight_` để gán đúng tài khoản cho từng dòng dữ liệu.
  - Viết hàm `getCampaignSpreadsheet_()` để lấy linh hoạt spreadsheet từ `PropertiesService` hoặc fallback, tự động tạo sheet nếu chưa có (`test-fb`, `data - by day`).
- [x] **`AdSetPipeline.gs` (AdSet Level)**:
  - Bổ sung `Account ID`, `Account Name` vào header (`getAdSetHeaders_`).
  - Viết lại hàm `fetchAdSetRows_()` chạy vòng lặp duyệt qua toàn bộ 8 tài khoản trong `AD_ACCOUNTS`, xử lý phân trang (`paging.next`) và chống rate-limit.
  - Cập nhật `buildAdSetRow_()` và kết nối động tới Sheet thông qua `getAdSetSheetId_()`.
- [x] **`AdPipeline.gs` (Ad & Creative Level)**:
  - Bổ sung `Account ID`, `Account Name` vào header (`getAdHeaders_`).
  - Viết lại hàm `fetchAdRows_()` duyệt qua toàn bộ 8 tài khoản quảng cáo, phân giải ad creative, thumbnail, video, carousel.
  - Cập nhật `buildAdRow_()` và kết nối động tới Sheet thông qua `getAdSheetId_()`.
- [x] **Kiểm thử cú pháp code (Syntax Validation)**:
  - Viết script kiểm tra JS (`verify_adpipeline.js`, `verify_adsetpipeline.js`, `check_missing.js`).
  - Toàn bộ các file `.gs` đều compile sạch không lỗi cú pháp.

---

## 5. CÁC BƯỚC TRIỂN KHAI TIẾP THEO (NEXT STEPS)

Khi về nhà hoặc mở dự án lên tiếp tục, chỉ cần thực hiện theo các bước sau:

### Bước 1: Đưa mã nguồn lên Google Apps Script
1. Truy cập [script.google.com](https://script.google.com/) và tạo một Dự án mới (ví dụ đặt tên: `Meta Ads Dashboard Pipeline`).
2. Tạo các file tương ứng trong dự án Apps Script và copy nội dung từ thư mục `apps-script/`:
   - `Config.gs`
   - `DataPipeline.gs`
   - `AdSetPipeline.gs`
   - `AdPipeline.gs`
   - `BreakdownPipeline.gs` (Phục vụ Report Builder: Age, Gender, Platform, Placement, Region)
   - `Code.gs`
   - `Dashboard.html` (copy từ `apps-script/Dashboard.html` hoặc `index.html`)

### Bước 2: Khởi tạo Google Sheets (Chỉ chạy 1 lần)
1. Trong trình biên tập Apps Script, chọn file `Config.gs`.
2. Trên thanh công cụ, chọn hàm **`initSetupGoogleSheets`** và bấm **Run** (Chạy).
3. Cấp quyền truy cập Google Drive & Google Sheets nếu được hỏi.
4. Kết quả: 3 file Google Sheet sẽ được tự động tạo trong thư mục Google Drive của bạn (`1WjwUW-4iyNrLLZHfDF9fpooqHrZkSCJg`) và lưu ID vào hệ thống.

### Bước 3: Đồng bộ dữ liệu ban đầu (Initial Data Pull)
1. Chọn hàm **`syncTatCaDuLieu`** trong `Config.gs` và bấm **Run**.
2. Hệ thống sẽ kéo dữ liệu của cả 8 tài khoản vào 3 Google Sheets (bao gồm cả Campaign, AdSet, Ad, Creative Cache và Breakdown).
3. *Lưu ý*: Nếu dữ liệu lịch sử quá lớn có thể chia nhỏ ngày hoặc chạy từng hàm riêng lẻ:
   - `importDataFromJSON()` (Campaign)
   - `importAdSetData()` (AdSet)
   - `importAdData()` (Ad)
   - `importAdCreatives()` (Creative cache)
   - `importBreakdownData()` (Breakdowns: Age, Gender, Platform, Placement, Region)

### Bước 4: Thiết lập Triggers chạy tự động hàng ngày (Time-driven triggers)
Vào biểu tượng **Triggers (Đồng hồ)** bên menu trái của Apps Script, tạo các trigger chạy theo ngày:
- **`copyDataOnceADay`**: Chạy lúc 1:00 AM – 2:00 AM hàng ngày (Tự động kéo và overwrite 7 ngày gần nhất để fix attribution trễ).
- **`importAdSetData`**: Chạy lúc 2:00 AM – 3:00 AM hàng ngày.
- **`importAdData`**: Chạy lúc 3:00 AM – 4:00 AM hàng ngày.
- **`importAdCreatives`**: Chạy lúc 4:00 AM – 5:00 AM hàng ngày.

### Bước 5: Kiểm tra & Tối ưu Giao diện Dashboard (`Code.gs` & `Dashboard.html`)
- **Bộ lọc tài khoản**: Đảm bảo trên giao diện Dashboard có dropdown lọc theo từng tài khoản (`Account Name` / `Account ID`) hoặc xem tổng thể cả 8 tài khoản.
- **Deploy Web App**:
  - Bấm **Deploy** -> **New deployment** -> Loại: **Web app**.
  - Execute as: *Me* (tài khoản Google của bạn).
  - Who has access: *Anyone with Google account* hoặc *Only myself*.
  - Bấm Deploy để lấy URL truy cập Dashboard trực tiếp trên trình duyệt.

---

## 6. DANH MỤC FILE TRONG DỰ ÁN (FILE STRUCTURE)

```
Meta Ads Dashboard/
├── TIEN_DO_DU_AN.md          # File này: Tổng quan tiến độ & hướng dẫn đầy đủ
├── README.md                 # Tài liệu tiếng Anh gốc của repository
├── index.html                # Web Dashboard giao diện chính (chạy được cả offline demo)
├── apps-script/
│   ├── Config.gs             # File cấu hình: Token, 8 tài khoản, Drive Folder, initSetup
│   ├── Config.example.gs     # File mẫu cấu hình ban đầu
│   ├── Code.gs               # Backend Web App: Xử lý dữ liệu hiển thị, chấm điểm ad
│   ├── DataPipeline.gs       # Pipeline kéo dữ liệu cấp Campaign
│   ├── AdSetPipeline.gs      # Pipeline kéo dữ liệu cấp Ad Set
│   ├── AdPipeline.gs         # Pipeline kéo dữ liệu cấp Ad + Cache hình ảnh Creative
│   ├── BreakdownPipeline.gs  # Pipeline kéo Breakdown (Age, Gender, Platform, Placement, Region)
│   └── Dashboard.html        # File HTML dùng khi deploy Web App trong Apps Script
├── check_missing.js          # Script NodeJS kiểm tra hàm/biến thiếu
├── verify_adpipeline.js      # Script kiểm tra cú pháp AdPipeline.gs
└── verify_adsetpipeline.js   # Script kiểm tra cú pháp AdSetPipeline.gs
```

---

## 7. CÁC LƯU Ý KỸ THUẬT QUAN TRỌNG (TECHNICAL GOTCHAS)

1. **Giới hạn thời gian 6 phút của Apps Script (6-minute Execution Limit)**:
   - Các hàm kéo dữ liệu đều đã được thiết kế phân trang (`limit: 500`), có sleep (`Utilities.sleep(200)`) tránh rate-limit.
   - Nếu chạy backfill lịch sử nhiều tháng, nên gọi `backfillDateRange(sinceStr, untilStr)` theo từng khoảng thời gian (khoảng 15-30 ngày/lần).
2. **Cơ chế Tự phục hồi dữ liệu (Self-healing 7-day Rolling Window)**:
   - Meta có độ trễ ghi nhận chuyển đổi (conversions attribution) trong vòng 7 ngày. Vì vậy hệ thống tự động xóa và nạp lại dữ liệu 7 ngày gần nhất mỗi đêm, tránh hiện tượng lệch số liệu cũ.
3. **Bảo mật Access Token**:
   - File `apps-script/Config.gs` hiện đang chứa token thật của tài khoản quảng cáo.
   - **LƯU Ý**: Không đẩy file `Config.gs` này lên các public repository trên GitHub để tránh lộ thông tin và bị khóa token.

---
*(Tài liệu này được tạo tự động bởi Antigravity để đồng bộ trạng thái làm việc giữa các môi trường)*
