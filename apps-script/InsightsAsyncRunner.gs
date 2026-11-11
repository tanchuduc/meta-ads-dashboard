/**
 * InsightsAsyncRunner.gs — Engine Backfill Bất Đồng Bộ (Meta Async Insights + Checkpoint + Auto-Resume Trigger)
 *
 * Giải quyết tận gốc 2 nguyên nhân khiến các hàm backfill dài ngày bị lỗi/treo:
 *   1. Meta API timeout/overload (code 2 / subcode 1504044, code 1 / subcode 99) khi truy vấn đồng bộ:
 *      Dùng POST /{act_id}/insights để tạo Async Report Job trên server Meta (trả report_run_id < 1s),
 *      poll trạng thái nhẹ nhàng, rồi tải kết quả đã dựng sẵn. Nếu job vẫn quá nặng thì tự chia đôi
 *      khoảng ngày; nếu chỉ còn 1 ngày mà async thất bại thì fallback về đồng bộ chia nhỏ limit.
 *   2. Giới hạn thực thi 6 phút của Google Apps Script:
 *      - Chạy với ngân sách an toàn 4 phút (240s), dư 2 phút đệm để không bao giờ bị GAS ngắt ngang.
 *      - Ghi dữ liệu xuống Google Sheets theo từng tài khoản / cửa sổ đã xong (idempotent, không mất dữ liệu).
 *      - Lưu con trỏ trạng thái nhỏ gọn (< 3KB) vào PropertiesService.
 *      - Tự động hẹn 1 trigger chạy tiếp sau 1 phút (hoặc 5 phút nếu gặp rate-limit 80004/613) và tự dọn
 *        trigger khi hoàn tất toàn bộ. Người dùng chỉ cần bấm Run đúng 1 lần.
 */

var ASYNC_BACKFILL_STATE_PROP_ = 'BACKFILL_ASYNC_JOB_STATE_V1';
var ASYNC_BACKFILL_TRIGGER_HANDLER_ = 'continueAsyncBackfillJob';
var ASYNC_BACKFILL_SOFT_BUDGET_MS_ = 240000;      // 4 phút an toàn (GAS hard limit = 6 phút)
var ASYNC_BACKFILL_POLL_INTERVAL_MS_ = 3000;      // 3 giây/lần poll trạng thái job Meta
var ASYNC_BACKFILL_MAX_RUN_AGE_MS_ = 900000;      // 15 phút tối đa cho 1 report_run_id trước khi chia nhỏ lại
var ASYNC_BACKFILL_RESUME_DELAY_MS_ = 60000;      // 1 phút tự chạy ca tiếp theo
var ASYNC_BACKFILL_RATE_LIMIT_DELAY_MS_ = 300000; // 5 phút hạ nhiệt nếu chạm account rate limit 80004/613
var ASYNC_BACKFILL_PAGE_LIMIT_ = 500;
var ASYNC_BACKFILL_SYNC_FALLBACK_LIMITS_ = [100, 50, 25];

function asyncParseUtcMs_(dateStr) {
  if (typeof parseUtcDateMs_ === 'function') return parseUtcDateMs_(dateStr);
  var m = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function asyncFormatUtcDate_(utcMs) {
  if (typeof formatUtcDate_ === 'function') return formatUtcDate_(utcMs);
  var d = new Date(utcMs);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : String(m)) + '-' + (day < 10 ? '0' + day : String(day));
}

function asyncDiffDaysInclusive_(sinceStr, untilStr) {
  var s = asyncParseUtcMs_(sinceStr);
  var u = asyncParseUtcMs_(untilStr);
  if (isNaN(s) || isNaN(u) || u < s) return 0;
  return Math.round((u - s) / 86400000) + 1;
}

function asyncBuildReversedChunks_(sinceStr, untilStr, chunkDays) {
  var s = asyncParseUtcMs_(sinceStr);
  var u = asyncParseUtcMs_(untilStr);
  if (isNaN(s) || isNaN(u) || u < s) return [];
  var step = Math.max(1, chunkDays || 1);
  var chunks = [];
  var cur = s;
  while (cur <= u) {
    var end = Math.min(u, cur + (step - 1) * 86400000);
    chunks.push({ s: asyncFormatUtcDate_(cur), u: asyncFormatUtcDate_(end) });
    cur = end + 86400000;
  }
  return chunks.reverse(); // Mới nhất trước để dữ liệu gần nhất lên Dashboard sớm nhất
}

function asyncSplitRangeInHalf_(sinceStr, untilStr) {
  var span = asyncDiffDaysInclusive_(sinceStr, untilStr);
  if (span <= 1) return null;
  var sMs = asyncParseUtcMs_(sinceStr);
  var midOffset = Math.floor((span - 1) / 2);
  var midMs = sMs + midOffset * 86400000;
  return [
    { s: sinceStr, u: asyncFormatUtcDate_(midMs) },
    { s: asyncFormatUtcDate_(midMs + 86400000), u: untilStr }
  ];
}

function getBackfillAccounts_() {
  if (typeof AD_ACCOUNTS !== 'undefined' && AD_ACCOUNTS && AD_ACCOUNTS.length) {
    return AD_ACCOUNTS;
  }
  var fallbackId = (typeof ACCOUNT_ID !== 'undefined') ? ACCOUNT_ID : '';
  return [{ id: fallbackId, name: 'Default' }];
}

function findBackfillAccount_(accountId) {
  var accounts = getBackfillAccounts_();
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].id === accountId) return accounts[i];
  }
  return { id: accountId, name: accountId };
}

function asyncIsAccountRateLimited_(err) {
  if (!err) return false;
  if (typeof isAccountRateLimited_ === 'function') return isAccountRateLimited_(err);
  return err.code === 80004 || err.code === 613;
}

function asyncIsQueryOverload_(err) {
  if (!err) return false;
  if (typeof isQueryOverloadMetaError_ === 'function') return isQueryOverloadMetaError_(err);
  if (err.code === 1 && err.error_subcode === 99) return true;
  if (err.code === 2) return true;
  var msg = String(err.message || '').toLowerCase();
  return msg.indexOf('reduce the amount of data') !== -1 ||
         msg.indexOf('too much data') !== -1 ||
         msg.indexOf('timeout') !== -1 ||
         msg.indexOf('timed out') !== -1 ||
         (err.code === 1 && msg.indexOf('unknown error') !== -1);
}

function asyncIsTransient_(err) {
  if (!err) return false;
  if (typeof isTransientMetaError_ === 'function') return isTransientMetaError_(err);
  return err.code === 1 || err.code === 2 || err.code === 4 || err.code === 17;
}

/**
 * Adapter chuẩn hóa cho từng tầng dữ liệu (campaign, adset, breakdown, ad).
 */
function getBackfillPipelineAdapter_(pipeline, breakdownType) {
  if (pipeline === 'campaign') {
    return {
      defaultChunkDays: 15,
      getSheet: function () {
        var ss = getCampaignSpreadsheet_();
        var dest = ss.getSheetByName('data - by day');
        if (!dest) dest = ss.insertSheet('data - by day');
        ensureCampaignHeaders_(dest);
        return dest;
      },
      buildParams: function (sinceStr, untilStr) {
        return {
          level: 'campaign',
          time_increment: '1',
          include_archived: 'true',
          fields: INSIGHT_FIELDS_,
          time_range: JSON.stringify({ since: sinceStr, until: untilStr })
        };
      },
      getSettings: function (accId, cache) {
        if (!cache[accId]) cache[accId] = fetchCampaignSettings(accId);
        return cache[accId];
      },
      buildRow: function (item, settings, acc) {
        return buildRowFromInsight_(item, settings, acc);
      },
      removeRange: function (sheet, sinceStr, untilStr, accountIdSet) {
        removeRowsInDateRange_(sheet, sinceStr, untilStr, accountIdSet);
      },
      appendRows: function (sheet, rows) {
        if (!rows || !rows.length) return;
        ensureColumns_(sheet, CAMPAIGN_HEADERS_.length);
        var startRow = sheet.getLastRow() + 1;
        var need = startRow + rows.length - 1;
        if (need > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
        sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      },
      freshnessKey: 'campaigns'
    };
  }

  if (pipeline === 'adset') {
    return {
      defaultChunkDays: 7,
      getSheet: function () {
        var sheet = getAdSetSheet_();
        ensureAdSetHeaders_(sheet);
        return sheet;
      },
      buildParams: function (sinceStr, untilStr) {
        return {
          level: 'adset',
          time_increment: '1',
          include_archived: 'true',
          fields: 'adset_name,' + INSIGHT_FIELDS_,
          time_range: JSON.stringify({ since: sinceStr, until: untilStr })
        };
      },
      getSettings: function (accId, cache) {
        if (!cache[accId]) cache[accId] = fetchAdSetSettings_(accId);
        return cache[accId];
      },
      buildRow: function (item, settings, acc) {
        return buildAdSetRow_(item, settings, acc);
      },
      removeRange: function (sheet, sinceStr, untilStr, accountIdSet) {
        removeAdSetRowsInRange_(sheet, sinceStr, untilStr, accountIdSet);
      },
      appendRows: function (sheet, rows) {
        appendAdSetRowsSafe_(sheet, rows);
      },
      freshnessKey: 'adsets'
    };
  }

  if (pipeline === 'breakdown') {
    var cfg = BREAKDOWN_CONFIGS_[breakdownType];
    if (!cfg) throw new Error('Unknown breakdownType: ' + breakdownType);
    return {
      defaultChunkDays: 7,
      getSheet: function () {
        return getOrCreateBreakdownSheet_(cfg.sheetName);
      },
      buildParams: function (sinceStr, untilStr) {
        return {
          level: 'campaign',
          time_increment: '1',
          include_archived: 'true',
          breakdowns: cfg.breakdowns,
          fields: 'campaign_name,spend,impressions,clicks,reach,ctr,inline_link_clicks,date_start,actions,action_values,video_p100_watched_actions',
          time_range: JSON.stringify({ since: sinceStr, until: untilStr })
        };
      },
      getSettings: function () { return null; },
      buildRow: function (item, settings, acc) {
        var purchases = av_(item.actions, 'omni_purchase') + av_(item.actions, 'purchase');
        var purchaseValue = av_(item.action_values, 'omni_purchase') + av_(item.action_values, 'purchase');
        var video3s = av_(item.actions, 'video_view');
        var video100 = av_(item.video_p100_watched_actions, 'video_view');
        var linkClicks = item.inline_link_clicks ? (parseFloat(item.inline_link_clicks) || 0) : av_(item.actions, 'link_click');
        return [
          item.date_start || '',
          item.campaign_name || '',
          cfg.getValue(item),
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
          acc ? acc.id : '',
          acc ? acc.name : ''
        ];
      },
      removeRange: function (sheet, sinceStr, untilStr, accountIdSet) {
        removeBreakdownRowsInRange_(sheet, sinceStr, untilStr, accountIdSet);
      },
      appendRows: function (sheet, rows) {
        appendBreakdownRowsSafe_(sheet, rows);
      },
      freshnessKey: null
    };
  }

  if (pipeline === 'ad') {
    return {
      defaultChunkDays: 3,
      getSheet: function () {
        var sheet = getAdSheet_();
        ensureAdHeaders_(sheet);
        return sheet;
      },
      buildParams: function (sinceStr, untilStr) {
        return {
          level: 'ad',
          time_increment: '1',
          include_archived: 'true',
          fields: 'ad_id,ad_name,adset_name,' + INSIGHT_FIELDS_,
          time_range: JSON.stringify({ since: sinceStr, until: untilStr })
        };
      },
      getSettings: function (accId, cache) {
        if (!cache[accId]) cache[accId] = fetchCampaignSettings(accId);
        return cache[accId];
      },
      buildRow: function (item, settings, acc) {
        return buildAdRow_(item, settings, acc);
      },
      removeRange: function (sheet, sinceStr, untilStr, accountIdSet) {
        removeAdRowsInRange_(sheet, sinceStr, untilStr, accountIdSet);
      },
      appendRows: function (sheet, rows) {
        appendAdRowsSafe_(sheet, rows);
      },
      freshnessKey: 'ads'
    };
  }

  throw new Error('Unsupported async backfill pipeline: ' + pipeline);
}

/**
 * Tạo Meta Async Insights Report Job (POST /{act_id}/insights).
 */
function createMetaAsyncInsightJob_(accountId, params, deadlineMs) {
  var url = 'https://graph.facebook.com/v18.0/' + accountId + '/insights';
  var wait = 2000;
  for (var attempt = 1; attempt <= 3; attempt++) {
    if (deadlineMs && attempt > 1 && Date.now() >= deadlineMs) {
      return { ok: false, timedOut: true, error: { message: 'Soft time budget reached before creating async job' } };
    }
    try {
      var resp = UrlFetchApp.fetch(url, {
        method: 'post',
        payload: params,
        headers: { Authorization: 'Bearer ' + ACCESS_TOKEN },
        muteHttpExceptions: true
      });
      var data = JSON.parse(resp.getContentText());
      if (data && data.report_run_id) {
        return { ok: true, reportRunId: String(data.report_run_id) };
      }
      var err = (data && data.error) ? data.error : { message: 'Missing report_run_id in response: ' + resp.getContentText() };
      if (asyncIsAccountRateLimited_(err)) {
        return { ok: false, rateLimited: true, error: err };
      }
      if (asyncIsQueryOverload_(err)) {
        return { ok: false, overload: true, error: err };
      }
      if (asyncIsTransient_(err) && attempt < 3) {
        if (deadlineMs && (Date.now() + wait) >= deadlineMs) {
          return { ok: false, timedOut: true, error: err };
        }
        Utilities.sleep(wait);
        wait *= 2;
        continue;
      }
      return { ok: false, error: err };
    } catch (e) {
      return { ok: false, error: { message: e.message } };
    }
  }
  return { ok: false, error: { message: 'Failed to create Meta async report job' } };
}

/**
 * Kiểm tra trạng thái Async Report Job trên Meta.
 */
function pollMetaAsyncInsightJob_(reportRunId) {
  var url = 'https://graph.facebook.com/v18.0/' + reportRunId + '?fields=id,async_status,async_percent_completion';
  try {
    var resp = UrlFetchApp.fetch(url, fetchOptions_());
    var data = JSON.parse(resp.getContentText());
    if (data && data.error) {
      if (asyncIsAccountRateLimited_(data.error)) {
        return { status: 'rate_limited', error: data.error };
      }
      if (asyncIsTransient_(data.error)) {
        return { status: 'transient_error', error: data.error };
      }
      return { status: 'error', error: data.error };
    }
    var st = String((data && data.async_status) || '');
    if (st === 'Job Completed') {
      return { status: 'completed', percent: 100 };
    }
    if (st === 'Job Failed' || st === 'Job Skipped') {
      return { status: 'failed', asyncStatus: st, error: { message: 'Meta async report status: ' + st } };
    }
    return {
      status: 'running',
      asyncStatus: st,
      percent: (data && typeof data.async_percent_completion === 'number') ? data.async_percent_completion : 0
    };
  } catch (e) {
    return { status: 'transient_error', error: { message: e.message } };
  }
}

/**
 * Tải toàn bộ trang kết quả của một Async Report Job đã hoàn tất.
 */
function fetchMetaAsyncInsightPages_(reportRunId, limit, deadlineMs) {
  var pageLimit = limit || ASYNC_BACKFILL_PAGE_LIMIT_;
  var nextUrl = 'https://graph.facebook.com/v18.0/' + reportRunId + '/insights?limit=' + pageLimit;
  var items = [];

  while (nextUrl) {
    if (deadlineMs && Date.now() >= deadlineMs) {
      return { ok: false, timedOut: true, items: [] };
    }
    var data = (typeof fetchWithRetry_ === 'function')
      ? fetchWithRetry_(nextUrl, 3, { failFastOnOverload: true, deadlineMs: deadlineMs })
      : JSON.parse(UrlFetchApp.fetch(nextUrl, fetchOptions_()).getContentText());

    if (!data || data.error) {
      var err = (data && data.error) ? data.error : { message: 'No response reading async report pages' };
      if (asyncIsAccountRateLimited_(err)) {
        return { ok: false, rateLimited: true, error: err };
      }
      if (asyncIsQueryOverload_(err)) {
        return { ok: false, overload: true, error: err };
      }
      return { ok: false, error: err };
    }

    var pageData = data.data || [];
    for (var i = 0; i < pageData.length; i++) items.push(pageData[i]);
    nextUrl = (data.paging && data.paging.next) ? data.paging.next : null;
    if (nextUrl) Utilities.sleep(150);
  }

  return { ok: true, items: items };
}

/**
 * Fallback đồng bộ cho đoạn 1 ngày duy nhất khi Async Report gặp sự cố.
 */
function fetchMetaSyncSingleDayFallback_(accountId, params, deadlineMs) {
  var baseUrl = 'https://graph.facebook.com/v18.0/' + accountId + '/insights';
  for (var li = 0; li < ASYNC_BACKFILL_SYNC_FALLBACK_LIMITS_.length; li++) {
    if (deadlineMs && Date.now() >= deadlineMs) {
      return { ok: false, timedOut: true, error: { message: 'Soft time budget reached' } };
    }
    var reqLimit = ASYNC_BACKFILL_SYNC_FALLBACK_LIMITS_[li];
    var fullParams = {};
    Object.keys(params).forEach(function (k) { fullParams[k] = params[k]; });
    fullParams.limit = reqLimit;
    var qs = Object.keys(fullParams).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(String(fullParams[k]));
    }).join('&');

    var nextUrl = baseUrl + '?' + qs;
    var items = [];
    var failedErr = null;
    var canShrinkLimit = (li < ASYNC_BACKFILL_SYNC_FALLBACK_LIMITS_.length - 1);

    do {
      if (deadlineMs && Date.now() >= deadlineMs) {
        return { ok: false, timedOut: true, error: { message: 'Soft time budget reached' } };
      }
      var data = (typeof fetchWithRetry_ === 'function')
        ? fetchWithRetry_(nextUrl, canShrinkLimit ? 2 : 3, { failFastOnOverload: canShrinkLimit, deadlineMs: deadlineMs })
        : JSON.parse(UrlFetchApp.fetch(nextUrl, fetchOptions_()).getContentText());

      if (!data || data.error) {
        failedErr = (data && data.error) ? data.error : { message: 'Sync fallback failed' };
        break;
      }
      var pageData = data.data || [];
      for (var i = 0; i < pageData.length; i++) items.push(pageData[i]);
      nextUrl = (data.paging && data.paging.next) ? data.paging.next : null;
      if (nextUrl) Utilities.sleep(150);
    } while (nextUrl);

    if (!failedErr) return { ok: true, items: items };
    if (asyncIsAccountRateLimited_(failedErr)) return { ok: false, rateLimited: true, error: failedErr };
    if (!asyncIsQueryOverload_(failedErr)) return { ok: false, error: failedErr };
  }
  return { ok: false, error: { message: 'Sync single-day fallback exhausted all limit steps' } };
}

/**
 * Xóa toàn bộ trigger cũ của bộ chạy backfill tự nối ca.
 */
function cleanupAsyncBackfillTriggers_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === ASYNC_BACKFILL_TRIGGER_HANDLER_) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  } catch (e) {
    Logger.log('cleanupAsyncBackfillTriggers_ warning: ' + e.message);
  }
}

/**
 * Hẹn trigger tự động chạy tiếp phần còn lại sau delayMs.
 */
function scheduleAsyncBackfillTrigger_(delayMs) {
  cleanupAsyncBackfillTriggers_();
  try {
    ScriptApp.newTrigger(ASYNC_BACKFILL_TRIGGER_HANDLER_)
      .timeBased()
      .after(Math.max(15000, delayMs || ASYNC_BACKFILL_RESUME_DELAY_MS_))
      .create();
    return { ok: true };
  } catch (e) {
    Logger.log('⚠️ Không thể tự tạo trigger nối ca (' + e.message + '). Vui lòng chạy thủ công hàm continueAsyncBackfillJob() để tiếp tục.');
    return { ok: false, error: e.message };
  }
}

/**
 * Ghi các kết quả đã hoàn tất trong bộ đệm xuống Google Sheets theo nhóm (pipeline + breakdown + date range).
 */
function flushAsyncBackfillBuffer_(bufferEntries) {
  if (!bufferEntries || !bufferEntries.length) return 0;

  var groups = {};
  var groupKeys = [];
  for (var i = 0; i < bufferEntries.length; i++) {
    var entry = bufferEntries[i];
    var key = entry.pipeline + '|' + (entry.breakdownType || '') + '|' + entry.since + '|' + entry.until;
    if (!groups[key]) {
      groups[key] = {
        pipeline: entry.pipeline,
        breakdownType: entry.breakdownType || null,
        since: entry.since,
        until: entry.until,
        accountIdSet: {},
        rows: []
      };
      groupKeys.push(key);
    }
    groups[key].accountIdSet[entry.accId] = true;
    for (var r = 0; r < entry.rows.length; r++) {
      groups[key].rows.push(entry.rows[r]);
    }
  }

  var writtenCount = 0;
  for (var k = 0; k < groupKeys.length; k++) {
    var g = groups[groupKeys[k]];
    var adapter = getBackfillPipelineAdapter_(g.pipeline, g.breakdownType);
    var sheet = adapter.getSheet();
    adapter.removeRange(sheet, g.since, g.until, g.accountIdSet);
    if (g.rows.length > 0) {
      adapter.appendRows(sheet, g.rows);
      writtenCount += g.rows.length;
    }
  }
  return writtenCount;
}

function advanceAsyncBackfillCursor_(state) {
  state.subQueue = [];
  state.activeRunId = null;
  state.activeRunCreatedAt = 0;
  state.aIdx++;

  if (state.aIdx >= state.accountIds.length) {
    state.aIdx = 0;
    state.wIdx++;
    if (state.wIdx >= state.windows.length) {
      state.wIdx = 0;
      state.bIdx++;
    }
  }

  if (state.bIdx < state.breakdownTypes.length && state.wIdx < state.windows.length) {
    var w = state.windows[state.wIdx];
    state.subQueue = [{ s: w.s, u: w.u }];
  }
}

function recordAsyncBackfillFailure_(state, acc, seg, errObj) {
  if (!state.failedTasks) state.failedTasks = [];
  if (state.failedTasks.length < 25) {
    state.failedTasks.push({
      acc: acc.name || acc.id,
      range: seg.s + '..' + seg.u,
      bType: state.breakdownTypes[state.bIdx] || null,
      err: String((errObj && errObj.message) ? errObj.message : JSON.stringify(errObj || '')).slice(0, 140)
    });
  }
}

/**
 * Khởi tạo và chạy một chiến dịch Backfill Async có khả năng tự nối ca qua trigger.
 */
function runAsyncBackfillJob_(jobConfig) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('⚠️ Đang có một tiến trình backfill khác đang chạy. Vui lòng đợi tiến trình đó hoàn tất hoặc chạy getAsyncBackfillStatus().');
    return { ok: false, locked: true };
  }

  try {
    cleanupAsyncBackfillTriggers_();

    var pipelines = (jobConfig.pipelines && jobConfig.pipelines.length)
      ? jobConfig.pipelines
      : [jobConfig.pipeline || 'campaign'];
    var pipeline = pipelines[0];
    var adapter = getBackfillPipelineAdapter_(pipeline, jobConfig.breakdownTypes ? jobConfig.breakdownTypes[0] : null);
    var sinceStr = jobConfig.since;
    var untilStr = jobConfig.until;
    var chunkDays = jobConfig.chunkDays || adapter.defaultChunkDays;
    var windows = asyncBuildReversedChunks_(sinceStr, untilStr, chunkDays);
    var accounts = getBackfillAccounts_();
    var breakdownTypes = (pipeline === 'breakdown')
      ? (jobConfig.breakdownTypes || ['age', 'gender', 'platform', 'placement', 'region'])
      : [null];

    if (!windows.length || !accounts.length) {
      Logger.log('runAsyncBackfillJob_: khoảng ngày hoặc danh sách tài khoản trống (' + sinceStr + '..' + untilStr + ').');
      return { ok: true, completed: true, rowsWritten: 0 };
    }

    var totalAccountSteps = 0;
    for (var pi = 0; pi < pipelines.length; pi++) {
      var pName = pipelines[pi];
      var pAdapter = getBackfillPipelineAdapter_(pName, null);
      var pChunk = (pi === 0 && jobConfig.chunkDays) ? jobConfig.chunkDays : pAdapter.defaultChunkDays;
      var pWins = asyncBuildReversedChunks_(sinceStr, untilStr, pChunk);
      var pBreakdowns = (pName === 'breakdown') ? ((jobConfig.breakdownTypes && jobConfig.breakdownTypes.length) || 5) : 1;
      totalAccountSteps += pWins.length * accounts.length * pBreakdowns;
    }

    var state = {
      jobId: 'backfill_' + Date.now(),
      pipelines: pipelines,
      pIdx: 0,
      pipeline: pipeline,
      since: sinceStr,
      until: untilStr,
      autoResume: jobConfig.autoResume !== false,
      breakdownTypes: breakdownTypes,
      windows: windows,
      accountIds: accounts.map(function (a) { return a.id; }),
      bIdx: 0,
      wIdx: 0,
      aIdx: 0,
      subQueue: [{ s: windows[0].s, u: windows[0].u }],
      activeRunId: null,
      activeRunCreatedAt: 0,
      completedAccountsSteps: 0,
      totalAccountSteps: totalAccountSteps,
      rowsWritten: 0,
      failedTasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    PropertiesService.getScriptProperties().setProperty(ASYNC_BACKFILL_STATE_PROP_, JSON.stringify(state));
    Logger.log('🚀 Bắt đầu Async Backfill [' + pipelines.join(' → ') + '] ' + sinceStr + '..' + untilStr +
      ' (tổng ' + totalAccountSteps + ' bước trên ' + accounts.length + ' tài khoản).');

    return executeAsyncBackfillBatch_(state, jobConfig.deadlineMs || (Date.now() + ASYNC_BACKFILL_SOFT_BUDGET_MS_));
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Callback cho Trigger nối ca tự động (và cũng có thể bấm chạy thủ công từ Editor để tiếp tục).
 */
function continueAsyncBackfillJob() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('continueAsyncBackfillJob: một phiên backfill khác đang chạy.');
    return { ok: false, locked: true };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(ASYNC_BACKFILL_STATE_PROP_);
    if (!raw) {
      cleanupAsyncBackfillTriggers_();
      Logger.log('continueAsyncBackfillJob: không có job nào đang chờ.');
      return { ok: true, completed: true, idle: true };
    }
    var state = JSON.parse(raw);
    return executeAsyncBackfillBatch_(state, Date.now() + ASYNC_BACKFILL_SOFT_BUDGET_MS_);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Thực thi 1 ca (tối đa ~4 phút) của job Backfill Async, tự flush & hẹn trigger nếu còn việc.
 */
function executeAsyncBackfillBatch_(state, deadlineMs) {
  var props = PropertiesService.getScriptProperties();
  var pendingBuffer = [];
  var bufferedRowsCount = 0;
  var settingsCache = {};
  var rateLimitedPause = false;
  var lastFreshnessKey = null;

  var flushNow = function () {
    if (!pendingBuffer.length) return;
    flushAsyncBackfillBuffer_(pendingBuffer);
    pendingBuffer = [];
    bufferedRowsCount = 0;
  };

  try {
    while (state.bIdx < state.breakdownTypes.length && state.wIdx < state.windows.length) {
      if (Date.now() >= deadlineMs) break;

      var bType = state.breakdownTypes[state.bIdx];
      var accId = state.accountIds[state.aIdx];
      var acc = findBackfillAccount_(accId);
      if (!state.subQueue || !state.subQueue.length) {
        var curWin = state.windows[state.wIdx];
        state.subQueue = [{ s: curWin.s, u: curWin.u }];
      }
      var seg = state.subQueue[0];
      var adapter = getBackfillPipelineAdapter_(state.pipeline, bType);
      if (adapter.freshnessKey) lastFreshnessKey = adapter.freshnessKey;
      var params = adapter.buildParams(seg.s, seg.u);

      // Bước 1: Tạo Async Report Job nếu chưa có activeRunId
      if (!state.activeRunId) {
        var createRes = createMetaAsyncInsightJob_(acc.id, params, deadlineMs);
        if (createRes.timedOut) break;
        if (createRes.rateLimited) {
          rateLimitedPause = true;
          Logger.log('⏸️ Meta rate-limit (80004/613) tại ' + acc.name + ' (' + seg.s + '..' + seg.u + ') — tạm nghỉ 5 phút rồi tự chạy tiếp.');
          break;
        }
        if (createRes.overload) {
          var halvesOnCreate = asyncSplitRangeInHalf_(seg.s, seg.u);
          if (halvesOnCreate) {
            Logger.log('⚠️ Async job overload khi tạo (' + acc.name + ', ' + seg.s + '..' + seg.u + ') — tự chia đôi.');
            state.subQueue = halvesOnCreate.concat(state.subQueue.slice(1));
            Utilities.sleep(300);
            continue;
          }
        }
        if (!createRes.ok) {
          Logger.log('❌ Lỗi tạo async job (' + acc.name + ', ' + seg.s + '..' + seg.u + '): ' + JSON.stringify(createRes.error));
          recordAsyncBackfillFailure_(state, acc, seg, createRes.error);
          state.subQueue.shift();
          if (!state.subQueue.length) {
            state.completedAccountsSteps++;
            advanceAsyncBackfillCursor_(state);
          }
          continue;
        }
        state.activeRunId = createRes.reportRunId;
        state.activeRunCreatedAt = Date.now();
      }

      // Bước 2: Poll trạng thái Async Job cho đến khi hoàn tất / lỗi / hết ngân sách ca hiện tại
      var jobReady = false;
      var jobFailed = false;
      var jobFailReason = null;

      while (true) {
        if (Date.now() >= deadlineMs) break;

        if (state.activeRunCreatedAt && (Date.now() - state.activeRunCreatedAt > ASYNC_BACKFILL_MAX_RUN_AGE_MS_)) {
          jobFailed = true;
          jobFailReason = { message: 'Async report exceeded 15m max age' };
          break;
        }

        var pollRes = pollMetaAsyncInsightJob_(state.activeRunId);
        if (pollRes.status === 'completed') {
          jobReady = true;
          break;
        }
        if (pollRes.status === 'rate_limited') {
          rateLimitedPause = true;
          Logger.log('⏸️ Meta rate-limit khi poll ' + state.activeRunId + ' (' + acc.name + ') — tạm nghỉ 5 phút.');
          break;
        }
        if (pollRes.status === 'failed' || pollRes.status === 'error') {
          jobFailed = true;
          jobFailReason = pollRes.error;
          break;
        }

        if (Date.now() + ASYNC_BACKFILL_POLL_INTERVAL_MS_ >= deadlineMs) {
          break;
        }
        Utilities.sleep(ASYNC_BACKFILL_POLL_INTERVAL_MS_);
      }

      if (rateLimitedPause) break;

      if (jobFailed) {
        state.activeRunId = null;
        state.activeRunCreatedAt = 0;
        var span = asyncDiffDaysInclusive_(seg.s, seg.u);
        if (span > 1) {
          var halvesOnFail = asyncSplitRangeInHalf_(seg.s, seg.u);
          Logger.log('⚠️ Async report failed (' + acc.name + ', ' + seg.s + '..' + seg.u + '): ' +
            JSON.stringify(jobFailReason) + ' — tự chia đôi khoảng ngày.');
          state.subQueue = halvesOnFail.concat(state.subQueue.slice(1));
          Utilities.sleep(300);
          continue;
        }

        // 1 ngày duy nhất mà Async vẫn lỗi -> dùng fallback đồng bộ với limit nhỏ (100 -> 50 -> 25)
        Logger.log('⚠️ Async report 1 ngày thất bại (' + acc.name + ', ' + seg.s + ') — thử fallback đồng bộ limit nhỏ.');
        var syncRes = fetchMetaSyncSingleDayFallback_(acc.id, params, deadlineMs);
        if (syncRes.timedOut) break;
        if (syncRes.rateLimited) {
          rateLimitedPause = true;
          break;
        }
        if (!syncRes.ok) {
          Logger.log('❌ Fallback đồng bộ thất bại (' + acc.name + ', ' + seg.s + '): ' + JSON.stringify(syncRes.error));
          recordAsyncBackfillFailure_(state, acc, seg, syncRes.error);
          state.subQueue.shift();
          if (!state.subQueue.length) {
            state.completedAccountsSteps++;
            advanceAsyncBackfillCursor_(state);
          }
          continue;
        }

        var syncSettings = adapter.getSettings(acc.id, settingsCache);
        var syncRows = syncRes.items.map(function (it) { return adapter.buildRow(it, syncSettings, acc); });
        pendingBuffer.push({
          pipeline: state.pipeline,
          breakdownType: bType,
          accId: acc.id,
          since: seg.s,
          until: seg.u,
          rows: syncRows
        });
        bufferedRowsCount += syncRows.length;
        state.rowsWritten += syncRows.length;
        state.subQueue.shift();
        if (!state.subQueue.length) {
          state.completedAccountsSteps++;
          advanceAsyncBackfillCursor_(state);
        }
        if (pendingBuffer.length >= 6 || bufferedRowsCount >= 2000) {
          flushNow();
        }
        continue;
      }

      if (!jobReady) {
        // Chạm soft deadline trong lúc Meta đang chạy ngầm -> giữ nguyên state.activeRunId để ca sau lấy ngay kết quả
        break;
      }

      // Bước 3: Tải các trang kết quả từ Async Job đã completed
      var pagesRes = fetchMetaAsyncInsightPages_(state.activeRunId, ASYNC_BACKFILL_PAGE_LIMIT_, deadlineMs);
      if (pagesRes.timedOut) {
        // Giữ nguyên state.activeRunId (đã completed trên Meta) để ca sau đọc lại trong vài giây
        break;
      }
      if (pagesRes.rateLimited) {
        rateLimitedPause = true;
        break;
      }
      if (pagesRes.overload && asyncDiffDaysInclusive_(seg.s, seg.u) > 1) {
        state.activeRunId = null;
        state.activeRunCreatedAt = 0;
        var halvesOnRead = asyncSplitRangeInHalf_(seg.s, seg.u);
        state.subQueue = halvesOnRead.concat(state.subQueue.slice(1));
        continue;
      }
      if (!pagesRes.ok) {
        Logger.log('❌ Lỗi đọc trang async report (' + acc.name + ', ' + seg.s + '..' + seg.u + '): ' + JSON.stringify(pagesRes.error));
        recordAsyncBackfillFailure_(state, acc, seg, pagesRes.error);
        state.activeRunId = null;
        state.activeRunCreatedAt = 0;
        state.subQueue.shift();
        if (!state.subQueue.length) {
          state.completedAccountsSteps++;
          advanceAsyncBackfillCursor_(state);
        }
        continue;
      }

      var accSettings = adapter.getSettings(acc.id, settingsCache);
      var builtRows = pagesRes.items.map(function (it) { return adapter.buildRow(it, accSettings, acc); });

      pendingBuffer.push({
        pipeline: state.pipeline,
        breakdownType: bType,
        accId: acc.id,
        since: seg.s,
        until: seg.u,
        rows: builtRows
      });
      bufferedRowsCount += builtRows.length;
      state.rowsWritten += builtRows.length;

      state.activeRunId = null;
      state.activeRunCreatedAt = 0;
      state.subQueue.shift();

      if (!state.subQueue.length) {
        state.completedAccountsSteps++;
        Logger.log('✅ [' + state.pipeline + (bType ? ':' + bType : '') + '] ' +
          state.completedAccountsSteps + '/' + state.totalAccountSteps +
          ' (' + acc.name + ', ' + seg.s + '..' + seg.u + '): ' + builtRows.length + ' dòng.');
        advanceAsyncBackfillCursor_(state);
      }

      if (pendingBuffer.length >= 6 || bufferedRowsCount >= 2000 || state.aIdx === 0) {
        flushNow();
      }
    }
  } finally {
    // Luôn flush mọi dữ liệu đã lấy được trước khi lưu checkpoint (đảm bảo không mất tiến độ & không lệch cursor)
    flushNow();
  }

  var currentPipelineDone = (state.bIdx >= state.breakdownTypes.length) || (state.wIdx >= state.windows.length);
  if (currentPipelineDone) {
    if (state.pipelines && (state.pIdx + 1) < state.pipelines.length) {
      state.pIdx++;
      state.pipeline = state.pipelines[state.pIdx];
      var nextAdapter = getBackfillPipelineAdapter_(state.pipeline, null);
      var nextChunk = nextAdapter.defaultChunkDays;
      state.windows = asyncBuildReversedChunks_(state.since, state.until, nextChunk);
      state.breakdownTypes = (state.pipeline === 'breakdown')
        ? (state.breakdownTypes || ['age', 'gender', 'platform', 'placement', 'region'])
        : [null];
      state.bIdx = 0;
      state.wIdx = 0;
      state.aIdx = 0;
      state.subQueue = state.windows.length ? [{ s: state.windows[0].s, u: state.windows[0].u }] : [];
      state.activeRunId = null;
      state.activeRunCreatedAt = 0;
      state.updatedAt = Date.now();
      Logger.log('➡️ Hoàn tất tầng trước! Tiếp tục chuyển sang tầng [' + state.pipeline + '] ' + state.since + '..' + state.until +
        ' (' + (state.pIdx + 1) + '/' + state.pipelines.length + ' tầng).');

      // Nếu còn nhiều hơn 45 giây trước soft deadline, tiếp tục ca hiện tại
      if (Date.now() + 45000 < deadlineMs) {
        return executeAsyncBackfillBatch_(state, deadlineMs);
      }
    }
  }

  var allDone = currentPipelineDone && (!state.pipelines || (state.pIdx + 1) >= state.pipelines.length);
  if (allDone) {
    props.deleteProperty(ASYNC_BACKFILL_STATE_PROP_);
    cleanupAsyncBackfillTriggers_();
    if (lastFreshnessKey && typeof markPipelineRefreshed_ === 'function') {
      markPipelineRefreshed_(lastFreshnessKey);
    }
    var failNote = (state.failedTasks && state.failedTasks.length)
      ? ' | ⚠️ ' + state.failedTasks.length + ' tác vụ lỗi (dữ liệu cũ của các tài khoản đó được giữ nguyên): ' + JSON.stringify(state.failedTasks)
      : ' | 0 lỗi.';
    var summaryName = state.pipelines ? state.pipelines.join(' → ') : state.pipeline;
    Logger.log('🎉 HOÀN TẤT Async Backfill [' + summaryName + '] ' + state.since + '..' + state.until +
      ': đã ghi tổng ' + state.rowsWritten + ' dòng (' + state.completedAccountsSteps + '/' +
      state.totalAccountSteps + ' lượt tài khoản-cửa sổ)' + failNote);
    return {
      ok: !(state.failedTasks && state.failedTasks.length),
      completed: true,
      rowsCount: state.rowsWritten,
      failedTasks: state.failedTasks || []
    };
  }

  state.updatedAt = Date.now();
  props.setProperty(ASYNC_BACKFILL_STATE_PROP_, JSON.stringify(state));

  var delayMs = rateLimitedPause ? ASYNC_BACKFILL_RATE_LIMIT_DELAY_MS_ : ASYNC_BACKFILL_RESUME_DELAY_MS_;
  var sched = state.autoResume ? scheduleAsyncBackfillTrigger_(delayMs) : { ok: false };
  var currentLabel = state.pipelines
    ? (state.pipeline + ' [' + (state.pIdx + 1) + '/' + state.pipelines.length + ' tầng]')
    : state.pipeline;
  Logger.log('⏳ Tạm dừng ca Async Backfill [' + currentLabel + '] ở mốc ' +
    state.completedAccountsSteps + '/' + state.totalAccountSteps + ' (đã ghi ' + state.rowsWritten + ' dòng). ' +
    (sched.ok
      ? ('Đã hẹn trigger tự chạy tiếp sau ' + Math.round(delayMs / 60000) + ' phút — bạn có thể đóng trình duyệt.')
      : 'Chạy continueAsyncBackfillJob() để tiếp tục phần còn lại.'));

  return {
    ok: true,
    completed: false,
    scheduledResume: !!sched.ok,
    rowsCount: state.rowsWritten,
    completedSteps: state.completedAccountsSteps,
    totalSteps: state.totalAccountSteps
  };
}

/**
 * Hủy job backfill đang chạy dở (nếu muốn dừng chủ động) và dọn sạch trigger.
 */
function cancelAsyncBackfillJob() {
  PropertiesService.getScriptProperties().deleteProperty(ASYNC_BACKFILL_STATE_PROP_);
  cleanupAsyncBackfillTriggers_();
  Logger.log('🛑 Đã hủy Async Backfill job và xóa toàn bộ trigger nối ca.');
}

/**
 * Xem trạng thái tiến độ của Async Backfill job hiện tại.
 */
function getAsyncBackfillStatus() {
  var raw = PropertiesService.getScriptProperties().getProperty(ASYNC_BACKFILL_STATE_PROP_);
  if (!raw) {
    Logger.log('Không có Async Backfill job nào đang chạy hoặc chờ.');
    return { isRunning: false, message: 'Không có tiến trình Backfill nào đang chạy.' };
  }
  var st = JSON.parse(raw);
  var pName = st.pipeline || 'unknown';
  if (st.pipelines && st.pipelines.length > 1) {
    pName = st.pipeline + ' (' + (st.pIdx + 1) + '/' + st.pipelines.length + ' tầng: ' + st.pipelines.join(' → ') + ')';
  }
  var percent = st.totalAccountSteps > 0 ? Math.round((st.completedAccountsSteps / st.totalAccountSteps) * 100) : 0;
  Logger.log('📊 Async Backfill [' + pName + '] ' + st.since + '..' + st.until + ': ' +
    st.completedAccountsSteps + '/' + st.totalAccountSteps + ' bước (' + percent + '%) | đã ghi ' + st.rowsWritten +
    ' dòng | activeRunId=' + (st.activeRunId || 'none'));
  st.isRunning = true;
  st.percent = percent;
  st.currentPipeline = st.pipeline;
  st.currentPipelineIndex = st.pIdx || 0;
  st.totalPipelines = (st.pipelines && st.pipelines.length) || 1;
  return st;
}
