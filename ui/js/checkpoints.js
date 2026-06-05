// Feature 4: Checkpoint browser — list, inspect, delete .pt/.ckpt files

let _checkpoints = [];

async function loadCheckpoints() {
  try {
    _checkpoints = await API.checkpoints();
    if (State.sidebarView === 'checkpoints') renderCheckpointsPanel();
  } catch(e) { console.error('loadCheckpoints:', e); }
}

function renderCheckpointsPanel() {
  const el = document.getElementById('checkpoints-view');
  if (!el) return;

  if (!_checkpoints.length) {
    el.innerHTML = `<div style="padding:16px;color:var(--fg-dim);font-size:12px;text-align:center;line-height:1.8">
      No checkpoints found.<br>
      <span style="font-size:11px">Looks for .pt .pth .ckpt .safetensors files in workspace</span>
    </div>`;
    return;
  }

  // Group by directory
  const byDir = {};
  _checkpoints.forEach(c => {
    if (!byDir[c.dir]) byDir[c.dir] = [];
    byDir[c.dir].push(c);
  });

  const totalSize = _checkpoints.reduce((a,c) => a + c.size_mb, 0);

  let html = `<div style="padding:6px 8px 4px;display:flex;gap:6px;align-items:center">
    <span style="font-size:11px;color:var(--fg-dim)">${_checkpoints.length} files · ${totalSize.toFixed(1)} MB total</span>
    <button class="sidebar-icon-btn" style="margin-left:auto" onclick="loadCheckpoints()" title="Refresh">${svgIcon('refresh')}</button>
  </div>`;

  Object.entries(byDir).sort().forEach(([dir, files]) => {
    const shortDir = dir.replace(config_workspace || '/workspace', '~');
    html += `<div class="ckpt-dir-header">${esc(shortDir)}</div>`;
    files.forEach(c => {
      const age = formatRelTime(new Date(c.mtime * 1000).toISOString());
      const sizeColor = c.size_mb > 1000 ? 'var(--red)' : c.size_mb > 100 ? 'var(--orange)' : 'var(--fg-muted)';
      html += `<div class="ckpt-row" id="ckpt-${btoa(c.path).replace(/[^a-z0-9]/gi,'').slice(0,12)}">
        <div class="ckpt-icon">${svgIcon('save')}</div>
        <div class="ckpt-info">
          <div class="ckpt-name">${esc(c.name)}</div>
          <div class="ckpt-meta">
            <span style="color:${sizeColor}">${c.size_mb} MB</span>
            <span style="color:var(--fg-dim)">· ${age}</span>
          </div>
        </div>
        <div class="ckpt-actions">
          <button class="code-btn copy" onclick="navigator.clipboard.writeText('${esc(c.path)}');toast('Path copied','ok')" title="Copy path">Copy</button>
          <button class="code-btn run" onclick="Checkpoints.loadInTerminal('${esc(c.path)}')" title="Load in terminal">Load</button>
          <button class="code-btn" style="color:var(--red);border-color:var(--red-dim)" onclick="Checkpoints.deleteCheckpoint('${esc(c.path)}','${esc(c.name)}')" title="Delete">Del</button>
        </div>
      </div>`;
    });
  });

  el.innerHTML = html;
}

// Store workspace for use in renderCheckpointsPanel
let config_workspace = '/workspace';
async function _initWorkspace() {
  try { const s = await API.status(); config_workspace = s.workspace || '/workspace'; } catch {}
}

const Checkpoints = {
  deleteCheckpoint(path, name) {
    showModal({
      title: 'Delete checkpoint',
      fields: [],
      confirmLabel: `Delete ${name}`,
      danger: true,
      onConfirm: async () => {
        try {
          await API.deleteCheckpoint(path);
          toast(`Deleted ${name}`, 'ok');
          await loadCheckpoints();
        } catch(e) { toast(e.message, 'err'); }
      },
    });
  },

  loadInTerminal(path) {
    // Generate a quick torch.load snippet
    const code = `import torch\ncheckpoint = torch.load('${path}', map_location='cpu')\nprint(type(checkpoint))\nif isinstance(checkpoint, dict): print(list(checkpoint.keys())[:10])`;
    TermManager.send(`python -c "${code.replace(/\n/g, '; ').replace(/'/g, "'")}"\r`);
    switchPanelTab('terminal');
    toast('Loading checkpoint in terminal…', 'info');
  },
};

window.loadCheckpoints = loadCheckpoints;
window.renderCheckpointsPanel = renderCheckpointsPanel;
window.Checkpoints = Checkpoints;
window._initWorkspace = _initWorkspace;