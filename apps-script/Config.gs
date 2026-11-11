/**
 * Config.gs — Cấu hình đa tài khoản Meta Ads và Google Drive
 */

var ACCESS_TOKEN = 'EAAOhgsUSolIBS6ke3vNsxPjH2K4peyf4Mm2THErTUcRQxCw6pJhQl5mGQy3Vy8oQjQvohIXLrb5FRHesEfZAoLUDWiZCIzX5VsvVOWCAPks2RjLraLbr3szthrMHCJVoMwoe1erU3ZAG6SZBxLYXXyPcYKamZAW4JpvOVBzTZAZBaeIpqTfTqzrxiQ1ClAJLZB0CxwZDZD';

// Danh sách 9 tài khoản quảng cáo được phân quyền từ System User
var AD_ACCOUNTS = [
  { id: 'act_988452388193871',  name: 'Alpha 1 GMT +7 20tr - Hoa',        shortName: 'Alpha 1 (Hoa)',    color: '#0064E0' },
  { id: 'act_3863604326993604', name: 'TKQC Alpha 2 GMT-7- Hoa',          shortName: 'Alpha 2 (Hoa)',    color: '#0866FF' },
  { id: 'act_140020454941995',  name: 'Alpha 5 GMT -7 - Tấn',             shortName: 'Alpha 5 (Tấn)',    color: '#10B981' },
  { id: 'act_856434001679007',  name: 'Alpha 3 GMT-3 MKT AB - Thảo',      shortName: 'Alpha 3 (Thảo)',   color: '#8B5CF6' },
  { id: 'act_1855997818105694', name: 'Alpha 6 - GMT -3 - Tấn',           shortName: 'Alpha 6 (Tấn)',    color: '#059669' },
  { id: 'act_542081774682636',  name: 'Alpha 7 - GMT-3 - HTXB - Phương',   shortName: 'Alpha 7 (Phương)', color: '#F59E0B' },
  { id: 'act_848982799482573',  name: 'Alpha 8 - GMT-4 (11h) - MKT Sống',  shortName: 'Alpha 8 (Sống)',   color: '#EC4899' },
  { id: 'act_2929843193813956', name: 'TKQC MED - Alpha 10 GMT +7 (0h)',   shortName: 'Alpha 10 (MED)',   color: '#06B6D4' },
  { id: 'act_1845118092714419', name: 'TK 1 - MKT Alpha - Thảo',          shortName: 'TK 1 (Thảo)',      color: '#6366F1' }
];

// Google OAuth 2.0 Client ID (Web application) dùng cho đăng nhập Google Sign-In.
// Hướng dẫn thiết lập:
//   1. Mở Google Cloud Console (https://console.cloud.google.com/apis/credentials)
//   2. Tạo OAuth 2.0 Client ID loại "Web application", thêm Authorized JavaScript origins
//      là domain Google Apps Script web app (https://script.google.com và https://*.googleusercontent.com)
//   3. Dán Client ID vào biến bên dưới HOẶC lưu vào Script Properties với key 'GOOGLE_OAUTH_CLIENT_ID'.
var GOOGLE_OAUTH_CLIENT_ID = '';

function getGoogleOAuthClientId_() {
  var prop = '';
  try {
    prop = PropertiesService.getScriptProperties().getProperty('GOOGLE_OAUTH_CLIENT_ID') || '';
  } catch (e) {}
  return String(prop || GOOGLE_OAUTH_CLIENT_ID || '').trim();
}

// ID thư mục Google Drive của bạn
var DRIVE_FOLDER_ID = '1WjwUW-4iyNrLLZHfDF9fpooqHrZkSCJg';

// Tài khoản mặc định fallback
var ACCOUNT_ID = AD_ACCOUNTS[0].id;

/**
 * HÀM TỰ ĐỘNG TẠO 3 GOOGLE SHEETS TRONG THƯ MỤC GOOGLE DRIVE:
 * Chạy hàm này một lần duy nhất từ menu Run -> initSetupGoogleSheets()
 */
function initSetupGoogleSheets() {
  var props = PropertiesService.getScriptProperties();
  var folder = null;
  try {
    if (DRIVE_FOLDER_ID) folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  } catch (e) {
    Logger.log('Cảnh báo DRIVE_FOLDER_ID (' + DRIVE_FOLDER_ID + '): ' + e.message + '. Sẽ lưu file ở thư mục My Drive gốc.');
  }
  
  var campaignSheetId = props.getProperty('CAMPAIGN_SHEET_ID');
  var adSetSheetId = props.getProperty('ADSET_SHEET_ID');
  var adSheetId = props.getProperty('AD_SHEET_ID');

  if (!campaignSheetId) {
    var ssCampaign = SpreadsheetApp.create('Meta Ads - Campaign Data');
    if (folder) {
      try { DriveApp.getFileById(ssCampaign.getId()).moveTo(folder); } catch (e) {}
    }
    campaignSheetId = ssCampaign.getId();
    props.setProperty('CAMPAIGN_SHEET_ID', campaignSheetId);
    Logger.log('Đã tạo Campaign Sheet: ' + campaignSheetId);
  }

  if (!adSetSheetId) {
    var ssAdSet = SpreadsheetApp.create('Meta Ads - AdSet Data');
    if (folder) {
      try { DriveApp.getFileById(ssAdSet.getId()).moveTo(folder); } catch (e) {}
    }
    adSetSheetId = ssAdSet.getId();
    props.setProperty('ADSET_SHEET_ID', adSetSheetId);
    Logger.log('Đã tạo AdSet Sheet: ' + adSetSheetId);
  }

  if (!adSheetId) {
    var ssAd = SpreadsheetApp.create('Meta Ads - Ad & Creative Data');
    if (folder) {
      try { DriveApp.getFileById(ssAd.getId()).moveTo(folder); } catch (e) {}
    }
    adSheetId = ssAd.getId();
    props.setProperty('AD_SHEET_ID', adSheetId);
    Logger.log('Đã tạo Ad Sheet: ' + adSheetId);
  }

  Logger.log('HOÀN TẤT SETUP SHEETS:');
  Logger.log('- Campaign Sheet ID: ' + campaignSheetId);
  Logger.log('- AdSet Sheet ID: ' + adSetSheetId);
  Logger.log('- Ad Sheet ID: ' + adSheetId);
  return {
    campaignSheetId: campaignSheetId,
    adSetSheetId: adSetSheetId,
    adSheetId: adSheetId
  };
}

function getCampaignSheetId_() {
  return PropertiesService.getScriptProperties().getProperty('CAMPAIGN_SHEET_ID') || '[SHEET_ID]';
}

function getAdSetSheetId_() {
  return PropertiesService.getScriptProperties().getProperty('ADSET_SHEET_ID') || '[ADSET_SHEET_ID]';
}

function getAdSheetId_() {
  return PropertiesService.getScriptProperties().getProperty('AD_SHEET_ID') || '[AD_SHEET_ID]';
}

/**
 * Lấy cấu hình các chiến dịch (objective, bid strategy, daily budget) theo từng tài khoản (có phân trang & retry)
 */
function fetchCampaignSettings(accountId) {
  var actId = accountId || (AD_ACCOUNTS[0] ? AD_ACCOUNTS[0].id : '');
  var map = {};
  var nextUrl = 'https://graph.facebook.com/v18.0/' + actId +
    '/campaigns?fields=id,name,objective,bid_strategy,daily_budget&limit=200';
  var guard = 0;

  try {
    while (nextUrl && guard < 25) {
      var data;
      if (typeof fetchWithRetry_ === 'function') {
        data = fetchWithRetry_(nextUrl, 3);
      } else {
        var resp = UrlFetchApp.fetch(nextUrl, {
          headers: { Authorization: 'Bearer ' + ACCESS_TOKEN },
          muteHttpExceptions: true
        });
        data = JSON.parse(resp.getContentText());
      }
      if (!data || data.error) {
        if (data && data.error) Logger.log('Lỗi fetchCampaignSettings cho ' + actId + ': ' + JSON.stringify(data.error));
        break;
      }
      (data.data || []).forEach(function (c) {
        var daily = c.daily_budget ? (parseFloat(c.daily_budget) || 0) : 0;
        map[c.name] = {
          id: c.id,
          objective: c.objective || '',
          bidStrategy: c.bid_strategy || '',
          bid_strategy: c.bid_strategy || '',
          dailyBudget: daily,
          daily_budget: daily
        };
      });
      nextUrl = (data.paging && data.paging.next) ? data.paging.next : null;
      if (nextUrl) Utilities.sleep(150);
      guard++;
    }
    return map;
  } catch (e) {
    Logger.log('Lỗi fetchCampaignSettings cho ' + actId + ': ' + e.message);
    return map;
  }
}

/**
 * HÀM 1-CLICK KÉO DỮ LIỆU CỐT LÕI (Campaign -> AdSet -> Ad)
 * Chạy 3 tầng chính, thời gian thực thi ~2-3 phút, an toàn 100% không lo chạm ngưỡng 6 phút của Apps Script.
 */
function syncDataCore() {
  var t0 = Date.now();
  Logger.log('1/3: Đang đồng bộ Campaign...');
  if (typeof importDataFromJSON === 'function') importDataFromJSON();

  Logger.log('2/3: Đang đồng bộ Ad Set...');
  if (typeof importAdSetData === 'function') importAdSetData();

  Logger.log('3/3: Đang đồng bộ Ad...');
  if (typeof importAdDataWithBudget_ === 'function') importAdDataWithBudget_(t0 + 290000);
  else if (typeof importAdData === 'function') importAdData();

  Logger.log('===> HOÀN TẤT ĐỒNG BỘ DỮ LIỆU CỐT LÕI (Campaign, Ad Set, Ad)!');
}

/**
 * HÀM 1-CLICK KÉO TOÀN BỘ DỮ LIỆU CẢ 9 TÀI KHOẢN (Campaign -> AdSet -> Ad -> Creative -> Breakdown)
 * Có cơ chế kiểm tra thời gian thực thi để tránh bị Google Apps Script ngắt đột ngột (giới hạn 6 phút).
 */
function syncTatCaDuLieu() {
  var t0 = Date.now();
  var MAX_SAFE_MS = 250000; // 4 phút 10 giây (dưới ngưỡng 6 phút để tránh crash timeout)

  Logger.log('1/5: Đang đồng bộ Campaign...');
  if (typeof importDataFromJSON === 'function') importDataFromJSON();

  Logger.log('2/5: Đang đồng bộ Ad Set...');
  if (typeof importAdSetData === 'function') importAdSetData();

  Logger.log('3/5: Đang đồng bộ Ad...');
  if (typeof importAdDataWithBudget_ === 'function') importAdDataWithBudget_(t0 + 290000);
  else if (typeof importAdData === 'function') importAdData();

  var elapsed = Date.now() - t0;
  if (elapsed > MAX_SAFE_MS) {
    Logger.log('⚠️ [LƯU Ý] Đã đồng bộ xong 3 tầng cốt lõi (Campaign, Ad Set, Ad) sau ' + (elapsed / 1000).toFixed(1) + 's.');
    Logger.log('⚠️ Để không vượt quá giới hạn 6 phút của Google Apps Script, vui lòng chạy riêng các hàm sau:');
    Logger.log('   👉 Bước 4: Chạy hàm importAdCreatives() (sẽ tự động tiếp tục từ trang dừng trước đó)');
    Logger.log('   👉 Bước 5: Chạy hàm importBreakdownData()');
    return;
  }

  Logger.log('4/5: Đang cache Creative thumbnail...');
  if (typeof importAdCreatives === 'function') importAdCreatives();

  elapsed = Date.now() - t0;
  if (elapsed > MAX_SAFE_MS) {
    Logger.log('⚠️ [LƯU Ý] Đã hoàn thành bước Creative sau ' + (elapsed / 1000).toFixed(1) + 's.');
    Logger.log('⚠️ Vui lòng chạy riêng hàm importBreakdownData() để đồng bộ 5 loại breakdown còn lại.');
    return;
  }

  Logger.log('5/5: Đang đồng bộ dữ liệu Breakdown: Age, Gender, Platform, Placement, Region...');
  if (typeof importBreakdownData === 'function') importBreakdownData();

  Logger.log('===> HOÀN TẤT ĐỒNG BỘ TOÀN BỘ DỮ LIỆU BAN ĐẦU!');
}

/**
 * =========================================================================
 * HÀM 1-CLICK CÀI ĐẶT 5 TIME-DRIVEN TRIGGERS TỰ ĐỘNG BAN ĐÊM (GMT+7)
 * =========================================================================
 * Đảm bảo hệ thống tự thức dậy kéo dữ liệu từ Meta Ads mỗi đêm hoàn toàn tự động:
 *   - 1:00 AM -> copyDataOnceADay   (Campaign - rolling 7 ngày)
 *   - 2:00 AM -> importAdSetData    (Ad Set)
 *   - 3:00 AM -> importAdData       (Ad)
 *   - 4:00 AM -> importAdCreatives  (Creative thumbnail cache)
 *   - 5:00 AM -> importBreakdownData(Breakdown cho Report Builder)
 * Hàm tự động dọn sạch các trigger cũ bị trùng lặp trước khi tạo mới.
 */
function setupDailyAutoTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var targetHandlers = [
    'copyDataOnceADay',
    'importAdSetData',
    'importAdData',
    'importAdCreatives',
    'importBreakdownData'
  ];

  var deletedCount = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (targetHandlers.indexOf(fn) !== -1) {
      ScriptApp.deleteTrigger(triggers[i]);
      deletedCount++;
    }
  }

  ScriptApp.newTrigger('copyDataOnceADay').timeBased().everyDays(1).atHour(1).create();
  ScriptApp.newTrigger('importAdSetData').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('importAdData').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('importAdCreatives').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('importBreakdownData').timeBased().everyDays(1).atHour(5).create();

  var msg = 'Đã cài đặt thành công 5 trigger tự động chạy đêm (1h-5h sáng GMT+7)! (Đã dọn ' + deletedCount + ' trigger cũ)';
  Logger.log('🎉 ' + msg);
  return {
    ok: true,
    deleted: deletedCount,
    installed: targetHandlers.length,
    message: msg
  };
}

/**
 * Xóa toàn bộ 5 trigger tự động (khi cần tạm dừng hệ thống)
 */
function removeDailyAutoTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var targetHandlers = [
    'copyDataOnceADay',
    'importAdSetData',
    'importAdData',
    'importAdCreatives',
    'importBreakdownData'
  ];
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (targetHandlers.indexOf(fn) !== -1) {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  Logger.log('Đã xóa ' + count + ' trigger tự động.');
  return { ok: true, deleted: count, message: 'Đã xóa ' + count + ' trigger tự động.' };
}

/**
 * Kiểm tra trạng thái hiện tại của các trigger tự động
 */
function getDailyAutoTriggersStatus() {
  var triggers = ScriptApp.getProjectTriggers();
  var targetHandlers = {
    'copyDataOnceADay': false,
    'importAdSetData': false,
    'importAdData': false,
    'importAdCreatives': false,
    'importBreakdownData': false
  };
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (targetHandlers.hasOwnProperty(fn)) {
      targetHandlers[fn] = true;
    }
  }
  var installedList = [];
  var missingList = [];
  Object.keys(targetHandlers).forEach(function(k) {
    if (targetHandlers[k]) installedList.push(k);
    else missingList.push(k);
  });
  return {
    triggers: targetHandlers,
    installedCount: installedList.length,
    missingCount: missingList.length,
    allInstalled: missingList.length === 0
  };
}

