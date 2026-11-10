/**
 * BreakdownPipeline.gs — Pipeline đồng bộ dữ liệu Breakdown Meta Ads
 * 
 * Hỗ trợ 5 loại Breakdown phục vụ Report Builder:
 *   - data_age       : Phân tích theo nhóm tuổi (age)
 *   - data_gender    : Phân tích theo giới tính (gender)
 *   - data_platform  : Phân tích theo nền tảng (publisher_platform: fb, ig, messenger, audience_network)
 *   - data_placement : Phân tích theo vị trí hiển thị (feed, story, reels...)
 *   - data_region    : Phân tích theo khu vực/tỉnh thành (region)
 *
 * Lưu trữ trong Campaign Spreadsheet: CAMPAIGN_SHEET_ID
 */

var BREAKDOWN_CONFIGS_ = {
  age: {
    sheetName: 'data_age',
    breakdowns: 'age',
    getValue: function (item) { return item.age || 'unknown'; }
  },
  gender: {
    sheetName: 'data_gender',
    breakdowns: 'gender',
    getValue: function (item) { return item.gender || 'unknown'; }
  },
  platform: {
    sheetName: 'data_platform',
    breakdowns: 'publisher_platform',
    getValue: function (item) { return item.publisher_platform || 'unknown'; }
  },
  placement: {
    sheetName: 'data_placement',
    breakdowns: 'publisher_platform,platform_position',
    getValue: function (item) {
      return (item.publisher_platform || 'unknown') + '_' + (item.platform_position || 'unknown');
    }
  },
  region: {
    sheetName: 'data_region',
    breakdowns: 'region',
    getValue: function (item) { return item.region || 'unknown'; }
  }
};

var BREAKDOWN_HEADERS_PIPELINE_ = [
  'Date', 'Campaign name', 'Breakdown Value', 'Spend', 'Impressions',
  'Clicks', 'Reach', 'CTR', 'Purchases', 'Purchase value',
  'Video 3s', 'Video 100%', 'Link clicks', 'Account ID', 'Account Name'
];

/**
 * Lấy hoặc tạo sheet Breakdown trong Campaign Spreadsheet
 */
function getOrCreateBreakdownSheet_(sheetName) {
  var ss = getCampaignSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  ensureColumns_(sheet, BREAKDOWN_HEADERS_PIPELINE_.length);
  var firstRow = sheet.getRange(1, 1, 1, BREAKDOWN_HEADERS_PIPELINE_.length).getValues()[0];
  var blank = firstRow.every(function (c) { return String(c).trim() === ''; });
  var lastExpected = BREAKDOWN_HEADERS_PIPELINE_[BREAKDOWN_HEADERS_PIPELINE_.length - 1];
  var prevLastExpected = BREAKDOWN_HEADERS_PIPELINE_[BREAKDOWN_HEADERS_PIPELINE_.length - 2];
  var headerNeedsUpdate = blank ||
    String(firstRow[0] || '').trim() !== 'Date' ||
    String(firstRow[BREAKDOWN_HEADERS_PIPELINE_.length - 2] || '').trim() !== prevLastExpected ||
    String(firstRow[BREAKDOWN_HEADERS_PIPELINE_.length - 1] || '').trim() !== lastExpected;
  if (headerNeedsUpdate) {
    var col0 = String(firstRow[0] || '').trim();
    var looksLikeDataRow = firstRow[0] instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(col0);
    if (looksLikeDataRow) {
      sheet.insertRowBefore(1);
    }
    sheet.getRange(1, 1, 1, BREAKDOWN_HEADERS_PIPELINE_.length).setValues([BREAKDOWN_HEADERS_PIPELINE_]);
  }
  return sheet;
}

/**
 * Xóa dữ liệu cũ trong khoảng thời gian để ghi đè (idempotent, tránh trùng lặp).
 * Khi truyền accountIdSet, chỉ xóa dữ liệu của các tài khoản nằm trong tập đó (col 13 = Account ID).
 */
function removeBreakdownRowsInRange_(sheet, sinceStr, untilStr, accountIdSet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var useIsoRange = /^\d{4}-\d{2}-\d{2}$/.test(sinceStr) && /^\d{4}-\d{2}-\d{2}$/.test(untilStr);
  var sinceTs = useIsoRange ? 0 : new Date(sinceStr).getTime();
  var untilTs = useIsoRange ? 0 : (new Date(untilStr).getTime() + 86399999);
  var kept = values.filter(function (row) {
    if (accountIdSet) {
      var rowAccId = String(row[13] || '').trim();
      if (!accountIdSet[rowAccId]) return true;
    }
    var k = dayKey_(row[0]); // col 1 = Date
    if (useIsoRange && /^\d{4}-\d{2}-\d{2}$/.test(k)) {
      return !(k >= sinceStr && k <= untilStr);
    }
    var ts = new Date(k).getTime();
    if (isNaN(ts)) return true;
    return !(ts >= sinceTs && ts <= untilTs);
  });
  var removed = values.length - kept.length;
  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (kept.length) {
    sheet.getRange(2, 1, kept.length, kept[0].length).setValues(kept);
  }
  Logger.log('removeBreakdownRowsInRange_ (' + sheet.getName() + '): cleared ' + removed + ' rows in ' + sinceStr + '..' + untilStr +
    (accountIdSet ? ' (scoped to ' + Object.keys(accountIdSet).length + ' account(s))' : ''));
}

/**
 * Append dữ liệu an toàn, tự động mở rộng grid nếu cần
 */
function appendBreakdownRowsSafe_(sheet, rows) {
  if (!rows || !rows.length) return;
  var start = sheet.getLastRow() + 1;
  var need = start + rows.length - 1;
  if (need > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  }
  var cols = rows[0].length;
  if (cols > sheet.getMaxColumns()) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
  }
  sheet.getRange(start, 1, rows.length, cols).setValues(rows);
}

/**
 * Kéo dữ liệu Breakdown cho 1 dimension cụ thể qua Meta Marketing API
 */
function fetchBreakdownRowsForAccount_(accountId, accountName, sinceStr, untilStr, breakdownType) {
  var cfg = BREAKDOWN_CONFIGS_[breakdownType];
  if (!cfg) return { rows: [], ok: false, errorMessage: 'Invalid breakdown type: ' + breakdownType };

  var params = {
    level: 'campaign',
    time_increment: 1,
    include_archived: true,
    breakdowns: cfg.breakdowns,
    fields: 'campaign_name,spend,impressions,clicks,reach,ctr,inline_link_clicks,date_start,actions,action_values,video_p100_watched_actions',
    time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
    limit: 500
  };

  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
  }).join('&');

  var base = 'https://graph.facebook.com/v18.0/' + accountId + '/insights';
  var next = null, out = [], errorMessage = '';

  do {
    var url = next ? next : base + '?' + qs;
    var data;
    try {
      if (typeof fetchWithRetry_ === 'function') {
        data = fetchWithRetry_(url);
      } else {
        var resp = UrlFetchApp.fetch(url, fetchOptions_());
        data = JSON.parse(resp.getContentText());
      }
    } catch (e) {
      errorMessage = e.message;
      Logger.log('Lỗi fetch breakdown ' + breakdownType + ' (' + accountId + '): ' + errorMessage);
      return { rows: out, ok: false, errorMessage: errorMessage };
    }

    if (!data || data.error) {
      errorMessage = (data && data.error) ? JSON.stringify(data.error) : 'No response';
      Logger.log('Meta API error breakdown ' + breakdownType + ' (' + accountId + '): ' + errorMessage);
      return { rows: out, ok: false, errorMessage: errorMessage };
    }

    (data.data || []).forEach(function (item) {
      var purchases = av_(item.actions, 'omni_purchase') + av_(item.actions, 'purchase');
      var purchaseValue = av_(item.action_values, 'omni_purchase') + av_(item.action_values, 'purchase');
      var video3s = av_(item.actions, 'video_view');
      var video100 = av_(item.video_p100_watched_actions, 'video_view');
      var linkClicks = item.inline_link_clicks ? (parseFloat(item.inline_link_clicks) || 0) : av_(item.actions, 'link_click');
      var breakdownVal = cfg.getValue(item);

      out.push([
        item.date_start || '',
        item.campaign_name || '',
        breakdownVal,
        parseFloat(item.spend) || 0,
        parseInt(item.impressions) || 0,
        parseInt(item.clicks) || 0,
        parseInt(item.reach) || 0,
        parseFloat(item.ctr) || 0,
        purchases,
        purchaseValue,
        video3s,
        video100,
        linkClicks,
        accountId || '',
        accountName || ''
      ]);
    });

    next = (data.paging && data.paging.next) ? data.paging.next : null;
    if (next) Utilities.sleep(300);
  } while (next);

  return { rows: out, ok: true, errorMessage: '' };
}

/**
 * Đồng bộ toàn bộ dữ liệu 1 loại Breakdown cho tất cả 8 tài khoản trong khoảng ngày
 */
function importOneBreakdownRange_(breakdownType, sinceStr, untilStr) {
  var cfg = BREAKDOWN_CONFIGS_[breakdownType];
  if (!cfg) return { ok: false, errorMessage: 'Unknown breakdown: ' + breakdownType };

  var sheet = getOrCreateBreakdownSheet_(cfg.sheetName);
  var accounts = (typeof AD_ACCOUNTS !== 'undefined' && AD_ACCOUNTS.length)
    ? AD_ACCOUNTS
    : [{ id: (typeof ACCOUNT_ID !== 'undefined' ? ACCOUNT_ID : ''), name: 'Default' }];

  var allRows = [];
  var hasErrors = false;

  accounts.forEach(function (acc) {
    Logger.log('Breakdown [' + breakdownType + '] -> ' + acc.name + ' (' + acc.id + ') ' + sinceStr + '..' + untilStr);
    var res = fetchBreakdownRowsForAccount_(acc.id, acc.name, sinceStr, untilStr, breakdownType);
    if (!res.ok) {
      hasErrors = true;
      Logger.log('  ⚠️ Lỗi fetch tài khoản ' + acc.name + ': ' + res.errorMessage);
    } else {
      allRows = allRows.concat(res.rows);
      Logger.log('  ✓ Lấy được ' + res.rows.length + ' dòng');
    }
    Utilities.sleep(200);
  });

  if (allRows.length > 0 || !hasErrors) {
    removeBreakdownRowsInRange_(sheet, sinceStr, untilStr);
    appendBreakdownRowsSafe_(sheet, allRows);
    Logger.log('===> Hoàn tất [' + breakdownType + ']: Đã ghi ' + allRows.length + ' dòng vào ' + cfg.sheetName);
  }

  return { ok: !hasErrors, rowsCount: allRows.length };
}

/**
 * HÀM TỔNG HỢP: Đồng bộ toàn bộ 5 loại breakdown (Age, Gender, Platform, Placement, Region)
 * Chạy cho cửa sổ rolling LOOKBACK_DAYS (mặc định 7 ngày gần nhất)
 */
function importBreakdownData() {
  var until = getYesterday();
  var since = getDateNDaysAgo_(LOOKBACK_DAYS || 7);
  Logger.log('=== BẮT ĐẦU ĐỒNG BỘ BREAKDOWN DỮ LIỆU (' + since + ' -> ' + until + ') ===');

  var types = ['age', 'gender', 'platform', 'placement', 'region'];
  types.forEach(function (t) {
    try {
      importOneBreakdownRange_(t, since, until);
    } catch (e) {
      Logger.log('Lỗi đồng bộ breakdown ' + t + ': ' + e.message);
    }
    Utilities.sleep(1000);
  });

  Logger.log('=== HOÀN TẤT ĐỒNG BỘ TẤT CẢ BREAKDOWN! ===');
}

/**
 * Backfill theo khoảng thời gian tùy chọn (dùng Async Report + checkpoint + tự nối ca).
 */
function backfillBreakdownsCustomRange(sinceStr, untilStr, opts) {
  opts = opts || {};
  if (!opts.syncOnly && typeof runAsyncBackfillJob_ === 'function') {
    return runAsyncBackfillJob_({
      pipeline: 'breakdown',
      since: sinceStr,
      until: untilStr,
      chunkDays: opts.chunkDays || 7,
      breakdownTypes: opts.breakdownTypes || ['age', 'gender', 'platform', 'placement', 'region'],
      autoResume: opts.autoResume !== false,
      deadlineMs: opts.deadlineMs
    });
  }
  Logger.log('Bắt đầu backfill Breakdowns từ ' + sinceStr + ' đến ' + untilStr);
  var types = opts.breakdownTypes || ['age', 'gender', 'platform', 'placement', 'region'];
  types.forEach(function (t) {
    importOneBreakdownRange_(t, sinceStr, untilStr);
    Utilities.sleep(1000);
  });
  Logger.log('Hoàn tất backfill Breakdowns: ' + sinceStr + ' .. ' + untilStr);
}

function backfillLast30Days_Breakdowns() {
  return backfillBreakdownsCustomRange(getDateNDaysAgo_(30), getYesterday());
}

function backfillLast90Days_Breakdowns() {
  return backfillBreakdownsCustomRange(getDateNDaysAgo_(90), getYesterday());
}
