// Feature 1: Experiment comparison — compare metrics across task runs

let _experiments = [];

async function loadExperiments() {
  try {
    _experiments = await API.experiments();
    if (State.sidebarView === 'experiments') renderExperimentsPanel();
  } catch(e) {
    console.error('loadExperiments:', e);
  }
}

function renderExperimentsPanel() {
  const el = document.getElementById('experiments-view');
  if (!el) return;

  if (!_experiments.length) {
    el.innerHTML = `<div style="padding:16px;color:var(--fg-dim);font-size:12px;text-align:center;line-height:1.8">
      No completed experiments yet.<br>Run a task to see results here.
    </div>`;
    return;
  }

  // Collect all metric keys across all experiments
  const allMetrics = new Set();
  _experiments.forEach(e => Object.keys(e.metrics || {}).forEach(k => allMetrics.add(k)));
  const metricCols = [...allMetrics].slice(0, 6); // cap at 6 columns

  const html = `
    <div style="padding:6px 8px 4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--fg-dim)">${_experiments.length} experiments</span>
      <button class="sidebar-icon-btn" style="margin-left:auto" onclick="loadExperiments()" title="Refresh">
        ${svgIcon('refresh')}
      </button>
    </div>
    <div style="overflow:auto;flex:1;min-height:0">
      <table class="exp-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Iters</th>
            ${metricCols.map(k => `<th>${esc(k)}</th>`).join('')}
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${_experiments.map(e => `
            <tr onclick="showExperimentDetail('${e.task_id}')" style="cursor:pointer">
              <td title="${esc(e.task)}">${esc(e.task.slice(0, 40))}${e.task.length > 40 ? '…' : ''}</td>
              <td><span class="task-badge ${e.status}" style="font-size:9px">${e.status}</span></td>
              <td style="text-align:right">${e.iterations}</td>
              ${metricCols.map(k => {
                const v = e.metrics[k];
                return `<td class="exp-metric">${v != null ? (typeof v === 'number' ? v.toFixed(4) : esc(String(v))) : '—'}</td>`;
              }).join('')}
              <td style="color:var(--fg-dim)">${formatRelTime(e.created_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${metricCols.length ? `
      <div style="padding:6px 8px;border-top:1px solid var(--border)">
        <div style="font-size:10px;color:var(--fg-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Best per metric</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${metricCols.map(k => {
            const vals = _experiments.map(e => ({ id: e.task_id, v: e.metrics[k] })).filter(x => x.v != null);
            if (!vals.length) return '';
            const best = vals.reduce((a,b) => b.v > a.v ? b : a);
            return `<div style="font-size:11px;background:var(--bg-hover);padding:2px 6px;border-radius:3px">
              <span style="color:var(--fg-muted)">${esc(k)}: </span>
              <span style="color:var(--accent);font-family:var(--font-mono)">${typeof best.v==='number'?best.v.toFixed(4):best.v}</span>
              <span style="color:var(--fg-dim)"> #${best.id}</span>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}`;

  el.innerHTML = html;
}

function showExperimentDetail(task_id) {
  const exp = _experiments.find(e => e.task_id === task_id);
  if (!exp) return;
  showModal({
    title: `Experiment #${task_id}`,
    fields: [],
    confirmLabel: 'Close',
    onConfirm: () => {},
  });
  setTimeout(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return;
    modal.querySelector('h2').insertAdjacentHTML('afterend', `
      <div style="font-size:12px;margin-bottom:12px;color:var(--fg-muted);line-height:1.6">${esc(exp.task)}</div>
      ${exp.summary ? `<div style="margin-bottom:10px"><div class="task-detail-label">Summary</div><div class="task-result-box">${esc(exp.summary)}</div></div>` : ''}
      ${Object.keys(exp.metrics).length ? `
        <div class="task-detail-label">Metrics</div>
        <div class="task-result-box" style="font-family:var(--font-mono);margin-bottom:10px">
          ${Object.entries(exp.metrics).map(([k,v]) => `<div>${esc(k)}: <b style="color:var(--accent)">${typeof v==='number'?v.toFixed(6):esc(String(v))}</b></div>`).join('')}
        </div>` : ''}
      ${exp.files_created?.length ? `
        <div class="task-detail-label">Files created</div>
        <div class="task-result-box" style="font-family:var(--font-mono)">
          ${exp.files_created.map(f => `<div style="cursor:pointer;color:var(--blue)" onclick="openFile('${esc(f)}','${esc(f.split('/').pop())}');closeModal()">${esc(f)}</div>`).join('')}
        </div>` : ''}
      <div style="margin-top:10px;font-size:11px;color:var(--fg-dim)">${exp.iterations} iterations · ${formatRelTime(exp.created_at)}</div>
    `);
    // Remove the footer buttons from the injected content (keep modal ones)
  }, 30);
}

window.loadExperiments = loadExperiments;
window.renderExperimentsPanel = renderExperimentsPanel;
window.showExperimentDetail = showExperimentDetail;