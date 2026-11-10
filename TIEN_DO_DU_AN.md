# BÁO CÁO TIẾN ĐỘ DỰ ÁN & BỐI CẢNH HIỆN TẠI (PROJECT STATUS)
> **Dự án**: Meta Ads Dashboard (Hệ thống Báo cáo & Dashboard Tự động Meta Ads)  
> **Cập nhật lần cuối**: 10/11/2026 (23:55 GMT+7) — Commit gần nhất: `0cb61dd` (`main`), kèm chỉnh sửa UI chưa commit tại `index.html` & `apps-script/Dashboard.html`  
> **Deployment GAS hiện tại**: `@12` (`AKfycbwiUrrO-wOlSQ8V-_6curECLrd7-n339lcJLhAwK6AUfQwzvxWeDgNYj4Xaq765-9uZ`)  
> **Mục đích tài liệu**: Tóm tắt toàn bộ bối cảnh, kiến trúc kỹ thuật, tiến độ đã hoàn thành, trạng thái cấu hình `clasp`/deploy và các bước tiếp theo để khi mở dự án trên bất kỳ máy nào (nhà hoặc công ty), AI Agent (Antigravity) và lập trình viên có thể nắm bắt và tiếp tục công việc ngay lập tức.

---

## 1. TỔNG QUAN DỰ ÁN (PROJECT OVERVIEW)

### 1.1. Mục tiêu & Vấn đề giải quyết
- **Vấn đề**: Giao diện Meta Ads Manager thường load chậm, khó lọc sâu, không so sánh chéo linh hoạt giữa 4 tầng dữ liệu (*Campaign → Ad Set → Ad → Creative/Thumbnail*). Các công cụ BI trả phí (Supermetrics, Funnel, Tableau...) lại tốn chi phí định kỳ và phụ thuộc bên thứ ba.
- **Giải pháp**: Xây dựng hệ thống tự phục hồi (**self-healing pipeline**) hoàn toàn miễn phí, sử dụng **Google Apps Script** làm backend/ETL, **Google Sheets** làm cơ sở dữ liệu lưu trữ bền vững, và giao diện web **Single-Page Dashboard** tương tác trực quan (Vanilla HTML/CSS/JS + Chart.js) có xác thực & phân quyền theo từng tài khoản quảng cáo.
- **Quy mô hiện tại**: Hỗ trợ **9 tài khoản quảng cáo Meta Ads** đồng thời với hàng ngàn ad/ad set/campaign, engine **Async Backfill tự nối ca** vượt giới hạn 6 phút của GAS, hệ thống **Auth & RBAC** phân quyền theo từng Ad Account, và quy trình đồng bộ/deploy tự động qua **Google `clasp` CLI**.

---

## 2. KIẾN TRÚC HỆ THỐNG & LUỒNG DỮ LIỆU (ARCHITECTURE & DATA FLOW)

```
Meta Marketing API (v18.0)
       │ (Sync hàng ngày, 1-click syncDataCore / syncTatCaDuLieu,
       │  hoặc Async Insights Report cho Backfill dài ngày)
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Google Apps Script Pipelines (ETL & Async Layer)               │
│  - Config.gs             : Cấu hình 9 TKQC + Drive + OAuth ID   │
│  - DataPipeline.gs       : Kéo Campaign ("data - by day")       │
│  - AdSetPipeline.gs      : Kéo AdSet ("data - adset - by day")  │
│  - AdPipeline.gs         : Kéo Ad + Cache Creative Thumbnails   │
│  - BreakdownPipeline.gs  : Kéo Age, Gender, Platform, Placement,│
│                            Region                               │
│  - InsightsAsyncRunner.gs: Async Insights + Checkpoint +        │
│                            Auto-Resume Time Trigger             │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ (Ghi dữ liệu bền vững, tự động tạo & quản lý qua PropertiesService)
┌─────────────────────────────────────────────────────────────────┐
│  3 Google Spreadsheets (Lớp Cơ Sở Dữ Liệu)                     │
│  1. Meta Ads - Campaign Data ("test-fb", "data - by day",       │
│     và các sheet data_age/gender/platform/placement/region)     │
│  2. Meta Ads - AdSet Data    ("data - adset - by day")          │
│  3. Meta Ads - Ad & Creative Data ("data - ad...", cache)       │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ (Xác thực RBAC + Đọc, tổng hợp, tìm kiếm, chấm điểm Benchmark)
┌─────────────────────────────────────────────────────────────────┐
│  Backend Auth & API (Auth.gs + Code.gs)                         │
│  - Auth.gs : GAS Session 1-click, Google OAuth, Password SHA-256│
│              RBAC (SUPER_ADMIN / ADMIN), User Management        │
│  - Code.gs : getDashboardData(), getAdSetData(), getAdData(),   │
│              getBreakdownData(), getCustomReport(),             │
│              getTodayLiveSnapshot(), getPipelineFreshness()     │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ (HTML Service Web App — Deploy tự động qua clasp)
┌─────────────────────────────────────────────────────────────────┐
│  index.html / apps-script/Dashboard.html (Frontend 2.0 + RBAC)  │
│  - Màn hình đăng nhập + Tab Quản Trị User (Super Admin)         │
│  - Executive Performance Dashboard, Chart.js, Sparklines        │
│  - Searchable Multi-Select Filter Pickers (MULTI_PICKERS)       │
│  - Creative Heatmap Matrix, Micro Data Bars, VNĐ Format         │
│  - Tự động chạy chế độ Demo (9 TK + Demo Users) khi offline    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. THÔNG TIN CẤU HÌNH & TÀI NGUYÊN (RESOURCES & CONFIG)

Tất cả cấu hình chính được khai báo trong [`apps-script/Config.gs`](apps-script/Config.gs), [`apps-script/Auth.gs`](apps-script/Auth.gs) và [`package.json`](package.json):

1. **Meta Marketing API Token**:
   - Access Token của System User được khai báo trong `ACCESS_TOKEN` của [`apps-script/Config.gs`](apps-script/Config.gs) (Meta Graph API v18.0).
2. **Danh sách 9 Tài khoản quảng cáo (`AD_ACCOUNTS`)**:
   - `act_988452388193871`: Alpha 1 GMT +7 20tr - Hoa
   - `act_3863604326993604`: TKQC Alpha 2 GMT-7- Hoa
   - `act_140020454941995`: Alpha 5 GMT -7 - Tấn
   - `act_856434001679007`: Alpha 3 GMT-3 MKT AB - Thảo
   - `act_1855997818105694`: Alpha 6 - GMT -3 - Tấn
   - `act_542081774682636`: Alpha 7 - GMT-3 - HTXB - Phương
   - `act_848982799482573`: Alpha 8 - GMT-4 (11h) - MKT Sống
   - `act_2929843193813956`: TKQC MED - Alpha 10 GMT +7 (0h)
   - `act_1845118092714419`: TK 1 - MKT Alpha - Thảo
3. **Thư mục Google Drive lưu trữ 3 Sheet**:
   - `DRIVE_FOLDER_ID`: `1WjwUW-4iyNrLLZHfDF9fpooqHrZkSCJg`
4. **Cơ chế lưu trữ trạng thái trong `PropertiesService` & `CacheService`**:
   - Sheet IDs: `CAMPAIGN_SHEET_ID`, `ADSET_SHEET_ID`, `AD_SHEET_ID`
   - Auth & Sessions: `AUTH_USERS_V1`, `AUTH_SESSIONS_V1`, `AUTH_SESS_*` (Cache 6 giờ), `INITIAL_ALPHA_PASSWORD`, `GOOGLE_OAUTH_CLIENT_ID`
   - Async Backfill Checkpoint: `BACKFILL_ASYNC_JOB_STATE_V1`
5. **Cấu hình Google Apps Script (`clasp`)**:
   - `scriptId` ([`.clasp.json`](.clasp.json)): `1luxN_OzfyFCdWtUlc-ZcUm3sLqBO6dRo8sji30a_6cyHE5CsNf7h5h5k` (`rootDir`: `apps-script`)
   - `Deployment ID` ([`package.json`](package.json)): `AKfycbwiUrrO-wOlSQ8V-_6curECLrd7-n339lcJLhAwK6AUfQwzvxWeDgNYj4Xaq765-9uZ` (đã deploy tới `@12`)
   - Runtime ([`apps-script/appsscript.json`](apps-script/appsscript.json)): V8, timezone `Asia/Ho_Chi_Minh`, Web App (`executeAs: USER_DEPLOYING`, `access: ANYONE`).

---

## 4. TIẾN ĐỘ ĐÃ HOÀN THÀNH (COMPLETED WORK)

### A. Tái cấu trúc & Nâng cấp Hệ thống Đa Tài khoản (Multi-Account)
- [x] **`Config.gs`**:
  - Khai báo mảng `AD_ACCOUNTS` hỗ trợ 9 tài khoản quảng cáo kèm `shortName` và `color`.
  - Hàm `initSetupGoogleSheets()` tự tạo 3 Google Sheets trong thư mục Drive và lưu ID vào `PropertiesService`.
  - Hàm `fetchCampaignSettings(accountId)` hỗ trợ truyền ID từng tài khoản để lấy đúng objective, bid strategy và daily budget.
- [x] **`DataPipeline.gs` (Campaign Level)**:
  - Bổ sung 2 cột đầu tiên: `Account ID` và `Account Name` trong `CAMPAIGN_HEADERS_`.
  - Cập nhật `buildRowFromInsight_()` và `getCampaignSpreadsheet_()` lấy linh hoạt spreadsheet từ `PropertiesService`, tự động tạo sheet nếu chưa có (`test-fb`, `data - by day`).
- [x] **`AdSetPipeline.gs` (AdSet Level)**:
  - Bổ sung `Account ID`, `Account Name` vào header (`getAdSetHeaders_`).
  - Viết lại `fetchAdSetRows_()` duyệt qua toàn bộ tài khoản trong `AD_ACCOUNTS`, xử lý phân trang (`paging.next`) và chống rate-limit.
- [x] **`AdPipeline.gs` (Ad & Creative Level)**:
  - Bổ sung `Account ID`, `Account Name` vào header (`getAdHeaders_`).
  - Viết lại `fetchAdRows_()` duyệt qua toàn bộ tài khoản quảng cáo, phân giải ad creative, thumbnail, video, carousel.
- [x] **`BreakdownPipeline.gs` (Breakdowns cho Report Builder)**:
  - Đồng bộ 5 loại breakdown (`data_age`, `data_gender`, `data_platform`, `data_placement`, `data_region`) vào Campaign Spreadsheet.
- [x] **Kiểm thử cú pháp code (Syntax Validation)**:
  - `verify_adpipeline.js` (59 hàm) và `verify_adsetpipeline.js` (52 hàm) compile sạch không lỗi cú pháp JS; `check_missing.js` hỗ trợ rà soát tham chiếu hàm.

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
  - Bộ lọc nhanh 1-click: cả cụm nút `#campaignQuickFilters` (`applyQuickFilter`) và thanh động `#tableQuickFilterBar` (`setTableQuickFilter`) đều đã hoạt động đồng bộ.
  - Tab Ads tích hợp View Switcher: Heatmap Matrix Table kèm thumbnail zoom preview 200px khi hover và Visual Cards.
- [x] **Bản địa hóa & Format Chuẩn VNĐ**:
  - Hàm `formatVND()` hỗ trợ `Tr ₫`, `Tỷ ₫`, `K ₫` và đầy đủ `₫`.

### C. Hạ Tầng Deploy, Mở Rộng 9 Tài Khoản & Chống Quá Tải Meta API
- [x] **Thiết lập `clasp` CLI & Auto-Deploy (`fedaa96`, `bc326ec`)**:
  - Cấu hình `.clasp.json`, `.claspignore`, `apps-script/appsscript.json` và `package.json` (`push`, `deploy`, `sync`, `pull`, `status`, `deployments`, `login`).
- [x] **Mở rộng lên 9 Tài khoản & Chống Timeout Pipeline (`598965c`, `Config.gs`)**:
  - Thêm tài khoản thứ 9 `act_1845118092714419` (`TK 1 - MKT Alpha - Thảo`) vào `AD_ACCOUNTS`.
  - Thêm hàm `syncDataCore()` (Campaign → AdSet → Ad) và `syncTatCaDuLieu()` với bộ đếm an toàn `MAX_SAFE_MS = 250000` (4 phút 10 giây).
- [x] **Khắc phục Deprecation API v26.0+ & Lỗi Quá Tải `code: 1 / subcode: 99` (`5824e85`, `AdPipeline.gs`, `AdSetPipeline.gs`)**:
  - Thay thế `GET /?ids=...` trong `fetchAdsFastPathBatch_()` bằng `UrlFetchApp.fetchAll()` theo batch 20 ads.
  - Chia chunk chủ động 2 ngày, hạ limit `200 -> 100 -> 50`, fail-fast khi overload và ghi an toàn từng tài khoản (`partialOk`).

### D. Hệ Thống Xác Thực Đa Phương Thức & Phân Quyền RBAC Theo Tài Khoản (`8d56ae3`, `0cb61dd`)
- [x] **Backend Auth & User Management ([`apps-script/Auth.gs`](apps-script/Auth.gs) — 1.070 dòng)**:
  - **2 vai trò**: `SUPER_ADMIN` (`tanchuducbk@gmail.com`, quyền `['ALL']` + quản trị user) và `ADMIN` (seed sẵn tài khoản `alpha` giới hạn 4 tài khoản trong `AUTH_ALPHA_ACCOUNTS_`).
  - **3 phương thức đăng nhập**:
    1. *1-click Google Apps Script Session*: `getAuthConfig()` + `loginWithGasSession()` nhận diện `Session.getActiveUser().getEmail()`.
    2. *Google Sign-In (OAuth 2.0 ID Token)*: `loginWithGoogle(idToken)` xác thực token qua `oauth2.googleapis.com/tokeninfo` khi cấu hình `GOOGLE_OAUTH_CLIENT_ID`.
    3. *Username/Email & Mật khẩu*: `loginWithPassword()` băm SHA-256 + salt + `constantTimeEqual_()`, kèm hàm `setupAuthPasswords(superAdminPass, alphaPass)` để cài/đặt lại mật khẩu an toàn trong Apps Script Editor.
  - **Quản lý phiên & CRUD User**: Session TTL 6 giờ (`AUTH_SESSION_TTL_SECONDS_ = 21600`) lưu trên `CacheService` + `PropertiesService` kèm `LockService` (`withAuthLock_`); các API `adminListUsers`, `adminSaveUser`, `adminToggleUserStatus`, `adminResetUserPassword`, `changeOwnPassword`, `verifySession`, `logoutUser`.
- [x] **Áp đặt RBAC & Chuẩn hóa Ngày trên Mọi API Backend ([`apps-script/Code.gs`](apps-script/Code.gs))**:
  - Toàn bộ API đọc dữ liệu (`getDashboardData`, `getPipelineFreshness`, `getTodayLiveSnapshot`, `getBreakdownData`, `getCustomReport`, `getReportCampaigns`, `getAdSetData`, `getAdSetCampaigns`, `getAdSetBreakdownData`, `getAdData`) yêu cầu `requireAuth_` và lọc phạm vi qua `enforceAccountScope_` / `isRowAuthorizedForScope_`.
  - Bổ sung `buildCampaignAccountMap_()` ánh xạ ngược dữ liệu lịch sử chưa có cột `Account ID` về đúng tài khoản sở hữu, và chuẩn hóa parse ngày `dd/MM/yyyy` / `yyyy-MM-dd` trong `toDateString()` & `tsOf()`.
- [x] **Giao diện Đăng Nhập & Tab Quản Trị User (`index.html` & `apps-script/Dashboard.html`)**:
  - Màn hình đăng nhập `#authOverlay`, pill hồ sơ `#userProfilePill`, modal đổi mật khẩu và tab `#adminUsersNavTab` / `#adminUsersView` (tạo/sửa user, gán danh sách Ad Account, bật/tắt trạng thái, reset mật khẩu).
  - Bổ sung `DEMO_ALL_ACCOUNTS_` đủ **9 tài khoản** và `DEMO_USERS_DB_` để test đầy đủ cả ở chế độ Demo Offline.

### E. Engine Backfill Bất Đồng Bộ & Tự Nối Ca (`0cb61dd`, [`apps-script/InsightsAsyncRunner.gs`](apps-script/InsightsAsyncRunner.gs))
- [x] **Meta Async Insights Runner (`InsightsAsyncRunner.gs` — 904 dòng)**:
  - Sử dụng `POST /{act_id}/insights` tạo Async Report Job (`createMetaAsyncInsightJob_`) → poll trạng thái (`pollMetaAsyncInsightJob_`) → tải kết quả (`fetchMetaAsyncInsightPages_`), tránh lỗi timeout/overload `code 2 / subcode 1504044` và `code 1 / subcode 99`.
  - Tự chia đôi khoảng ngày (`asyncSplitRangeInHalf_`) khi job quá nặng; fallback đồng bộ (`fetchMetaSyncSingleDayFallback_`) nếu đã thu gọn xuống 1 ngày.
  - Giới hạn ca chạy 4 phút (`ASYNC_BACKFILL_SOFT_BUDGET_MS_ = 240000`), flush buffer định kỳ (`flushAsyncBackfillBuffer_`), lưu checkpoint vào `BACKFILL_ASYNC_JOB_STATE_V1`, và tự đặt Time-driven Trigger `continueAsyncBackfillJob` (1 phút, hoặc 5 phút nếu gặp rate-limit `80004/613`) cho tới khi hoàn tất 9/9 tài khoản rồi tự dọn trigger (`cleanupAsyncBackfillTriggers_`).
  - Hỗ trợ kiểm tra & hủy job qua `getAsyncBackfillStatus()` và `cancelAsyncBackfillJob()`.
- [x] **Tích hợp Async Runner & Xóa Scope Theo Tài Khoản vào Các Pipeline**:
  - **Campaign** (`DataPipeline.gs`): `backfillLast30Days()`, `backfillLast90Days()`, `backfillAllHistory_CampaignLevel()`, `backfillDateRange()` đều chuyển sang chạy qua `runAsyncBackfillJob_()`.
  - **AdSet** (`AdSetPipeline.gs`): `backfillAdSetHistory()`, `backfillAdSetData()`, `backfillRemainingAdSetData()` tích hợp `runAsyncBackfillJob_()`.
  - **Breakdown** (`BreakdownPipeline.gs`): `backfillBreakdownsCustomRange()`, `backfillLast30Days_Breakdowns()`, `backfillLast90Days_Breakdowns()` tích hợp `runAsyncBackfillJob_()`.
  - Các hàm dọn dữ liệu (`removeRowsInDateRange_`, `removeAdSetRowsInRange_`, `removeBreakdownRowsInRange_`) hỗ trợ tham số `accountIdSet` và so sánh ngày ISO để chỉ ghi đè đúng tài khoản đã kéo thành công.

### F. Bộ Lọc Đa Chọn Có Tìm Kiếm & Đồng Bộ File (Chưa Commit / Chưa Deploy sau 23:49)
- [x] **Backend hỗ trợ lọc đa chiến dịch (`0cb61dd`, `Code.gs`)**:
  - `getDashboardData()` hỗ trợ `filters.campaignNames` (mảng nhiều tên chiến dịch) và trả về `allCampaignMeta` (`{ name, accountName }`).
- [x] **Frontend Searchable Multi-Select Filter Pickers (`MULTI_PICKERS`, chưa commit)**:
  - Thay thế các ô tìm kiếm/dropdown đơn lẻ bằng bộ chọn đa mục kèm tìm kiếm không dấu tiếng Việt (`foldVi_`), chọn tất cả, xóa chọn, Enter chọn khớp:
    - Tab Chiến dịch: `#campPickerGroup`
    - Tab Nhóm QC: `#adsetCampaignFilterGroup`, `#adsetNamePickerGroup`
    - Tab Mẫu QC: `#adsCampPickerGroup`, `#adsAdSetPickerGroup`, `#adsNamePickerGroup`
    - Tab Report Builder: `#reportCampPickerGroup`
- [x] **Kiểm tra đồng bộ Frontend**:
  - `index.html` và `apps-script/Dashboard.html` hiện **giống nhau 100%** (SHA-256: `2BFEC74148B5D4D44065D8E29A112BFFB3B3009281BEE4266BC27707C68AD213`).

---

## 5. CÁC BƯỚC TRIỂN KHAI & VẬN HÀNH TIẾP THEO (NEXT STEPS)

### Bước 1: Commit Git & Deploy bản UI `MULTI_PICKERS` lên GAS
Hiện tại `index.html` và `apps-script/Dashboard.html` đang có chỉnh sửa mới (lúc 23:49) chưa commit và chưa push lên deployment `@12`. Chạy tuần tự trên PowerShell (dùng `npm.cmd`):
```powershell
npm.cmd run sync
npm.cmd run deployments
```
Sau đó kiểm tra `git status` và commit các file thay đổi lên Git.

### Bước 2: Thiết lập Auth & Google Sign-In (Nếu chưa cấu hình lần đầu)
1. Mở Apps Script Editor (Project ID: `1luxN_OzfyFCdWtUlc-ZcUm3sLqBO6dRo8sji30a_6cyHE5CsNf7h5h5k`), chọn file `Auth.gs` và chạy 1 lần hàm `setupAuthPasswords('mat_khau_super_admin', 'mat_khau_alpha')` (hoặc tạo Script Property `INITIAL_ALPHA_PASSWORD`).
2. Đăng nhập trên Web App bằng **1-click Google Apps Script Session** (nếu trình duyệt đang đăng nhập `tanchuducbk@gmail.com`) hoặc **Username/Password**.
3. *(Tùy chọn)* Nếu muốn bật nút Google Sign-In cho domain ngoài GAS, tạo OAuth 2.0 Web Client ID và lưu vào Script Property `GOOGLE_OAUTH_CLIENT_ID` (hoặc biến `GOOGLE_OAUTH_CLIENT_ID` trong `Config.gs`).

### Bước 3: Khởi tạo Sheets & Đồng bộ / Backfill Dữ Liệu
- **Khởi tạo 3 Sheets (chỉ 1 lần)**: Chạy `initSetupGoogleSheets()` trong `Config.gs` (bỏ qua nếu đã có ID trong Script Properties).
- **Đồng bộ hàng ngày / thủ công**:
  - Kéo nhanh 3 tầng cốt lõi: `syncDataCore()` trong `Config.gs`.
  - Kéo toàn bộ 5 bước: `syncTatCaDuLieu()` (nếu chạm ngưỡng 4 phút 10 giây, chạy tiếp `importAdCreatives()` / `importBreakdownData()`).
- **Backfill lịch sử dài ngày (tự động nối ca)**:
  - Campaign 30/90 ngày hoặc toàn bộ: `backfillLast30Days()`, `backfillLast90Days()`, `backfillAllHistory_CampaignLevel()` trong `DataPipeline.gs`.
  - AdSet / Breakdown: `backfillAdSetData()`, `backfillAdSetHistory()`, `backfillLast30Days_Breakdowns()`, `backfillLast90Days_Breakdowns()`.
  - Theo dõi tiến độ bằng `getAsyncBackfillStatus()` hoặc dừng chủ động bằng `cancelAsyncBackfillJob()`.

### Bước 4: Duy trì Triggers chạy tự động hàng ngày
Trong mục **Triggers** của Apps Script, đảm bảo có các trigger hàng ngày (khung giờ đêm GMT+7):
- `copyDataOnceADay` (1:00–2:00 AM — overwrite rolling 7 ngày cho Campaign)
- `importAdSetData` (2:00–3:00 AM)
- `importAdData` (3:00–4:00 AM)
- `importAdCreatives` (4:00–5:00 AM)
- `importBreakdownData` (5:00–6:00 AM — nếu sử dụng Report Builder)

### Bước 5: Việc cần kiểm nghiệm & cải thiện tiếp (Pending Items)
- [ ] Push bản UI `MULTI_PICKERS` mới nhất lên Google Apps Script (`npm.cmd run sync`) và commit git các thay đổi đang chờ (`index.html`, `apps-script/Dashboard.html`, `TIEN_DO_DU_AN.md`).
- [ ] Kiểm thử thực tế các luồng trên GAS Web App:
  - Đăng nhập RBAC (Super Admin thấy 9/9 TK & tab Quản Trị User; user `alpha` chỉ thấy 4 TK được cấp).
  - Bộ lọc `MULTI_PICKERS` đa chọn trên cả 4 tab (Chiến dịch, Nhóm QC, Mẫu QC, Report Builder).
  - Chạy thử 1 lệnh Async Backfill (`backfillLast30Days()` hoặc `backfillAdSetData()`) để xác nhận trigger `continueAsyncBackfillJob` tự nối ca và tự dọn sau khi hoàn tất.
- [ ] Kiểm tra log chạy thực tế cho tài khoản thứ 9 (`act_1845118092714419`) và `fetchAdsFastPathBatch_()` (`UrlFetchApp.fetchAll`).
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
│   ├── Config.gs                 # Cấu hình: Token, 9 tài khoản, Drive Folder, OAuth ID, sync
│   ├── Config.example.gs         # File mẫu cấu hình ban đầu (ignored bởi clasp)
│   ├── Auth.gs                   # Xác thực đa phương thức, Session, RBAC & User Management
│   ├── Code.gs                   # Backend Web App: API có bảo vệ RBAC, tìm kiếm, scoring
│   ├── DataPipeline.gs           # Pipeline kéo dữ liệu cấp Campaign
│   ├── AdSetPipeline.gs          # Pipeline kéo dữ liệu cấp Ad Set
│   ├── AdPipeline.gs             # Pipeline kéo dữ liệu cấp Ad + Cache Creative Thumbnails
│   ├── BreakdownPipeline.gs      # Pipeline kéo Breakdown (Age, Gender, Platform, Placement, Region)
│   ├── InsightsAsyncRunner.gs    # Engine Async Backfill + Checkpoint + Auto-Resume Trigger
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
2. **Bảo mật Auth & Mật khẩu mặc định (`Auth.gs`)**:
   - User `alpha` nếu chưa cấu hình `INITIAL_ALPHA_PASSWORD` sẽ sinh mật khẩu ngẫu nhiên lần đầu và ghi vào Apps Script Logger. Chạy `setupAuthPasswords(...)` để chủ động đặt mật khẩu cho `tanchuducbk@gmail.com` và `alpha`.
   - `SUPER_ADMIN` cuối cùng đang hoạt động không thể tự vô hiệu hóa hoặc hạ quyền chính mình (được bảo vệ trong `Auth.gs`).
3. **Giới hạn thời gian 6 phút của Google Apps Script**:
   - `syncTatCaDuLieu()` dùng `MAX_SAFE_MS = 250000` (4 phút 10 giây); `InsightsAsyncRunner.gs` dùng `ASYNC_BACKFILL_SOFT_BUDGET_MS_ = 240000` (4 phút) và tự nối ca bằng trigger.
   - Khi chạy Async Backfill, không tạo thủ công nhiều trigger trùng tên `continueAsyncBackfillJob` vì runner tự quản lý và dọn trigger khi xong.
4. **Cơ chế Tự phục hồi dữ liệu (Self-healing 7-day Rolling Window)**:
   - Hệ thống tự động xóa và nạp lại dữ liệu 7 ngày gần nhất mỗi đêm để khớp cửa sổ attribution trễ của Meta.
5. **Đồng bộ hai file Frontend (`index.html` ↔ `apps-script/Dashboard.html`)**:
   - Khi sửa UI, luôn phải giữ `index.html` (phục vụ GitHub Pages / offline demo) và `apps-script/Dashboard.html` (phục vụ Google Apps Script Web App) giống nhau hoàn toàn trước khi chạy `npm.cmd run sync`.
6. **PowerShell trên Windows**:
   - Nếu `npm` / `npx` bị chặn bởi Execution Policy (`npm.ps1 cannot be loaded`), luôn dùng `npm.cmd` / `npx.cmd`.

---
*(Tài liệu được cập nhật đồng bộ với trạng thái thực tế của mã nguồn tại commit `0cb61dd` và thay đổi working tree ngày 10/11/2026)*
