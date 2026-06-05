// Terminal — xterm.js over WebSocket SSH PTY, multi-instance

let _terms = [];
let _activeId = null;
let _counter = 0;

const TERM_THEMES = {
  dark: {
    background:    '#0a0a0a',
    foreground:    '#e8e8e8',
    cursor:        '#f5c518',
    cursorAccent:  '#000000',
    selectionBackground: 'rgba(245,197,24,0.2)',
    black:         '#1a1a1a',   brightBlack:   '#555555',
    red:           '#f14c4c',   brightRed:     '#ff6b6b',
    green:         '#4ec994',   brightGreen:   '#73e8b0',
    yellow:        '#e8a24a',   brightYellow:  '#f5c518',
    blue:          '#4d9de0',   brightBlue:    '#79bbff',
    magenta:       '#b48ead',   brightMagenta: '#d0a8c8',
    cyan:          '#5bbccc',   brightCyan:    '#7ed6e8',
    white:         '#d0d0d0',   brightWhite:   '#ffffff',
  },
  'dark-plus': {
    background:    '#1e1e1e',
    foreground:    '#d4d4d4',
    cursor:        '#007acc',
    cursorAccent:  '#ffffff',
    selectionBackground: 'rgba(0,122,204,0.25)',
    black:         '#000000',   brightBlack:   '#666666',
    red:           '#cd3131',   brightRed:     '#f14c4c',
    green:         '#0dbc79',   brightGreen:   '#23d18b',
    yellow:        '#e5e510',   brightYellow:  '#f5f543',
    blue:          '#2472c8',   brightBlue:    '#3b8eea',
    magenta:       '#bc3fbc',   brightMagenta: '#d670d6',
    cyan:          '#11a8cd',   brightCyan:    '#29b8db',
    white:         '#e5e5e5',   brightWhite:   '#ffffff',
  },
  monokai: {
    background:    '#272822',
    foreground:    '#f8f8f2',
    cursor:        '#a6e22e',
    cursorAccent:  '#272822',
    selectionBackground: 'rgba(166,226,46,0.2)',
    black:         '#272822',   brightBlack:   '#75715e',
    red:           '#f92672',   brightRed:     '#f92672',
    green:         '#a6e22e',   brightGreen:   '#a6e22e',
    yellow:        '#f4bf75',   brightYellow:  '#f4bf75',
    blue:          '#66d9ef',   brightBlue:    '#66d9ef',
    magenta:       '#ae81ff',   brightMagenta: '#ae81ff',
    cyan:          '#a1efe4',   brightCyan:    '#a1efe4',
    white:         '#f8f8f2',   brightWhite:   '#f9f8f5',
  },
};

function getCurrentTermTheme() {
  const saved = localStorage.getItem('autolab-theme') || 'dark';
  return TERM_THEMES[saved] || TERM_THEMES.dark;
}

const TermManager = {
  init() { this.create(); },

  create() {
    _counter++;
    const id = _counter;

    const term = new window.Terminal({
      allowProposedApi: true,
      theme: getCurrentTermTheme(),
      fontFamily: "'Cascadia Code','Consolas','JetBrains Mono','Fira Code','Courier New',monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: false,
      macOptionIsMeta: true,
    });

    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    // Container — inside the terminals-wrapper
    const wrapper = document.getElementById('terminals-wrapper');
    const container = document.createElement('div');
    container.id = `term-${id}`;
    container.className = 'term-instance';
    container.style.cssText = 'display:none;flex:1;overflow:hidden;';
    wrapper.appendChild(container);
    term.open(container);

    // Tab button (before the action buttons)
    const actions = document.querySelector('.panel-tab-actions');
    const tabEl = document.createElement('div');
    tabEl.className = 'panel-tab';
    tabEl.dataset.termId = id;
    tabEl.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
        <polyline points="2,5 7,8 2,11"/><line x1="9" y1="11" x2="13" y2="11"/>
      </svg>
      bash ${id > 1 ? id : ''}
      <span class="panel-tab-close" onclick="TermManager.close(${id},event)">×</span>`;
    tabEl.onclick = e => { if (!e.target.classList.contains('panel-tab-close')) TermManager.activate(id); };
    actions.parentNode.insertBefore(tabEl, actions);

    const inst = { id, term, ws: null, fitAddon, tabEl, container };
    _terms.push(inst);

    this.activate(id);
    this.connect(id);

    term.onData(data => {
      if (inst.ws && inst.ws.readyState === WebSocket.OPEN) inst.ws.send(data);
    });
    term.onResize(({ cols, rows }) => {
      if (inst.ws && inst.ws.readyState === WebSocket.OPEN)
        inst.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    return id;
  },

  connect(id) {
    const inst = _terms.find(t => t.id === id);
    if (!inst) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/terminal`;
    if (inst.ws) { try { inst.ws.close(); } catch {} }

    inst.ws = new WebSocket(url);

    inst.ws.onopen = () => {
      inst.term.write('\x1b[32mConnected\x1b[0m\r\n');
      setTimeout(() => {
        try {
          inst.fitAddon.fit();
          inst.ws.send(JSON.stringify({ type: 'resize', cols: inst.term.cols, rows: inst.term.rows }));
        } catch {}
      }, 150);
    };

    inst.ws.onmessage = e => { inst.term.write(e.data); };

    inst.ws.onclose = () => {
      inst.term.write('\r\n\x1b[33mDisconnected — reconnecting in 3s…\x1b[0m\r\n');
      setTimeout(() => { if (_terms.find(t => t.id === id)) TermManager.connect(id); }, 3000);
    };

    inst.ws.onerror = () => {
      inst.term.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
    };
  },

  activate(id) {
    _activeId = id;
    _terms.forEach(inst => {
      const active = inst.id === id;
      inst.container.style.display = active ? 'flex' : 'none';
      inst.tabEl.classList.toggle('active', active);
      if (active) {
        try { inst.fitAddon.fit(); } catch {}
        inst.term.focus();
      }
    });
    // Make sure terminal panel tab is active
    switchPanelTab('terminal');
  },

  close(id, e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (_terms.length <= 1) return;
    const inst = _terms.find(t => t.id === id);
    if (!inst) return;
    try { inst.ws?.close(); } catch {}
    inst.term.dispose();
    inst.container.remove();
    inst.tabEl.remove();
    _terms = _terms.filter(t => t.id !== id);
    if (_activeId === id && _terms.length) this.activate(_terms[_terms.length - 1].id);
  },

  clear() {
    const inst = _terms.find(t => t.id === _activeId);
    if (inst) inst.term.clear();
  },

  reconnect() {
    if (_activeId) this.connect(_activeId);
  },

  send(text) {
    // Ensure terminal panel is visible and active
    if (!_panelVisible) togglePanel();
    const inst = _terms.find(t => t.id === _activeId);
    if (inst?.ws?.readyState === WebSocket.OPEN) {
      switchPanelTab('terminal');
      inst.ws.send(text);
      this.focus();
    } else {
      toast('Terminal not connected', 'err');
    }
  },

  focus() {
    const inst = _terms.find(t => t.id === _activeId);
    inst?.term.focus();
  },

  fitAll() {
    _terms.forEach(inst => {
      try { inst.fitAddon.fit(); } catch {}
    });
  },

  updateTheme(themeName) {
    const theme = TERM_THEMES[themeName] || TERM_THEMES.dark;
    _terms.forEach(inst => {
      try { inst.term.options.theme = theme; } catch {}
    });
  },
};

function initTermResizeObserver() {
  const el = document.getElementById('terminals-wrapper');
  if (el) new ResizeObserver(() => TermManager.fitAll()).observe(el);
}

// _panelVisible needs to be visible to TermManager.send
window._panelVisible = true;

window.TermManager = TermManager;
window.initTermResizeObserver = initTermResizeObserver;