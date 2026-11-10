/**
 * Config.gs — Cấu hình đa tài khoản Meta Ads và Google Drive
 */

var ACCESS_TOKEN = 'EAAOhgsUSolIBS6ke3vNsxPjH2K4peyf4Mm2THErTUcRQxCw6pJhQl5mGQy3Vy8oQjQvohIXLrb5FRHesEfZAoLUDWiZCIzX5VsvVOWCAPks2RjLraLbr3szthrMHCJVoMwoe1erU3ZAG6SZBxLYXXyPcYKamZAW4JpvOVBzTZAZBaeIpqTfTqzrxiQ1ClAJLZB0CxwZDZD';

// Danh sách 8 tài khoản quảng cáo được phân quyền từ System User
var AD_ACCOUNTS = [
  { id: 'act_988452388193871',  name: 'Alpha 1 GMT +7 20tr - Hoa' },
  { id: 'act_3863604326993604', name: 'TKQC Alpha 2 GMT-7- Hoa' },
  { id: 'act_140020454941995',  name: 'Alpha 5 GMT -7 - Tấn' },
  { id: 'act_856434001679007',  name: 'Alpha 3 GMT-3 MKT AB - Thảo' },
  { id: 'act_1855997818105694', name: 'Alpha 6 - GMT -3 - Tấn' },
  { id: 'act_542081774682636',  name: 'Alpha 7 - GMT-3 - HTXB - Phương' },
  { id: 'act_848982799482573',  name: 'Alpha 8 - GMT-4 (11h) - MKT Sống' },
  { id: 'act_2929843193813956', name: 'TKQC MED - Alpha 10 GMT +7 (0h)' }
];

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
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  
  var campaignSheetId = props.getProperty('CAMPAIGN_SHEET_ID');
  var adSetSheetId = props.getProperty('ADSET_SHEET_ID');
  var adSheetId = props.getProperty('AD_SHEET_ID');

  if (!campaignSheetId) {
    var ssCampaign = SpreadsheetApp.create('Meta Ads - Campaign Data');
    DriveApp.getFileById(ssCampaign.getId()).moveTo(folder);
    campaignSheetId = ssCampaign.getId();
    props.setProperty('CAMPAIGN_SHEET_ID', campaignSheetId);
    Logger.log('Đã tạo Campaign Sheet: ' + campaignSheetId);
  }

  if (!adSetSheetId) {
    var ssAdSet = SpreadsheetApp.create('Meta Ads - AdSet Data');
    DriveApp.getFileById(ssAdSet.getId()).moveTo(folder);
    adSetSheetId = ssAdSet.getId();
    props.setProperty('ADSET_SHEET_ID', adSetSheetId);
    Logger.log('Đã tạo AdSet Sheet: ' + adSetSheetId);
  }

  if (!adSheetId) {
    var ssAd = SpreadsheetApp.create('Meta Ads - Ad & Creative Data');
    DriveApp.getFileById(ssAd.getId()).moveTo(folder);
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
 * Lấy cấu hình các chiến dịch (objective, bid strategy, daily budget) theo từng tài khoản
 */
function fetchCampaignSettings(accountId) {
  var actId = accountId || (AD_ACCOUNTS[0] ? AD_ACCOUNTS[0].id : '');
  var url = 'https://graph.facebook.com/v18.0/' + actId +
    '/campaigns?fields=id,name,objective,bid_strategy,daily_budget&limit=200';
  try {
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ACCESS_TOKEN },
      muteHttpExceptions: true
    });
    var data = JSON.parse(resp.getContentText());
    var map = {};
    (data.data || []).forEach(function (c) {
      map[c.name] = { id: c.id, objective: c.objective, bidStrategy: c.bid_strategy, dailyBudget: c.daily_budget };
    });
    return map;
  } catch (e) {
    Logger.log('Lỗi fetchCampaignSettings cho ' + actId + ': ' + e.message);
    return {};
  }
}

/**
 * HÀM 1-CLICK KÉO TOÀN BỘ DỮ LIỆU CẢ 8 TÀI KHOẢN (Campaign -> AdSet -> Ad -> Creative)
 */
function syncTatCaDuLieu() {
  Logger.log('1/5: Đang đồng bộ Campaign...');
  if (typeof importDataFromJSON === 'function') importDataFromJSON();

  Logger.log('2/5: Đang đồng bộ Ad Set...');
  if (typeof importAdSetData === 'function') importAdSetData();

  Logger.log('3/5: Đang đồng bộ Ad...');
  if (typeof importAdData === 'function') importAdData();

  Logger.log('4/5: Đang cache Creative thumbnail...');
  if (typeof importAdCreatives === 'function') importAdCreatives();

  Logger.log('5/5: Đang đồng bộ dữ liệu Breakdown: Age, Gender, Platform, Placement, Region...');
  if (typeof importBreakdownData === 'function') importBreakdownData();

  Logger.log('===> HOÀN TẤT ĐỒNG BỘ DỮ LIỆU BAN ĐẦU!');
}
