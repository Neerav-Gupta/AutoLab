// App bootstrap — layout, resizing, keybindings, polling

function _updateMobileBadge() {
  if (typeof Mobile !== 'undefined' && Mobile.isMobile) {
    const running = State.allTasks.filter(t => t.status === 'running').length;
    Mobile.updateTaskBadge(running);
    if (Mobile._activeView === 'tasks') Mobile._renderMobileTasks?.();
  }
}

async function updateStatus() {
  try {
    const d = await API.status();
    const running = State.allTasks.filter(t => t.status === 'running').length;
    setStatusItem('status-host', d.ssh_host, 'statusbar-item');
    setStatusItem('status-model', d.model, 'statusbar-item');
    setStatusItem('status-run', running > 0 ? `⟳ ${running} running` : '', running > 0 ? 'statusbar-item accent' : 'statusbar-item');
    document.getElementById('status-dot').className = 'status-dot connected';
  } catch {
    document.getElementById('status-dot').className = 'status-dot disconnected';
    setStatusItem('status-host', 'disconnected', 'statusbar-item red');
  }
}

function setSidebarView(view) {
  State.sidebarView = view;
  document.querySelectorAll('.activity-btn').forEach(el =>
    el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll('.sidebar-panel').forEach(el =>
    el.classList.toggle('hidden', el.dataset.panel !== view));
  if (view === 'tasks')       renderTasksPanel();
  if (view === 'experiments') { loadExperiments(); }
  if (view === 'checkpoints') { loadCheckpoints(); }
  if (view === 'search') setTimeout(() => document.querySelector('.sidebar-search-input')?.focus(), 50);
}

function toggleChat() {
  State.chatVisible = !State.chatVisible;
  document.getElementById('chat-sidebar').classList.toggle('collapsed', !State.chatVisible);
  document.getElementById('chat-resize').style.display = State.chatVisible ? 'block' : 'none';
}

let _panelVisible = true;
function togglePanel() {
  _panelVisible = !_panelVisible;
  const panel = document.getElementById('panel');
  panel.style.height = _panelVisible ? '' : '0';
  panel.style.minHeight = _panelVisible ? '' : '0';
  if (_panelVisible) setTimeout(() => TermManager.fitAll(), 50);
}

function switchPanelTab(name) {
  document.querySelectorAll('.panel-tab[data-panel]').forEach(el =>
    el.classList.toggle('active', el.dataset.panel === name));
  const tw = document.getElementById('terminals-wrapper');
  const ob = document.getElementById('output-wrapper');
  const pb = document.getElementById('problems-wrapper');
  if (tw) tw.style.display = name === 'terminal'  ? 'flex' : 'none';
  if (ob) ob.style.display = name === 'output'    ? 'flex' : 'none';
  if (pb) pb.style.display = name === 'problems'  ? 'flex' : 'none';
  if (name === 'terminal') setTimeout(() => TermManager.fitAll(), 30);
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function openThemeMenu() {
  const current = localStorage.getItem('autolab-theme') || 'dark';
  const overlay = document.createElement('div');
  overlay.id = 'theme-modal';
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" style="max-width:360px">
      <h2>Appearance</h2>
      <label class="modal-label">Color theme</label>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
        ${[
          ['dark',      'Dark (default)',  '#0a0a0a', '#f5c518'],
          ['dark-plus', 'Dark+',           '#1e1e1e', '#007acc'],
          ['monokai',   'Monokai',         '#272822', '#a6e22e'],
        ].map(([val, label, bg, accent]) => `
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px;border-radius:4px;border:2px solid ${val===current?'var(--accent)':'var(--border2)'};transition:border-color 0.1s" id="theme-opt-${val}">
            <input type="radio" name="theme" value="${val}" ${val===current?'checked':''} style="display:none" onchange="applyTheme('${val}');document.querySelectorAll('[id^=theme-opt-]').forEach(el=>el.style.borderColor='var(--border2)');this.closest('label').style.borderColor='var(--accent)'"/>
            <div style="width:32px;height:32px;border-radius:4px;background:${bg};border:1px solid #333;flex-shrink:0;display:flex;align-items:center;justify-content:center">
              <div style="width:12px;height:12px;border-radius:50%;background:${accent}"></div>
            </div>
            <span style="font-size:13px">${label}</span>
          </label>`).join('')}
      </div>
      <div style="text-align:right">
        <button class="btn btn-primary" onclick="document.getElementById('theme-modal').remove()">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); });
}

function applyTheme(theme) {
  const root = document.documentElement;
  // Remove old theme attribute
  root.removeAttribute('data-theme');
  if (theme !== 'dark') root.setAttribute('data-theme', theme);
  localStorage.setItem('autolab-theme', theme);
  // Update terminal colors to match theme
  TermManager.updateTheme(theme);
}

// ── Resize handles ────────────────────────────────────────────────────────────

function initResize() {
  // Panel height
  const ph = document.getElementById('panel-resize');
  const panel = document.getElementById('panel');
  if (ph) {
    let sy, sh;
    ph.addEventListener('mousedown', e => {
      sy = e.clientY; sh = panel.offsetHeight;
      ph.classList.add('dragging');
      const mv = e => {
        const h = Math.min(Math.max(sh + (sy - e.clientY), 80), window.innerHeight * 0.75);
        panel.style.height = h + 'px';
        TermManager.fitAll();
      };
      const up = () => { ph.classList.remove('dragging'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }

  // Sidebar width
  const sv = document.getElementById('sidebar-resize');
  const sb = document.getElementById('sidebar');
  if (sv) {
    let sx, sw;
    sv.addEventListener('mousedown', e => {
      sx = e.clientX; sw = sb.offsetWidth;
      sv.classList.add('dragging');
      const mv = e => { sb.style.width = Math.min(Math.max(sw + (e.clientX - sx), 120), 600) + 'px'; };
      const up = () => { sv.classList.remove('dragging'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }

  // Chat width
  const cv = document.getElementById('chat-resize');
  const chat = document.getElementById('chat-sidebar');
  if (cv) {
    let cx, cw;
    cv.addEventListener('mousedown', e => {
      cx = e.clientX; cw = chat.offsetWidth;
      cv.classList.add('dragging');
      const mv = e => { chat.style.width = Math.min(Math.max(cw - (e.clientX - cx), 220), 600) + 'px'; };
      const up = () => { cv.classList.remove('dragging'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }
}

// ── Keybindings ───────────────────────────────────────────────────────────────

function initKeybindings() {
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape')                        { hideCtxMenu(); }
    if (mod && e.key === '`')                      { e.preventDefault(); togglePanel(); if (_panelVisible) TermManager.focus(); }
    if (e.key === 'F5')                            { e.preventDefault(); Editor.runCurrentFile(); }
    if (mod && e.shiftKey && e.key === 'P')        { e.preventDefault(); openNewTaskModal(); }
    if (mod && e.shiftKey && e.key === 'F')        { e.preventDefault(); setSidebarView('search'); }
    if (mod && e.shiftKey && e.key === 'E')        { e.preventDefault(); setSidebarView('explorer'); }
  });
  document.addEventListener('click', hideCtxMenu);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  // Apply saved theme
  const savedTheme = localStorage.getItem('autolab-theme') || 'dark';
  if (savedTheme !== 'dark') document.documentElement.setAttribute('data-theme', savedTheme);

  document.getElementById('app').style.display = 'flex';

  initResize();
  initKeybindings();
  initTermResizeObserver();

  TermManager.init();
  Mobile.detect();
  GpuMonitor.start();
  _initWorkspace();

  await Promise.all([
    Editor.init(),
    loadTasks(),
    updateStatus(),
  ]);

  await reconnectRunningStreams();

  setInterval(loadTasks, 8000);
  setInterval(() => { if (State.sidebarView==='experiments') loadExperiments(); }, 30000);
  setInterval(() => { if (State.sidebarView==='checkpoints') loadCheckpoints(); }, 30000);
  setInterval(updateStatus, 20000);
}

window.setSidebarView = setSidebarView;
window.toggleChat = toggleChat;
window.togglePanel = togglePanel;
window.switchPanelTab = switchPanelTab;
window.openThemeMenu = openThemeMenu;
window.applyTheme = applyTheme;

document.addEventListener('DOMContentLoaded', init);