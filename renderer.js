const { ipcRenderer } = require('electron');

const profilesList = document.getElementById('profiles-list');

let profiles = [];
try {
  const saved = localStorage.getItem('mp_profiles');
  if (saved) profiles = JSON.parse(saved);
} catch (e) { }

if (profiles.length === 0) {
  profiles = [{ id: Date.now().toString(), name: 'Nick 1', partition: 'persist:nick_1', platform: 'zalo' }];
  saveProfiles();
}

profiles = profiles.map((p) => ({ ...p, platform: p.platform || 'zalo' }));
let activeProfileId = profiles[0].id;
let downloads = [];
let updateState = { status: 'idle', progress: 0 };
let appLocked = false;
let hasLockPassword = false;

function saveProfiles() { localStorage.setItem('mp_profiles', JSON.stringify(profiles)); }
function platformIcon(platform) {
  return { zalo: 'Z', telegram: '✈', messenger: 'M', fanpage: '🚩', whatsapp: 'W', teams: 'T', gmail: 'G' }[platform || 'zalo'] || 'A';
}

function renderSidebar() {
  profilesList.innerHTML = '';
  profiles.forEach(p => {
    const btn = document.createElement('div');
    btn.className = `profile-btn ${p.id === activeProfileId ? 'active' : ''}`;
    btn.title = `${p.name} (${p.platform || 'zalo'}) - Click phải để đổi tên/xóa`;
    const span = document.createElement('span');
    span.innerText = p.avatar ? '' : platformIcon(p.platform || 'zalo');
    if (p.avatar) {
      const img = document.createElement('img');
      img.src = p.avatar.startsWith('http') ? p.avatar : `file://${p.avatar.replace(/\\/g, '/')}`;
      img.style.cssText = 'width:100%;height:100%;border-radius:inherit;object-fit:cover;position:absolute;inset:0;';
      btn.appendChild(img);
    } else {
      btn.appendChild(span);
    }
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.id = `badge-${p.id}`;
    badge.innerText = '0';
    btn.appendChild(badge);
    btn.onclick = () => { if (!appLocked) switchProfile(p.id); };
    btn.oncontextmenu = () => { if (!appLocked) openModal(p); };
    profilesList.appendChild(btn);
  });
}

function switchProfile(id) {
  activeProfileId = id;
  renderSidebar();
  const p = profiles.find(x => x.id === id);
  if (p) ipcRenderer.send('switch-profile', p);
}

let editingProfile = null;
let tempAvatarPath = null;
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const nameInput = document.getElementById('profile-name-input');
const proxyInput = document.getElementById('profile-proxy-input');
const platformInput = document.getElementById('profile-platform-input');
const avatarPreview = document.getElementById('avatar-preview');
const avatarImg = document.getElementById('avatar-img');
const avatarLetter = document.getElementById('avatar-letter');
const avatarInput = document.getElementById('avatar-input');

function openModal(profileToEdit = null) {
  ipcRenderer.send('set-browserview-visibility', false);
  editingProfile = profileToEdit;
  tempAvatarPath = profileToEdit ? profileToEdit.avatar : null;
  modalTitle.innerText = profileToEdit ? 'Chỉnh sửa tài khoản' : 'Thêm tài khoản';
  nameInput.value = profileToEdit ? profileToEdit.name : '';
  proxyInput.value = profileToEdit && profileToEdit.proxy ? profileToEdit.proxy : '';
  platformInput.value = profileToEdit && profileToEdit.platform ? profileToEdit.platform : 'zalo';
  document.getElementById('modal-delete').style.display = profileToEdit ? 'block' : 'none';
  updateAvatarPreview();
  modalOverlay.style.display = 'flex';
  nameInput.focus();
}

function updateAvatarPreview() {
  if (tempAvatarPath) {
    avatarImg.src = tempAvatarPath.startsWith('http') ? tempAvatarPath : `file://${tempAvatarPath.replace(/\\/g, '/')}`;
    avatarImg.style.display = 'block';
    avatarLetter.style.display = 'none';
  } else {
    avatarImg.style.display = 'none';
    avatarLetter.style.display = 'block';
    avatarLetter.innerText = platformIcon(platformInput.value || 'zalo');
  }
}
nameInput.addEventListener('input', updateAvatarPreview);
platformInput.addEventListener('change', updateAvatarPreview);
avatarPreview.onclick = () => avatarInput.click();
avatarInput.onchange = (e) => { if (e.target.files && e.target.files[0]) { tempAvatarPath = e.target.files[0].path; updateAvatarPreview(); } };

document.getElementById('modal-delete').onclick = () => {
  if (!editingProfile) return;
  if (confirm(`Bạn có chắc chắn muốn XÓA tài khoản [${editingProfile.name}]?`)) {
    if (profiles.length <= 1) return alert('Phải có ít nhất 1 tài khoản!');
    profiles = profiles.filter(x => x.id !== editingProfile.id);
    saveProfiles();
    ipcRenderer.send('delete-profile', editingProfile.id);
    if (activeProfileId === editingProfile.id) switchProfile(profiles[0].id);
    modalOverlay.style.display = 'none';
    renderSidebar();
    ipcRenderer.send('set-browserview-visibility', true);
  }
};
document.getElementById('modal-cancel').onclick = () => { modalOverlay.style.display = 'none'; ipcRenderer.send('set-browserview-visibility', true); };
document.getElementById('modal-save').onclick = () => {
  let name = nameInput.value.trim();
  if (!name) name = `Tài khoản ${profiles.length + 1}`;
  if (editingProfile) {
    editingProfile.name = name;
    editingProfile.avatar = tempAvatarPath;
    editingProfile.platform = platformInput.value;
    editingProfile.proxy = proxyInput.value.trim();
    ipcRenderer.send('update-profile-settings', editingProfile);
  } else {
    const id = Date.now().toString();
    profiles.push({ id, name, avatar: tempAvatarPath, partition: `persist:nick_${id}`, platform: platformInput.value, proxy: proxyInput.value.trim() });
    activeProfileId = id;
  }
  saveProfiles();
  modalOverlay.style.display = 'none';
  renderSidebar();
  ipcRenderer.send('set-browserview-visibility', true);
  if (!editingProfile) switchProfile(activeProfileId);
};
document.getElementById('btn-add-profile').onclick = () => openModal();

function renderDownloads() {
  const list = document.getElementById('downloads-list');
  if (!downloads.length) { list.innerHTML = '<p class="download-meta">Chưa có file tải xuống.</p>'; return; }
  list.innerHTML = '';
  downloads.slice().reverse().forEach((d) => {
    const item = document.createElement('div');
    item.className = 'download-item';
    const pct = d.totalBytes ? Math.round((d.receivedBytes / d.totalBytes) * 100) : (d.status === 'completed' ? 100 : 0);
    item.innerHTML = `<div class="download-name">${escapeHtml(d.filename || 'download')}</div><div class="download-meta">${d.statusText || d.status || ''} ${pct ? `• ${pct}%` : ''}</div><div class="progress"><span style="width:${pct}%"></span></div><div class="row" style="margin-top:10px;"><button class="modal-btn cancel" data-action="folder">Thư mục</button><div><button class="modal-btn cancel" data-action="open">Mở</button><button class="modal-btn cancel" data-action="remove">Xóa</button></div></div>`;
    item.querySelector('[data-action="open"]').onclick = () => ipcRenderer.send('open-download', d.id);
    item.querySelector('[data-action="folder"]').onclick = () => ipcRenderer.send('show-download-in-folder', d.id);
    item.querySelector('[data-action="remove"]').onclick = () => { ipcRenderer.send('remove-download', d.id); downloads = downloads.filter(x => x.id !== d.id); renderDownloads(); };
    list.appendChild(item);
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const downloadsButton = document.getElementById('btn-downloads');
const downloadsCloseButton = document.getElementById('downloads-close');
if (downloadsButton) downloadsButton.onclick = () => { document.getElementById('downloads-overlay').style.display = 'flex'; ipcRenderer.send('get-downloads'); };
if (downloadsCloseButton) downloadsCloseButton.onclick = () => document.getElementById('downloads-overlay').style.display = 'none';
ipcRenderer.on('downloads-list', (_, list) => { downloads = list || []; renderDownloads(); });
ipcRenderer.on('download-updated', (_, item) => { downloads = downloads.filter(d => d.id !== item.id).concat(item); renderDownloads(); });

function renderUpdate() {
  const isMacSigError = updateState.status === 'error' && updateState.message && updateState.message.toLowerCase().includes('code signature');
  
  if (isMacSigError) {
    document.getElementById('update-status').innerHTML = 'Hệ điều hành macOS yêu cầu tải bản cập nhật thủ công do giới hạn bảo mật.<br><a href="#" id="mac-manual-download" style="color:#0a84ff;">Tải xuống bản mới nhất tại đây</a>';
    setTimeout(() => {
      const btn = document.getElementById('mac-manual-download');
      if (btn) btn.onclick = (e) => { e.preventDefault(); require('electron').shell.openExternal('https://github.com/Tio-dev71/Deplao-App/releases/latest'); };
    }, 100);
  } else {
    document.getElementById('update-status').innerText = updateState.message || 'Sẵn sàng kiểm tra cập nhật.';
  }
  
  document.getElementById('update-progress').style.width = `${updateState.progress || 0}%`;
  document.getElementById('update-download').style.display = updateState.status === 'available' ? 'inline-block' : 'none';
  document.getElementById('update-install').style.display = updateState.status === 'downloaded' ? 'inline-block' : 'none';
}

document.getElementById('btn-update').onclick = () => {
  ipcRenderer.send('set-browserview-visibility', false);
  document.getElementById('update-overlay').style.display = 'flex';
  ipcRenderer.send('check-for-updates');
  ipcRenderer.send('get-update-state');
};
document.getElementById('update-close').onclick = () => {
  document.getElementById('update-overlay').style.display = 'none';
  ipcRenderer.send('set-browserview-visibility', true);
};
document.getElementById('update-check').onclick = () => ipcRenderer.send('check-for-updates');
document.getElementById('update-download').onclick = () => ipcRenderer.send('download-update');
document.getElementById('update-install').onclick = () => ipcRenderer.send('install-update');

ipcRenderer.on('update-state', (_, state) => {
  updateState = state;
  renderUpdate();
  // Auto-show overlay when update available/downloaded (e.g. triggered from tray menu)
  if (state.status === 'available' || state.status === 'downloaded') {
    if (document.getElementById('update-overlay').style.display !== 'flex') {
      ipcRenderer.send('set-browserview-visibility', false);
      document.getElementById('update-overlay').style.display = 'flex';
    }
  }
});

let isDarkMode = true;
const toggleDarkMode = () => {
  isDarkMode = !isDarkMode;
  document.body.className = isDarkMode ? 'dark-mode' : 'light-mode';
  document.getElementById('icon-sun').style.display = isDarkMode ? 'none' : 'block';
  document.getElementById('icon-moon').style.display = isDarkMode ? 'block' : 'none';
  ipcRenderer.send('set-theme', isDarkMode);
};
document.getElementById('btn-dark-mode').onclick = toggleDarkMode;
document.getElementById('btn-zoom-in').onclick = () => ipcRenderer.send('zoom-in');
document.getElementById('btn-zoom-out').onclick = () => ipcRenderer.send('zoom-out');
document.getElementById('btn-fs').onclick = () => ipcRenderer.send('toggle-fullscreen');
document.getElementById('btn-pin').onclick = () => { const btn = document.getElementById('btn-pin'); const isPinned = btn.classList.toggle('active'); btn.style.opacity = isPinned ? '1' : '0.65'; ipcRenderer.send('toggle-always-on-top'); };
document.getElementById('btn-reload').onclick = () => ipcRenderer.send('reload-page');
document.getElementById('btn-shield').onclick = () => ipcRenderer.send('toggle-zadark-shield');
document.getElementById('btn-lock').onclick = () => ipcRenderer.send('lock-app');

// Quick Replies Management
let quickReplies = ipcRenderer.sendSync('get-quick-replies') || [];

function renderQuickReplies() {
  const list = document.getElementById('quick-replies-list');
  if (!quickReplies.length) {
    list.innerHTML = '<p class="download-meta" style="text-align:center;padding:20px 0;">Chưa có tin nhắn mẫu nào.<br>Thêm tin nhắn bên dưới để bắt đầu!</p>';
    return;
  }
  list.innerHTML = '';
  quickReplies.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'download-item';
    item.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:12px;';
    item.innerHTML = `<div style="flex-shrink:0;background:linear-gradient(135deg,#0a84ff,#5e5ce6);color:white;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;font-family:monospace;">/${i + 1}</div><div style="flex:1;min-width:0;"><div class="download-name" style="margin-bottom:4px;">${escapeHtml(r.message).substring(0, 100)}${r.message.length > 100 ? '...' : ''}</div><div class="download-meta">${r.message.length} ký tự</div></div><div style="display:flex;gap:6px;flex-shrink:0;"><button class="modal-btn cancel" data-action="edit" style="padding:6px 10px;font-size:12px;">✏️</button><button class="modal-btn cancel" data-action="delete" style="padding:6px 10px;font-size:12px;background:rgba(255,69,58,.2);color:#ff453a;">🗑</button></div>`;
    item.querySelector('[data-action="edit"]').onclick = () => {
      const newMsg = prompt('Sửa tin nhắn mẫu:', r.message);
      if (newMsg !== null && newMsg.trim()) {
        quickReplies[i].message = newMsg.trim();
        ipcRenderer.send('save-quick-replies', quickReplies);
        renderQuickReplies();
      }
    };
    item.querySelector('[data-action="delete"]').onclick = () => {
      if (confirm(`Xóa tin nhắn mẫu /${i + 1}?`)) {
        quickReplies.splice(i, 1);
        ipcRenderer.send('save-quick-replies', quickReplies);
        renderQuickReplies();
      }
    };
    list.appendChild(item);
  });
}

document.getElementById('btn-quick-replies').onclick = () => {
  ipcRenderer.send('set-browserview-visibility', false);
  quickReplies = ipcRenderer.sendSync('get-quick-replies') || [];
  renderQuickReplies();
  document.getElementById('quick-replies-overlay').style.display = 'flex';
};
document.getElementById('quick-replies-close').onclick = () => {
  document.getElementById('quick-replies-overlay').style.display = 'none';
  ipcRenderer.send('set-browserview-visibility', true);
};
document.getElementById('quick-reply-add').onclick = () => {
  const input = document.getElementById('quick-reply-input');
  const msg = input.value.trim();
  if (!msg) return alert('Vui lòng nhập nội dung tin nhắn mẫu!');
  quickReplies.push({ message: msg });
  ipcRenderer.send('save-quick-replies', quickReplies);
  renderQuickReplies();
  input.value = '';
};
document.getElementById('quick-reply-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('quick-reply-add').click();
  }
});

function showLockOverlay(setupMode = false) {
  appLocked = true;
  ipcRenderer.send('set-browserview-visibility', false);
  document.getElementById('lock-overlay').style.display = 'flex';
  document.getElementById('lock-password-confirm').style.display = setupMode ? 'block' : 'none';
  document.getElementById('lock-hint').innerText = setupMode ? 'Tạo mật khẩu khóa ứng dụng.' : 'Nhập mật khẩu để mở khóa.';
  document.getElementById('lock-submit').innerText = setupMode ? 'Tạo khóa' : 'Mở khóa';
  document.getElementById('lock-password').value = '';
  document.getElementById('lock-password-confirm').value = '';
  document.getElementById('lock-password').focus();
}
function hideLockOverlay() { appLocked = false; document.getElementById('lock-overlay').style.display = 'none'; ipcRenderer.send('set-browserview-visibility', true); }
document.getElementById('lock-submit').onclick = () => {
  const password = document.getElementById('lock-password').value;
  const confirmPassword = document.getElementById('lock-password-confirm').value;
  if (!hasLockPassword) {
    if (!password || password !== confirmPassword) return alert('Mật khẩu không khớp.');
    ipcRenderer.send('set-lock-password', password);
  } else {
    ipcRenderer.send('unlock-app', password);
  }
};

document.addEventListener('keydown', (e) => {
  // Ctrl+L (Win/Linux) or Cmd+L (Mac) to lock app
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    ipcRenderer.send('lock-app');
  }
  
  // Escape to cancel lock setup
  if (e.key === 'Escape' && appLocked && !hasLockPassword) {
    e.preventDefault();
    hideLockOverlay();
  }
});

// Enter to submit lock password
document.getElementById('lock-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('lock-submit').click();
});
document.getElementById('lock-password-confirm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('lock-submit').click();
});
ipcRenderer.on('lock-state', (_, state) => {
  hasLockPassword = !!state.hasPassword;
  if (state.zadarkShield !== undefined) document.getElementById('btn-shield').classList.toggle('active', !!state.zadarkShield);
  if (state.locked) showLockOverlay(!hasLockPassword);
});
ipcRenderer.on('unlock-result', (_, result) => { if (result.ok) { hasLockPassword = true; hideLockOverlay(); } else alert(result.message || 'Sai mật khẩu.'); });

ipcRenderer.on('update-profile-badge', (event, { id, count }) => {
  const badge = document.getElementById(`badge-${id}`);
  if (badge) { badge.innerText = count > 9 ? '9+' : count; badge.style.display = count > 0 ? 'block' : 'none'; }
});
ipcRenderer.on('update-profile-avatar', (event, { id, avatarUrl }) => {
  const p = profiles.find(x => x.id === id);
  if (p) {
    const isAutoAvatar = !p.avatar || p.avatar.includes('graph.facebook.com') || p.avatar.includes('scontent') || p.avatar.includes('fbcdn');
    if (isAutoAvatar && p.avatar !== avatarUrl) { p.avatar = avatarUrl; saveProfiles(); renderSidebar(); }
  }
});
ipcRenderer.on('update-profile-info', (event, { id, name, avatarUrl }) => {
  const p = profiles.find(x => x.id === id);
  if (p) {
    let changed = false;
    if (name && p.name.startsWith('Tài khoản ')) { p.name = name; changed = true; }
    if (avatarUrl && !p.avatar) { p.avatar = avatarUrl; changed = true; }
    if (changed) { saveProfiles(); renderSidebar(); }
  }
});

const settings = ipcRenderer.sendSync('get-settings');
isDarkMode = settings.isDarkMode;
hasLockPassword = !!settings.hasLockPassword;
document.body.className = isDarkMode ? 'dark-mode' : 'light-mode';
document.getElementById('icon-sun').style.display = isDarkMode ? 'none' : 'block';
document.getElementById('icon-moon').style.display = isDarkMode ? 'block' : 'none';
if (settings.alwaysOnTop) document.getElementById('btn-pin').classList.add('active');
document.getElementById('btn-shield').classList.toggle('active', !!settings.zadarkShield);
renderSidebar();
switchProfile(activeProfileId);
ipcRenderer.send('renderer-ready');
if (settings.lockOnStartup) showLockOverlay(!hasLockPassword);

// ==========================================
// LICENSE & AUTHENTICATION (9Meta API)
// ==========================================
const API_BASE_URL = localStorage.getItem('API_URL') || 'https://api.tiodev.io.vn/v1';
let accessToken = localStorage.getItem('access_token') || null;

const authOverlay = document.getElementById('auth-overlay');
const expiredOverlay = document.getElementById('expired-overlay');
const authSubmit = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');

function showAuth() {
  ipcRenderer.send('set-browserview-visibility', false);
  authOverlay.style.display = 'flex';
  expiredOverlay.style.display = 'none';
}

function showExpired(message, upgradeUrl) {
  ipcRenderer.send('set-browserview-visibility', false);
  expiredOverlay.style.display = 'flex';
  authOverlay.style.display = 'none';
  if (message) document.getElementById('expired-message').innerText = message;
  if (upgradeUrl) {
    const btn = document.getElementById('expired-upgrade');
    btn.onclick = () => require('electron').shell.openExternal(upgradeUrl);
  }
}

function unlockAppFromAuth() {
  authOverlay.style.display = 'none';
  expiredOverlay.style.display = 'none';
  ipcRenderer.send('set-browserview-visibility', true);
  if (activeProfileId) switchProfile(activeProfileId);
}

document.getElementById('auth-email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') authSubmit.click();
});
document.getElementById('auth-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') authSubmit.click();
});

authSubmit.onclick = async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) {
    authError.innerText = 'Vui lòng nhập đầy đủ thông tin.';
    authError.style.display = 'block';
    return;
  }
  
  authSubmit.innerText = 'Đang đăng nhập...';
  authSubmit.disabled = true;
  authError.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, appVersion: require('./package.json').version, os: process.platform })
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.message || 'Đăng nhập thất bại');
    
    accessToken = data.accessToken;
    localStorage.setItem('access_token', accessToken);
    checkSubscription();
  } catch (err) {
    authError.innerText = err.message;
    authError.style.display = 'block';
  } finally {
    authSubmit.innerText = 'Đăng nhập';
    authSubmit.disabled = false;
  }
};

document.getElementById('expired-logout').onclick = () => {
  localStorage.removeItem('access_token');
  accessToken = null;
  expiredOverlay.style.display = 'none';
  showAuth();
};

async function checkSubscription() {
  if (!accessToken) return showAuth();
  
  try {
    const res = await fetch(`${API_BASE_URL}/me/subscription`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('access_token');
      accessToken = null;
      return showAuth();
    }
    
    const data = await res.json();
    
    if (data.isActive === false) {
      showExpired(
        'Gói đăng ký của bạn đã hết hạn. Vui lòng thanh toán gia hạn để tiếp tục sử dụng.', 
        data.upgradeUrl || 'https://tiodev.io.vn/pricing'
      );
    } else {
      // Đang active, mở khóa app
      unlockAppFromAuth();
    }
  } catch (err) {
    console.error('Lỗi kiểm tra bản quyền:', err);
    // Nếu lỗi mạng, có thể du di cho dùng offline tạm, hoặc chặn cứng. Ở đây tạm cho qua nếu lỗi mạng để khỏi phiền người dùng.
    unlockAppFromAuth(); 
  }
}

// Khởi chạy kiểm tra ngay khi mở app
if (!settings.lockOnStartup) {
  checkSubscription();
}
// Kiểm tra định kỳ 15 phút một lần
setInterval(() => {
  if (accessToken && !appLocked) checkSubscription();
}, 15 * 60 * 1000);
