# BÁO CÁO TIẾN ĐỘ DỰ ÁN & BỐI CẢNH HIỆN TẠI (PROJECT STATUS)
> **Dự án**: Meta Ads Dashboard (Hệ thống Báo cáo & Dashboard Tự động Meta Ads)  
> **Cập nhật lần cuối**: 10/11/2026 (21:30 GMT+7) — Commit gần nhất: `5824e85` (`main`)  
> **Mục đích tài liệu**: Tóm tắt toàn bộ bối cảnh, kiến trúc kỹ thuật, tiến độ đã hoàn thành, trạng thái cấu hình `clasp`/deploy và các bước tiếp theo để khi mở dự án trên bất kỳ máy nào (nhà hoặc công ty), AI Agent (Antigravity) và lập trình viên có thể nắm bắt và tiếp tục công việc ngay lập tức.

---

## 1. TỔNG QUAN DỰ ÁN (PROJECT OVERVIEW)

### 1.1. Mục tiêu & Vấn đề giải quyết
- **Vấn đề**: Giao diện Meta Ads Manager thường load chậm, khó lọc sâu, không so sánh chéo linh hoạt giữa 4 tầng dữ liệu (*Campaign → Ad Set → Ad → Creative/Thumbnail*). Các công cụ BI trả phí (Supermetrics, Funnel, Tableau...) lại tốn chi phí định kỳ và phụ thuộc bên thứ ba.
- **Giải pháp**: Xây dựng hệ thống tự phục hồi (**self-healing pipeline**) hoàn toàn miễn phí, sử dụng **Google Apps Script** làm backend/ETL, **Google Sheets** làm cơ sở dữ liệu lưu trữ bền vững, và giao diện web **Single-Page Dashboard** tương tác trực quan (Vanilla HTML/CSS/JS + Chart.js).
- **Quy mô hiện tại**: Đã mở rộng backend để hỗ trợ **9 tài khoản quảng cáo Meta Ads** đồng thời với hàng ngàn ad/ad set/campaign, kèm quy trình đồng bộ & deploy tự động qua **Google `clasp` CLI**.

---

## 2. KIẾN TRÚC HỆ THỐNG & LUỒNG DỮ LIỆU (ARCHITECTURE & DATA FLOW)

```
Meta Marketing API (v18.0)
       │ (Tự động theo lịch, 1-click syncDataCore / syncTatCaDuLieu)
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Google Apps Script Pipelines (ETL Layer)                   │
│  - Config.gs            : Cấu hình 9 tài khoản + Drive      │
│  - DataPipeline.gs      : Kéo Campaign ("data - by day")    │
│  - AdSetPipeline.gs     : Kéo AdSet ("data - adset...")     │
│  - AdPipeline.gs        : Kéo Ad + Cache Creative Thumbnails│
│  - BreakdownPipeline.gs : Kéo Age, Gender, Platform,        │
│                           Placement, Region                 │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (Ghi dữ liệu bền vững, tự động tạo & quản lý qua PropertiesService)
┌─────────────────────────────────────────────────────────────┐
│  3 Google Spreadsheets (Lớp Cơ Sở Dữ Liệu)                 │
│  1. Meta Ads - Campaign Data ("test-fb", "data - by day",   │
│     và các sheet data_age/gender/platform/placement/region) │
│  2. Meta Ads - AdSet Data    ("data - adset - by day")      │
│  3. Meta Ads - Ad & Creative Data ("data - ad...", cache)   │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (Đọc, tổng hợp, tìm kiếm đa trường, chấm điểm Benchmark)
┌─────────────────────────────────────────────────────────────┐
│  Code.gs (Apps Script Web App Backend)                      │
│  - getDashboardData(), getAdSetData(), getAdData()          │
│  - getBreakdownData(), getCustomReport(), getTodayLive...() │
│  - Chấm điểm hiệu quả ad (Poor / Average / Good / Excellent)│
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (HTML Service Web App — Deploy tự động qua clasp)
┌─────────────────────────────────────────────────────────────┐
│  index.html / apps-script/Dashboard.html (Frontend 2.0)     │
│  - Executive Performance Dashboard, Chart.js, Sparklines    │
│  - Creative Heatmap Matrix, Micro Data Bars, VNĐ Format     │
│  - Tự động chạy chế độ Fake Data Demo nếu chạy offline      │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. THÔNG TIN CẤU HÌNH & TÀI NGUYÊN (RESOURCES & CONFIG)

Tất cả cấu hình chính được khai báo trong [`apps-script/Config.gs`](apps-script/Config.gs) và [`package.json`](package.json):

1. **Meta Marketing API Token**:
   - Access Token của System User đã được cấu hình sẵn trong `ACCESS_TOKEN` (Meta Graph API v18.0).
2. **Danh sách 9 Tài khoản quảng cáo được phân quyền (`AD_ACCOUNTS`)**:
   - `act_988452388193871`: Alpha 1 GMT +7 20tr - Hoa
   - `act_3863604326993604`: TKQC Alpha 2 GMT-7- Hoa
   - `act_140020454941995`: Alpha 5 GMT -7 - Tấn
   - `act_856434001679007`: Alpha 3 GMT-3 MKT AB - Thảo
   - `act_1855997818105694`: Alpha 6 - GMT -3 - Tấn
   - `act_542081774682636`: Alpha 7 - GMT-3 - HTXB - Phương
   - `act_848982799482573`: Alpha 8 - GMT-4 (11h) - MKT Sống
   - `act_2929843193813956`: TKQC MED - Alpha 10 GMT +7 (0h)
   - `act_1845118092714419`: TK 1 - MKT Alpha - Thảo *(mới bổ sung)*
3. **Thư mục Google Drive lưu trữ 3 Sheet**:
   - `DRIVE_FOLDER_ID`: `1WjwUW-4iyNrLLZHfDF9fpooqHrZkSCJg`
4. **Cơ chế lưu trữ ID Sheet**:
   - Lưu trữ tự động trong `PropertiesService.getScriptProperties()` với 3 khóa:
     - `CAMPAIGN_SHEET_ID`
     - `ADSET_SHEET_ID`
     - `AD_SHEET_ID`
5. **Cấu hình Google Apps Script (`clasp`)**:
   - `scriptId` ([`.clasp.json`](.clasp.json)): `1luxN_OzfyFCdWtUlc-ZcUm3sLqBO6dRo8sji30a_6cyHE5CsNf7h5h5k` (`rootDir`: `apps-script`)
   - `Deployment ID` ([`package.json`](package.json)): `AKfycbwiUrrO-wOlSQ8V-_6curECLrd7-n339lcJLhAwK6AUfQwzvxWeDgNYj4Xaq765-9uZ`
   - Runtime ([`apps-script/appsscript.json`](apps-script/appsscript.json)): V8, timezone `Asia/Ho_Chi_Minh`, Web App (`executeAs: USER_DEPLOYING`, `access: ANYONE`).

---

## 4. TIẾN ĐỘ ĐÃ HOÀN THÀNH (COMPLETED WORK)

### A. Tái cấu trúc & Nâng cấp Hệ thống Đa Tài khoản (Multi-Account)
- [x] **`Config.gs`**:
  - Khai báo mảng `AD_ACCOUNTS` hỗ trợ đa tài khoản (hiện tại đã nâng lên 9 tài khoản).
  - Hàm `initSetupGoogleSheets()` tự tạo 3 Google Sheets trong thư mục Drive và lưu ID vào `PropertiesService`.
  - Hàm `fetchCampaignSettings(accountId)` hỗ trợ truyền ID từng tài khoản để lấy đúng objective, bid strategy và daily budget.
- [x] **`DataPipeline.gs` (Campaign Level)**:
  - Bổ sung 2 cột đầu tiên: `Account ID` và `Account Name` trong `CAMPAIGN_HEADERS_`.
  - Cập nhật `buildRowFromInsight_()` và `getCampaignSpreadsheet_()` để lấy linh hoạt spreadsheet từ `PropertiesService`, tự động tạo sheet nếu chưa có (`test-fb`, `data - by day`).
- [x] **`AdSetPipeline.gs` (AdSet Level)**:
  - Bổ sung `Account ID`, `Account Name` vào header (`getAdSetHeaders_`).
  - Viết lại `fetchAdSetRows_()` duyệt qua toàn bộ tài khoản trong `AD_ACCOUNTS`, xử lý phân trang (`paging.next`) và chống rate-limit.
- [x] **`AdPipeline.gs` (Ad & Creative Level)**:
  - Bổ sung `Account ID`, `Account Name` vào header (`getAdHeaders_`).
  - Viết lại `fetchAdRows_()` duyệt qua toàn bộ tài khoản quảng cáo, phân giải ad creative, thumbnail, video, carousel.
- [x] **`BreakdownPipeline.gs` (Breakdowns cho Report Builder)**:
  - Đồng bộ 5 loại breakdown (`data_age`, `data_gender`, `data_platform`, `data_placement`, `data_region`) vào Campaign Spreadsheet.
- [x] **Kiểm thử cú pháp code (Syntax Validation)**:
  - Các script Node.js (`verify_adpipeline.js`, `verify_adsetpipeline.js`, `check_missing.js`) đã được bổ sung; `AdPipeline.gs` và `AdSetPipeline.gs` compile sạch không lỗi cú pháp JS.

### B. Nâng Cấp Toàn Diện Giao Diện UI/UX 2.0 (Executive Performance Dashboard)
- [x] **Hệ thống Thiết kế & CSS Design System (`index.html` & `apps-script/Dashboard.html`)**:
  - Font Inter + `font-feature-settings: "tnum"` cho số liệu tài chính.
  - Bảng màu Slate (`--slate-50` đến `--slate-900`), Meta Blue (`#0064E0`), Emerald (`#10B981`), Amber (`#F59E0B`), Crimson (`#EF4444`).
- [x] **Tầng 1 - Executive Narrative Storyline & Account Allocation Bar**:
  - `renderNarrativeSummary()`: tự động phân tích và sinh câu kết luận điều hành.
  - `renderAccountAllocation()`: thanh phân bổ ngân sách đa tài khoản kèm tooltip hover.
- [x] **Tầng 2 - Thẻ KPI Phễu Toàn Diện (Full-Funnel) & Canvas Sparklines**:
  - 3 tầng phễu: Top Funnel (Spend, Impr, Reach, Frequency) → Mid Funnel (Clicks, CTR, CPC, CPM) → Bottom Funnel (Purchases, CPA, Value, ROAS).
  - Mini Sparklines Canvas 2D, so sánh kép (Dual Delta), và huy hiệu cảnh báo bão hòa tệp (Fatigue Badge) / áp lực đấu giá.
- [x] **Tầng 3 - Bộ 4 Biểu Đồ Media Buying Suite (Chart.js)**:
  - `trendChart` (Chi tiêu vs ROAS & Doanh thu), `auctionPressureChart` (Impressions vs CPM), `trafficEfficiencyChart` (Clicks vs CPC), `distributionChart` (Phân bổ đa tài khoản & mục tiêu).
- [x] **Tầng 4 & 5 - In-Cell Micro Data Bars, Heatmap Shading & Creative Matrix**:
  - Cột Chi tiêu và Doanh số tích hợp thanh đo tỷ lệ phần trăm (Micro Data Bars).
  - Cột ROAS, CPA, CTR tô màu nhiệt (Heatmap Shading).
  - Bộ lọc nhanh 1-click (`setTableQuickFilter` trong `#tableQuickFilterBar`).
  - Tab Ads tích hợp View Switcher: Heatmap Matrix Table kèm thumbnail zoom preview 200px khi hover và Visual Cards.
- [x] **Bản địa hóa, Format Chuẩn VNĐ & Đồng bộ File**:
  - Hàm `formatVND()` hỗ trợ `Tr ₫`, `Tỷ ₫`, `K ₫` và đầy đủ `₫`.
  - `index.html` và `apps-script/Dashboard.html` đã đồng bộ 100% (trùng mã hash SHA-256).

### C. Cập Nhật Hạ Tầng Deploy, Mở Rộng 9 Tài Khoản & Tối Ưu API (Chiều 10/11/2026)
- [x] **Thiết lập `clasp` CLI & Auto-Deploy (`fedaa96`, `bc326ec`)**:
  - Cấu hình `.clasp.json`, `.claspignore`, `apps-script/appsscript.json` và `package.json` (`npm run push`, `npm run deploy`, `npm run sync`, `npm run pull`, `npm run status`).
- [x] **Mở rộng lên 9 Tài khoản & Chống Timeout Pipeline (`598965c`, `Config.gs`)**:
  - Thêm tài khoản thứ 9 `act_1845118092714419` (`TK 1 - MKT Alpha - Thảo`) vào `AD_ACCOUNTS`.
  - Thêm hàm `syncDataCore()` chạy riêng 3 tầng cốt lõi (Campaign → AdSet → Ad) trong ~2-3 phút.
  - Nâng cấp `syncTatCaDuLieu()` thêm bộ đếm thời gian `MAX_SAFE_MS = 250000` (4 phút 10 giây) để tự dừng an toàn trước ngưỡng 6 phút của Apps Script và hướng dẫn chạy tiếp `importAdCreatives()` / `importBreakdownData()`.
- [x] **Nâng cấp Tìm kiếm Đa Trường (`598965c`, `Code.gs`)**:
  - Cập nhật `filters.search` trong `getDashboardData()`, `getAdSetData()`, `getAdData()` hỗ trợ tìm kiếm chéo theo tên Ad/AdSet/Campaign, tên Tài khoản, Account ID và Objective.
- [x] **Khắc phục Deprecation API v26.0+ trong Fast-Path Creative (`5824e85`, `AdPipeline.gs`)**:
  - Thay thế endpoint `GET /?ids=...` (đã deprecated trên Graph API v26.0+) trong `fetchAdsFastPathBatch_()` bằng `UrlFetchApp.fetchAll()` gọi song song trực tiếp từng node `/{ad_id}?fields=...` theo batch 20 ads.
- [x] **Tài liệu & Agent Skills (`598965c`)**:
  - Bổ sung `KE_HOACH_NANG_CAP_UI_UX.md` và cài đặt local skills `.agents/skills/ui-ux` + `.agents/skills/ui-ux-pro-max`.
- [x] **Fix lỗi quá tải Meta API `code: 1 / subcode: 99` ở tầng Ad & Deploy lên GAS (`@7` — 22:10 10/11/2026)**:
  - Nâng cấp `AdSetPipeline.gs` (`isQueryOverloadMetaError_`, `fetchWithRetry_` hỗ trợ `failFastOnOverload` & `deadlineMs`).
  - Nâng cấp `AdPipeline.gs` (`fetchAdRowsForAccount_`, `importAdDataCore_`, `removeAdRowsInRange_`) chia chunk chủ động 2 ngày, hạ limit `200 -> 100 -> 50`, tự động chia nhỏ khi gặp `code: 1 / subcode: 99` và ghi an toàn từng tài khoản (`partialOk`).
  - Cập nhật `Config.gs` (`syncDataCore`, `syncTatCaDuLieu`) truyền soft deadline vào `importAdDataWithBudget_`.
  - Đã xác thực `clasp` trên máy (`tanchuducbk@gmail.com`) và push/deploy 8 file lên Google Apps Script thành công (`Deployed ... @7`).

---

## 5. CÁC BƯỚC TRIỂN KHAI & VẬN HÀNH TIẾP THEO (NEXT STEPS)

Khi mở dự án trên máy mới hoặc tiếp tục phát triển, thực hiện theo quy trình chuẩn sau:

### Bước 1: Đồng bộ & Deploy code lên Google Apps Script bằng `clasp`
1. Kiểm tra đăng nhập `clasp` (nếu mở trên máy mới lần đầu — trên Windows PowerShell dùng `npm.cmd` nếu `npm.ps1` bị chặn Execution Policy):
   ```bash
   npm.cmd run login
   npm.cmd run status
   ```
2. Mỗi khi chỉnh sửa file trong `apps-script/` (lưu ý nếu sửa UI thì nhớ đồng bộ cả `index.html` và `apps-script/Dashboard.html`), chạy lệnh 1-click để push & cập nhật Web App deployment:
   ```bash
   npm.cmd run sync
   ```

### Bước 2: Khởi tạo Google Sheets (Chỉ chạy 1 lần nếu chưa từng setup)
1. Mở Apps Script Editor tại [script.google.com](https://script.google.com/) (Project ID: `1luxN_OzfyFCdWtUlc-ZcUm3sLqBO6dRo8sji30a_6cyHE5CsNf7h5h5k`).
2. Trong `Config.gs`, chọn hàm **`initSetupGoogleSheets`** → bấm **Run** và cấp quyền Drive/Sheets (bỏ qua nếu 3 Sheet ID đã có trong Script Properties).

### Bước 3: Đồng bộ dữ liệu (Initial / Manual Data Pull)
- **Kéo nhanh dữ liệu cốt lõi (khuyên dùng)**: Chạy `syncDataCore()` trong `Config.gs` (chạy Campaign → AdSet → Ad cho cả 9 tài khoản).
- **Kéo toàn bộ 5 bước**: Chạy `syncTatCaDuLieu()`. Nếu chạm ngưỡng an toàn 4 phút 10 giây, hệ thống sẽ tự dừng và log nhắc chạy tiếp thủ công:
  - `importAdCreatives()` (tự động resume từ trang dừng trước đó)
  - `importBreakdownData()` (Age, Gender, Platform, Placement, Region)

### Bước 4: Kiểm tra & Duy trì Triggers chạy tự động hàng ngày
Trong mục **Triggers** của Apps Script, đảm bảo có các trigger hàng ngày (khung giờ đêm GMT+7):
- `copyDataOnceADay` (1:00–2:00 AM — overwrite rolling 7 ngày cho Campaign)
- `importAdSetData` (2:00–3:00 AM)
- `importAdData` (3:00–4:00 AM)
- `importAdCreatives` (4:00–5:00 AM)
- `importBreakdownData` (5:00–6:00 AM — nếu sử dụng Report Builder)

### Bước 5: Kiểm nghiệm thực tế & Việc cần làm tiếp (Pending Items)
- [ ] Kiểm tra log chạy thực tế trên Apps Script cho tài khoản thứ 9 (`act_1845118092714419`) và hàm `fetchAdsFastPathBatch_()` mới sửa (`UrlFetchApp.fetchAll`).
- [ ] Cập nhật `DEMO_ACCOUNTS` trong `index.html` / `apps-script/Dashboard.html` thêm tài khoản thứ 9 nếu muốn chế độ Offline Demo phản ánh đủ 9 tài khoản.
- [ ] Dọn dẹp cụm nút tĩnh `#campaignQuickFilters` trong `index.html` / `apps-script/Dashboard.html` (hiện đang gọi `applyQuickFilter` chưa định nghĩa, trong khi thanh lọc hoạt động thực tế là `#tableQuickFilterBar` gọi `setTableQuickFilter`).
- [ ] Rà soát bảo mật `ACCESS_TOKEN` trong `apps-script/Config.gs` (xem mục 7).

---

## 6. DANH MỤC FILE TRONG DỰ ÁN (FILE STRUCTURE)

```
meta-ads-dashboard/
├── TIEN_DO_DU_AN.md              # File này: Tổng quan tiến độ, bối cảnh & hướng dẫn
├── KE_HOACH_NANG_CAP_UI_UX.md    # Đặc tả thiết kế & lộ trình UI/UX 2.0
├── README.md                     # Tài liệu tiếng Anh gốc của repository
├── package.json                  # npm scripts push/deploy/sync qua @google/clasp
├── .clasp.json                   # Cấu hình scriptId Apps Script & rootDir: apps-script
├── .claspignore                  # Loại trừ Config.example.gs khi push lên GAS
├── index.html                    # Giao diện Dashboard chính (hỗ trợ cả GitHub Pages Demo)
├── apps-script/
│   ├── appsscript.json           # Manifest Apps Script (V8, Asia/Ho_Chi_Minh, Web App)
│   ├── Config.gs                 # Cấu hình: Token, 9 tài khoản, Drive Folder, initSetup, sync
│   ├── Config.example.gs         # File mẫu cấu hình ban đầu (ignored bởi clasp)
│   ├── Code.gs                   # Backend Web App: API đọc dữ liệu, tìm kiếm đa trường, scoring
│   ├── DataPipeline.gs           # Pipeline kéo dữ liệu cấp Campaign
│   ├── AdSetPipeline.gs          # Pipeline kéo dữ liệu cấp Ad Set
│   ├── AdPipeline.gs             # Pipeline kéo dữ liệu cấp Ad + Cache Creative Thumbnails
│   ├── BreakdownPipeline.gs      # Pipeline kéo Breakdown (Age, Gender, Platform, Placement, Region)
│   └── Dashboard.html            # Bản đồng bộ 100% của index.html dùng khi deploy GAS Web App
├── .agents/skills/               # Local agent skills (ui-ux, ui-ux-pro-max)
├── check_missing.js              # Script Node.js kiểm tra tham chiếu hàm
├── verify_adpipeline.js          # Script Node.js kiểm tra cú pháp AdPipeline.gs
└── verify_adsetpipeline.js       # Script Node.js kiểm tra cú pháp AdSetPipeline.gs
```

---

## 7. CÁC LƯU Ý KỸ THUẬT & BẢO MẬT QUAN TRỌNG (GOTCHAS)

1. **Bảo mật Access Token (`Config.gs`) — LƯU Ý CAO**:
   - File `apps-script/Config.gs` hiện đang chứa `ACCESS_TOKEN` thật của System User và đã được commit trong lịch sử git.
   - Đảm bảo repository GitHub giữ ở chế độ **Private** (hoặc chuyển `ACCESS_TOKEN` vào `PropertiesService.getScriptProperties()` và rotate token mới nếu có ý định public repo).
2. **Giới hạn thời gian 6 phút của Google Apps Script**:
   - Đã có cơ chế ngắt an toàn `MAX_SAFE_MS = 250000` trong `syncTatCaDuLieu()` và chế độ chạy riêng `syncDataCore()`.
   - Khi backfill dữ liệu lịch sử nhiều tháng, vẫn nên gọi `backfillDateRange(sinceStr, untilStr)` theo từng khoảng 15–30 ngày/lần.
3. **Cơ chế Tự phục hồi dữ liệu (Self-healing 7-day Rolling Window)**:
   - Hệ thống tự động xóa và nạp lại dữ liệu 7 ngày gần nhất mỗi đêm để khớp cửa sổ attribution trễ của Meta.
4. **Đồng bộ hai file Frontend (`index.html` ↔ `apps-script/Dashboard.html`)**:
   - Khi sửa UI, luôn phải giữ `index.html` (phục vụ GitHub Pages / offline demo) và `apps-script/Dashboard.html` (phục vụ Google Apps Script Web App) giống nhau hoàn toàn trước khi chạy `npm run sync`.
5. **Điểm kỹ thuật nhỏ đã ghi nhận ở Frontend**:
   - `DEMO_ACCOUNTS` trong `index.html` hiện mới khai báo 8 tài khoản demo (tài khoản thứ 9 mới chỉ có ở backend `Config.gs`).
   - Cụm nút tĩnh `#campaignQuickFilters` gọi `applyQuickFilter(...)` chưa tồn tại, còn thanh lọc động `#tableQuickFilterBar` gọi `setTableQuickFilter(...)` đang hoạt động bình thường.

---
*(Tài liệu được cập nhật đồng bộ với trạng thái thực tế của mã nguồn tại commit `5824e85`)*
