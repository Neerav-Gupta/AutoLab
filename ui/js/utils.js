// Shared utilities — icons defined first so everything else can use them

// ── SVG Icons ─────────────────────────────────────────────────────────────────

const ICONS = {
  'folder':       '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="14" height="14"><path d="M1 4a1 1 0 011-1h4l1.5 1.5H14a1 1 0 011 1V12a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></svg>',
  'folder-open':  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="14" height="14"><path d="M1 4a1 1 0 011-1h4l1.5 1.5H14a1 1 0 011 1v1H1V4z"/><path d="M1 6.5h14L13 13H2L1 6.5z"/></svg>',
  'file':         '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="14" height="14"><path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"/><polyline points="9,2 9,6 13,6"/></svg>',
  'close':        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="11" height="11"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
  'add':          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>',
  'refresh':      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><polyline points="2,10 2,14 6,14"/><polyline points="14,6 14,2 10,2"/><path d="M14,6 A6 6 0 0 0 2,10"/><path d="M2,10 A6 6 0 0 0 14,6"/></svg>',
  'terminal':     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><polyline points="2,5 7,8 2,11"/><line x1="9" y1="11" x2="13" y2="11"/></svg>',
  'settings':     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1"/></svg>',
  'clear':        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><circle cx="8" cy="8" r="5.5"/><line x1="5" y1="5" x2="11" y2="11"/></svg>',
  'new-file':     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"/><polyline points="9,2 9,6 13,6"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="6" y1="11" x2="10" y2="11"/></svg>',
  'new-folder':   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><path d="M1 4a1 1 0 011-1h4l1.5 1.5H14a1 1 0 011 1V12a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/><line x1="8" y1="7" x2="8" y2="11"/><line x1="6" y1="9" x2="10" y2="9"/></svg>',
  'run':          '<svg viewBox="0 0 14 14" fill="currentColor" width="12" height="12"><polygon points="2,1 13,7 2,13"/></svg>',
  'save':         '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><path d="M3 2h8l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><rect x="5" y="9" width="6" height="5"/><rect x="5" y="2" width="4" height="3"/></svg>',
  'copy':         '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M3 11V3a1 1 0 011-1h8"/></svg>',
  'chat':         '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" width="13" height="13"><path d="M2 2h12a1 1 0 011 1v8a1 1 0 01-1 1H5l-3 2V3a1 1 0 011-1z"/></svg>',
};

function svgIcon(name, cls) {
  const svg = ICONS[name] || ICONS['file'];
  if (!cls) return svg;
  return svg.replace('<svg ', `<svg class="${cls}" `);
}

// Color-coded file icon based on extension
function fileIconSvg(name) {
  if (!name) return ICONS['file'];
  const ext = name.toLowerCase().split('.').pop();
  const colors = {
    py:'var(--blue)', ipynb:'var(--blue)',
    js:'var(--orange)', jsx:'var(--orange)',
    ts:'var(--blue)', tsx:'var(--blue)',
    json:'var(--syn-string)',
    yaml:'var(--syn-class)', yml:'var(--syn-class)', toml:'var(--syn-class)',
    md:'var(--fg-muted)', txt:'var(--fg-dim)', rst:'var(--fg-dim)',
    sh:'var(--green)', bash:'var(--green)',
    html:'var(--orange)', css:'var(--cyan)',
    pt:'var(--accent)', pth:'var(--accent)',
    ckpt:'var(--accent)', safetensors:'var(--accent)',
    log:'var(--fg-dim)', csv:'var(--green)',
    c:'var(--purple)', cpp:'var(--purple)', h:'var(--purple)',
    rs:'var(--orange)',
  };
  const color = colors[ext] || 'var(--fg-dim)';
  return `<svg viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.4" width="14" height="14" style="flex-shrink:0;vertical-align:middle"><path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"/><polyline points="9,2 9,6 13,6"/></svg>`;
}

// ── General utilities ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fileIcon(name) {
  return fileIconSvg(name); // legacy alias
}

function formatRelTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function setStatusItem(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (cls) el.className = cls;
}

function detectLang(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  const map = {
    py:'python', js:'javascript', ts:'typescript',
    jsx:'javascript', tsx:'typescript',
    json:'json', yaml:'yaml', yml:'yaml',
    sh:'shell', bash:'shell', md:'markdown',
    html:'html', css:'css', cpp:'cpp', c:'c', rs:'rust', toml:'toml',
  };
  return map[ext] || 'text';
}

function detectLangLabel(path) {
  const labels = {
    python:'Python', javascript:'JavaScript', typescript:'TypeScript',
    json:'JSON', yaml:'YAML', shell:'Shell', markdown:'Markdown',
    html:'HTML', css:'CSS', cpp:'C++', c:'C', rust:'Rust', toml:'TOML',
    text:'Plain Text',
  };
  return labels[detectLang(path)] || 'Plain Text';
}

// ── Exports ───────────────────────────────────────────────────────────────────

window.svgIcon       = svgIcon;
window.fileIconSvg   = fileIconSvg;
window.fileIcon      = fileIcon;
window.esc           = esc;
window.formatRelTime = formatRelTime;
window.formatTime    = formatTime;
window.toast         = toast;
window.setStatusItem = setStatusItem;
window.detectLang    = detectLang;
window.detectLangLabel = detectLangLabel;