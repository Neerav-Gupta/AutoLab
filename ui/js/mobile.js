// Mobile — self-contained view for screens ≤768px
// Each view is built fresh. Terminal gets its own WebSocket+xterm.
// Chat uses API directly and shares State.chatHistory with desktop.

const Mobile = {
  isMobile:  false,
  _view:     'status',
  _term:     null,   // { xterm, ws, fitAddon }

  detect() {
    const check = () => window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    this.isMobile = check();
    if (this.isMobile) this._on();
    window.addEventListener('resize', () => {
      const now = check();
      if (now && !this.isMobile) { this.isMobile = true;  this._on(); }
      if (!now && this.isMobile)  { this.isMobile = false; this._off(); }
    });
  },

  _on() {
    document.documentElement.setAttribute('data-mobile', '1');
    this._scaffold();
    this.go('status');
  },

  _off() {
    this._killTerm();
    document.documentElement.removeAttribute('data-mobile');
    document.getElementById('m-shell')?.remove();
    document.getElementById('m-nav')?.remove();
  },

  _scaffold() {
    if (document.getElementById('m-shell')) return;

    const shell = document.createElement('div');
    shell.id = 'm-shell';
    // Inline styles as backup — CSS may not win due to specificity on some mobile browsers
    // Use window.innerHeight instead of 100vh/dvh — on Chrome and Safari mobile,
    // 100vh includes the browser UI chrome (address bar, toolbar) making content
    // get clipped. window.innerHeight is always the actual visible pixel height.
    const _setShellHeight = () => {
      const navH = 56;
      const h = window.innerHeight - navH;
      shell.style.height = h + 'px';
    };
    shell.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;flex-direction:column;background:var(--bg);z-index:10;overflow:hidden;';
    _setShellHeight();
    // Re-measure when browser chrome appears/disappears (scroll, orientation change)
    window.addEventListener('resize', _setShellHeight);
    window.addEventListener('orientationchange', () => setTimeout(_setShellHeight, 300));
    shell.innerHTML = `
      <div id="m-topbar" style="height:48px;min-height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--bg-titlebar);border-bottom:1px solid var(--border);">
        <span id="m-title" style="font-size:15px;font-weight:600;color:var(--fg);">AutoLab</span>
        <div id="m-action" style="display:flex;align-items:center;gap:8px;"></div>
      </div>
      <div id="m-body" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;"></div>`;
    document.body.appendChild(shell);

    const nav = document.createElement('nav');
    nav.id = 'm-nav';
    nav.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:56px;display:flex;background:var(--bg-sidebar);border-top:1px solid var(--border);z-index:20;';
    nav.innerHTML = `
      <button data-v="status"   onclick="Mobile.go('status')">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M3.5 3.5l1.5 1.5M15 15l1.5 1.5M3.5 16.5l1.5-1.5M15 5l1.5-1.5"/></svg>
        Status
      </button>
      <button data-v="tasks"    onclick="Mobile.go('tasks')">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="14" height="16" rx="1.5"/><line x1="7" y1="7" x2="13" y2="7"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="7" y1="13" x2="10" y2="13"/></svg>
        Tasks
        <em id="m-badge"></em>
      </button>
      <button data-v="chat"     onclick="Mobile.go('chat')">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h16a1 1 0 011 1v9a1 1 0 01-1 1H6l-4 3V4a1 1 0 011-1z"/></svg>
        Chat
      </button>
      <button data-v="terminal" onclick="Mobile.go('terminal')">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,6 9,10 3,14"/><line x1="11" y1="14" x2="17" y2="14"/></svg>
        Terminal
      </button>`;
    document.body.appendChild(nav);
  },

  go(view) {
    if (!this.isMobile) return;
    this._view = view;

    // Kill terminal when leaving terminal tab
    if (view !== 'terminal') this._killTerm();

    // Nav highlight
    document.querySelectorAll('#m-nav button').forEach(b =>
      b.classList.toggle('active', b.dataset.v === view));

    // Header
    const titles = { status:'AutoLab', tasks:'Tasks', chat:'AI Assistant', terminal:'Terminal' };
    const el = document.getElementById('m-title');
    if (el) el.textContent = titles[view] || 'AutoLab';
    const act = document.getElementById('m-action');
    if (act) act.innerHTML = '';

    const body = document.getElementById('m-body');
    if (!body) return;
    body.innerHTML = '';

    if (view === 'status')   this._status(body, act);
    if (view === 'tasks')    this._tasks(body, act);
    if (view === 'chat')     this._chat(body);
    if (view === 'terminal') this._terminal(body, act);
  },

  // ── Status ────────────────────────────────────────────────────────────────────

  async _status(body, act) {
    body.innerHTML = '<p style="padding:16px;color:var(--fg-dim)">Loading…</p>';
    try {
      const [s, g] = await Promise.all([API.status(), API.gpu().catch(() => ({available:false,gpus:[]}))]);
      const run = State.allTasks.filter(t => t.status === 'running').length;
      const rows = [
        ['SSH',     s.ssh_host||'not set',                   s.ssh_host ? 'var(--green)' : 'var(--red)'],
        ['Model',   (s.model||'').split('/').pop(),           'var(--accent)'],
        ['Running', String(run),                              run > 0 ? 'var(--orange)' : 'var(--fg-muted)'],
        ...(g.available && g.gpus?.length ? [
          ['GPU',       g.gpus[0].name,                      'var(--fg-muted)'],
          ['GPU util',  g.gpus[0].util+'%',                  g.gpus[0].util>50?'var(--green)':'var(--fg-muted)'],
          ['VRAM',      g.gpus[0].mem_used+'/'+g.gpus[0].mem_total+' MB', 'var(--fg-muted)'],
        ] : [['GPU', 'Not available', 'var(--fg-dim)']]),
      ];
      body.innerHTML = `
        <div class="m-grid">${rows.map(([k,v,c])=>`
          <div class="m-card">
            <div class="m-card-label">${k}</div>
            <div class="m-card-value" style="color:${c}">${esc(String(v))}</div>
          </div>`).join('')}
        </div>
        <div style="padding:0 12px 12px">
          <button class="btn btn-primary" style="width:100%;padding:11px;font-size:14px" onclick="openNewTaskModal()">+ New Task</button>
          ${run?`<button class="btn btn-ghost" style="width:100%;padding:11px;margin-top:8px" onclick="Mobile.go('tasks')">View ${run} running task${run>1?'s':''}</button>`:''}
        </div>`;
    } catch(e) {
      body.innerHTML = `<p style="padding:16px;color:var(--red)">Error: ${esc(e.message)}</p>`;
    }
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────────

  _tasks(body, act) {
    if (act) act.innerHTML = `<button class="btn btn-primary" style="padding:5px 12px;font-size:12px" onclick="openNewTaskModal()">+ New</button>`;
    if (!State.allTasks.length) {
      body.innerHTML = `<p style="padding:20px;text-align:center;color:var(--fg-dim)">No tasks yet.</p>`;
      return;
    }
    const run  = State.allTasks.filter(t => t.status === 'running');
    const done = State.allTasks.filter(t => t.status !== 'running');
    let h = '<div style="padding:8px;overflow-y:auto;height:100%;box-sizing:border-box">';
    if (run.length)  h += `<div class="task-section-label">Running</div>` + run.map(Mobile._tcard).join('');
    if (done.length) h += `<div class="task-section-label">Completed</div>` + done.slice(0,20).map(Mobile._tcard).join('');
    h += '</div>';
    body.innerHTML = h;
  },

  _tcard: t => `<div style="background:var(--bg-input);border:1px solid var(--border2);border-radius:4px;padding:10px;margin-bottom:6px">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
      <span class="task-badge ${t.status}" style="font-size:10px">${t.status}</span>
      <span style="font-size:10px;color:var(--fg-dim)">#${t.task_id} · ${formatRelTime(t.updated_at)}</span>
    </div>
    <div style="font-size:13px;color:var(--fg);line-height:1.4">${esc(t.task.slice(0,120))}${t.task.length>120?'…':''}</div>
    <div style="font-size:11px;color:var(--fg-dim);margin-top:3px">${t.iterations} step${t.iterations!==1?'s':''}</div>
  </div>`,

  // ── Chat ──────────────────────────────────────────────────────────────────────

  _chat(body) {
    // Set styles directly on body so layout works regardless of CSS specificity issues
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%;';
    body.innerHTML = `
      <div id="mc-msgs" style="flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:10px;"></div>
      <div id="mc-foot" style="flex-shrink:0;padding:8px 10px 12px;border-top:1px solid var(--border);background:var(--bg-sidebar);">
        <textarea id="mc-input"
          placeholder="Ask anything…&#10;Shift+Enter for newline"
          onkeydown="Mobile._ck(event)"
          style="width:100%;min-height:52px;max-height:120px;background:var(--bg-input);color:var(--fg);border:1px solid var(--border2);border-radius:4px;padding:8px 10px;font-size:14px;font-family:var(--font-ui);resize:none;outline:none;line-height:1.4;box-sizing:border-box;display:block;"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:6px;">
          <button id="mc-send" class="chat-send" onclick="Mobile._send()">Send</button>
        </div>
      </div>`;

    // Replay history
    const msgs = document.getElementById('mc-msgs');
    State.chatHistory.filter(m => m.role !== 'system').slice(-30).forEach(m => {
      this._addMsg(m.role, m.role === 'user' ? m.content.split('\n')[0].slice(0,200) : m.content, msgs);
    });
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  },

  _addMsg(role, content, container) {
    if (!container) container = document.getElementById('mc-msgs');
    if (!container) return;
    const d = document.createElement('div');
    d.className = `chat-msg ${role}`;
    if (role === 'user') {
      d.textContent = content;
    } else {
      d.innerHTML = content
        .replace(/```[\w]*\n?([\s\S]+?)```/g, (_,c) =>
          `<pre style="background:var(--bg-editor);border:1px solid var(--border2);border-radius:3px;padding:8px;font:12px/1.5 var(--font-mono);overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:4px 0">${esc(c.trimEnd())}</pre>`)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\n/g, '<br>');
    }
    container.appendChild(d);
    container.scrollTop = container.scrollHeight;
  },

  _ck(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
  },

  async _send() {
    const input = document.getElementById('mc-input');
    const btn   = document.getElementById('mc-send');
    const msgs  = document.getElementById('mc-msgs');
    if (!input || !msgs) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    this._addMsg('user', msg, msgs);
    State.chatHistory.push({ role:'user', content:msg });
    const t = document.createElement('div');
    t.className = 'typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(t);
    msgs.scrollTop = msgs.scrollHeight;
    if (btn) btn.disabled = true;
    try {
      const d = await API.chat(msg, State.chatHistory.slice(0,-1));
      t.remove();
      const r = d.reply || 'No response';
      State.chatHistory.push({ role:'assistant', content:r });
      this._addMsg('assistant', r, msgs);
    } catch(e) {
      t.remove();
      this._addMsg('assistant', 'Error: ' + e.message, msgs);
    }
    if (btn) btn.disabled = false;
  },

  // ── Terminal ──────────────────────────────────────────────────────────────────

  _terminal(body, act) {
    if (act) act.innerHTML = `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="Mobile._trecon()">Reconnect</button>`;

    // Body must be flex to pass height down
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%;';

    const wrap = document.createElement('div');
    wrap.id = 'mc-term';
    // Explicit inline styles — must fill body completely so xterm measures correctly
    wrap.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;height:100%;';
    body.appendChild(wrap);

    // Double rAF ensures wrap is painted with real pixel dimensions before xterm opens
    requestAnimationFrame(() => requestAnimationFrame(() => this._openTerm(wrap)));
  },

  _openTerm(wrap) {
    if (this._term) return; // already open

    const term = new window.Terminal({
      theme: {
        background:'#0a0a0a', foreground:'#e8e8e8', cursor:'#f5c518',
        black:'#1a1a1a', brightBlack:'#555555', red:'#f14c4c', brightRed:'#ff6b6b',
        green:'#4ec994', brightGreen:'#73e8b0', yellow:'#e8a24a', brightYellow:'#f5c518',
        blue:'#4d9de0', brightBlue:'#79bbff', magenta:'#b48ead', brightMagenta:'#d0a8c8',
        cyan:'#5bbccc', brightCyan:'#7ed6e8', white:'#d0d0d0', brightWhite:'#ffffff',
      },
      fontFamily:"'Cascadia Code','Consolas','Courier New',monospace",
      fontSize:13, lineHeight:1.4, cursorBlink:true, scrollback:5000,
      allowProposedApi:true, macOptionIsMeta:true,
    });

    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(wrap);
    setTimeout(() => { try { fit.fit(); } catch {} }, 60);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal`);
    this._term = { term, fit, ws };

    ws.onopen = () => {
      term.write('\x1b[32mConnected\x1b[0m\r\n');
      setTimeout(() => {
        try { fit.fit(); ws.send(JSON.stringify({type:'resize', cols:term.cols, rows:term.rows})); } catch {}
      }, 80);
    };
    ws.onmessage = e => term.write(e.data);
    ws.onclose   = ()  => term.write('\r\n\x1b[33mDisconnected\x1b[0m\r\n');
    ws.onerror   = ()  => term.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
    term.onData(d => { if (ws.readyState===1) ws.send(d); });
    term.onResize(({cols,rows}) => { if (ws.readyState===1) ws.send(JSON.stringify({type:'resize',cols,rows})); });

    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => { try { fit.fit(); } catch {} }).observe(wrap);
  },

  _killTerm() {
    if (!this._term) return;
    try { this._term.ws.close(); } catch {}
    try { this._term.term.dispose(); } catch {}
    document.getElementById('mc-term')?.remove();
    this._term = null;
  },

  _trecon() {
    if (!this._term) return;
    try { this._term.ws.close(); } catch {}
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal`);
    this._term.ws = ws;
    const { term, fit } = this._term;
    ws.onopen = () => { term.write('\x1b[32mReconnected\x1b[0m\r\n'); try { fit.fit(); ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows})); } catch {} };
    ws.onmessage = e => term.write(e.data);
    ws.onclose   = () => term.write('\r\n\x1b[33mDisconnected\x1b[0m\r\n');
    ws.onerror   = () => term.write('\r\n\x1b[31mError\x1b[0m\r\n');
    term.onData(d => { if (ws.readyState===1) ws.send(d); });
  },

  updateTaskBadge(count) {
    const b = document.getElementById('m-badge');
    if (!b) return;
    b.textContent = count || '';
    b.style.display = count ? 'inline-flex' : 'none';
  },
};

window.Mobile = Mobile;