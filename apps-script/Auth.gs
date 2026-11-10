/**
 * Auth.gs — Authentication, RBAC (per Ad Account), and User Management
 * for Google Apps Script backend.
 */

var AUTH_USERS_PROP_KEY_ = 'AUTH_USERS_V1';
var AUTH_SESSIONS_PROP_KEY_ = 'AUTH_SESSIONS_V1';
var AUTH_CACHE_PREFIX_ = 'AUTH_SESS_';
var AUTH_SESSION_TTL_SECONDS_ = 21600; // 6 gio
var AUTH_SESSION_TTL_MS_ = AUTH_SESSION_TTL_SECONDS_ * 1000;

var AUTH_SUPER_ADMIN_EMAIL_ = 'tanchuducbk@gmail.com';
var AUTH_ALPHA_USERNAME_ = 'alpha';
var AUTH_ALPHA_ACCOUNTS_ = [
  'act_988452388193871',
  'act_3863604326993604',
  'act_856434001679007',
  'act_1845118092714419'
];

var AUTH_COLOR_PALETTE_ = [
  '#0064E0', '#0866FF', '#10B981', '#8B5CF6', '#059669',
  '#F59E0B', '#EC4899', '#06B6D4', '#6366F1', '#EF4444', '#14B8A6'
];

// ── ACCOUNT METADATA HELPERS ─────────────────────────────────────────────────

function makeShortAccountNameMeta_(name, id) {
  var s = String(name || id || '').trim();
  if (s.length <= 24) return s;
  return s.slice(0, 22) + '…';
}

function getAllAdAccountsMeta_() {
  var raw = (typeof AD_ACCOUNTS !== 'undefined' && AD_ACCOUNTS && AD_ACCOUNTS.length)
    ? AD_ACCOUNTS
    : [];
  return raw.map(function (acc, idx) {
    var id = String(acc && acc.id || '').trim();
    var name = String(acc && acc.name || id).trim();
    return {
      id: id,
      name: name,
      shortName: (acc && acc.shortName) ? String(acc.shortName) : makeShortAccountNameMeta_(name, id),
      color: (acc && acc.color) ? String(acc.color) : AUTH_COLOR_PALETTE_[idx % AUTH_COLOR_PALETTE_.length]
    };
  }).filter(function (acc) { return !!acc.id; });
}

function getValidAccountIdMap_() {
  var map = {};
  getAllAdAccountsMeta_().forEach(function (acc) {
    map[acc.id] = true;
  });
  return map;
}

// ── CRYPTO & LOCK HELPERS ────────────────────────────────────────────────────

function withAuthLock_(fn) {
  var lock = null;
  var acquired = false;
  try {
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(10000);
  } catch (e) {
    lock = null;
  }
  try {
    return fn();
  } finally {
    if (lock && acquired) {
      try { lock.releaseLock(); } catch (e2) {}
    }
  }
}

function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function generateSessionToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function generateRandomPassword_(length) {
  var len = length || 14;
  var charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  var seedHex = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var out = [];
  for (var i = 0; i < len; i++) {
    var hexPair = seedHex.substr((i * 2) % seedHex.length, 2);
    var num = parseInt(hexPair, 16);
    var idx = (isNaN(num) ? (i * 7) : num) % charset.length;
    out.push(charset.charAt(idx));
  }
  return out.join('');
}

function hashPassword_(password, salt) {
  var input = String(salt || '') + ':' + String(password || '');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  var hex = [];
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i];
    if (v < 0) v += 256;
    var s = v.toString(16);
    hex.push(s.length === 1 ? '0' + s : s);
  }
  return hex.join('');
}

function constantTimeEqual_(a, b) {
  var sa = String(a == null ? '' : a);
  var sb = String(b == null ? '' : b);
  var len = Math.max(sa.length, sb.length);
  var diff = sa.length ^ sb.length;
  for (var i = 0; i < len; i++) {
    var ca = i < sa.length ? sa.charCodeAt(i) : 0;
    var cb = i < sb.length ? sb.charCodeAt(i) : 0;
    diff |= (ca ^ cb);
  }
  return diff === 0;
}

function verifyUserPassword_(rawUser, plainPassword) {
  if (!rawUser || !rawUser.passwordHash || !rawUser.salt) return false;
  if (typeof plainPassword !== 'string' || !plainPassword) return false;
  var computed = hashPassword_(plainPassword, rawUser.salt);
  return constantTimeEqual_(computed, rawUser.passwordHash);
}

// ── USER STORAGE & SEEDING ───────────────────────────────────────────────────

function readUsersMap_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AUTH_USERS_PROP_KEY_);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      var map = {};
      parsed.forEach(function (u) {
        if (u && u.username) {
          map[String(u.username).trim().toLowerCase()] = u;
        }
      });
      return map;
    }
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeUsersMap_(usersMap) {
  PropertiesService.getScriptProperties().setProperty(AUTH_USERS_PROP_KEY_, JSON.stringify(usersMap || {}));
}

function sanitizeUser_(u) {
  if (!u) return null;
  var role = u.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
  return {
    username: String(u.username || ''),
    email: String(u.email || ''),
    displayName: String(u.displayName || u.username || ''),
    role: role,
    isSuperAdmin: role === 'SUPER_ADMIN',
    allowedAccountIds: role === 'SUPER_ADMIN'
      ? ['ALL']
      : (Array.isArray(u.allowedAccountIds) ? u.allowedAccountIds.slice() : []),
    allowedAccounts: getAllowedAccountObjects_(u),
    isActive: u.isActive !== false,
    hasPassword: !!(u.passwordHash && u.salt),
    createdAt: u.createdAt || '',
    updatedAt: u.updatedAt || '',
    lastLoginAt: u.lastLoginAt || ''
  };
}

function findUserByIdentifier_(usersMap, identifier) {
  var needle = String(identifier || '').trim().toLowerCase();
  if (!needle) return null;
  if (usersMap[needle]) return usersMap[needle];
  var keys = Object.keys(usersMap);
  for (var i = 0; i < keys.length; i++) {
    var u = usersMap[keys[i]];
    if (!u) continue;
    var uname = String(u.username || '').trim().toLowerCase();
    var uemail = String(u.email || '').trim().toLowerCase();
    if (uname === needle || (uemail && uemail === needle)) {
      return u;
    }
  }
  return null;
}

/**
 * Seed 2 tai khoan mac dinh mot cach idempotent (khong ghi de neu da ton tai).
 */
function ensureDefaultUsers_() {
  var users = readUsersMap_();
  var superKey = AUTH_SUPER_ADMIN_EMAIL_.toLowerCase();
  var alphaKey = AUTH_ALPHA_USERNAME_.toLowerCase();

  if (users[superKey] && users[alphaKey]) {
    return users;
  }

  return withAuthLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var current = readUsersMap_();
    var changed = false;
    var nowIso = new Date().toISOString();

    if (!current[superKey]) {
      current[superKey] = {
        username: AUTH_SUPER_ADMIN_EMAIL_,
        email: AUTH_SUPER_ADMIN_EMAIL_,
        displayName: 'Super Admin',
        role: 'SUPER_ADMIN',
        allowedAccountIds: ['ALL'],
        isActive: true,
        passwordHash: '',
        salt: '',
        createdAt: nowIso,
        updatedAt: nowIso,
        lastLoginAt: ''
      };
      changed = true;
    }

    if (!current[alphaKey]) {
      var initialPropPass = String(props.getProperty('INITIAL_ALPHA_PASSWORD') || '').trim();
      var initialPass = initialPropPass || generateRandomPassword_(14);
      var salt = generateSalt_();
      var hash = hashPassword_(initialPass, salt);

      current[alphaKey] = {
        username: AUTH_ALPHA_USERNAME_,
        email: '',
        displayName: 'Admin Alpha',
        role: 'ADMIN',
        allowedAccountIds: AUTH_ALPHA_ACCOUNTS_.slice(),
        isActive: true,
        passwordHash: hash,
        salt: salt,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastLoginAt: ''
      };
      changed = true;

      if (!initialPropPass) {
        Logger.log('Auth seed lan dau: Mat khau tam cho user "' + AUTH_ALPHA_USERNAME_ + '" la: ' + initialPass);
        Logger.log('Vui long doi mat khau hoac chay setupAuthPasswords(superAdminPass, alphaPass) trong Apps Script editor.');
      } else {
        Logger.log('Auth seed lan dau: Da khoi tao user "' + AUTH_ALPHA_USERNAME_ + '" tu INITIAL_ALPHA_PASSWORD.');
      }
    }

    if (changed) {
      writeUsersMap_(current);
    }
    return current;
  });
}

/**
 * Ham tien ich chay tay trong Apps Script Editor de set/reset mat khau cho
 * Super Admin (tanchuducbk@gmail.com) va Admin Alpha (alpha).
 * Khong hardcode mat khau trong ma nguon.
 */
function setupAuthPasswords(superAdminPass, alphaPass) {
  ensureDefaultUsers_();
  return withAuthLock_(function () {
    var users = readUsersMap_();
    var nowIso = new Date().toISOString();
    var updated = [];

    if (typeof superAdminPass === 'string' && superAdminPass.length > 0) {
      if (superAdminPass.length < 6) {
        throw new Error('Mat khau Super Admin phai co it nhat 6 ky tu.');
      }
      var superKey = AUTH_SUPER_ADMIN_EMAIL_.toLowerCase();
      if (users[superKey]) {
        var sSalt = generateSalt_();
        users[superKey].salt = sSalt;
        users[superKey].passwordHash = hashPassword_(superAdminPass, sSalt);
        users[superKey].updatedAt = nowIso;
        updated.push(superKey);
      }
    }

    if (typeof alphaPass === 'string' && alphaPass.length > 0) {
      if (alphaPass.length < 6) {
        throw new Error('Mat khau Alpha phai co it nhat 6 ky tu.');
      }
      var alphaKey = AUTH_ALPHA_USERNAME_.toLowerCase();
      if (users[alphaKey]) {
        var aSalt = generateSalt_();
        users[alphaKey].salt = aSalt;
        users[alphaKey].passwordHash = hashPassword_(alphaPass, aSalt);
        users[alphaKey].updatedAt = nowIso;
        updated.push(alphaKey);
      }
    }

    if (updated.length) {
      writeUsersMap_(users);
      Logger.log('setupAuthPasswords: Da cap nhat mat khau cho: ' + updated.join(', '));
    } else {
      Logger.log('setupAuthPasswords: Khong co mat khau nao duoc truyen vao de cap nhat.');
    }
    return { ok: true, updated: updated };
  });
}

// ── SESSION MANAGEMENT (CacheService + PropertiesService) ────────────────────

function readSessionsMap_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AUTH_SESSIONS_PROP_KEY_);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function pruneExpiredSessions_(sessions, nowMs) {
  var cleaned = {};
  var now = nowMs || Date.now();
  var tokens = Object.keys(sessions || {});
  var validList = [];
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    var sess = sessions[tok];
    if (sess && sess.username && sess.expiresAt && Number(sess.expiresAt) > now) {
      validList.push({ token: tok, sess: sess });
    }
  }
  // Giu toi da 200 phien gan nhat de tranh vuot gioi han dung luong ScriptProperties
  if (validList.length > 200) {
    validList.sort(function (a, b) { return (b.sess.createdAt || 0) - (a.sess.createdAt || 0); });
    validList = validList.slice(0, 200);
  }
  for (var j = 0; j < validList.length; j++) {
    cleaned[validList[j].token] = validList[j].sess;
  }
  return cleaned;
}

function createSession_(username) {
  var token = generateSessionToken_();
  var now = Date.now();
  var sessionObj = {
    username: String(username || '').trim().toLowerCase(),
    createdAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS_
  };

  try {
    CacheService.getScriptCache().put(
      AUTH_CACHE_PREFIX_ + token,
      JSON.stringify(sessionObj),
      AUTH_SESSION_TTL_SECONDS_
    );
  } catch (e) {}

  withAuthLock_(function () {
    var sessions = pruneExpiredSessions_(readSessionsMap_(), now);
    sessions[token] = sessionObj;
    PropertiesService.getScriptProperties().setProperty(AUTH_SESSIONS_PROP_KEY_, JSON.stringify(sessions));
  });

  return token;
}

function getSession_(token) {
  var tok = String(token || '').trim();
  if (!tok) return null;
  var now = Date.now();

  try {
    var cached = CacheService.getScriptCache().get(AUTH_CACHE_PREFIX_ + tok);
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed && parsed.username && parsed.expiresAt && Number(parsed.expiresAt) > now) {
        return parsed;
      }
    }
  } catch (e) {}

  var sessions = readSessionsMap_();
  var stored = sessions[tok];
  if (stored && stored.username && stored.expiresAt && Number(stored.expiresAt) > now) {
    var remainSec = Math.max(1, Math.floor((Number(stored.expiresAt) - now) / 1000));
    try {
      CacheService.getScriptCache().put(
        AUTH_CACHE_PREFIX_ + tok,
        JSON.stringify(stored),
        Math.min(AUTH_SESSION_TTL_SECONDS_, remainSec)
      );
    } catch (e2) {}
    return stored;
  }

  return null;
}

function deleteSession_(token) {
  var tok = String(token || '').trim();
  if (!tok) return;
  try {
    CacheService.getScriptCache().remove(AUTH_CACHE_PREFIX_ + tok);
  } catch (e) {}

  withAuthLock_(function () {
    var sessions = pruneExpiredSessions_(readSessionsMap_(), Date.now());
    if (sessions[tok]) {
      delete sessions[tok];
    }
    PropertiesService.getScriptProperties().setProperty(AUTH_SESSIONS_PROP_KEY_, JSON.stringify(sessions));
  });
}

function revokeSessionsForUser_(username) {
  var target = String(username || '').trim().toLowerCase();
  if (!target) return;

  withAuthLock_(function () {
    var sessions = pruneExpiredSessions_(readSessionsMap_(), Date.now());
    var tokens = Object.keys(sessions);
    var cache = null;
    try { cache = CacheService.getScriptCache(); } catch (e) {}
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (sessions[tok] && String(sessions[tok].username || '').toLowerCase() === target) {
        if (cache) {
          try { cache.remove(AUTH_CACHE_PREFIX_ + tok); } catch (e2) {}
        }
        delete sessions[tok];
      }
    }
    PropertiesService.getScriptProperties().setProperty(AUTH_SESSIONS_PROP_KEY_, JSON.stringify(sessions));
  });
}

function touchUserLastLogin_(username) {
  var key = String(username || '').trim().toLowerCase();
  if (!key) return;
  withAuthLock_(function () {
    var users = readUsersMap_();
    if (users[key]) {
      users[key].lastLoginAt = new Date().toISOString();
      writeUsersMap_(users);
    }
  });
}

// ── MIDDLEWARE HELPERS FOR Code.gs ───────────────────────────────────────────

function resolveSessionToken_(sessionToken, payload) {
  if (typeof sessionToken === 'string' && sessionToken.trim()) {
    return sessionToken.trim();
  }
  if (sessionToken && typeof sessionToken === 'object' && sessionToken.sessionToken) {
    return String(sessionToken.sessionToken).trim();
  }
  if (payload && typeof payload === 'object' && payload.sessionToken) {
    return String(payload.sessionToken).trim();
  }
  return '';
}

function requireAuth_(sessionToken) {
  var users = ensureDefaultUsers_();
  var tok = resolveSessionToken_(sessionToken);
  if (!tok) {
    return { ok: false, authError: true, error: 'Phiên đăng nhập không hợp lệ hoặc chưa đăng nhập.' };
  }

  var sess = getSession_(tok);
  if (!sess) {
    return { ok: false, authError: true, error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' };
  }

  var user = findUserByIdentifier_(users, sess.username);
  if (!user || user.isActive === false) {
    deleteSession_(tok);
    return { ok: false, authError: true, error: 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa.' };
  }

  return {
    ok: true,
    user: user,
    sanitizedUser: sanitizeUser_(user)
  };
}

function requireSuperAdmin_(sessionToken) {
  var auth = requireAuth_(sessionToken);
  if (!auth.ok) return auth;
  if (auth.user.role !== 'SUPER_ADMIN') {
    return {
      ok: false,
      authError: false,
      forbidden: true,
      error: 'Bạn không có quyền Super Admin để thực hiện thao tác này.'
    };
  }
  return auth;
}

function getAllowedAccountIds_(authUser) {
  var validMap = getValidAccountIdMap_();
  var allIds = Object.keys(validMap);
  if (!authUser) return [];
  if (authUser.role === 'SUPER_ADMIN') {
    return allIds;
  }
  var raw = Array.isArray(authUser.allowedAccountIds) ? authUser.allowedAccountIds : [];
  var seen = {};
  var allowed = [];
  for (var i = 0; i < raw.length; i++) {
    var id = String(raw[i] || '').trim();
    if (id && validMap[id] && !seen[id]) {
      seen[id] = true;
      allowed.push(id);
    }
  }
  return allowed;
}

function getAllowedAccountObjects_(authUser) {
  var allowed = getAllowedAccountIds_(authUser);
  var allowedMap = {};
  allowed.forEach(function (id) { allowedMap[id] = true; });
  return getAllAdAccountsMeta_().filter(function (acc) {
    return !!allowedMap[acc.id];
  });
}

function enforceAccountScope_(filters, authUser) {
  var allowed = getAllowedAccountIds_(authUser);
  if (!allowed.length) return ['__DENIED_EMPTY__'];

  var rawRequested = (typeof normalizeAccountFilterList_ === 'function')
    ? normalizeAccountFilterList_(filters)
    : [];
  var hasAll = rawRequested.indexOf('ALL') !== -1;
  var requested = rawRequested.filter(function (x) { return x && x !== 'ALL'; });

  if (hasAll || !requested.length) {
    return allowed;
  }

  var allowedMap = {};
  allowed.forEach(function (id) { allowedMap[id] = true; });
  var intersection = requested.filter(function (id) { return !!allowedMap[id]; });
  return intersection.length ? intersection : ['__DENIED_EMPTY__'];
}

function isUnfilteredSuperAdmin_(filters, authUser) {
  if (!authUser || authUser.role !== 'SUPER_ADMIN') return false;
  var rawRequested = (typeof normalizeAccountFilterList_ === 'function')
    ? normalizeAccountFilterList_(filters)
    : [];
  var requested = rawRequested.filter(function (x) { return x && x !== 'ALL'; });
  return requested.length === 0;
}

// ── PUBLIC AUTH ENDPOINTS ────────────────────────────────────────────────────

function getActiveGasSessionEmail_() {
  try {
    var email = Session.getActiveUser().getEmail();
    return String(email || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

function getAuthConfig() {
  var users = ensureDefaultUsers_();
  var clientId = (typeof getGoogleOAuthClientId_ === 'function') ? getGoogleOAuthClientId_() : '';
  var activeEmail = getActiveGasSessionEmail_();
  var gasUser = activeEmail ? findUserByIdentifier_(users, activeEmail) : null;
  var gasSessionEmail = (gasUser && gasUser.isActive !== false) ? activeEmail : '';
  return {
    googleEnabled: !!clientId,
    googleClientId: clientId,
    gasSessionEmail: gasSessionEmail,
    gasSessionDisplayName: gasSessionEmail ? String(gasUser.displayName || gasUser.username || '') : ''
  };
}

/**
 * Dang nhap nhanh 1-click bang phien Google Apps Script hien tai
 * (chi hoat dong khi Google Apps Script tra ve email cua nguoi dung hop le qua Session.getActiveUser).
 */
function loginWithGasSession() {
  var activeEmail = getActiveGasSessionEmail_();
  if (!activeEmail) {
    return {
      ok: false,
      sessionToken: '',
      user: null,
      error: 'Không nhận diện được phiên Google Apps Script. Vui lòng đăng nhập bằng tài khoản & mật khẩu.'
    };
  }

  var users = ensureDefaultUsers_();
  var user = findUserByIdentifier_(users, activeEmail);
  if (!user) {
    return {
      ok: false,
      sessionToken: '',
      user: null,
      error: 'Email "' + activeEmail + '" chưa được cấp quyền truy cập dashboard.'
    };
  }
  if (user.isActive === false) {
    return {
      ok: false,
      sessionToken: '',
      user: null,
      error: 'Tài khoản "' + activeEmail + '" đã bị vô hiệu hóa.'
    };
  }

  var sessionToken = createSession_(user.username);
  touchUserLastLogin_(user.username);
  return {
    ok: true,
    sessionToken: sessionToken,
    user: sanitizeUser_(user),
    error: null
  };
}

function loginWithGoogle(idToken) {
  var tokenStr = String(idToken || '').trim();
  if (!tokenStr) {
    return { ok: false, sessionToken: '', user: null, error: 'Thiếu Google ID Token.' };
  }

  var clientId = (typeof getGoogleOAuthClientId_ === 'function') ? getGoogleOAuthClientId_() : '';
  if (!clientId) {
    return { ok: false, sessionToken: '', user: null, error: 'Google Sign-In chưa được cấu hình trên máy chủ.' };
  }

  var info;
  try {
    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokenStr);
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      return { ok: false, sessionToken: '', user: null, error: 'Xác thực Google ID Token thất bại.' };
    }
    info = JSON.parse(resp.getContentText());
  } catch (e) {
    return { ok: false, sessionToken: '', user: null, error: 'Không thể kết nối dịch vụ xác thực Google: ' + e.message };
  }

  if (!info || String(info.aud || '').trim() !== clientId) {
    return { ok: false, sessionToken: '', user: null, error: 'Google Token không khớp Client ID của ứng dụng.' };
  }
  var verified = (info.email_verified === true || String(info.email_verified).toLowerCase() === 'true');
  if (!verified) {
    return { ok: false, sessionToken: '', user: null, error: 'Email Google chưa được xác minh.' };
  }
  var expSec = Number(info.exp);
  if (!expSec || (expSec * 1000) <= Date.now()) {
    return { ok: false, sessionToken: '', user: null, error: 'Google Token đã hết hạn.' };
  }

  var email = String(info.email || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, sessionToken: '', user: null, error: 'Không đọc được email từ Google Token.' };
  }

  var users = ensureDefaultUsers_();
  var user = findUserByIdentifier_(users, email);
  if (!user) {
    return { ok: false, sessionToken: '', user: null, error: 'Email "' + email + '" chưa được cấp quyền truy cập dashboard.' };
  }
  if (user.isActive === false) {
    return { ok: false, sessionToken: '', user: null, error: 'Tài khoản "' + email + '" đã bị vô hiệu hóa.' };
  }

  var sessionToken = createSession_(user.username);
  touchUserLastLogin_(user.username);
  return {
    ok: true,
    sessionToken: sessionToken,
    user: sanitizeUser_(user),
    error: null
  };
}

function loginWithPassword(username, password) {
  var ident = String(username || '').trim().toLowerCase();
  var pass = typeof password === 'string' ? password : '';
  if (!ident || !pass) {
    return { ok: false, sessionToken: '', user: null, error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' };
  }

  var users = ensureDefaultUsers_();
  var user = findUserByIdentifier_(users, ident);
  if (!user) {
    return { ok: false, sessionToken: '', user: null, error: 'Tên đăng nhập hoặc mật khẩu không đúng.' };
  }
  if (user.isActive === false) {
    return { ok: false, sessionToken: '', user: null, error: 'Tài khoản đã bị vô hiệu hóa.' };
  }
  if (!user.passwordHash || !user.salt) {
    return {
      ok: false,
      sessionToken: '',
      user: null,
      error: 'Tài khoản chưa thiết lập mật khẩu. Vui lòng đăng nhập bằng Google hoặc liên hệ Super Admin.'
    };
  }
  if (!verifyUserPassword_(user, pass)) {
    return { ok: false, sessionToken: '', user: null, error: 'Tên đăng nhập hoặc mật khẩu không đúng.' };
  }

  var sessionToken = createSession_(user.username);
  touchUserLastLogin_(user.username);
  return {
    ok: true,
    sessionToken: sessionToken,
    user: sanitizeUser_(user),
    error: null
  };
}

function verifySession(sessionToken) {
  var auth = requireAuth_(sessionToken);
  if (!auth.ok) {
    return { ok: false, user: null, authError: true, error: auth.error };
  }
  return { ok: true, user: auth.sanitizedUser, authError: false, error: null };
}

function logoutUser(sessionToken) {
  var tok = resolveSessionToken_(sessionToken);
  if (tok) {
    deleteSession_(tok);
  }
  return { ok: true };
}

function changeOwnPassword(sessionToken, currentPassword, newPassword) {
  var auth = requireAuth_(sessionToken);
  if (!auth.ok) {
    return { ok: false, authError: true, error: auth.error };
  }
  var nextPass = typeof newPassword === 'string' ? newPassword : '';
  if (nextPass.length < 6) {
    return { ok: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' };
  }

  return withAuthLock_(function () {
    var users = readUsersMap_();
    var key = String(auth.user.username || '').trim().toLowerCase();
    var user = users[key];
    if (!user || user.isActive === false) {
      return { ok: false, authError: true, error: 'Tài khoản không tồn tại hoặc đã bị khóa.' };
    }
    if (user.passwordHash && user.salt) {
      if (!verifyUserPassword_(user, typeof currentPassword === 'string' ? currentPassword : '')) {
        return { ok: false, error: 'Mật khẩu hiện tại không đúng.' };
      }
    }
    var newSalt = generateSalt_();
    user.salt = newSalt;
    user.passwordHash = hashPassword_(nextPass, newSalt);
    user.updatedAt = new Date().toISOString();
    users[key] = user;
    writeUsersMap_(users);
    return { ok: true, error: null };
  });
}

// ── SUPER ADMIN USER CRUD ENDPOINTS ──────────────────────────────────────────

function countActiveSuperAdmins_(usersMap) {
  var count = 0;
  Object.keys(usersMap || {}).forEach(function (k) {
    var u = usersMap[k];
    if (u && u.role === 'SUPER_ADMIN' && u.isActive !== false) count++;
  });
  return count;
}

function buildSanitizedUsersList_(usersMap) {
  return Object.keys(usersMap || {}).sort().map(function (k) {
    return sanitizeUser_(usersMap[k]);
  });
}

function adminListUsers(sessionToken) {
  var auth = requireSuperAdmin_(sessionToken);
  if (!auth.ok) {
    return {
      ok: false,
      users: [],
      allAccounts: [],
      authError: !!auth.authError,
      forbidden: !!auth.forbidden,
      error: auth.error
    };
  }
  var users = ensureDefaultUsers_();
  return {
    ok: true,
    users: buildSanitizedUsersList_(users),
    allAccounts: getAllAdAccountsMeta_(),
    authError: false,
    error: null
  };
}

function adminSaveUser(sessionToken, payload) {
  var auth = requireSuperAdmin_(sessionToken);
  if (!auth.ok) {
    return { ok: false, authError: !!auth.authError, forbidden: !!auth.forbidden, error: auth.error };
  }
  payload = payload || {};
  var mode = payload.mode === 'edit' ? 'edit' : 'create';
  var username = String(payload.username || '').trim().toLowerCase();
  var targetKey = mode === 'edit'
    ? String(payload.originalUsername || payload.username || '').trim().toLowerCase()
    : username;

  if (!targetKey || !/^[a-z0-9._@-]{3,80}$/.test(targetKey)) {
    return { ok: false, error: 'Tên đăng nhập không hợp lệ (3-80 ký tự: a-z, 0-9, ., _, @, -).' };
  }

  var role = payload.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (payload.role === 'ADMIN' ? 'ADMIN' : '');
  if (!role) {
    return { ok: false, error: 'Vai trò không hợp lệ (chỉ chấp nhận SUPER_ADMIN hoặc ADMIN).' };
  }

  var email = String(payload.email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Định dạng email không hợp lệ.' };
  }

  var displayName = String(payload.displayName || '').trim() || targetKey;
  var isActive = payload.isActive !== false;
  var rawPass = typeof payload.password === 'string' ? payload.password : '';
  if (rawPass && rawPass.length < 6) {
    return { ok: false, error: 'Mật khẩu phải có ít nhất 6 ký tự.' };
  }

  var validMap = getValidAccountIdMap_();
  var allowedAccountIds = [];
  if (role === 'SUPER_ADMIN') {
    allowedAccountIds = ['ALL'];
  } else {
    var reqIds = Array.isArray(payload.allowedAccountIds) ? payload.allowedAccountIds : [];
    if (reqIds.indexOf('ALL') !== -1) {
      allowedAccountIds = Object.keys(validMap);
    } else {
      var seen = {};
      reqIds.forEach(function (id) {
        var clean = String(id || '').trim();
        if (clean && validMap[clean] && !seen[clean]) {
          seen[clean] = true;
          allowedAccountIds.push(clean);
        }
      });
    }
  }

  ensureDefaultUsers_();

  var result = withAuthLock_(function () {
    var users = readUsersMap_();
    var nowIso = new Date().toISOString();

    // Kiem tra trung email voi user khac
    if (email) {
      var keys = Object.keys(users);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === targetKey) continue;
        var other = users[k];
        if (!other) continue;
        var oEmail = String(other.email || '').trim().toLowerCase();
        var oUser = String(other.username || '').trim().toLowerCase();
        if (oEmail === email || oUser === email) {
          return { ok: false, error: 'Email "' + email + '" đã thuộc về tài khoản khác.' };
        }
      }
    }

    if (mode === 'create') {
      if (users[targetKey]) {
        return { ok: false, error: 'Tên đăng nhập "' + targetKey + '" đã tồn tại.' };
      }
      if (!rawPass && !email) {
        return { ok: false, error: 'Tài khoản mới cần có mật khẩu (tối thiểu 6 ký tự) hoặc email Google.' };
      }
      var newSalt = rawPass ? generateSalt_() : '';
      var newHash = rawPass ? hashPassword_(rawPass, newSalt) : '';
      users[targetKey] = {
        username: targetKey,
        email: email,
        displayName: displayName,
        role: role,
        allowedAccountIds: allowedAccountIds,
        isActive: isActive,
        passwordHash: newHash,
        salt: newSalt,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastLoginAt: ''
      };
      writeUsersMap_(users);
      return {
        ok: true,
        user: sanitizeUser_(users[targetKey]),
        users: buildSanitizedUsersList_(users),
        revokeTarget: false,
        error: null
      };
    }

    // mode === 'edit'
    var existing = users[targetKey];
    if (!existing) {
      return { ok: false, error: 'Không tìm thấy tài khoản "' + targetKey + '".' };
    }

    var actorKey = String(auth.user.username || '').trim().toLowerCase();
    if (targetKey === actorKey && (!isActive || role !== 'SUPER_ADMIN')) {
      return { ok: false, error: 'Không thể tự khóa hoặc tự hạ quyền Super Admin của chính mình.' };
    }

    if (existing.role === 'SUPER_ADMIN' && existing.isActive !== false && (!isActive || role !== 'SUPER_ADMIN')) {
      var activeSupers = countActiveSuperAdmins_(users);
      if (activeSupers <= 1) {
        return { ok: false, error: 'Không thể khóa hoặc hạ quyền Super Admin cuối cùng đang hoạt động.' };
      }
    }

    var oldRole = existing.role;
    var oldAllowed = JSON.stringify(existing.allowedAccountIds || []);
    var newAllowed = JSON.stringify(allowedAccountIds);

    existing.email = email;
    existing.displayName = displayName;
    existing.role = role;
    existing.allowedAccountIds = allowedAccountIds;
    existing.isActive = isActive;
    existing.updatedAt = nowIso;

    if (rawPass) {
      var uSalt = generateSalt_();
      existing.salt = uSalt;
      existing.passwordHash = hashPassword_(rawPass, uSalt);
    }

    users[targetKey] = existing;
    writeUsersMap_(users);

    var shouldRevoke = !isActive || (oldRole !== role) || (oldAllowed !== newAllowed);
    return {
      ok: true,
      user: sanitizeUser_(existing),
      users: buildSanitizedUsersList_(users),
      revokeTarget: shouldRevoke,
      error: null
    };
  });

  if (result.ok && result.revokeTarget) {
    revokeSessionsForUser_(targetKey);
  }
  delete result.revokeTarget;
  return result;
}

function adminToggleUserStatus(sessionToken, targetUsername, isActive) {
  var auth = requireSuperAdmin_(sessionToken);
  if (!auth.ok) {
    return { ok: false, authError: !!auth.authError, forbidden: !!auth.forbidden, error: auth.error };
  }
  var targetKey = String(targetUsername || '').trim().toLowerCase();
  if (!targetKey) {
    return { ok: false, error: 'Thiếu tên tài khoản mục tiêu.' };
  }
  var nextActive = !!isActive;
  var actorKey = String(auth.user.username || '').trim().toLowerCase();
  if (targetKey === actorKey && !nextActive) {
    return { ok: false, error: 'Không thể tự khóa tài khoản đang đăng nhập.' };
  }

  ensureDefaultUsers_();
  var res = withAuthLock_(function () {
    var users = readUsersMap_();
    var target = users[targetKey];
    if (!target) {
      return { ok: false, error: 'Không tìm thấy tài khoản "' + targetKey + '".' };
    }
    if (target.role === 'SUPER_ADMIN' && target.isActive !== false && !nextActive) {
      if (countActiveSuperAdmins_(users) <= 1) {
        return { ok: false, error: 'Không thể khóa Super Admin cuối cùng đang hoạt động.' };
      }
    }
    target.isActive = nextActive;
    target.updatedAt = new Date().toISOString();
    users[targetKey] = target;
    writeUsersMap_(users);
    return {
      ok: true,
      user: sanitizeUser_(target),
      users: buildSanitizedUsersList_(users),
      error: null
    };
  });

  if (res.ok && !nextActive) {
    revokeSessionsForUser_(targetKey);
  }
  return res;
}

function adminResetUserPassword(sessionToken, targetUsername, newPassword) {
  var auth = requireSuperAdmin_(sessionToken);
  if (!auth.ok) {
    return { ok: false, authError: !!auth.authError, forbidden: !!auth.forbidden, error: auth.error };
  }
  var targetKey = String(targetUsername || '').trim().toLowerCase();
  var nextPass = typeof newPassword === 'string' ? newPassword : '';
  if (!targetKey) {
    return { ok: false, error: 'Thiếu tên tài khoản mục tiêu.' };
  }
  if (nextPass.length < 6) {
    return { ok: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' };
  }

  ensureDefaultUsers_();
  var res = withAuthLock_(function () {
    var users = readUsersMap_();
    var target = users[targetKey];
    if (!target) {
      return { ok: false, error: 'Không tìm thấy tài khoản "' + targetKey + '".' };
    }
    var salt = generateSalt_();
    target.salt = salt;
    target.passwordHash = hashPassword_(nextPass, salt);
    target.updatedAt = new Date().toISOString();
    users[targetKey] = target;
    writeUsersMap_(users);
    return { ok: true, user: sanitizeUser_(target), error: null };
  });

  if (res.ok) {
    var actorKey = String(auth.user.username || '').trim().toLowerCase();
    if (targetKey !== actorKey) {
      revokeSessionsForUser_(targetKey);
    }
  }
  return res;
}
