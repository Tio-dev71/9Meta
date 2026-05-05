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
});

// Lấy cài đặt từ main process
const settings = ipcRenderer.sendSync('get-settings');

// Inject script vào trang web để chặn các API báo đã xem / đang nhập
const injectionScript = `
  window.__DepLaoBlockSeen = ${settings.blockSeen || false};
  window.__DepLaoBlockTyping = ${settings.blockTyping || false};

  (function() {
    // Phát hiện nền tảng đang chạy
    var host = window.location.hostname || '';
    var isZalo = host.includes('zalo.me') || host.includes('zadn.vn');
    var isMessenger = host.includes('messenger.com') || host.includes('facebook.com');
    var isWhatsApp = host.includes('whatsapp.com');
    var platform = isZalo ? 'Zalo' : isMessenger ? 'Messenger' : isWhatsApp ? 'WhatsApp' : 'Unknown';

    if (platform === 'Unknown') {
      console.log("[DepLao] Nền tảng không hỗ trợ:", host);
      return;
    }
    console.log("[DepLao] Khởi tạo trên nền tảng:", platform);

    // Hàm kiểm tra URL có nên chặn Seen không
    function shouldBlockSeen(url) {
      if (!window.__DepLaoBlockSeen) return false;
      if (isZalo) {
        return (url.includes('/api/message/read') || url.includes('/api/message/seen')) && !url.includes('read_status');
      }
      if (isMessenger) {
        return url.includes('change_read_status') || url.includes('mark_read') || 
               url.includes('read_receipt') || url.includes('/ajax/mercury/mark_seen');
      }
      if (isWhatsApp) {
        return url.includes('/read') || url.includes('receipt');
      }
      return false;
    }

    // Hàm kiểm tra URL có nên chặn Typing không
    function shouldBlockTyping(url) {
      if (!window.__DepLaoBlockTyping) return false;
      if (isZalo) {
        return url.includes('/api/message/typing');
      }
      if (isMessenger) {
        return url.includes('typ.php') || url.includes('typing_indicator') || url.includes('send_typing_indicator');
      }
      if (isWhatsApp) {
        return url.includes('chatstate') || url.includes('composing') || url.includes('typing');
      }
      return false;
    }

    // 1. Chặn Fetch API
    var originalFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
      if (shouldBlockSeen(url)) {
        console.log('[DepLao] Chặn Fetch Seen (' + platform + '):', url);
        return Promise.resolve(new Response(JSON.stringify({error: 0, msg: "Blocked by DepLao"}), { status: 200 }));
      }
      if (shouldBlockTyping(url)) {
        console.log('[DepLao] Chặn Fetch Typing (' + platform + '):', url);
        return Promise.resolve(new Response(JSON.stringify({error: 0, msg: "Blocked by DepLao"}), { status: 200 }));
      }
      return originalFetch.apply(this, args);
    };

    // 2. Chặn XMLHttpRequest
    var originalXHROpen = XMLHttpRequest.prototype.open;
    var originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = typeof url === 'string' ? url : (url ? url.toString() : '');
      return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
      var url = this._url || '';
      
      if (shouldBlockSeen(url) || shouldBlockTyping(url)) {
        console.log('[DepLao] Chặn XHR (' + platform + '):', url);
        Object.defineProperty(this, 'readyState', {get: function() { return 4; }});
        Object.defineProperty(this, 'status', {get: function() { return 200; }});
        Object.defineProperty(this, 'responseText', {get: function() { return '{"error":0}'; }});
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload();
        return;
      }
      
      return originalXHRSend.apply(this, arguments);
    };

    // 3. Chặn WebSocket
    var originalWSSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      var shouldDrop = false;
      try {
        if (typeof data === 'string') {
          if (isZalo) {
            if (window.__DepLaoBlockSeen && (data.includes('"cmd":97') || data.includes('"action":"read"'))) shouldDrop = true;
            if (window.__DepLaoBlockTyping && (data.includes('"cmd":121') || data.includes('"cmd":122') || data.includes('"action":"typing"'))) shouldDrop = true;
          }
          if (isMessenger) {
            if (window.__DepLaoBlockSeen && (data.includes('"type":"read"') || data.includes('mark_read') || data.includes('read_receipt'))) shouldDrop = true;
            if (window.__DepLaoBlockTyping && (data.includes('"type":"typ"') || data.includes('typing') || data.includes('composing'))) shouldDrop = true;
          }
          if (isWhatsApp) {
            if (window.__DepLaoBlockSeen && (data.includes('"read"') || data.includes('"receipt"') || data.includes('"ack"'))) shouldDrop = true;
            if (window.__DepLaoBlockTyping && (data.includes('"composing"') || data.includes('"chatstate"') || data.includes('"paused"'))) shouldDrop = true;
          }
        }
      } catch (e) {}
      
      if (shouldDrop) {
        console.log('[DepLao] Chặn WS (' + platform + '):', typeof data === 'string' ? data.substring(0, 100) : '[binary]');
        return;
      }
      return originalWSSend.call(this, data);
    };
    
    // 4. Fake window.open để không báo lỗi khi click link
    var originalWindowOpen = window.open;
    window.open = function(url, target, features) {
      var win = originalWindowOpen.call(window, url, target, features);
      if (!win) {
        return { closed: false, focus: function() {}, close: function() {} };
      }
      return win;
    };
    
    // 5. Gợi ý tin nhắn nhanh (Quick Reply) — chỉ áp dụng cho Zalo
    if (isZalo) {
      var quickReplies = [
        "Vâng ạ", "Dạ vâng", "OK", "Cảm ơn nhé!", "Đã nhận được thông tin", 
        "Mình đang bận, gọi lại sau nhé", "Đợi chút nhé", "Tuyệt vời! 👍", 
        "Gửi mình thông tin chi tiết nhé", "Chưa hiểu rõ lắm, bạn nói lại được không?"
      ];

      function injectQuickReplyBar() {
        var richInput = document.getElementById('richInput');
        if (!richInput) return;
        
        var container = richInput.closest('[id*="chat"]') || richInput.parentElement.parentElement;
        if (!container) return;

        var bar = document.getElementById('dep-lao-quick-reply');
        if (bar) return;

        bar = document.createElement('div');
        bar.id = 'dep-lao-quick-reply';
        bar.style.cssText = 'display:flex;gap:8px;padding:8px 16px;overflow-x:auto;white-space:nowrap;scrollbar-width:none;z-index:10;';
        
        var isDark = document.body.classList.contains('dark-mode');
        var textColor = isDark ? '#e1e4ea' : '#111827';
        var bgColor = isDark ? 'rgba(255,255,255,0.12)' : '#f3f4f6';
        var hoverBg = isDark ? 'rgba(255,255,255,0.22)' : '#e5e7eb';
        var bdrColor = isDark ? 'rgba(255,255,255,0.15)' : '#d1d5db';

        for (var i = 0; i < quickReplies.length; i++) {
          (function(text, bg, hv, tc, bc) {
            var btn = document.createElement('button');
            btn.innerText = text;
            btn.style.cssText = 'background:' + bg + ';color:' + tc + ';border:1px solid ' + bc + ';padding:6px 14px;border-radius:16px;font-size:13px;font-weight:500;cursor:pointer;flex-shrink:0;transition:all 0.2s;';
            
            btn.onmouseover = function() { btn.style.background = hv; };
            btn.onmouseout = function() { btn.style.background = bg; };
            
            btn.onclick = function(e) {
              e.preventDefault();
              e.stopPropagation();
              var input = document.getElementById('richInput');
              if (input) {
                input.focus();
                document.execCommand('insertText', false, text);
              }
            };
            bar.appendChild(btn);
          })(quickReplies[i], bgColor, hoverBg, textColor, bdrColor);
        }

        container.insertBefore(bar, container.firstChild);
        console.log('[DepLao] Đã chèn thanh gợi ý tin nhắn');
      }

      setTimeout(function() {
        setInterval(injectQuickReplyBar, 2000);
      }, 3000);
    }
    
    console.log("[DepLao] Khởi tạo xong — Platform:", platform, "| Block Seen:", window.__DepLaoBlockSeen, "| Block Typing:", window.__DepLaoBlockTyping);
  })();
`;

webFrame.executeJavaScript(injectionScript);

ipcRenderer.on('update-block-settings', (event, newSettings) => {
  webFrame.executeJavaScript(`
    window.__DepLaoBlockSeen = ${newSettings.blockSeen};
    window.__DepLaoBlockTyping = ${newSettings.blockTyping};
    console.log("[DepLao] Đã cập nhật cài đặt chặn. Block Seen:", window.__DepLaoBlockSeen, ", Block Typing:", window.__DepLaoBlockTyping);
  `);
});

