// Preload nay chay trong sandbox (Electron >= 20 bat sandbox mac dinh cho WebContentsView),
// nen CHI duoc require('electron'). Moi require khac (fs, path, ...) se lam ca preload
// khong load duoc -> mat contextBridge va mat cac listener IPC quet nhom/nguoi dung.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('messengerApp', {
  onNotificationClick: () => ipcRenderer.send('notification-click'),
  toggleDarkMode: () => ipcRenderer.send('toggle-dark-mode'),
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
  reloadPage: () => ipcRenderer.send('reload-page'),
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  getSettings: () => ipcRenderer.sendSync('get-settings'),
  sendProfileInfo: (info) => ipcRenderer.send('profile-info-extracted', info),
  sendCurrentChatInfo: (info) => ipcRenderer.send('current-chat-info-extracted', info),
  sendRecentChats: (chats) => ipcRenderer.send('recent-chats-extracted', chats),
  sendUnreadConversationCount: (count) => ipcRenderer.send('profile-unread-count', count),
  sendUnreadCountDetail: (payload) => ipcRenderer.send('profile-unread-count-detail', payload),
  sendConvDiag: (payload) => ipcRenderer.send('conv-diag', payload),
  sendTextToActiveChat: (message) => ipcRenderer.invoke('active-chat-send-text', message),
  emitZaloGroupScanEvent: (payload) => ipcRenderer.send('zalo-group-scan:event', payload),
  emitZaloUserScanEvent: (payload) => ipcRenderer.send('zalo-user-scan:event', payload),
  pasteQuickReplyImage: (imagePath) => ipcRenderer.invoke('quick-reply:paste-image', imagePath),
  pasteQuickReplyText: (text, mode) => ipcRenderer.invoke('quick-reply:paste-text', text, mode),
  // Bao gia KHONG phai mau tin nhan nhanh nen khong di qua duong dan 'quick-reply:paste-text'
  // (handler do chan dung noi dung co trong danh sach mau). Kenh rieng nay goi chu that
  // theo tung dong vao o soan tin Zalo de Lexical ghi nhan state, Enter moi gui duoc.
  insertQuoteComposerText: (text) => ipcRenderer.invoke('quote:insert-text', text),
});

// Neu main process chua kip dang ky listener thi sendSync tra ve undefined;
// dung object rong de preload khong bao gio chet giua duong (mat bridge + mat listener quet).
const settings = ipcRenderer.sendSync('get-settings') || {};
if (typeof window.addEventListener === 'function') {
  const reportNetworkState = () => ipcRenderer.send('zalo-network-state', { online: navigator.onLine !== false });
  window.addEventListener('online', reportNetworkState);
  window.addEventListener('offline', reportNetworkState);
  setTimeout(reportNetworkState, 0);
}
// Font Quicksand duoc main process doc tu dia va gui kem theo get-settings,
// vi preload sandbox khong the tu doc file.
const quicksandFontDataUrl = (settings && settings.quicksandFontDataUrl) || '';

function runInjection(currentSettings) {
  const injectionScript = String.raw`
    window.__DepLaoBlockSeen = ${currentSettings.blockSeen || false};
    window.__DepLaoBlockTyping = ${currentSettings.blockTyping || false};
    window.__DepLaoZaDarkShield = ${currentSettings.zadarkShield || false};

    (function() {
      if (window.__DepLaoInjected && typeof window.__DepLaoRunQuickReply === 'function') return;
      window.__DepLaoInjected = true;
      var host = window.location.hostname || '';
      var isZalo = host === 'chat.zalo.me' || host.includes('zalo.me');
      var isMessenger = host.includes('messenger.com') || host.includes('facebook.com');
      var isWhatsApp = host.includes('whatsapp.com');
      var isTelegram = host.includes('telegram.org') || host.includes('web.telegram.org');
      var platform = isZalo ? 'Zalo' : isMessenger ? 'Messenger' : isWhatsApp ? 'WhatsApp' : isTelegram ? 'Telegram' : 'Unknown';
      if (platform === 'Unknown') return;

      var nhaYenFontFamily = 'Quicksand, sans-serif';
      var nhaYenFontDataUrl = ${JSON.stringify(quicksandFontDataUrl)};
      if (nhaYenFontDataUrl && window.FontFace && document.fonts) {
        try {
          var nhaYenFont = new FontFace('Quicksand', 'url(' + nhaYenFontDataUrl + ')', { weight: '300 700', style: 'normal' });
          nhaYenFont.load().then(function(loadedFont) { document.fonts.add(loadedFont); }).catch(function() {});
        } catch (_) {}
      }

      function shouldBlockSeen(url) {
        if (!window.__DepLaoBlockSeen) return false;
        if (isZalo) return (url.includes('/api/message/read') || url.includes('/api/message/seen')) && !url.includes('read_status');
        if (isMessenger) return url.includes('change_read_status') || url.includes('mark_read') || url.includes('read_receipt') || url.includes('/ajax/mercury/mark_seen');
        if (isWhatsApp) return url.includes('/read') || url.includes('receipt');
        if (isTelegram) return url.includes('readHistory') || url.includes('messages.read') || url.includes('readMentions');
        return false;
      }
      function shouldBlockTyping(url) {
        if (!window.__DepLaoBlockTyping) return false;
        if (isZalo) return url.includes('/api/message/typing');
        if (isMessenger) return url.includes('typ.php') || url.includes('typing_indicator') || url.includes('send_typing_indicator');
        if (isWhatsApp) return url.includes('chatstate') || url.includes('composing') || url.includes('typing');
        if (isTelegram) return url.includes('setTyping') || url.includes('sendMessageTypingAction') || url.includes('typing');
        return false;
      }
      function shouldDropPayload(data) {
        if (typeof data !== 'string') return false;
        if (isZalo) {
          if (window.__DepLaoBlockSeen && (data.includes('"cmd":97') || data.includes('"action":"read"'))) return true;
          if (window.__DepLaoBlockTyping && (data.includes('"cmd":121') || data.includes('"cmd":122') || data.includes('"action":"typing"'))) return true;
        }
        if (isMessenger) {
          if (window.__DepLaoBlockSeen && (data.includes('"type":"read"') || data.includes('mark_read') || data.includes('read_receipt'))) return true;
          if (window.__DepLaoBlockTyping && (data.includes('"type":"typ"') || data.includes('typing') || data.includes('composing'))) return true;
        }
        if (isWhatsApp) {
          if (window.__DepLaoBlockSeen && (data.includes('"read"') || data.includes('"receipt"') || data.includes('"ack"'))) return true;
          if (window.__DepLaoBlockTyping && (data.includes('"composing"') || data.includes('"chatstate"') || data.includes('"paused"'))) return true;
        }
        if (isTelegram) {
          if (window.__DepLaoBlockSeen && (data.includes('readHistory') || data.includes('messages.read'))) return true;
          if (window.__DepLaoBlockTyping && (data.includes('sendMessageTypingAction') || data.includes('setTyping'))) return true;
        }
        return false;
      }

      var originalFetch = window.fetch;
      window.fetch = function() {
        var args = arguments;
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (shouldBlockSeen(url) || shouldBlockTyping(url)) return Promise.resolve(new Response(JSON.stringify({error:0,msg:'Blocked by DepLao'}), { status: 200 }));
        return originalFetch.apply(this, args);
      };
      var originalXHROpen = XMLHttpRequest.prototype.open;
      var originalXHRSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) { this._url = typeof url === 'string' ? url : (url ? url.toString() : ''); return originalXHROpen.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function() {
        var url = this._url || '';
        if (shouldBlockSeen(url) || shouldBlockTyping(url)) {
          Object.defineProperty(this, 'readyState', {get:function(){return 4;}});
          Object.defineProperty(this, 'status', {get:function(){return 200;}});
          Object.defineProperty(this, 'responseText', {get:function(){return '{"error":0}';}});
          if (this.onreadystatechange) this.onreadystatechange();
          if (this.onload) this.onload();
          return;
        }
        return originalXHRSend.apply(this, arguments);
      };
      var originalWSSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        if (shouldDropPayload(data)) return;
        return originalWSSend.call(this, data);
      };

      function applyZaDarkShield() {
        if (!window.__DepLaoZaDarkShield) return;
        try {
          Object.defineProperty(navigator, 'webdriver', { get: function() { return false; }, configurable: true });
        } catch(e) {}
        try {
          var style = document.getElementById('dep-lao-zadark-style');
          if (!style) {
            style = document.createElement('style');
            style.id = 'dep-lao-zadark-style';
            style.textContent = 'html{color-scheme:dark;} body{scrollbar-color:#3b82f6 #111827;} ::selection{background:#2563eb!important;color:#fff!important;}';
            document.documentElement.appendChild(style);
          }
        } catch(e) {}
      }
      applyZaDarkShield();
      setInterval(applyZaDarkShield, 3000);

      var originalWindowOpen = window.open;
      window.open = function(url, target, features) {
        var win = originalWindowOpen.call(window, url, target, features);
        if (!win) return { closed:false, focus:function(){}, close:function(){} };
        return win;
      };

      // Quick Reply Shortcut System - Nhà Yến dùng dấu / và ẩn panel gốc của Zalo Web.
      window.__DepLaoQuickReplies = ${JSON.stringify(currentSettings.quickReplies || [])};

      var QUICK_REPLY_IMAGE_TIMEOUT_MS = 12000;
      var QUICK_REPLY_POLL_MS = 150;

      function findComposerInput() {
        var selectors = ['#richInput', '.chat-input [contenteditable="true"]', '[contenteditable="true"]', 'textarea'];
        for (var i = 0; i < selectors.length; i++) {
          var nodes = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < nodes.length; j++) {
            var rect = nodes[j].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return nodes[j];
          }
        }
        return null;
      }

      function findComposerFromTarget(target) {
        var node = target && target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
        if (!node || !node.closest) return null;
        var editable = node.closest('#richInput, .chat-input [contenteditable="true"], [contenteditable="true"], textarea');
        if (!editable) return null;
        var rect = editable.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        var composer = findComposerInput();
        return composer && (editable === composer || editable.contains(composer) || composer.contains(editable)) ? composer : editable;
      }

      // Vùng soạn tin là nơi duy nhất được quyền chứa ảnh đính kèm đang chờ gửi.
      function composerRoot() {
        var selectors = ['[class*="chat-input"]', '[class*="chatInput"]', 'footer'];
        for (var i = 0; i < selectors.length; i++) {
          var nodes = document.querySelectorAll(selectors[i]);
          for (var j = nodes.length - 1; j >= 0; j--) {
            var rect = nodes[j].getBoundingClientRect();
            if (rect.width > 120 && rect.height > 60) return nodes[j];
          }
        }
        return document.body;
      }

      // Ảnh "sắp gửi" luôn là blob:/data: URL do Zalo vừa tạo, không phải ảnh tin nhắn cũ.
      function composerPendingImageNodes(root) {
        var hits = [];
        var nodes = root.querySelectorAll('img, [style*="background-image"]');
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var src = String(el.currentSrc || el.src || '');
          var style = String(el.getAttribute && el.getAttribute('style') || '');
          var isPending = src.indexOf('blob:') === 0 || src.indexOf('data:image') === 0 || style.indexOf('blob:') > -1;
          if (!isPending) continue;
          var rect = el.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) continue;
          hits.push(el);
        }
        if (!hits.length) {
          var items = root.querySelectorAll('[class*="attachment" i]');
          for (var k = 0; k < items.length; k++) {
            var itemRect = items[k].getBoundingClientRect();
            if (itemRect.width < 20 || itemRect.height < 20) continue;
            if (items[k].closest('#richInput')) continue;
            hits.push(items[k]);
          }
        }
        return hits;
      }

      // Chờ Zalo thực sự vẽ ảnh preview trong ô soạn tin; không đoán bằng thời gian cố định.
      function waitForComposerImage(previousCount, timeoutMs) {
        return new Promise(function(resolve) {
          var deadline = Date.now() + timeoutMs;
          var observer = null;
          var timer = null;

          function finish(ok) {
            if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
            if (timer) { clearInterval(timer); timer = null; }
            resolve(ok);
          }
          function check() {
            if (composerPendingImageNodes(composerRoot()).length > previousCount) { finish(true); return; }
            if (Date.now() >= deadline) finish(false);
          }

          try {
            observer = new MutationObserver(function() { check(); });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class'] });
          } catch (e) {}
          timer = setInterval(check, QUICK_REPLY_POLL_MS);
          check();
        });
      }

      function clearComposerNotice() {
        var box = document.getElementById('dep-lao-quick-reply-notice');
        if (box) box.remove();
      }

      function showQuickReplyNotice(message) {
        var box = document.getElementById('dep-lao-quick-reply-notice');
        if (!box) {
          box = document.createElement('div');
          box.id = 'dep-lao-quick-reply-notice';
          box.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:120px;z-index:2147483000;max-width:70%;padding:10px 16px;border-radius:12px;background:rgba(20,22,30,.96);color:#ffd9d9;font-size:13px;line-height:1.4;box-shadow:0 12px 32px rgba(0,0,0,.45);pointer-events:none;transition:opacity .25s;font-family:' + nhaYenFontFamily + ';';
          document.body.appendChild(box);
        }
        box.textContent = message;
        box.style.opacity = '1';
        clearTimeout(box.__depLaoTimer);
        box.__depLaoTimer = setTimeout(clearComposerNotice, 7000);
      }

      function composerTextValue(input) {
        return String(input.value !== undefined && input.value !== '' ? input.value : (input.innerText || input.textContent || ''));
      }

      // Chỉ khoanh vùng chọn trong chính ô soạn tin: selectAll cả trang làm người dùng
      // tưởng Ctrl+A lan sang nơi khác và execCommand chèn chữ cũng dễ thất bại.
      function selectAllComposerText(targetInput) {
        targetInput.focus();
        var selection = window.getSelection && window.getSelection();
        var range = document.createRange();
        try { range.selectNodeContents(targetInput); } catch (err) { range.selectNode(targetInput); }
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      }

      function clearComposerText(targetInput) {
        targetInput.focus();
        selectAllComposerText(targetInput);
        document.execCommand('delete', false, null);
        if (targetInput.value !== undefined) targetInput.value = '';
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Luồng gõ \keyword trong ô chat: focus đã sẵn trong ô soạn nên execCommand
      // vẫn đáng tin ở đây; chỉ luồng nút "Chèn" (focus nằm ngoài tab Zalo) mới cần
      // nhờ main process dán chữ bằng webContents.insertText.
      function insertComposerTextInPage(targetInput, text) {
        var normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var lines = normalized.split('\n');
        targetInput.focus();
        if (targetInput.value !== undefined) {
          targetInput.value = normalized;
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        // Lexical trên Zalo không đọc innerHTML thẳng — phải đi qua editing engine
        // nên thử execCommand('insertText') trước, DOM div chỉ là dự phòng.
        var beforeLen = String(composerTextValue(targetInput)).length;
        var execOk = false;
        try {
          // Đã được clearComposerText ở ngoài nếu cần; không xoá lại để không mất
          // preview ảnh khi ảnh nằm trong cùng editor.
          execOk = document.execCommand('insertText', false, normalized);
        } catch (e) { execOk = false; }
        try {
          var ev = typeof InputEvent === 'function' ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: normalized }) : new Event('input', { bubbles: true });
          targetInput.dispatchEvent(ev);
        } catch (e) { try { targetInput.dispatchEvent(new Event('input', { bubbles: true })); } catch (ignored) {} }
        try { targetInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
        if (execOk && String(composerTextValue(targetInput)).trim().length > 0) {
          try { targetInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {}
          try {
            var range2 = document.createRange();
            var sel2 = window.getSelection && window.getSelection();
            range2.selectNodeContents(targetInput);
            range2.collapse(false);
            if (sel2) { sel2.removeAllRanges(); sel2.addRange(range2); }
          } catch (e3) {}
          return true;
        }
        // Dự phòng: môi trường Zalo lạ hoặc execCommand bị từ chối — dựng DOM trực tiếp
        var isRichInput = targetInput.id === 'richInput' || (targetInput.getAttribute && (targetInput.getAttribute('role') || '').toLowerCase() === 'textbox');
        targetInput.innerHTML = '';
        if (lines.length === 1 && lines[0] === '') {
          targetInput.appendChild(document.createElement('br'));
        } else {
          for (var i = 0; i < lines.length; i++) {
            var div = document.createElement('div');
            div.appendChild(document.createTextNode(lines[i]));
            if (lines[i] === '') div.appendChild(document.createElement('br'));
            targetInput.appendChild(div);
          }
        }
        try {
          var range = document.createRange();
          var sel = window.getSelection && window.getSelection();
          range.selectNodeContents(targetInput);
          range.collapse(false);
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        } catch (e) {}
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (!String(composerTextValue(targetInput)).trim()) {
          targetInput.focus();
          var ok = false;
          try { ok = document.execCommand('insertText', false, normalized); } catch (err) { ok = false; }
          if (!ok) targetInput.innerText = normalized;
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (isRichInput) {
          try { targetInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {}
        }
        return String(composerTextValue(targetInput)).trim().length > 0;
      }

      // Che panel tin nhắn nhanh gốc của Zalo (chỉ trong vùng soạn tin) để không đấu với danh sách của Nhà Yến.
      function hideZaloQuickReplyPanel() {
        var candidates = document.querySelectorAll('[class*="quick-reply" i], [class*="quickReply" i], [class*="command-list" i], [class*="cmd-list" i]');
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          if (el.id && String(el.id).indexOf('dep-lao') === 0) continue;
          var anchor = el.closest('[class*="chat-input" i], [class*="chatInput" i], footer');
          if (!anchor) continue;
          if (el.style.display === 'none') continue;
          el.style.setProperty('display', 'none', 'important');
          el.setAttribute('data-dep-lao-hidden', 'zalo-quick-reply');
        }
      }

      function setupQuickReplyPanelHider() {
        if (window.__DepLaoQuickReplyHiderReady) return;
        window.__DepLaoQuickReplyHiderReady = true;
        hideZaloQuickReplyPanel();
        setInterval(hideZaloQuickReplyPanel, 700);
      }

      function normalizeComposerCompare(text) {
        return String(text || '').replace(/\s+/g, '');
      }

      // Chỉ cần ô soạn CHỨA nội dung mẫu (phần chữ gõ trước \ được giữ nguyên).
      function waitForComposerText(targetInput, expected, timeoutMs) {
        var want = normalizeComposerCompare(expected);
        return new Promise(function(resolve) {
          var deadline = Date.now() + timeoutMs;
          (function poll() {
            var have = normalizeComposerCompare(composerTextValue(targetInput));
            if (want ? have.indexOf(want) >= 0 : !have) { resolve(true); return; }
            if (Date.now() >= deadline) { resolve(false); return; }
            setTimeout(poll, 40);
          })();
        });
      }

      // Chọn đúng đoạn từ dấu \ cuối cùng tới hết ô soạn (token \keyword); không có
      // dấu \ (nút "Chèn") thì chọn cả ô. Lexical theo dõi vùng chọn của trang nên
      // lần Ctrl+V thật sau đó sẽ thay đúng đoạn này.
      function selectQuickReplyToken(targetInput) {
        var trigger = String.fromCharCode(92);
        var walker = document.createTreeWalker(targetInput, NodeFilter.SHOW_TEXT, null);
        var lastNode = null, lastOffset = -1, endNode = null, node;
        while ((node = walker.nextNode())) {
          endNode = node;
          var idx = node.nodeValue.lastIndexOf(trigger);
          if (idx >= 0) { lastNode = node; lastOffset = idx; }
        }
        var selection = window.getSelection && window.getSelection();
        if (!selection) return;
        var range = document.createRange();
        if (lastNode) {
          range.setStart(lastNode, lastOffset);
          range.setEnd(endNode, endNode.nodeValue.length);
        } else {
          range.selectNodeContents(targetInput);
        }
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Ô chat Zalo là Lexical: chữ dựng bằng DOM/execCommand chỉ hiện trên màn hình,
      // state gửi đi vẫn rỗng (đè placeholder, Enter chỉ gửi ảnh). Chọn token \keyword
      // rồi nhờ main bấm Ctrl+V chữ thật để Lexical tự ghi nhận.
      async function fillComposerWithRealPaste(targetInput, message, finalMessage) {
        targetInput.focus();
        if (targetInput.value === undefined && window.messengerApp && window.messengerApp.pasteQuickReplyText) {
          selectQuickReplyToken(targetInput);
          // Cho Lexical kịp nhận sự kiện selectionchange trước khi dán.
          await new Promise(function(resolve) { setTimeout(resolve, 30); });
          var res = null;
          try { res = await window.messengerApp.pasteQuickReplyText(message); } catch (e) { res = null; }
          if (res && res.ok && await waitForComposerText(targetInput, message, 2500)) return true;
          // Dán không ăn (clipboard bị chiếm, máy chậm...): gõ thật qua main thay cho
          // dựng DOM, vì chữ dựng DOM chỉ hiện đè placeholder mà Zalo không gửi được.
          if (!(await waitForComposerText(targetInput, message, 0))) {
            targetInput.focus();
            selectQuickReplyToken(targetInput);
            await new Promise(function(resolve) { setTimeout(resolve, 30); });
            try { res = await window.messengerApp.pasteQuickReplyText(message, 'type'); } catch (e) { res = null; }
          }
          if (await waitForComposerText(targetInput, message, 2500)) return true;
        }
        clearComposerText(targetInput);
        return insertComposerTextInPage(targetInput, finalMessage);
      }

      async function applyQuickReply(targetInput, reply, typedText, viaMain) {
        if (!targetInput || !reply || window.__DepLaoApplyingQuickReply) {
          return { ok: false, message: 'Đang có mẫu khác chờ chèn. Thử lại sau giây lát.' };
        }
        window.__DepLaoApplyingQuickReply = true;
        var keyword = String(reply.keyword || '').trim();
        try {
          var currentText = String(typedText !== undefined ? typedText : composerTextValue(targetInput));
          var trigger = String.fromCharCode(92);
          var triggerIndex = currentText.lastIndexOf(trigger);
          var finalMessage = (triggerIndex >= 0 ? currentText.slice(0, triggerIndex) : '') + String(reply.message || '');
          clearComposerNotice();
          // Dán ảnh NGAY (như bản cũ) cho nhanh; ảnh nằm ở khung đính kèm riêng nên
          // lần dán chữ sau không làm mất ảnh. Chờ ảnh hiện để clipboard ảnh không bị
          // chữ ghi đè trước khi Zalo kịp đọc.
          var imagePath = String(reply.imagePath || '').trim();
          var imageWarn = null;
          if (imagePath) {
            var before = composerPendingImageNodes(composerRoot()).length;
            var paste = null;
            try { paste = await window.messengerApp.pasteQuickReplyImage(imagePath); }
            catch (err) { paste = { ok: false, message: String((err && err.message) || err) }; }
            if (!paste || !paste.ok) imageWarn = (paste && paste.message) || 'Không dán được ảnh.';
            else await waitForComposerImage(before, QUICK_REPLY_IMAGE_TIMEOUT_MS);
          }
          // Chữ đi qua thao tác dán thật để Lexical ghi nhận -> Enter gửi cả chữ lẫn ảnh.
          await fillComposerWithRealPaste(targetInput, String(reply.message || ''), finalMessage);
          if (imageWarn) {
            showQuickReplyNotice('Mẫu ' + trigger + keyword + ' không chèn được ảnh: ' + imageWarn + '. Tin nhắn chữ đã được điền, ảnh chưa có.');
            return { ok: true, stage: 'paste-warn', message: imageWarn, keyword: keyword };
          }
          if (viaMain) return { ok: true, doneByMain: true, finalMessage: finalMessage, keyword: keyword };
          return { ok: true, keyword: keyword };
        } catch (err) {
          return { ok: false, message: String((err && err.message) || err) };
        } finally {
          setTimeout(function() { window.__DepLaoApplyingQuickReply = false; }, 100);
        }
      }

      // Dọn thông báo tạm sau khi nút "Chèn" đã điền xong nội dung trong ô soạn tin.
      window.__DepLaoFinalizeQuickReply = function(result) {
        if (result && result.doneByMain) {
          var box = document.getElementById('dep-lao-quick-reply-notice');
          if (box) box.remove();
        }
        return result;
      };

      // Nút "Chèn" trong bảng quản lý dùng đúng luồng này trên tab Zalo đang mở.
      window.__DepLaoRunQuickReply = function(reply) {
        var input = findComposerInput();
        if (!input) return Promise.resolve({ ok: false, message: 'Không tìm thấy ô soạn tin Zalo. Hãy mở một cuộc trò chuyện.' });
        if (!String(composerTextValue(input)).trim()) input.focus();
        return applyQuickReply(input, reply || {}, undefined, true);
      };

      // Nút "Chèn" báo giá: đi đúng luồng dán chữ thật như tin nhắn nhanh. Ô soạn Zalo
      // là Lexical, nên chữ dựng bằng DOM/execCommand chỉ hiện đè placeholder mà state gửi
      // đi vẫn rỗng (Enter không gửi được). Dán/gõ thật qua main là đường đã ổn định.
      window.__DepLaoInsertComposerText = function(text) {
        var input = findComposerInput();
        if (!input) return Promise.resolve({ ok: false, message: 'Không tìm thấy ô soạn tin Zalo. Hãy mở một cuộc trò chuyện.' });
        var message = String(text || '');
        if (!message) return Promise.resolve({ ok: false, message: 'Nội dung báo giá đang trống.' });
        clearComposerText(input);
        // Báo giá không thuộc danh sách mẫu nên đường dán clipboard bị main chặn
        // (xem 'quick-reply:paste-text'): gõ thật từng dòng qua kệnh riêng; nếu
        // kệnh chưa có (preload cũ) mới về lại đường DOM dự phòng.
        if (window.messengerApp && window.messengerApp.insertQuoteComposerText) {
          selectQuickReplyToken(input);
          return window.messengerApp.insertQuoteComposerText(message)
            .then(function(result) { return result || { ok: false, message: 'Không chèn được nội dung báo giá.' }; })
            .catch(function(error) {
              return { ok: false, message: String((error && error.message) || error) };
            });
        }
        return fillComposerWithRealPaste(input, message, message)
          .then(function(ok) {
            if (!ok) return { ok: false, message: 'Không chèn được nội dung vào ô soạn tin Zalo.' };
            return { ok: true, chars: message.length };
          })
          .catch(function(error) {
            return { ok: false, message: String((error && error.message) || error) };
          });
      };

      // Ẩn panel Tin nhắn nhanh gốc của Zalo để chỉ còn danh sách của Nhà Yến (chỉ ẩn bằng CSS, không vá sâu vào Zalo).
      setupQuickReplyPanelHider();

      function setupQuickReplyShortcuts() {
        if (window.__DepLaoShortcutsReady) return;
        window.__DepLaoShortcutsReady = true;

        var activeHintIndex = 0;
        var autoFillTimer = null;
        document.addEventListener('keydown', function(e) {
          var hint = document.getElementById('dep-lao-shortcut-hint');
          // Chi huy timer tu dong dien khi phim nay thay doi trang thai goi y hoac noi dung o nhap;
          // phim dieu huong (Home/End/mui ten) khong lam thay doi text nen giu timer song sot.
          var cancelsAutoFill = e.key === 'Escape' || (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Backspace' || e.key === 'Delete';
          if (autoFillTimer && cancelsAutoFill) { clearTimeout(autoFillTimer); autoFillTimer = null; }
          if (!hint || hint.style.display === 'none' || !hint.children.length) {
            if (window.__DepLaoExactReply) window.__DepLaoExactReply = null;
            return;
          }
          var items = Array.from(hint.children);
          // \keyword + phím space: chèn nhanh, nhưng chỉ khi gợi ý khớp đúng 1 mẫu
          // để không nuốt mất dấu cách khi người dùng đang gõ dở.
          if (e.key === ' ' && items.length === 1 && window.__DepLaoExactReply) {
            e.preventDefault(); e.stopPropagation();
            hint.style.display = 'none';
            window.__DepLaoExactReply = null;
            items[0].click();
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            activeHintIndex = (activeHintIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items.forEach(function(item, index) { item.style.background = index === activeHintIndex ? 'rgba(10,132,255,.2)' : ''; });
            items[activeHintIndex].scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault(); e.stopPropagation(); items[activeHintIndex].click();
          } else if (e.key === 'Escape') {
            e.preventDefault(); hint.style.display = 'none';
          }
        }, true);

        // Gợi ý riêng của Nhà Yến dùng dấu \, kể cả khi event phát từ phần tử con của contenteditable.
        document.addEventListener('input', function(e) {
          if (window.__DepLaoApplyingQuickReply) return;
          if (autoFillTimer) { clearTimeout(autoFillTimer); autoFillTimer = null; }
          var replies = window.__DepLaoQuickReplies;
          if (!replies || !replies.length) return;
          var targetInput = findComposerFromTarget(e.target);
          if (!targetInput) return;
          var text = composerTextValue(targetInput);
          var existingHint = document.getElementById('dep-lao-shortcut-hint');
          var trigger = String.fromCharCode(92);
          var token = String(text).replace(/[​-‍﻿]/g, '').trim();
          var validToken = token.charCodeAt(0) === 92;
          for (var tokenIndex = 1; validToken && tokenIndex < token.length; tokenIndex++) {
            var tokenCode = token.charCodeAt(tokenIndex);
            if (tokenCode === 9 || tokenCode === 10 || tokenCode === 13 || tokenCode === 32 || tokenCode === 160 || tokenCode === 92) validToken = false;
          }
          var normalizeSearch = function(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi'); };
          var query = normalizeSearch(token.slice(1));
          if (validToken) {
            if (!existingHint) {
              existingHint = document.createElement('div');
              existingHint.id = 'dep-lao-shortcut-hint';
              existingHint.style.cssText = 'position:absolute;bottom:100%;left:16px;right:16px;background:rgba(20,22,30,.95);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px 0;z-index:999;max-height:240px;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:' + nhaYenFontFamily + ';font-size:13px;';
              var inputContainer = targetInput.closest('[class*="chat-input"]') || targetInput.closest('[role="presentation"]') || targetInput.parentElement;
              if (inputContainer) { inputContainer.style.position = 'relative'; inputContainer.appendChild(existingHint); }
            }
            existingHint.innerHTML = '';
            activeHintIndex = 0;
            var ranked = replies.map(function(reply, index) { return { reply: reply, keyword: String(reply.keyword || (index + 1)), order: index }; })
              .filter(function(entry) { return normalizeSearch(entry.keyword).startsWith(query); })
              .sort(function(a, b) { var ap = normalizeSearch(a.keyword).indexOf(query) === 0; var bp = normalizeSearch(b.keyword).indexOf(query) === 0; return Number(bp) - Number(ap) || a.order - b.order; });
            ranked.forEach(function(entry, index) {
                var item = document.createElement('div');
                var shortcut = trigger + entry.keyword;
                item.style.cssText = 'padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:background .15s;' + (index === 0 ? 'background:rgba(10,132,255,.2);' : '');
                item.innerHTML = '<span style="background:rgba(10,132,255,.3);color:#65b7ff;padding:3px 8px;border-radius:8px;font-size:13px;font-weight:700;font-family:inherit;flex-shrink:0;">' + shortcut + '</span><span style="font-size:13px;color:rgba(255,255,255,.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (entry.reply.message.length > 60 ? entry.reply.message.substring(0, 60) + '...' : entry.reply.message) + '</span>';
                item.onmouseenter = function() { item.style.background = 'rgba(255,255,255,.08)'; };
                item.onmouseleave = function() { item.style.background = index === activeHintIndex ? 'rgba(10,132,255,.2)' : ''; };
                item.onclick = function(ev) { ev.preventDefault(); ev.stopPropagation(); existingHint.remove(); applyQuickReply(targetInput, entry.reply, text); };
                existingHint.appendChild(item);
              });
            existingHint.style.display = existingHint.children.length ? 'block' : 'none';
            // Ghi nhớ mẫu khớp chính xác để phím space có thể chèn nhanh (chỉ 1 mẫu).
            if (ranked.length === 1 && query && normalizeSearch(ranked[0].keyword) === query) {
              window.__DepLaoExactReply = { index: 0, token: token };
            } else {
              window.__DepLaoExactReply = null;
            }
            // Tu dong dien khi chi co dung 1 ket qua khop chinh xac voi keyword
            if (ranked.length === 1 && query && normalizeSearch(ranked[0].keyword) === query) {
              (function(entry, expectedToken) {
                autoFillTimer = setTimeout(function() {
                  autoFillTimer = null;
                  if (window.__DepLaoApplyingQuickReply) return;
                  // Kiem tra lai noi dung o nhap de khong dien nham khi text da thay doi
                  var liveText = composerTextValue(targetInput);
                  var liveToken = String(liveText).replace(/[​-‍﻿]/g, '').trim();
                  if (liveToken !== expectedToken) return;
                  var hint2 = document.getElementById('dep-lao-shortcut-hint');
                  if (hint2) hint2.remove();
                  applyQuickReply(targetInput, entry.reply, liveText);
                }, 450);
              })(ranked[0], token);
            }
            return;
          }
          if (existingHint) existingHint.style.display = 'none';
          window.__DepLaoExactReply = null;
        }, true);
      }
      // Chạy trong main world của Zalo giống cơ chế ổn định trước đây.
      setTimeout(setupQuickReplyShortcuts, 3000);

      // Bo loc hoi thoai Zalo: Tat ca / Ca nhan (unread) / Nhom (unread).
      // Chi toggle display — khong click, khong doi class unread, khong scroll -> KHONG tu danh dau da doc.
      // Logic phan loai inline tu modules/conv-classify.js (preload sandbox khong require ngoai electron).
      window.__NY_FILTER_MODE = window.__NY_FILTER_MODE || 'all';

      function __nyClassifyConversation(input) {
        var dataId = String((input && input.dataId) || '');
        var className = String((input && input.className) || '');
        var ariaLabel = String((input && input.ariaLabel) || '');
        var title = String((input && input.title) || '');
        var bodyText = String((input && input.bodyText) || '');
        var avatarCount = Number((input && input.avatarCount) || 0) || 0;
        var hasGroupIcon = !!(input && input.hasGroupIcon);
        // Tin xem truoc cua nhom luon co tien to ten nguoi gui ("Emin:", "Tuấn Gai:");
        // chat 1-1 thi khong (hoac "Bạn:"). Day la dau hieu dang tin nhat trong DOM Zalo web.
        var m = bodyText.match(/^\s*([^:\n]{1,40}):\s/);
        if (m) {
          var who = m[1].trim().toLowerCase();
          if (who && who !== 'bạn' && who !== 'ban' && who !== 'you') return 'group';
        }
        if (/(^|[^a-z])(group|grp)[_-]/i.test(dataId)) return 'group';
        if (/\bgroup\b/i.test(className)) return 'group';
        if (/(nh[oó]m|group)/i.test(ariaLabel) || /(nh[oó]m|group)/i.test(title)) return 'group';
        if (avatarCount >= 3) return 'group';
        if (hasGroupIcon) return 'group';
        return 'personal';
      }

      function __nyIsUnreadRow(row) {
        if (!row || !row.querySelector) return false;
        var badge = row.querySelector('[class*="unread" i], [class*="badge" i], [class*="notify" i], [data-unread="true"]');
        if (!badge) return false;
        var rect = badge.getBoundingClientRect && badge.getBoundingClientRect();
        var style = window.getComputedStyle ? window.getComputedStyle(badge) : null;
        if (!rect || rect.width <= 0 || rect.height <= 0 || (style && (style.display === 'none' || style.visibility === 'hidden'))) return false;
        var text = String(badge.textContent || '').trim();
        var className = String(badge.className || '');
        if (!text && !/unread|notify/i.test(className) && badge.getAttribute('data-unread') !== 'true') return false;
        return true;
      }

      function __nyNormalizeChatText(value) {
        return String(value || '')
          .normalize('NFC')
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function __nyTokenHas(el, token) {
        if (!el || !el.classList) return false;
        try { return el.classList.contains(token); } catch (e) { return false; }
      }

      function __nyCollectConversationRows() {
        if (!isZalo) return [];
        // Dong that cua Zalo web = phan tu co TOKEN class 'conv-item' (khong phai conv-item__avatar /
        // conv-item-title__name / conv-item-body / conv-unread-react). Dung '.conv-item' (token)
        // de khong vo cac phan tu con giong nhu '[class*=conv-item]'.
        var inner = Array.from(document.querySelectorAll('.conv-item'));
        var seenEl = new Set();
        var seenKey = new Set();
        var out = [];
        inner.forEach(function(cell) {
          if (!cell || !cell.querySelector) return;
          // An toan theo wrapper .msg-item (tat wrapper de khong de lai cho trong), neu khong co thi dung chinh no.
          var row = (cell.closest && cell.closest('.msg-item')) || cell;
          if (seenEl.has(row)) return;
          seenEl.add(row);
          var key = row.getAttribute('data-id') || row.getAttribute('id') || '';
          if (!key) key = 'k:' + out.length;
          if (seenKey.has(key)) return;
          seenKey.add(key);
          var nameEl = row.querySelector('.conv-item-title__name, .item-title__name, .item-title, .truncate');
          var name = nameEl ? __nyNormalizeChatText(nameEl.innerText || nameEl.textContent || '') : '';
          var bodyEl = row.querySelector('.conv-item-body, [class*="conv-item-body"]');
          var bodyText = bodyEl ? __nyNormalizeChatText(bodyEl.innerText || bodyEl.textContent || '') : '';
          var unread = __nyIsUnreadRow(row);
          var typed = __nyClassifyConversation({
            dataId: row.getAttribute('data-id') || '',
            className: String(row.className || ''),
            ariaLabel: String(row.getAttribute('aria-label') || ''),
            title: String(row.getAttribute('title') || name || ''),
            bodyText: bodyText,
            avatarCount: row.querySelectorAll('img,.avatar,.zavatar').length,
            hasGroupIcon: !!row.querySelector('[class*="group" i]')
          });
          out.push({ el: row, id: key, name: name, unread: unread, type: typed, bodyText: bodyText });
        });
        return out;
      }

      function __nyApplyFilter(rows) {
        // Read-only by design. Zalo owns row visibility for its virtualized list.
        // Mutating inline display here can desynchronize React state and hide history.
        return rows;
      }

      function __nyEmitCounts(rows) {
        var personalUnread = 0, groupUnread = 0;
        rows.forEach(function(r) { if (r && r.unread) { if (r.type === 'group') groupUnread += 1; else personalUnread += 1; } });
        var total = personalUnread + groupUnread;
        try { window.messengerApp.sendUnreadConversationCount(total); } catch (e) {}
        try { window.messengerApp.sendUnreadCountDetail({ total: total, personalUnread: personalUnread, groupUnread: groupUnread }); } catch (e) {}
        try {
          var chats = [];
          for (var i = 0; i < rows.length; i++) {
            var n = String(rows[i].name || '');
            if (!n || chats.indexOf(n) !== -1) continue;
            var low = n.toLowerCase();
            if (['tin nhắn', 'danh bạ', 'zalo cloud', 'công cụ', 'giao việc', 'lịch sử đồng bộ', 'cài đặt'].some(function(k){ return low === k || low.indexOf(k) !== -1; })) continue;
            chats.push(n);
          }
          window.messengerApp.sendRecentChats(chats);
        } catch (e2) {}
      }

      function __nyDiagCollect(rows, err) {
        try {
          var q = function(sel){ try { return document.querySelectorAll(sel).length; } catch(e){ return -1; } };
          var probes = {
            dot_conv_item: q('.conv-item'),
            star_conv_item: q('[class*="conv-item" i]'),
            msg_item: q('.msg-item'),
            data_id: q('[data-id]'),
            gridv2_conv: q('.gridv2.conv-item'),
            conv_rel: q('.conv-item.conv-rel')
          };
          var samples = [];
          var sels = ['.conv-item', '.msg-item', '[class*="conv-item"]'];
          for (var s = 0; s < sels.length; s++) {
            try {
              var list = document.querySelectorAll(sels[s]);
              var got = [];
              for (var t = 0; t < list.length && got.length < 6; t++) {
                var el = list[t];
                got.push(String(el.className || '').slice(0, 120));
              }
              samples.push({ sel: sels[s], count: list.length, classes: got });
            } catch (e) {}
          }
          var items = [];
          for (var i = 0; i < rows.length && items.length < 30; i++) {
            var r = rows[i];
            if (!r || !r.el) continue;
            items.push({ name: r.name, id: r.id, unread: !!r.unread, type: r.type, body: String(r.bodyText||'').slice(0,40) });
          }
          window.messengerApp.sendConvDiag({
            at: Date.now(), engineVer: 'v2', rowCount: rows.length,
            probes: probes, samples: samples, items: items,
            err: err ? String(err && err.message ? err.message : err) : null
          });
        } catch (e) {}
      }

      function __nyTick() {
        // DA CHUYEN SANG ISOLATED WORLD (preload top-level). De trong main world = no-op
        // tranh xung dot display/count voi engine that.
        return;
        if (!isZalo) return;
        var __diagErr = null;
        try {
          var rows = __nyCollectConversationRows();
          __nyApplyFilter(rows);
          __nyEmitCounts(rows);
          if (window.__NY_DIAG_ONCE) { window.__NY_DIAG_ONCE = false; __nyDiagCollect(rows, null); }
        } catch (e) {
          __diagErr = e;
          try { if (window.__NY_DIAG_ONCE) { window.__NY_DIAG_ONCE = false; __nyDiagCollect(window.__nyCollectConversationRows ? (function(){try{return __nyCollectConversationRows();}catch(e2){return [];}})() : [], e); } } catch (e3) {}
        }
      }

      window.__nyFilterMode = function(mode) {
        if (mode !== 'personal' && mode !== 'group') mode = 'all';
        window.__NY_FILTER_MODE = mode;
        __nyTick();
      };
      window.__nyTick = __nyTick;

      setInterval(__nyTick, 2000);
      setTimeout(__nyTick, 1200);

      // Chan doan tu dong: ghi log vai lan sau khi mo app de bat duoc DOM that (khong can bam chip).
      var __nyAutoDiag = 0;
      function __nyAutoDiagFire() {
        if (__nyAutoDiag >= 4 || !isZalo) return;
        __nyAutoDiag++;
        try { __nyDiagCollect(__nyCollectConversationRows(), null); } catch (e) { __nyDiagCollect([], e); }
      }
      [3000, 7000, 12000, 20000].forEach(function(d){ setTimeout(__nyAutoDiagFire, d); });

      var __nyObs = null;
      var __nyObsTimer = null;
      function __nySetupObserver() {
        if (__nyObs || !isZalo) return;
        var rows = document.querySelectorAll('.msg-item, [class*="conv-item" i], [data-id]');
        if (!rows.length) return;
        var anchor = rows[0] && rows[0].parentElement;
        var guard = 0;
        while (anchor && anchor !== document.body && guard < 6) {
          if (anchor.querySelectorAll('.msg-item, [class*="conv-item" i], [data-id]').length >= 2) break;
          anchor = anchor.parentElement; guard++;
        }
        if (!anchor || anchor === document.body) anchor = document.body;
        try {
          __nyObs = new MutationObserver(function() {
            if (__nyObsTimer) return;
            __nyObsTimer = setTimeout(function() { __nyObsTimer = null; __nyTick(); }, 250);
          });
          __nyObs.observe(anchor, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-unread'] });
        } catch (e) { __nyObs = null; }
      }
      setTimeout(__nySetupObserver, 2500);
      setInterval(__nySetupObserver, 8000);


      // Auto extract profile name & avatar
      function extractCurrentChatInfo() {
        var info = { name: '', platform: platform.toLowerCase() };
        try {
          if (isZalo) {
            var candidates = Array.from(document.querySelectorAll('.header-title, .title-name, [class*="chat-header"] [class*="title"]'));
            candidates = candidates.filter(function(el) {
              var rect = el.getBoundingClientRect();
              var text = (el.innerText || '').replace(/\s+/g, ' ').trim();
              return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 170 && rect.left > 180 && text && !/^(Thông tin nhóm|Thành viên nhóm)$/i.test(text);
            }).sort(function(a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
            var chatNameEl = candidates[0] || null;
            if (chatNameEl) info.name = (chatNameEl.innerText || '').replace(/\s+/g, ' ').trim();
          } else if (isMessenger) {
            var chatNameEl = document.querySelector('span[dir="auto"]');
            if (document.title && document.title.includes('Messenger')) {
               var t = document.title.replace('| Messenger', '').trim();
               if (t !== 'Messenger' && t !== 'Facebook') info.name = t;
            }
          } else if (isWhatsApp) {
            var chatNameEl = document.querySelector('#main header span[dir="auto"]');
            if (chatNameEl) info.name = chatNameEl.innerText.trim();
          } else if (isTelegram) {
            var chatNameEl = document.querySelector('.MiddleHeader .chat-title, .middle-header .peer-title');
            if (chatNameEl) info.name = chatNameEl.innerText.trim();
          }
        } catch (e) {}
        if (info.name) {
          try { window.messengerApp.sendCurrentChatInfo(info); } catch (e) {}
        }
      }
      setInterval(extractCurrentChatInfo, 3000);

      function extractProfileInfo() {
        var info = { name: '', avatar: '' };
        try {
          if (isZalo) {
            var nameEl = document.querySelector('#app-navigation .str-name, #app-navigation [class*="profile-name"], .nav__tabs__profile-name');
            var avatarEl = document.querySelector('#app-navigation .zavatar img, #app-navigation [class*="avatar"] img, .nav__tabs__avatar img, .zavatar-img');
            if (!avatarEl) {
              var imgs = Array.from(document.querySelectorAll('img'));
              avatarEl = imgs.find(function(img) {
                var rect = img.getBoundingClientRect();
                var src = String(img.currentSrc || img.src || '');
                return src && !/logo|icon|banner|ads?/i.test(src) && rect.left >= 0 && rect.left < 90 && rect.top >= 20 && rect.top < 180 && rect.width >= 28 && rect.width <= 72 && Math.abs(rect.width - rect.height) < 10;
              });
            }
            if (nameEl) info.name = (nameEl.innerText || '').replace(/\s+/g, ' ').trim();
            if (avatarEl) info.avatar = avatarEl.currentSrc || avatarEl.src;
          } else if (isMessenger) {
            var titleEl = document.querySelector('title');
            if (titleEl && titleEl.innerText) {
              var t = titleEl.innerText;
              if (t.includes('(')) t = t.substring(t.indexOf(')') + 1);
              info.name = t.replace('Messenger', '').trim();
            }
            var avatarEl = document.querySelector('img[role="img"]') || document.querySelector('image[preserveAspectRatio="xMidYMid slice"]');
            if (avatarEl) info.avatar = avatarEl.src || avatarEl.getAttribute('xlink:href');
          } else if (isWhatsApp) {
            var nameEl = document.querySelector('h1.tvf2evcx') || document.querySelector('header span[dir="auto"]');
            var avatarEl = document.querySelector('header img');
            if (nameEl) info.name = nameEl.innerText.trim();
            if (avatarEl) info.avatar = avatarEl.src;
          } else if (isTelegram) {
            var nameEl = document.querySelector('.peer-title');
            var avatarEl = document.querySelector('.Avatar img');
            if (nameEl) info.name = nameEl.innerText.trim();
            if (avatarEl) info.avatar = avatarEl.src;
          } else if (host.includes('facebook.com')) {
            var nameEl = document.querySelector('h1') || document.querySelector('title');
            var avatarEl = document.querySelector('img[referrerpolicy="origin-when-cross-origin"]');
            if (nameEl) {
              var t = nameEl.innerText || '';
              if (t.includes('(')) t = t.substring(t.indexOf(')') + 1);
              info.name = t.replace('Facebook', '').trim();
            }
            if (avatarEl) info.avatar = avatarEl.src;
          }
        } catch (e) { console.error('Extracted error', e); }
        if (info.name || info.avatar) {
          info.kind = 'account-navigation';
          try { window.messengerApp.sendProfileInfo(info); } catch (e) { console.error('sendProfileInfo error', e); }
        }
      }
      setInterval(extractProfileInfo, 5000);

      console.log('[DepLao] Shield ready:', platform, window.__DepLaoBlockSeen, window.__DepLaoBlockTyping, window.__DepLaoZaDarkShield);
    })();
  `;
  webFrame.executeJavaScript(injectionScript);
}

runInjection(settings);

// ===== ENGINE LOC HOI THOAI — chay trong ISOLATED WORLD (preload) =====
// Ly do: main-world IIFE (injectionScript) bat isZalo MOT LUC luc inject va co the
// khong chay duoc khi anh bam chip. Isolated world truy cap CUNG DOM that, co san
// ipcRenderer, va tinh isZalo TUOI moi tick -> chang phu thuoc injection/timing.
// Chi toggle 'display' tren dong .conv-item — khong click/khong scroll -> KHONG tu danh dau da doc.
(function () {
  var __nyMode = 'all';

  function __nyIsZalo() {
    var h = location.hostname || '';
    return h === 'chat.zalo.me' || h.indexOf('zalo.me') !== -1;
  }

  function __nyNorm(value) {
    return String(value || '')
      .normalize('NFC')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function __nyClassify(input) {
    var dataId = String((input && input.dataId) || '');
    var className = String((input && input.className) || '');
    var ariaLabel = String((input && input.ariaLabel) || '');
    var title = String((input && input.title) || '');
    var bodyText = String((input && input.bodyText) || '');
    var avatarCount = Number((input && input.avatarCount) || 0) || 0;
    var hasGroupIcon = !!(input && input.hasGroupIcon);
    // Tin xem truoc cua nhom luon co tien to ten nguoi gui ("Emin:"); chat 1-1 thi khong (hoac "Bạn:").
    var m = bodyText.match(/^\s*([^:\n]{1,40}):\s/);
    if (m) {
      var who = m[1].trim().toLowerCase();
      if (who && who !== 'bạn' && who !== 'ban' && who !== 'you') return 'group';
    }
    if (/(^|[^a-z])(group|grp)[_-]/i.test(dataId)) return 'group';
    if (/\bgroup\b/i.test(className)) return 'group';
    if (/(nh[oó]m|group)/i.test(ariaLabel) || /(nh[oó]m|group)/i.test(title)) return 'group';
    if (avatarCount >= 3) return 'group';
    if (hasGroupIcon) return 'group';
    return 'personal';
  }

  function __nyIsUnread(row) {
    if (!row || !row.querySelector) return false;
    var badge = row.querySelector('[class*="unread" i], [class*="badge" i], [class*="notify" i], [data-unread="true"]');
    if (!badge) return false;
    var rect = badge.getBoundingClientRect && badge.getBoundingClientRect();
    var style = window.getComputedStyle ? window.getComputedStyle(badge) : null;
    if (!rect || rect.width <= 0 || rect.height <= 0 || (style && (style.display === 'none' || style.visibility === 'hidden'))) return false;
    var text = String(badge.textContent || '').trim();
    var className = String(badge.className || '');
    if (!text && !/unread|notify/i.test(className) && badge.getAttribute('data-unread') !== 'true') return false;
    return true;
  }

  function __nyCollect() {
    if (!__nyIsZalo()) return [];
    var inner = Array.prototype.slice.call(document.querySelectorAll('.conv-item'));
    var seenEl = [];
    var seenKey = {};
    var out = [];
    inner.forEach(function (cell) {
      if (!cell || !cell.querySelector) return;
      var row = (cell.closest && cell.closest('.msg-item')) || cell;
      if (seenEl.indexOf(row) !== -1) return;
      seenEl.push(row);
      var key = row.getAttribute('data-id') || row.getAttribute('id') || '';
      if (!key) key = 'k:' + out.length;
      if (seenKey[key]) return;
      seenKey[key] = true;
      var nameEl = row.querySelector('.conv-item-title__name, .item-title__name, .item-title, .truncate');
      var name = nameEl ? __nyNorm(nameEl.innerText || nameEl.textContent || '') : '';
      var bodyEl = row.querySelector('.conv-item-body, [class*="conv-item-body"]');
      var bodyText = bodyEl ? __nyNorm(bodyEl.innerText || bodyEl.textContent || '') : '';
      var unread = __nyIsUnread(row);
      var typed = __nyClassify({
        dataId: row.getAttribute('data-id') || '',
        className: String(row.className || ''),
        ariaLabel: String(row.getAttribute('aria-label') || ''),
        title: String(row.getAttribute('title') || name || ''),
        bodyText: bodyText,
        avatarCount: row.querySelectorAll('img,.avatar,.zavatar').length,
        hasGroupIcon: !!row.querySelector('[class*="group" i]')
      });
      out.push({ el: row, id: key, name: name, unread: unread, type: typed, bodyText: bodyText });
    });
    return out;
  }

  function __nyApply(rows) {
    // Deliberately read-only. Never mutate style/class/scroll/focus on Zalo rows.
    return rows;
  }

  function __nyEmit(rows) {
    var personalUnread = 0, groupUnread = 0;
    rows.forEach(function (r) { if (r && r.unread) { if (r.type === 'group') groupUnread += 1; else personalUnread += 1; } });
    var total = personalUnread + groupUnread;
    try { ipcRenderer.send('profile-unread-count', total); } catch (e) {}
    try { ipcRenderer.send('profile-unread-count-detail', { total: total, personalUnread: personalUnread, groupUnread: groupUnread }); } catch (e) {}
    try {
      var chats = [];
      for (var i = 0; i < rows.length; i++) {
        var n = String(rows[i].name || '');
        if (!n || chats.indexOf(n) !== -1) continue;
        var low = n.toLowerCase();
        if (['tin nhắn', 'danh bạ', 'zalo cloud', 'công cụ', 'giao việc', 'lịch sử đồng bộ', 'cài đặt'].some(function (k) { return low === k || low.indexOf(k) !== -1; })) continue;
        chats.push(n);
      }
      ipcRenderer.send('recent-chats-extracted', chats);
    } catch (e2) {}
  }

  function __nyTick() {
    if (!__nyIsZalo()) return;
    try {
      var rows = __nyCollect();
      __nyApply(rows);
      __nyEmit(rows);
      __nyDiagRows(rows);
    } catch (e) {
      try { ipcRenderer.send('conv-diag4', { at: Date.now(), err: String(e && e.message ? e.message : e) }); } catch (e2) {}
    }
  }

  // Do chan dong: vai lan dau, gui phan loai + unread cua tung dong de doi chieu.
  var __nyDiagN = 0;
  function __nyDiagRows(rows) {
    if (__nyDiagN >= 18) return;
    __nyDiagN++;
    try {
      var pu = 0, gu = 0, out = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.unread) { if (r.type === 'group') gu++; else pu++; }
        out.push({ name: String(r.name || '').slice(0, 24), unread: !!r.unread, type: r.type, body: String(r.bodyText || '').slice(0, 36) });
      }
      // Do cau truc tho: so .conv-item that trong DOM vs so dong engine gom duoc,
      // de phan biet virtualization (raw it) vs gop nham qua closest('.msg-item') (raw nhieu, rowCount it).
      var rawCells = document.querySelectorAll('.conv-item');
      var struct = [];
      for (var j = 0; j < rawCells.length && j < 10; j++) {
        var c = rawCells[j];
        var mi = c.closest ? c.closest('.msg-item') : null;
        struct.push({
          cls: String(c.className || '').slice(0, 60),
          hasMsgItem: !!mi,
          miCls: mi ? String(mi.className || '').slice(0, 60) : null,
          dataId: c.getAttribute('data-id') || (mi && mi.getAttribute('data-id')) || '',
          badge: !!c.querySelector('[class*="unread" i], [class*="badge" i], [class*="notify" i], [data-unread="true"]')
        });
      }
      ipcRenderer.send('conv-diag4', { at: Date.now(), mode: __nyMode, rawConvItem: rawCells.length, rowCount: rows.length, personalUnread: pu, groupUnread: gu, struct: struct, rows: out });
    } catch (e) {}
  }

  window.__nyIwSetMode = function (m) {
    __nyMode = (m === 'personal' || m === 'group') ? m : 'all';
    __nyTick();
  };

  setInterval(__nyTick, 1500);
  setTimeout(__nyTick, 1000);

  var __nyObs = null, __nyObsTimer = null;
  function __nySetupObserver() {
    if (__nyObs || !__nyIsZalo()) return;
    var rows = document.querySelectorAll('.conv-item');
    if (!rows.length) return;
    var anchor = rows[0] && rows[0].parentElement;
    var guard = 0;
    while (anchor && anchor !== document.body && guard < 6) {
      if (anchor.querySelectorAll('.conv-item').length >= 2) break;
      anchor = anchor.parentElement; guard++;
    }
    if (!anchor || anchor === document.body) anchor = document.body;
    try {
      __nyObs = new MutationObserver(function () {
        if (__nyObsTimer) return;
        __nyObsTimer = setTimeout(function () { __nyObsTimer = null; __nyTick(); }, 250);
      });
      __nyObs.observe(anchor, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-unread'] });
    } catch (e) { __nyObs = null; }
  }
  setTimeout(__nySetupObserver, 2500);
  setInterval(__nySetupObserver, 8000);
})();

// ===== di chan dong (giu lai tam thoi de doi chieu, se go khi xong) =====
(function () {
  var __nyDiag3N = 0;
  function __nyDiag3Fire() {
    if (__nyDiag3N >= 5) return;
    __nyDiag3N++;
    try {
      var q = function (sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } };
      var probes = { dot_conv_item: q('.conv-item'), star_conv_item: q('[class*="conv-item" i]'), msg_item: q('.msg-item'), data_id: q('[data-id]'), conv_rel: q('.conv-item.conv-rel') };
      var samples = [];
      var list = document.querySelectorAll('.conv-item');
      for (var t = 0; t < list.length && t < 5; t++) samples.push(String(list[t].className || '').slice(0, 120));
      ipcRenderer.send('conv-diag3', { at: Date.now(), host: location.hostname, ready: document.readyState, probes: probes, samples: samples });
    } catch (e) { try { ipcRenderer.send('conv-diag3', { at: Date.now(), err: String(e) }); } catch (e2) {} }
  }
  [2000, 6000, 11000, 18000, 28000].forEach(function (d) { setTimeout(__nyDiag3Fire, d); });
})();

ipcRenderer.on('zalo-group-scan:start', (event, { scanId, script }) => {
  webFrame.executeJavaScript(script).catch((error) => {
    ipcRenderer.send('zalo-group-scan:event', { scanId, type: 'error', message: error.message || String(error) });
  });
});

ipcRenderer.on('zalo-group-scan:cancel', (event, { script }) => {
  webFrame.executeJavaScript(script).catch(() => {});
});

ipcRenderer.on('zalo-user-scan:start', (event, { scanId, script }) => {
  webFrame.executeJavaScript(script).catch((error) => ipcRenderer.send('zalo-user-scan:event', { scanId, type: 'error', message: error.message || String(error) }));
});

ipcRenderer.on('update-block-settings', (event, newSettings) => {
  webFrame.executeJavaScript(`
    window.__DepLaoBlockSeen = ${!!newSettings.blockSeen};
    window.__DepLaoBlockTyping = ${!!newSettings.blockTyping};
    window.__DepLaoZaDarkShield = ${!!newSettings.zadarkShield};
    var style = document.getElementById('dep-lao-zadark-style');
    if (!window.__DepLaoZaDarkShield && style) style.remove();
    console.log('[DepLao] Cập nhật bảo mật:', window.__DepLaoBlockSeen, window.__DepLaoBlockTyping, window.__DepLaoZaDarkShield);
  `);
});

ipcRenderer.on('update-quick-replies', (event, replies) => {
  webFrame.executeJavaScript(`
    window.__DepLaoQuickReplies = ${JSON.stringify(replies)};
    console.log('[DepLao] Cập nhật tin nhắn mẫu:', window.__DepLaoQuickReplies.length, 'mẫu');
  `);
});

ipcRenderer.on('conversation-filter:set', (event, payload) => {
  const mode = (payload && payload.mode) || 'all';
  try { window.__nyIwSetMode(mode); } catch (e) {}
});

ipcRenderer.on('quick-reply:ensure-ready', (event, payload) => {
  const request = Array.isArray(payload) ? { replies: payload } : (payload || {});
  runInjection({ ...settings, quickReplies: request.replies || [] });
  webFrame.executeJavaScript(`typeof window.__DepLaoRunQuickReply === 'function'`)
    .then((ready) => ipcRenderer.send('quick-reply:ready', { requestId: request.requestId || '', ok: !!ready }))
    .catch(() => ipcRenderer.send('quick-reply:ready', { requestId: request.requestId || '', ok: false }));
});
