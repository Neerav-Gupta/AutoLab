// Task management

async function loadTasks() {
  try {
    const fresh = await API.tasks();
    State.allTasks = fresh;
    updateTaskBadge();
    if (State.sidebarView === 'tasks') _patchTasksPanel();
  } catch {}
}

function updateTaskBadge() {
  const running = State.allTasks.filter(t => t.status === 'running').length;
  const badge = document.getElementById('tasks-badge');
  if (badge) { badge.textContent = running || ''; badge.style.display = running ? 'flex' : 'none'; }
}

// ── Render (full rebuild, called once or when list changes) ────────────────────

function renderTasksPanel() {
  const el = document.getElementById('tasks-view');
  if (!el) return;

  const running   = State.allTasks.filter(t => t.status === 'running');
  const completed = State.allTasks.filter(t => t.status !== 'running');

  if (!State.allTasks.length) {
    el.innerHTML = `<div style="color:var(--fg-dim);font-size:12px;padding:16px;text-align:center;line-height:1.8">
      No tasks yet.<br>
      <button class="btn btn-primary" style="margin-top:10px" onclick="openNewTaskModal()">+ New Task</button>
    </div>`;
    return;
  }

  let html = '';
  if (running.length)   html += `<div class="task-section-label">Running (${running.length})</div>` + running.map(renderTaskCard).join('');
  if (completed.length) html += `<div class="task-section-label" style="margin-top:${running.length?'10px':'0'}">Completed (${completed.length})</div>` + completed.map(renderTaskCard).join('');
  el.innerHTML = html;
}

// ── Patch (surgical update — never touches open detail panels) ─────────────────

function _patchTasksPanel() {
  const el = document.getElementById('tasks-view');
  if (!el) return;

  const renderedIds = new Set([...el.querySelectorAll('.task-card')].map(c => c.id.replace('task-card-','')));
  const currentIds  = new Set(State.allTasks.map(t => t.task_id));

  // New task appeared or a task disappeared — full rebuild
  const changed = State.allTasks.some(t => !renderedIds.has(t.task_id)) ||
                  [...renderedIds].some(id => !currentIds.has(id));
  if (changed || !renderedIds.size) {
    // Preserve which detail panels were open
    const openDetails = new Set([...el.querySelectorAll('.task-detail.open')].map(d => d.id.replace('detail-','')));
    renderTasksPanel();
    // Restore open state (content already there from earlier load — don't re-fetch)
    openDetails.forEach(id => {
      const d = document.getElementById(`detail-${id}`);
      if (d && d.innerHTML.trim()) d.classList.add('open');
    });
    return;
  }

  // Only patch badges/iter counts — never touch detail panel DOM
  State.allTasks.forEach(t => {
    const card = document.getElementById(`task-card-${t.task_id}`);
    if (!card) return;
    const badge = card.querySelector('.task-badge');
    if (badge) { badge.textContent = _statusLabel(t.status); badge.className = `task-badge ${t.status}`; }
    const iters = card.querySelector('.task-iters');
    if (iters) iters.textContent = `${t.iterations}i · ${formatRelTime(t.updated_at)}`;
  });

  // Check if running/completed sections changed (task finished) — need section rebuild
  const runningNow      = State.allTasks.filter(t => t.status === 'running').map(t => t.task_id).sort().join(',');
  const runningRendered = [...el.querySelectorAll('.task-card')]
    .filter(c => { const b = c.querySelector('.task-badge'); return b && b.className.includes('running'); })
    .map(c => c.id.replace('task-card-','')).sort().join(',');

  if (runningNow !== runningRendered) {
    const openDetails = new Set([...el.querySelectorAll('.task-detail.open')].map(d => d.id.replace('detail-','')));
    renderTasksPanel();
    openDetails.forEach(id => {
      const d = document.getElementById(`detail-${id}`);
      if (d && d.innerHTML.trim()) d.classList.add('open');
    });
  }
}

function _statusLabel(s) {
  return { running:'running', success:'done', stuck:'stuck',
           error:'error', max_iterations:'max iters', cancelled:'cancelled' }[s] || s;
}

function renderTaskCard(t) {
  return `<div class="task-card" id="task-card-${t.task_id}">
    <div class="task-card-head" onclick="toggleTaskDetail('${t.task_id}')">
      <span class="task-badge ${t.status}">${_statusLabel(t.status)}</span>
      <span class="task-id">#${t.task_id}</span>
      <span class="task-description">${esc(t.task)}</span>
      <span class="task-iters">${t.iterations}i · ${formatRelTime(t.updated_at)}</span>
    </div>
    <div class="task-detail" id="detail-${t.task_id}"></div>
  </div>`;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

async function toggleTaskDetail(id) {
  const el = document.getElementById(`detail-${id}`);
  if (!el) return;
  if (el.classList.contains('open')) { el.classList.remove('open'); return; }
  el.classList.add('open');
  // Only fetch if not already loaded
  if (!el.innerHTML.trim()) await _loadDetailContent(id, el);
}

async function _loadDetailContent(id, el) {
  el.innerHTML = `<div style="padding:8px;color:var(--fg-dim);font-size:11px">Loading…</div>`;
  try {
    const d = await API.task(id);
    el.innerHTML = renderDetailContent(d);
  } catch(e) {
    el.innerHTML = `<div style="padding:8px;color:var(--red);font-size:11px">${esc(e.message)}</div>`;
  }
}

function renderDetailContent(d) {
  const iters = d.iterations || [];
  const errCount = iters.filter(it => it.exit_code != null && it.exit_code !== 0).length;
  return `
    <div class="task-detail-section">
      <div style="display:flex;gap:10px;font-size:11px;color:var(--fg-muted);margin-bottom:8px;flex-wrap:wrap;align-items:center">
        <span>${iters.length} iterations</span>
        <span style="color:${errCount>0?'var(--red)':'var(--green)'}">${errCount} errors</span>
        <span>${formatTime(d.created_at)}</span>
        ${d.status === 'running'
          ? `<button onclick="cancelTaskAction('${d.task_id}')" class="btn btn-danger" style="padding:2px 8px;font-size:10px;margin-left:auto">Cancel</button>`
          : ''}
      </div>
      ${d.result ? `
        <div class="task-detail-label">Result</div>
        <div class="task-result-box">${esc(d.result.summary || JSON.stringify(d.result,null,2))}</div>
        ${d.result.metrics && Object.keys(d.result.metrics).length ? `
          <div class="task-detail-label" style="margin-top:6px">Metrics</div>
          <div class="task-result-box" style="font-family:var(--font-mono)">
            ${Object.entries(d.result.metrics).map(([k,v])=>`${esc(k)}: <b>${esc(String(v))}</b>`).join('<br>')}
          </div>` : ''}
        ${d.result.suggested_next ? `
          <div class="task-detail-label" style="margin-top:6px">Suggested next</div>
          <div class="task-result-box" style="color:var(--accent)">${esc(d.result.suggested_next)}</div>` : ''}
      ` : d.error ? `
        <div class="task-detail-label">Error</div>
        <div class="task-result-box" style="color:var(--red)">${esc(d.error)}</div>
      ` : ''}
    </div>
    ${iters.length ? `
      <div class="task-detail-label">Steps</div>
      ${iters.slice().reverse().map(it => `
        <div class="iter-row ${it.exit_code===0?'ok':it.exit_code!=null?'err':''}">
          <div class="iter-row-head" onclick="this.nextElementSibling.classList.toggle('open')">
            <span class="iter-num">#${it.iteration}</span>
            ${it.tool ? `<span class="iter-tool">${esc(it.tool)}</span>` : ''}
            ${it.exit_code!=null ? `<span class="iter-exit" style="color:${it.exit_code===0?'var(--green)':'var(--red)'}">exit ${it.exit_code}</span>` : ''}
            <span class="iter-thought">${esc((it.thought||'').substring(0,100))}</span>
          </div>
          <div class="iter-body">
            ${it.thought?`<div class="task-detail-label">Thought</div><div class="task-result-box">${esc(it.thought)}</div>`:''}
            ${it.tool_output?`<div class="task-detail-label" style="margin-top:5px">Output</div><pre>${esc(it.tool_output.substring(0,800))}${it.tool_output.length>800?'\n…':''}</pre>`:''}
          </div>
        </div>`).join('')}` : ''}`;
}

async function cancelTaskAction(id) {
  showModal({
    title: 'Cancel task',
    fields: [],
    confirmLabel: 'Cancel Task',
    danger: true,
    onConfirm: async () => {
      try { await API.cancelTask(id); await loadTasks(); toast('Task cancelled', 'ok'); }
      catch(e) { toast(e.message, 'err'); }
    },
  });
}

async function submitNewTask() {
  const task = document.getElementById('nti-task')?.value.trim();
  if (!task) return;
  const maxIter = parseInt(document.getElementById('nti-max')?.value) || null;
  const btn = document.getElementById('nti-submit');
  btn.disabled = true; btn.textContent = 'Launching…';
  try {
    const d = await API.createTask(task, maxIter);
    closeModal();
    document.getElementById('nti-task').value = '';
    setSidebarView('tasks');
    await loadTasks();
    toast(`Task #${d.task_id} started`, 'ok');
    streamTask(d.task_id);
  } catch(e) { toast(e.message, 'err'); }
  btn.disabled = false; btn.textContent = 'Launch';
}

function streamTask(task_id) {
  if (State.activeStreams[task_id]) return;
  const es = API.streamTask(task_id);
  State.activeStreams[task_id] = es;

  es.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'iteration') {
      setStatusItem('status-run', `Running #${task_id} · step ${msg.iteration}${msg.tool?` · ${msg.tool}`:''}`, 'statusbar-item accent');
      // Patch iter count without touching detail panel
      const itersEl = document.querySelector(`#task-card-${task_id} .task-iters`);
      if (itersEl) itersEl.textContent = `${msg.iteration}i · just now`;
      addOutputLine(task_id, msg);
    }
    if (msg.type === 'done') {
      es.close();
      delete State.activeStreams[task_id];
      loadTasks();
      setStatusItem('status-run', '', 'statusbar-item');
      toast(`Task #${task_id} ${msg.status}`, msg.status==='success'?'ok':'err', 6000);
    }
  };
  es.onerror = () => { es.close(); delete State.activeStreams[task_id]; loadTasks(); };
}

async function reconnectRunningStreams() {
  const tasks = await API.tasks().catch(() => []);
  tasks.filter(t => t.status === 'running').forEach(t => streamTask(t.task_id));
}

function addOutputLine(task_id, msg) {
  const body = document.getElementById('output-body');
  if (!body) return;
  const div = document.createElement('div');
  div.className = `output-iter ${msg.exit_code===0?'ok':msg.exit_code!=null?'err':''}`;
  div.innerHTML = `
    <div class="output-iter-head">
      <span>#${msg.iteration}</span>
      ${msg.tool?`<span class="output-iter-tool">${esc(msg.tool)}</span>`:''}
      ${msg.exit_code!=null?`<span style="color:${msg.exit_code===0?'var(--green)':'var(--red)'}">exit ${msg.exit_code}</span>`:''}
      <span class="output-iter-thought">${esc((msg.thought||'').substring(0,100))}</span>
    </div>
    ${msg.output_preview?`<div class="output-iter-body">${esc(msg.output_preview)}</div>`:''}`;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;

  // Feature 7: auto-install detection in output panel
  if (msg.output_preview && msg.output_preview.includes('ModuleNotFoundError')) {
    const m = msg.output_preview.match(/No module named ['"]?([\w.]+)/);
    if (m) {
      const pkg = m[1].split('.')[0];
      const banner = document.createElement('div');
      banner.style.cssText = 'padding:5px 10px;background:var(--blue-dim);border-left:3px solid var(--blue);font-size:11px;display:flex;align-items:center;gap:8px';
      banner.innerHTML = `<span style="color:var(--fg)">Missing package: <b style="font-family:var(--font-mono)">${esc(pkg)}</b></span>
        <button class="code-btn run" onclick="autoInstallPackage('${esc(pkg)}',this)">pip install ${esc(pkg)}</button>
        <button class="code-btn" onclick="this.closest('div').remove()">Dismiss</button>`;
      body.appendChild(banner);
    }
  }
}

window.loadTasks = loadTasks;
window.renderTasksPanel = renderTasksPanel;
window.toggleTaskDetail = toggleTaskDetail;
window.cancelTaskAction = cancelTaskAction;
window.submitNewTask = submitNewTask;
window.streamTask = streamTask;
window.reconnectRunningStreams = reconnectRunningStreams;

async function autoInstallPackage(pkg, btn) {
  btn.disabled = true; btn.textContent = `Installing ${pkg}…`;
  try {
    const d = await API.autoInstall(`ModuleNotFoundError: No module named '${pkg}'`);
    if (d.installed) {
      toast(`Installed ${pkg}`, 'ok');
      btn.closest('div').remove();
    } else {
      toast(`Failed to install ${pkg}: ${d.output.slice(-100)}`, 'err');
      btn.disabled = false; btn.textContent = `pip install ${pkg}`;
    }
  } catch(e) { toast(e.message, 'err'); btn.disabled = false; }
}
window.autoInstallPackage = autoInstallPackage;