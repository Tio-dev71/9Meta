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
    var manager = window.groupManager;
    if (!manager) return { ok: false, incompatible: true, message: 'Zalo Web chưa cung cấp groupManager.' };
    var groupId = ${encodedGroupId};
    var group = typeof manager.getGroupByIdSync === 'function' ? manager.getGroupByIdSync(groupId) : null;
    if (!group) return { ok: false, message: 'Nhóm không còn tồn tại trong phiên Zalo hiện tại.' };
    try {
      if (!window.__9MetaWebpackRequire) {
        if (!window.webpackJsonp || typeof window.webpackJsonp.push !== 'function') {
          return { ok: false, incompatible: true, message: 'Không tìm thấy bộ nạp module của Zalo Web.' };
        }
        var probeId = '__9meta_leave_probe_' + Date.now();
        var probeModules = {};
        probeModules[probeId] = function(module, exports, require) { window.__9MetaWebpackRequire = require; };
        window.webpackJsonp.push([[probeId], probeModules, [[probeId]]]);
      }
      var require = window.__9MetaWebpackRequire;
      var leaveApi = null;
      var modules = require && require.c ? require.c : {};
      for (var moduleId in modules) {
        var exported = modules[moduleId] && modules[moduleId].exports;
        var candidates = [exported, exported && exported.default];
        for (var index = 0; index < candidates.length; index += 1) {
          var candidate = candidates[index];
          if (!candidate || typeof candidate.leaveGroup !== 'function') continue;
          var source = Function.prototype.toString.call(candidate.leaveGroup);
          if (/\\/api\\/group\\/leave/.test(source)) { leaveApi = candidate; break; }
        }
        if (leaveApi) break;
      }
      if (!leaveApi) {
        return { ok: false, incompatible: true, message: 'Không tìm thấy API rời nhóm đã xác minh trong phiên Zalo Web.' };
      }
      var result = await leaveApi.leaveGroup(groupId);
      if (result && (result.error || result.error_code || result.errorCode)) {
        return { ok: false, message: String(result.message || result.error || result.error_code || result.errorCode) };
      }
      return { ok: true, method: 'verified-webpack-leave-api' };
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
    const BATCH = 50, MAX_NODES = 12000, MAX_TEXT = 500;
    const found = new Map();
    const restores = [];
    let emitted = 0, discovered = 0, duplicates = 0;
    let discoverySent = false, finished = false, observer = null, timer = null, scrollTimer = null;

    const text = (value, max = MAX_TEXT) => String(value ?? '')
      .normalize('NFC')
      .replace(/[\\u0000-\\u001F\\u007F]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, max);

    // "Hinh dang nhom": khong phai object danh ba (user) va co it nhat mot dau hieu
    // danh danh nhom. Chi lay ID de so sanh, khong khop digits de tranh loai.
    const looksLikeGroup = (item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const id = item.groupId ?? item.globalId ?? item.conversationId ?? item.chatId ?? item.userId ?? item.id;
      if (!id || typeof id === 'object' || !String(id).trim()) return false;
      if (['zaloName', 'displayName', 'avatarUrl', 'phoneNumber', 'isFriend', 'friendStatus'].some((key) => key in item)) return false;
      return 'totalMember' in item || 'total_member' in item || 'memberCount' in item || 'memberIds' in item
        || Array.isArray(item.members) || 'groupName' in item || 'groupAvatar' in item || 'creatorId' in item
        || 'adminIds' in item || 'createdTime' in item;
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
      finishDiscovery();
    };

    const inspect = (root) => {
      if (!root || typeof root !== 'object') return;
      const queue = [root], seen = new WeakSet();
      let count = 0;
      while (queue.length && count++ < MAX_NODES) {
        const value = queue.shift();
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
    const callManager = (manager, method) => {
      try {
        const maybe = manager[method]();
        return Promise.resolve(maybe).then((result) => Array.isArray(result) ? result : (Array.isArray(result && result.data) ? result.data : null));
      } catch { return Promise.resolve(null); }
    };
    const scanManagers = async () => {
      let total = 0;
      for (const name of GROUP_MANAGER_NAMES) {
        if (control.isCancelled()) return total;
        const manager = window[name];
        if (!manager) continue;
        for (const method of GROUP_LIST_METHODS) {
          if (typeof manager[method] !== 'function') continue;
          const list = await callManager(manager, method);
          if (!Array.isArray(list)) continue;
          for (const item of list) { if (Array.isArray(item)) for (const inner of item) add(inner); else add(item); }
          flush();
          if (found.size) return found.size;
        }
      }
      return total;
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
      emit({ type: 'complete' });
    };
    const fail = (message) => {
      if (finished) return;
      finished = true;
      cleanup();
      emit({ type: 'incompatible', message: String(message) });
    };

    // Adapter ngoai cho phep ghi de (giu tuong thich cho ban build rieng).
    if (window.__9MetaZaloGroupAdapter && typeof window.__9MetaZaloGroupAdapter.scan === 'function') {
      Promise.resolve(window.__9MetaZaloGroupAdapter.scan({
        control,
        onProgress: (progress) => emit({ type: 'progress', progress }),
        onDiscoveryComplete: (summary) => { flush(); },
        onBatch: (dtos) => emit({ type: 'batch', dtos }),
        onFailure: (failure) => emit({ type: 'failure', failure }),
      })).then(() => { if (!control.cancelled) complete(); }).catch((error) => {
        if (!control.cancelled) emit({ type: 'error', message: String(error && error.message || error || 'Lỗi extractor') });
      });
      return;
    }

    scanManagers().then((fromManagers) => {
      if (control.isCancelled() || finished) return;
      finishDiscovery();
      if (found.size) { complete(); return; }
      // Chua co gi: mo tab Nhom de Zalo tu tai danh sach roi doc phan do ve.
      openGroups();
      setTimeout(openGroups, 1_200);
      setTimeout(() => document.querySelectorAll('[class*="group" i], [class*="conversation" i], [data-id]').forEach(inspectElement), 2_600);
      // Keo danh sach de Zalo tai cac trang con lai.
      let scrolls = 0;
      scrollTimer = setInterval(() => {
        if (control.isCancelled() || finished) return;
        if (scrollList()) { scrolls += 1; return; }
        if (found.size || scrolls >= 3) { clearInterval(scrollTimer); scrollTimer = null; }
      }, 900);
      timer = setTimeout(() => {
        if (found.size) complete();
        else fail('Chưa nhận được danh sách nhóm từ Zalo Web. Hãy mở tab Nhóm trên Zalo rồi bấm Quét lại.');
      }, 15_000);
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
