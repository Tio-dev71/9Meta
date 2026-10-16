const TEXT_FIELDS = ['groupId', 'name', 'desc', 'type', 'creatorId', 'avt', 'fullAvt'];
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const OPTIONAL_TEXT_FIELDS = new Set(['desc', 'type', 'creatorId', 'avt', 'fullAvt']);
const MAX_TEXT_LENGTH = 16_384;
const MAX_TOTAL_MEMBER = 10_000_000;
const LEAVE_GROUP_POLICY = Object.freeze({
  maxPerRun: 1_000,
  minDelayMs: 5_000,
  maxDelayMs: 10_000,
  pauseEvery: 5,
  minPauseMs: 60_000,
  maxPauseMs: 120_000,
  maxPerDay: 1_000,
});

function randomIntegerInclusive(minimum, maximum, random = Math.random) {
  const ratio = Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.min(maximum, minimum + Math.floor(ratio * (maximum - minimum + 1)));
}

function getLeavePolicyWaitMs(processedCount, random = Math.random) {
  const isLongPause = Number(processedCount) > 0 && Number(processedCount) % LEAVE_GROUP_POLICY.pauseEvery === 0;
  return isLongPause
    ? randomIntegerInclusive(LEAVE_GROUP_POLICY.minPauseMs, LEAVE_GROUP_POLICY.maxPauseMs, random)
    : randomIntegerInclusive(LEAVE_GROUP_POLICY.minDelayMs, LEAVE_GROUP_POLICY.maxDelayMs, random);
}

function getDailyLeaveUsageKey(profileId, date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}:${String(profileId || '')}`;
}

function normalizeText(value, field) {
  if (value === null || value === undefined) {
    if (OPTIONAL_TEXT_FIELDS.has(field)) return '';
    throw new TypeError(`${field} is required`);
  }
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`${field} must be a primitive value`);
  }
  const normalized = String(value)
    .replace(/[|\t\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  if (!normalized && !OPTIONAL_TEXT_FIELDS.has(field)) throw new TypeError(`${field} is required`);
  return normalized;
}

function normalizeGroupDto(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('group DTO must be an object');
  const result = {};
  for (const field of TEXT_FIELDS) result[field] = normalizeText(input[field], field);
  if (!Number.isInteger(input.totalMember) || input.totalMember < 0 || input.totalMember > MAX_TOTAL_MEMBER) {
    throw new TypeError('totalMember must be an integer between 0 and 10000000');
  }
  result.totalMember = input.totalMember;
  result.createdTime = Number.isFinite(Number(input.createdTime)) ? Number(input.createdTime) : 0;
  result.sourceIndex = Number.isInteger(input.sourceIndex) && input.sourceIndex >= 0 ? input.sourceIndex : 0;
  return result;
}

function compareUtf16Ordinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi')
    .replace(/\s+/g, ' ')
    .trim();
}

function filterAndSortGroups(groups, { query = '', sort = 'name-asc' } = {}) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  const result = (Array.isArray(groups) ? groups : []).filter((group) => {
    const name = normalizeSearchText(group?.name);
    return terms.every((term) => name.includes(term));
  });
  const nameCollator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  const tieBreak = (a, b) => compareUtf16Ordinal(String(a.groupId || ''), String(b.groupId || ''));
  const numeric = (field, direction = 1) => (a, b) => {
    const difference = (Number(a?.[field]) || 0) - (Number(b?.[field]) || 0);
    return difference ? difference * direction : tieBreak(a, b);
  };
  const comparators = {
    'name-asc': (a, b) => nameCollator.compare(String(a.name || ''), String(b.name || '')) || tieBreak(a, b),
    'name-desc': (a, b) => nameCollator.compare(String(b.name || ''), String(a.name || '')) || tieBreak(a, b),
    'members-asc': numeric('totalMember'),
    'members-desc': numeric('totalMember', -1),
    'created-asc': numeric('createdTime'),
    'created-desc': numeric('createdTime', -1),
    source: numeric('sourceIndex'),
  };
  return result.sort(comparators[sort] || comparators['name-asc']);
}

function buildBulkGroupPlan(groups, selectedIds, limit = 50) {
  const wanted = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  const plan = (Array.isArray(groups) ? groups : [])
    .filter((group) => wanted.has(String(group?.groupId || '')))
    .map((group) => ({ groupId: String(group.groupId), name: String(group.name || '').trim() }))
    .filter((group) => group.groupId && group.name);
  if (!plan.length) throw new Error('Hãy chọn ít nhất một nhóm.');
  if (plan.length > limit) throw new Error(`Mỗi lượt chỉ xử lý tối đa ${limit} nhóm.`);
  return plan;
}

function findAmbiguousGroupNames(groups, selectedIds) {
  const wanted = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  const names = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const normalizedName = normalizeSearchText(group?.name);
    if (!normalizedName) continue;
    const entry = names.get(normalizedName) || { count: 0, selectedLabel: null };
    entry.count += 1;
    if (wanted.has(String(group?.groupId || '')) && !entry.selectedLabel) {
      entry.selectedLabel = String(group.name || '').trim();
    }
    names.set(normalizedName, entry);
  }
  return Array.from(names.values())
    .filter((entry) => entry.count > 1 && entry.selectedLabel)
    .map((entry) => entry.selectedLabel)
    .sort(compareUtf16Ordinal);
}

function buildLeaveGroupScript(groupId) {
  const encodedGroupId = JSON.stringify(String(groupId));
  return `(async function() {
    if (window.location.hostname !== 'chat.zalo.me') return { ok: false, message: 'Profile không ở Zalo Web.' };
    var groupId = ${encodedGroupId};
    // KHONG bam mot ten groupManager nua: Zalo doi ten la duong roi chet ngay giong
    // loi quet truoc day. Thu nhieu ten de kiem tra nhom con ton tai; khong co manager
    // nao thi van cho di tiep vi buoc roi that chi can API webpack ben duoi.
    var managerNames = ['groupManager', 'GroupManager', 'groupListManager', 'GroupListManager', 'conversationManager', 'chatManager'];
    var manager = null;
    for (var managerIndex = 0; managerIndex < managerNames.length; managerIndex += 1) {
      var candidate = window[managerNames[managerIndex]];
      if (candidate && (typeof candidate.getGroupByIdSync === 'function' || typeof candidate.getGroupById === 'function')) { manager = candidate; break; }
    }
    var group = null;
    try {
      if (manager) {
        group = typeof manager.getGroupByIdSync === 'function'
          ? manager.getGroupByIdSync(groupId)
          : (typeof manager.getGroupById === 'function' ? manager.getGroupById(groupId) : null);
        if (group && typeof group.then === 'function') { try { group = await Promise.race([group, new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 5000); })]); } catch { group = null; } }
      }
    } catch { group = null; }
    if (manager && !group) return { ok: false, message: 'Nhóm không còn tồn tại trong phiên Zalo hiện tại.' };
    try {
      if (!window.__9MetaWebpackRequire) {
        var probeId = '__9meta_leave_probe_' + Date.now();
        var probeModules = {};
        probeModules[probeId] = function(module, exports, require) { window.__9MetaWebpackRequire = require; };
        try {
          var globalRequire = window.webpackChunk_zalo_web && window.webpackChunk_zalo_web.push ? window.webpackChunk_zalo_web.push : null;
          if (!globalRequire && window.webpackJsonp && typeof window.webpackJsonp.push === 'function') {
            window.webpackJsonp.push([[probeId], probeModules, [[probeId]]]);
          } else if (window.webpackChunk_zalo_web && typeof window.webpackChunk_zalo_web.push === 'function') {
            window.webpackChunk_zalo_web.push([[probeId], probeModules, [[probeId]]]);
          } else {
            return { ok: false, incompatible: true, message: 'Không tìm thấy bộ nạp module của Zalo Web.' };
          }
        } catch (probeError) {
          return { ok: false, incompatible: true, message: 'Không tìm thấy bộ nạp module của Zalo Web.' };
        }
      }
      var require = window.__9MetaWebpackRequire;
      var leaveApi = null; var leaveApiModuleId = null;
      var modules = require && require.c ? require.c : {};
      for (var moduleId in modules) {
        var exported = modules[moduleId] && modules[moduleId].exports;
        var candidates = [exported, exported && exported.default];
        for (var index = 0; index < candidates.length; index += 1) {
          var candidate = candidates[index];
          if (!candidate || typeof candidate.leaveGroup !== 'function') continue;
          var source = Function.prototype.toString.call(candidate.leaveGroup);
          if (/\\/api\\/group\\/leave/.test(source)) { leaveApi = candidate; leaveApiModuleId = String(moduleId); break; }
        }
        if (leaveApi) break;
      }
      if (!leaveApi) {
        return { ok: false, incompatible: true, message: 'Không tìm thấy API rời nhóm đã xác minh trong phiên Zalo Web.' };
      }
      // Ham trich ma loi dung chung: duyet ca cap ngoai va data. Zalo boc ma loi
      // theo 2 dang: so (error_code: 0) hoac object { "0": { error_code: 0, ... } }.
      // Dang object cu doc nhu 'String(object)' thanh "[object Object]" -> luon fail.
      var normalizeCode = function(value) {
        if (value === undefined || value === null || value === '') return undefined;
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          var trimmed = value.trim();
          if (!trimmed || trimmed === '[object Object]') return undefined;
          var asNumber = Number(trimmed);
          return Number.isNaN(asNumber) ? trimmed : asNumber;
        }
        if (typeof value === 'object') {
          var innerKeys = Object.keys(value);
          if (!innerKeys.length) return undefined;
          for (var k = 0; k < innerKeys.length; k++) {
            var inner = value[innerKeys[k]];
            if (inner !== undefined && inner !== null && inner !== '') {
              if (typeof inner === 'object') {
                var v = inner.error_code ?? inner.errorCode ?? inner.code ?? inner.error ?? inner.ret;
                if (v !== undefined && v !== null && String(v) !== '') return v;
              } else return inner;
            }
          }
          return undefined;
        }
        return value;
      };
      var readReply = function(value) {
        var code, msg;
        try {
          if (value && typeof value === 'object') {
            var dataObj = value.data && typeof value.data === 'object' ? value.data : null;
            var cands = [value.error, value.error_code, value.errorCode, value.code, value.ret,
              dataObj && dataObj.error, dataObj && dataObj.error_code, dataObj && dataObj.errorCode, dataObj && dataObj.code];
            for (var c = 0; c < cands.length; c++) {
              var normalized = normalizeCode(cands[c]);
              if (normalized !== undefined) { code = normalized; break; }
            }
            msg = value.message || value.msg || value.error_message || (dataObj && (dataObj.message || dataObj.msg)) || '';
          }
        } catch {}
        return { code: code, msg: msg };
      };
      var rawResult = null, rawResult2 = null, attemptUsed = -1, attemptParams = '', attemptsTried = 0;
      var leaveApiSourceHead = '', leaveApiArity = -1;
      try { leaveApiArity = leaveApi.leaveGroup.length; } catch {}
      try { leaveApiSourceHead = Function.prototype.toString.call(leaveApi.leaveGroup).slice(0, 300); } catch {}
      // Zalo tra "Successful!" ca khi goi sai tham so (thieu memberId cua chinh
      // minh trong nhom) nen chi mot dau khong du de ket luan. Cac dang goi duoc
      // thu lan luot cho den khi nhom bien mat khoi cache cua Zalo:
      //   0: leaveGroup(groupId)
      //   1: leaveGroup({ groupId: groupId })
      //   2: leaveGroup(groupId, memberId) — memberId lay tu chinh object nhom
      // Tham so nao that bai se ghi vao log de lan sau sua dung nhanh.
      var groupKeys = '';
      try { if (group && typeof group === 'object') groupKeys = Object.keys(group).slice(0, 40).join(','); } catch {}
      var memberId = '';
      var safeId = function(value) {
        if (value === undefined || value === null) return '';
        if (typeof value === 'object' || typeof value === 'function') return '';
        return String(value).replace(/\s+/g, ' ').trim().slice(0, 128);
      };
      if (group && typeof group === 'object') {
        memberId = safeId(group.memberId) || safeId(group.member_id) || safeId(group.userIdInGroup)
          || safeId(group.userId) || safeId(group.myMemberId) || safeId(group.memberID) || '';
      }
      var paramShapes = [
        { desc: 'groupId', args: [groupId] },
        { desc: 'object{groupId}', args: [{ groupId: groupId }] },
        { desc: 'groupId+memberId', args: memberId ? [groupId, memberId] : null },
      ];
      // Doc trang thái nhom tu cache Zalo: null = doc duoc va khong con; undefined
      // = khong doc duoc (loi/timeout) — hai truong hop nay khac nhau.
      var readGroupNow = function() {
        if (!manager) return undefined;
        var one = null;
        try {
          one = typeof manager.getGroupByIdSync === 'function'
            ? manager.getGroupByIdSync(groupId)
            : (typeof manager.getGroupById === 'function' ? manager.getGroupById(groupId) : null);
        } catch { return undefined; }
        if (one && typeof one.then === 'function') return undefined;
        return one || null;
      };
      var withTimeoutCall = (fn) => Promise.race([fn(), new Promise(function(_, reject) { setTimeout(function() { reject(new Error('Zalo không phản hồi lệnh rời nhóm (quá 20 giây).')); }, 20000); })]);
      var callError = null, callErrorShapes = '';
      for (var attempt = 0; attempt < paramShapes.length; attempt += 1) {
        var shape = paramShapes[attempt];
        if (!shape.args) continue;
        attemptsTried += 1;
        var shapeArgs = shape.args;
        try {
          var callResult = await withTimeoutCall(function() { return leaveApi.leaveGroup.apply(leaveApi, shapeArgs); });
          if (attempt === 0) rawResult = callResult; else rawResult2 = callResult;
          var shapeReply = readReply(callResult);
          if (shapeReply.code !== undefined && String(shapeReply.code) !== '0') {
            callError = { message: String(shapeReply.msg || ('Zalo báo lỗi rời nhóm: ' + String(shapeReply.code))), code: shapeReply.code };
            callErrorShapes += (callErrorShapes ? ',' : '') + shape.desc;
            continue;
          }
          attemptUsed = attempt; attemptParams = shape.desc; callError = null;
        } catch (error) {
          callError = { message: error && error.message ? error.message : String(error), code: 'throw' };
          callErrorShapes += (callErrorShapes ? ',' : '') + shape.desc;
          continue;
        }
        // Zalo da nhan lenh (thuong tra "Successful!"): cho cache cap nhat roi kiem
        // trai nhau; chi thu dang tham so tiep theo khi nhom van con.
        for (var settle = 0; settle < 3; settle += 1) {
          await new Promise(function(resolve) { setTimeout(resolve, 1000); });
          if (readGroupNow() === null) break;
        }
        if (readGroupNow() === null) break;
      }
      if (callError) {
        var failedText = '';
        try { failedText = JSON.stringify(rawResult2 !== null && rawResult2 !== undefined ? rawResult2 : rawResult) || ''; } catch { failedText = String(rawResult2 !== null && rawResult2 !== undefined ? rawResult2 : rawResult); }
        if (failedText.length > 2000) failedText = failedText.slice(0, 2000);
        return { ok: false, message: callError.message, attemptParams: attemptParams || ('fail:' + callErrorShapes), attemptsTried: attemptsTried, groupKeys: groupKeys, memberId: memberId ? 'yes' : 'no', raw: failedText, rawType: typeof rawResult, leaveApiModuleId: leaveApiModuleId, leaveApiArity: leaveApiArity, leaveApiSourceHead: leaveApiSourceHead };
      }
      var rawText = '';
      var rawType = typeof rawResult;
      var rawKeys = '';
      try { rawText = JSON.stringify(rawResult); if (rawText && rawText.length > 2000) rawText = rawText.slice(0, 2000); } catch { rawText = String(rawResult); if (rawText.length > 2000) rawText = rawText.slice(0, 2000); }
      try { if (rawResult && typeof rawResult === 'object') rawKeys = Object.keys(rawResult).slice(0, 20).join(','); } catch {}
      try { if (rawResult2 !== null && rawResult2 !== undefined) { rawText += ' | ' + JSON.stringify(rawResult2); if (rawText.length > 3000) rawText = rawText.slice(0, 3000); } } catch {}
      var errCode = readReply(rawResult).code, errMsg = readReply(rawResult).msg;
      if (errCode !== undefined && String(errCode) !== '0' && errCode !== 0) {
        return { ok: false, message: String(errMsg || rawResult.error || rawResult.error_code || rawResult.errorCode || ('Zalo báo lỗi rời nhóm: ' + String(errCode))), raw: rawText, rawType: rawType, rawKeys: rawKeys, leaveApiModuleId: leaveApiModuleId, leaveApiArity: leaveApiArity, leaveApiSourceHead: leaveApiSourceHead };
      }
      var isEmptyReply = rawResult === null || rawResult === undefined || rawResult === true
        || (typeof rawResult === 'string' && !rawResult.trim())
        || (typeof rawResult === 'object' && Object.keys(rawResult).length === 0);
      // Xac minh: nhom phai bien mat khoi manager sau khi roi. Phan biet "doc duoc va khong con" vs
      // "loi/timeout" — tuong lai: loi/timeout = unverified, khong ok:true.
      var managerName = null;
      for (var mn = 0; mn < managerNames.length; mn++) if (window[managerNames[mn]] === manager) { managerName = managerNames[mn]; break; }
      var verified = false, stillExists = null, verifyTimedOut = false, verifyErrored = false, verifyMs = 0;
      if (manager) {
        var verifyStart = Date.now();
        var checks = 0;
        var passedMissing = 0;
        while (checks < 2) {
          await new Promise(function(resolve) { setTimeout(resolve, checks === 0 ? 1500 : 3000); });
          var one = null, oneErr = false, oneTO = false;
          try {
            one = typeof manager.getGroupByIdSync === 'function'
              ? manager.getGroupByIdSync(groupId)
              : (typeof manager.getGroupById === 'function' ? manager.getGroupById(groupId) : null);
            if (one && typeof one.then === 'function') {
              try { one = await Promise.race([one, new Promise(function(resolve) { setTimeout(function() { oneTO = true; resolve(null); }, 4000); })]); if (oneTO) verifyTimedOut = true; } catch { one = null; oneErr = true; verifyErrored = true; }
            }
          } catch { one = null; oneErr = true; verifyErrored = true; }
          stillExists = one;
          checks += 1;
          if (!one && !oneErr && !oneTO) passedMissing += 1;
          else passedMissing = 0;
          if (one) break;
        }
        verifyMs = Date.now() - verifyStart;
        verified = (passedMissing >= 2);
        if (stillExists) {
          var hint = rawText ? (' Phản hồi Zalo: ' + rawText) : '';
          return { ok: false, verified: false, stillExists: true, managerName: managerName, raw: rawText, rawType: rawType, rawKeys: rawKeys, verifyMs: verifyMs, leaveApiArity: leaveApiArity, leaveApiSourceHead: leaveApiSourceHead, message: 'Zalo chưa rời nhóm (nhóm vẫn còn trong phiên hiện tại).' + hint };
        }
        if (!verified) {
          // Khong xac minh duoc (loi/timeout hoac chi 1 lan missing) — neu reply trong thi khong du co so bao ok.
          if (isEmptyReply) {
            return { ok: false, verified: false, stillExists: null, managerName: managerName, raw: rawText, rawType: rawType, rawKeys: rawKeys, verifyMs: verifyMs, leaveApiArity: leaveApiArity, leaveApiSourceHead: leaveApiSourceHead, message: 'Chưa xác minh được lệnh rời nhóm (không đọc được trạng thái nhóm sau khi rời). Phản hồi Zalo: ' + (rawText || String(rawResult)) };
          }
          // Reply co ma 0 nhung khong xac minh duoc qua manager — bao ok nhung ghi la unverified + kèm raw de chan doan.
          return { ok: true, verified: false, managerName: managerName, raw: rawText, rawType: rawType, rawKeys: rawKeys, verifyMs: verifyMs, leaveApiArity: leaveApiArity, leaveApiSourceHead: leaveApiSourceHead, method: 'verified-webpack-leave-api-unverified' };
        }
      } else {
        // Khong co manager de xac minh -> yeu cau phai co ma thanh cong ro rang.
        if (errCode === undefined || String(errCode) !== '0') {
          return { ok: false, verified: false, stillExists: null, raw: rawText, rawType: rawType, rawKeys: rawKeys, leaveApiArity: leaveApiArity, leaveApiSourceHead: leaveApiSourceHead, message: isEmptyReply ? ('Chưa xác minh được lệnh rời nhóm. Phản hồi Zalo: ' + (rawText || String(rawResult))) : ('Chưa xác minh được lệnh rời nhóm. Phản hồi Zalo: ' + rawText) };
        }
        verified = true;
      }
      return { ok: true, verified: true, managerName: managerName, raw: rawText, rawType: rawType, rawKeys: rawKeys, verifyMs: verifyMs, leaveApiArity: leaveApiArity, leaveApiSourceHead: leaveApiSourceHead, method: 'verified-webpack-leave-api' };
    } catch (error) {
      return { ok: false, message: error && error.message ? error.message : String(error) };
    }
  })()`;
}

function normalizeAndDedupe(groups) {
  const unique = new Map();
  for (const group of groups || []) {
    const normalized = normalizeGroupDto(group);
    unique.set(normalized.groupId, normalized);
  }
  return Array.from(unique.values()).sort((a, b) => compareUtf16Ordinal(a.groupId, b.groupId));
}

function serializeGroups(groups) {
  const lines = normalizeAndDedupe(groups).map((group) => [
    group.groupId,
    group.name,
    group.desc,
    group.type,
    group.creatorId,
    group.avt,
    group.fullAvt,
    String(group.totalMember),
    'False',
  ].join('|'));
  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}

// Zalo Web khong on dinh ten bien global: v2.5.58 chi con bam window.groupManager nen
// mot lan doi code la tinh nang Quet nhom chet ngay. Bộ quét này dung CHUNG cach
// voi Quet nguoi dung (modules/zalo-user-management.js): boc fetch / XMLHttpRequest /
// JSON.parse va doc object thoang qua, loc theo "hinh dang" du lieu nhom chu khong phu
// thuoc ten bien nao cua Zalo.
function buildPageExtractorScript(scanId) {
  const encodedScanId = JSON.stringify(String(scanId));
  return `(() => {
    const scanId = ${encodedScanId};
    const emit = (event) => window.messengerApp.emitZaloGroupScanEvent({ ...event, scanId });
    if (window.location.hostname !== 'chat.zalo.me') {
      emit({ type: 'incompatible', message: 'Profile chưa ở trang chat.zalo.me.' });
      return;
    }
    window.__9MetaZaloGroupScans = window.__9MetaZaloGroupScans || Object.create(null);
    if (window.__9MetaZaloGroupScanCleanup) { try { window.__9MetaZaloGroupScanCleanup(); } catch {} }
    const control = { cancelled: false, isCancelled() { return this.cancelled; } };
    window.__9MetaZaloGroupScans[scanId] = control;
    const BATCH = 50, MAX_NODES = 60000, MAX_TEXT = 500;
    const found = new Map();
    const restores = [];
    let emitted = 0, discovered = 0, duplicates = 0;
    let discoverySent = false, finished = false, observer = null, timer = null, scrollTimer = null, stabilityTimer = null, stabilityChecks = 0, lastStableSize = 0;

    const text = (value, max = MAX_TEXT) => String(value ?? '')
      .normalize('NFC')
      .replace(/[\\u0000-\\u001F\\u007F]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, max);

    // "Hinh dang nhom": bat buoc co groupId/globalId + it nhat mot dau hieu nhom.
    // Bai hoc v2.5.60-test: nhan muc gon {groupId + ten} ma khong can dau hieu
    // nhom -> tin nhan/file/link-preview (cung chua groupId cua hoi thoai + ten
    // hien thi) bi tinh la nhom, phong tu 2000 that len 11473 rac.
    // 'setting'/'verified' KHONG duoc dung de loai: object nhom Zalo that thuong
    // co truong setting (cai dat nhom), dung chung la loai gan het nhom that.
    const GROUP_MARKERS = ['totalMember', 'total_member', 'memberCount', 'memberIds', 'members', 'adminIds', 'creatorId', 'createdTime', 'groupName', 'groupAvatar'];
    const USER_MARKERS = ['zaloName', 'phoneNumber', 'isFriend', 'friendStatus'];
    // Dau hieu cua tin nhan / file / link-preview: nhom that khong co cac key nay.
    const MESSAGE_MARKERS = ['messageId', 'msgId', 'cliMsgId', 'fileId', 'fileName', 'senderId', 'content', 'msgContent'];
    const looksLikeGroup = (item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      // Chi nhan id nhom that. Khong nhan conversationId/chatId/userId/id:
      // id hoi thoai 1-1 hoac id tin nhan khong phai nhom.
      const groupId = item.groupId ?? item.globalId;
      if (!groupId || typeof groupId === 'object' || !String(groupId).trim()) return false;
      if (USER_MARKERS.some((key) => key in item)) return false;
      if (MESSAGE_MARKERS.some((key) => key in item)) return false;
      // Bat buoc co dau hieu nhom: so luong / danh sach thanh vien / admin /
      // nguoi tao / thoi gian tao / ten truong rieng cua nhom.
      return GROUP_MARKERS.some((key) => key in item) || Array.isArray(item.members);
    };

    const toDto = (item) => ({
      groupId: text(item.groupId ?? item.globalId ?? item.conversationId ?? item.chatId ?? item.userId ?? item.id, 128),
      name: text(item.displayName ?? item.groupName ?? item.name ?? item.title ?? item.alias ?? item.currentName, MAX_TEXT),
      desc: text(item.desc ?? item.description ?? item.groupDesc ?? item.topic, 4_000),
      type: text(item.type ?? item.groupType ?? '', 32),
      creatorId: text(item.creatorId ?? item.creator ?? item.adminId ?? item.ownerId ?? '', 128),
      avt: text(item.avatar ?? item.avatarUrl ?? item.groupAvatar ?? item.photo ?? item.avt ?? '', 2_048),
      fullAvt: text(item.bgavatar ?? item.bgAvatar ?? item.cover ?? item.fullAvt ?? item.avatar ?? item.avatarUrl ?? '', 2_048),
      totalMember: Number(item.totalMember ?? item.total_member ?? item.memberCount ?? (Array.isArray(item.memberIds) ? item.memberIds.length : 0)) || 0,
      createdTime: Number(item.createdTime ?? item.createTime ?? item.createdAt ?? item.created_at ?? 0) || 0,
      sourceIndex: 0,
    });

    const add = (item) => {
      if (!looksLikeGroup(item)) return false;
      const dto = toDto(item);
      if (!dto.groupId || !dto.name) return false;
      discovered += 1;
      const previous = found.get(dto.groupId);
      if (previous) {
        duplicates += 1;
        // Giu duoc truong nhieu hon cua ban goc thay vi lan ghi sau.
        found.set(dto.groupId, {
          ...dto,
          desc: dto.desc || previous.desc,
          type: dto.type || previous.type,
          creatorId: dto.creatorId || previous.creatorId,
          avt: dto.avt || previous.avt,
          fullAvt: dto.fullAvt || previous.fullAvt,
          totalMember: dto.totalMember || previous.totalMember,
          createdTime: dto.createdTime || previous.createdTime,
        });
        return false;
      }
      found.set(dto.groupId, dto);
      return true;
    };

    const finishDiscovery = () => {
      if (discoverySent) return;
      discoverySent = true;
      emit({ type: 'discovery-complete', summary: { totalUnique: found.size, duplicateCount: duplicates } });
    };

    const flush = () => {
      const groups = Array.from(found.values());
      for (let offset = emitted; offset < groups.length; offset += BATCH) {
        emit({
          type: 'batch',
          dtos: groups.slice(offset, offset + BATCH),
          progress: { pages: 1, discovered, totalUnique: found.size, processed: Math.min(offset + BATCH, groups.length) },
        });
      }
      emitted = groups.length;
    };

    const inspect = (root) => {
      if (!root || typeof root !== 'object') return;
      const queue = [root], seen = new WeakSet();
      let head = 0, count = 0;
      while (head < queue.length && count++ < MAX_NODES) {
        const value = queue[head++];
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);
        add(value);
        let children;
        try { children = Array.isArray(value) ? value : Object.values(value); } catch { continue; }
        for (const child of children) if (child && typeof child === 'object') queue.push(child);
      }
      flush();
    };

    // --- Duong 1: dung ten global cua Zalo (nhanh nhat, giu nguyen cho tung phien) ---
    const GROUP_MANAGER_NAMES = ['groupManager', 'GroupManager', 'groupListManager', 'GroupListManager'];
    const GROUP_LIST_METHODS = ['getGroupsList', 'getGroupList', 'fetchGetGroupList', 'forceRequestGetGroupList', 'getAllGroupList', 'getGroupListFromCache'];
    const MANAGER_TIMEOUT_MS = 8_000;
    // Gioi han tung cuoc goi manager: Zalo tra promise treo hoac ham chay lau qua la
    // bo qua duong nay va tiep tuc duong mang, khong ket cung scan o "Dang lay chi tiet".
    const withTimeout = (promise) => new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; resolve(value); };
      Promise.resolve(promise).then(finish, () => finish(null));
      setTimeout(() => finish(null), MANAGER_TIMEOUT_MS);
    });
    const callManager = (manager, method) => {
      try {
        return withTimeout(manager[method]()).then((result) => result);
      } catch { return Promise.resolve(null); }
    };
    // Thu HET cac method cua tung manager, duyet sau moi ket qua bang inspect()
    // (hoc theo phia quet nguoi dung). Khong dung giua chung khi found.size > 0:
    // method dau tien co the chi tra cache mot phan, cac method sau moi du.
    const scanManagers = async () => {
      for (const name of GROUP_MANAGER_NAMES) {
        if (control.isCancelled()) return;
        const manager = window[name];
        if (!manager) continue;
        for (const method of GROUP_LIST_METHODS) {
          if (control.isCancelled()) return;
          if (typeof manager[method] !== 'function') continue;
          try {
            const list = await callManager(manager, method);
            if (list) inspect(list);
          } catch {}
          emit({ type: 'progress', progress: { pages: 1, discovered, totalUnique: found.size, processed: found.size } });
        }
      }
    };

    // --- Duong 2: quet state cua trang ---
    for (const key of ['__INITIAL_STATE__', '__PRELOADED_STATE__', 'store', 'reduxStore', 'zaloStore', 'app']) {
      try { inspect(window[key] && window[key].getState ? window[key].getState() : window[key]); } catch {}
    }

    // --- Duong 3: bắt du lieu Zalo tu tai ve ---
    const inspectText = (body) => { try { if (typeof body === 'string' && body.length < 12_000_000) inspect(JSON.parse(body)); } catch {} };
    const originalParse = JSON.parse;
    JSON.parse = function (...args) {
      const result = originalParse.apply(this, args);
      try { queueMicrotask(() => inspect(result)); } catch {}
      return result;
    };
    restores.push(() => { JSON.parse = originalParse; });

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try { response.clone().text().then(inspectText).catch(() => {}); } catch {}
        return response;
      };
      restores.push(() => { window.fetch = originalFetch; });
    }

    const originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (...args) { return originalOpen.apply(this, args); };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') inspectText(this.responseText);
          else if (this.responseType === 'json') inspect(this.response);
        } catch {}
      }, { once: true });
      return originalSend.apply(this, args);
    };
    restores.push(() => { XMLHttpRequest.prototype.open = originalOpen; XMLHttpRequest.prototype.send = originalSend; });

    // Doc state React cua DOM hien tai (phong khi Zalo da cache xong danh sach).
    const inspectElement = (element) => {
      if (!element || typeof element !== 'object') return;
      try { for (const key of Object.keys(element)) if (key.startsWith('__reactProps$') || key.startsWith('__reactFiber$')) inspect(element[key]); } catch {}
    };
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        inspectElement(mutation.target);
        for (const node of mutation.addedNodes || []) inspectElement(node);
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });

    const openGroups = () => {
      const candidates = Array.from(document.querySelectorAll('button,[role="button"],[aria-label],[title],nav div')).slice(0, 1500);
      const target = candidates.find((el) => /^(nh[oó]m|groups?)$/i.test(text(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-translate-title') || el.textContent, 80)));
      if (!target) return false;
      target.click();
      return true;
    };
    const scrollList = () => {
      const panes = Array.from(document.querySelectorAll('[class*="chat-list" i], [class*="chatList" i], [class*="conv-list" i], [class*="conversation" i], nav, aside')).slice(0, 20);
      let moved = 0;
      for (const pane of panes) {
        if (pane.scrollHeight > pane.clientHeight + 40) {
          pane.scrollTop = pane.scrollHeight;
          moved += 1;
          if (moved >= 2) break;
        }
      }
      return moved > 0;
    };

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
      if (stabilityTimer) { clearTimeout(stabilityTimer); stabilityTimer = null; }
      try { observer && observer.disconnect(); } catch {}
      observer = null;
      for (const restore of restores.reverse()) { try { restore(); } catch {} }
      if (window.__9MetaZaloGroupScanCleanup === cleanup) delete window.__9MetaZaloGroupScanCleanup;
    };
    window.__9MetaZaloGroupScanCleanup = cleanup;

    const complete = () => {
      if (finished) return;
      finished = true;
      cleanup();
      flush();
      // Chi chot tong o lan cuoi. Truoc day flush() chot som 'discovery-complete' khi
      // con 0 nhom -> main ghi totalUnique=0 vinh vien, roi complete() so sanh
      // groups.size (1982) != totalUnique (0) va nem loi 'scan is incomplete'.
      finishDiscovery();
      emit({ type: 'complete' });
    };
    const fail = (message) => {
      if (finished) return;
      finished = true;
      cleanup();
      emit({ type: 'incompatible', message: String(message) });
    };

    // Timer tong dat ngay tu luc bat dau (khong doi sau khi manager chay xong):
    // danh sach 2000 nhom du kien, phai cho Zalo nhieu thoi gian tai & keo.
    timer = setTimeout(() => {
      if (found.size) complete();
      else fail('Chưa nhận được danh sách nhóm từ Zalo Web. Hãy mở tab Nhóm trên Zalo rồi bấm Quét lại.');
    }, 40000);
    // Chot khi so luong nhom da on dinh qua nhieu chu ky lien tiep: Zalo tai danh
    // sach ao hoa theo trang, nen phai cho "het them" truocc khi ket luan.
    const STABILITY_INTERVAL_MS = 2000, STABILITY_REQUIRED = 3;
    const armStabilityWatch = () => {
      if (stabilityTimer || finished) return;
      stabilityTimer = setInterval(() => {
        if (control.isCancelled() || finished) return;
        if (found.size === lastStableSize && found.size > 0) stabilityChecks += 1;
        else { stabilityChecks = 0; lastStableSize = found.size; }
        emit({ type: 'progress', progress: { pages: 1, discovered, totalUnique: found.size, processed: found.size } });
        if (found.size > 0 && stabilityChecks >= STABILITY_REQUIRED) complete();
      }, STABILITY_INTERVAL_MS);
    };

    // Adapter ngoai cho phep ghi de (giu tuong thich cho ban build rieng).
    if (window.__9MetaZaloGroupAdapter && typeof window.__9MetaZaloGroupAdapter.scan === 'function') {
      Promise.resolve(window.__9MetaZaloGroupAdapter.scan({
        control,
        onProgress: (progress) => emit({ type: 'progress', progress }),
        onDiscoveryComplete: (summary) => { /* adapter chi bao tien do; tong chot o complete() */ },
        onBatch: (dtos) => emit({ type: 'batch', dtos }),
        onFailure: (failure) => emit({ type: 'failure', failure }),
      })).then(() => { if (!control.cancelled) complete(); }).catch((error) => {
        if (!control.cancelled) emit({ type: 'error', message: String(error && error.message || error || 'Lỗi extractor') });
      });
      return;
    }

    scanManagers().then(() => {
      if (control.isCancelled() || finished) return;
      // Da co it nhom tu manager/state van phai chay tiep phan mo tab + keo danh sach:
      // truoc day chi can found.size > 0 la complete() ngay, bo sot ~2000 nhom con lai.
      openGroups();
      setTimeout(openGroups, 1200);
      setTimeout(() => { if (!finished) { document.querySelectorAll('[class*="group" i], [class*="conversation" i], [data-id]').forEach(inspectElement); armStabilityWatch(); } }, 2600);
      // Keo danh sach lien tuc: dung khi Zalo het them trang moi — xac dinh bang
      // so luong on dinh chu khong dung khi scrolls >= 3 nhu truoc.
      scrollTimer = setInterval(() => {
        if (control.isCancelled() || finished) return;
        scrollList();
      }, 900);
      armStabilityWatch();
    });
  })()`;
}

function buildCancelExtractorScript(scanId) {
  const encodedScanId = JSON.stringify(String(scanId));
  return `(() => {
    const scans = window.__9MetaZaloGroupScans;
    const control = scans && scans[${encodedScanId}];
    if (control) control.cancelled = true;
  })()`;
}

async function saveTxtNoOverwrite(destination, groups) {
  const directory = path.dirname(destination);
  const tempPath = path.join(directory, `.${path.basename(destination)}.tmp-${crypto.randomBytes(8).toString('hex')}`);
  let tempCreated = false;
  try {
    const handle = await fsPromises.open(tempPath, 'wx');
    tempCreated = true;
    try {
      await handle.writeFile(serializeGroups(groups), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fsPromises.link(tempPath, destination);
    } catch (error) {
      if (error.code === 'EEXIST') throw error;
      await fsPromises.copyFile(tempPath, destination, fs.constants.COPYFILE_EXCL);
    }
  } finally {
    if (tempCreated) await fsPromises.unlink(tempPath).catch(() => {});
  }
  return destination;
}

class ScanStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.scans = new Map();
  }

  start({ scanId, profileId, partition }) {
    if (!scanId || !profileId || !partition) throw new TypeError('scanId, profileId and partition are required');
    if (this.scans.has(scanId)) throw new Error('scanId already exists');
    const scan = {
      scanId,
      profileId,
      partition,
      status: 'discovering',
      groups: new Map(),
      failures: new Map(),
      totalUnique: null,
      duplicateCount: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.scans.set(scanId, scan);
    return scan;
  }

  get(scanId) {
    const scan = this.scans.get(scanId);
    if (!scan) throw new Error('scan not found');
    return scan;
  }

  isActive(scan) {
    return scan.status === 'discovering' || scan.status === 'fetching' || scan.status === 'failed';
  }

  acceptBatch(scanId, dtos) {
    const scan = this.get(scanId);
    if (!this.isActive(scan)) return false;
    for (const dto of dtos || []) {
      const group = normalizeGroupDto(dto);
      scan.groups.set(group.groupId, group);
    }
    scan.updatedAt = this.now();
    return true;
  }

  finishDiscovery(scanId, { totalUnique, duplicateCount = 0 }) {
    const scan = this.get(scanId);
    if (scan.status !== 'discovering') throw new Error('scan is not discovering');
    if (!Number.isInteger(totalUnique) || totalUnique < 0) throw new TypeError('totalUnique must be a non-negative integer');
    scan.totalUnique = totalUnique;
    scan.duplicateCount = duplicateCount;
    scan.status = 'fetching';
    scan.updatedAt = this.now();
    return scan;
  }

  fail(scanId, { groupId, reason }) {
    const scan = this.get(scanId);
    if (!this.isActive(scan)) return false;
    scan.failures.set(String(groupId), String(reason || 'unknown error'));
    scan.status = 'failed';
    scan.updatedAt = this.now();
    return true;
  }

  resolveFailure(scanId, groupId) {
    const scan = this.get(scanId);
    scan.failures.delete(String(groupId));
    if (scan.status === 'failed' && scan.failures.size === 0) scan.status = 'fetching';
    scan.updatedAt = this.now();
    return scan;
  }

  complete(scanId) {
    const scan = this.get(scanId);
    if (scan.totalUnique === null) throw new Error('discovery is not finished');
    if (scan.failures.size) throw new Error('scan has failures');
    if (scan.groups.size !== scan.totalUnique) throw new Error('scan is incomplete');
    scan.status = 'completed';
    scan.updatedAt = this.now();
    return scan;
  }

  cancel(scanId) {
    const scan = this.get(scanId);
    if (!this.isActive(scan)) return false;
    scan.status = 'cancelled';
    scan.updatedAt = this.now();
    return true;
  }

  markError(scanId, message) {
    const scan = this.get(scanId);
    if (!this.isActive(scan)) return false;
    scan.status = 'incompatible';
    scan.error = String(message || 'Không tương thích');
    scan.updatedAt = this.now();
    return true;
  }

  remove(scanId) {
    return this.scans.delete(scanId);
  }
}

module.exports = {
  LEAVE_GROUP_POLICY,
  ScanStore,
  buildCancelExtractorScript,
  buildBulkGroupPlan,
  buildLeaveGroupScript,
  buildPageExtractorScript,
  compareUtf16Ordinal,
  filterAndSortGroups,
  findAmbiguousGroupNames,
  getDailyLeaveUsageKey,
  getLeavePolicyWaitMs,
  normalizeAndDedupe,
  normalizeGroupDto,
  saveTxtNoOverwrite,
  serializeGroups,
};
