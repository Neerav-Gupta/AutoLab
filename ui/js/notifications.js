// Notification system — modals, toasts, context menu

// ── Context menu ──────────────────────────────────────────────────────────────

function showCtxMenu(e, items) {
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = items.map(item => {
    if (item === 'sep') return '<div class="ctx-sep"></div>';
    return `<div class="ctx-item${item.danger ? ' danger' : ''}" data-action="${esc(item.action || '')}">${esc(item.label)}</div>`;
  }).join('');

  menu.querySelectorAll('.ctx-item').forEach((el, i) => {
    const item = items.filter(x => x !== 'sep')[i];
    if (item && item.onClick) el.addEventListener('click', () => { hideCtxMenu(); item.onClick(); });
  });

  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 220) + 'px';
}

function hideCtxMenu() {
  const menu = document.getElementById('ctx-menu');
  if (menu) menu.style.display = 'none';
}

// ── Dynamic modals ────────────────────────────────────────────────────────────

function showModal({ title, fields = [], confirmLabel = 'OK', onConfirm, danger = false }) {
  const existing = document.getElementById('dynamic-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'dynamic-modal';
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };

  overlay.innerHTML = `
    <div class="modal">
      <h2>${esc(title)}</h2>
      ${fields.map(f => `
        <label class="modal-label">${esc(f.label)}</label>
        ${f.type === 'textarea'
          ? `<textarea class="modal-textarea" id="mf-${f.id}" placeholder="${esc(f.placeholder||'')}" rows="${f.rows||3}">${esc(f.value||'')}</textarea>`
          : `<input class="modal-input" id="mf-${f.id}" type="${f.type||'text'}" placeholder="${esc(f.placeholder||'')}" value="${esc(f.value||'')}"/>`
        }
      `).join('')}
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="modal-ok">${esc(confirmLabel)}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('modal-ok').onclick = () => {
    const vals = {};
    fields.forEach(f => { vals[f.id] = document.getElementById(`mf-${f.id}`)?.value || ''; });
    closeModal();
    onConfirm(vals);
  };

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); document.getElementById('modal-ok')?.click(); }
    if (e.key === 'Escape') closeModal();
  });

  const first = overlay.querySelector('input, textarea');
  if (first) setTimeout(() => { first.focus(); first.select(); }, 40);
}

function closeModal() {
  const m = document.getElementById('dynamic-modal');
  if (m) m.remove();
  const nt = document.getElementById('new-task-modal');
  if (nt) nt.style.display = 'none';
}

// ── Specific modals ───────────────────────────────────────────────────────────

function showNewFileModal(dirPath) {
  hideCtxMenu();
  showModal({
    title: 'New File',
    fields: [{ id: 'name', label: 'File name', placeholder: 'script.py' }],
    confirmLabel: 'Create',
    onConfirm: async ({ name }) => {
      if (!name) return;
      const path = `${dirPath.replace(/\/$/, '')}/${name}`;
      try {
        await API.writeFile(path, '');
        await Editor.loadFileTree();
        Editor.openFile(path, name);
        toast(`Created ${name}`, 'ok');
      } catch(e) { toast(e.message, 'err'); }
    },
  });
}

function showNewFolderModal(dirPath) {
  hideCtxMenu();
  showModal({
    title: 'New Folder',
    fields: [{ id: 'name', label: 'Folder name', placeholder: 'experiments' }],
    confirmLabel: 'Create',
    onConfirm: async ({ name }) => {
      if (!name) return;
      try {
        await API.shell(`mkdir -p "${dirPath}/${name}"`);
        await Editor.loadFileTree();
        toast(`Created ${name}`, 'ok');
      } catch(e) { toast(e.message, 'err'); }
    },
  });
}

function showRenameModal(path) {
  hideCtxMenu();
  const current = path.split('/').pop();
  const dir = path.split('/').slice(0, -1).join('/');
  showModal({
    title: 'Rename',
    fields: [{ id: 'name', label: 'New name', value: current }],
    confirmLabel: 'Rename',
    onConfirm: async ({ name }) => {
      if (!name || name === current) return;
      try {
        await API.shell(`mv "${path}" "${dir}/${name}"`);
        await Editor.loadFileTree();
        toast(`Renamed to ${name}`, 'ok');
      } catch(e) { toast(e.message, 'err'); }
    },
  });
}

async function deletePathConfirm(path, isDir) {
  hideCtxMenu();
  const name = path.split('/').pop();
  showModal({
    title: `Delete ${isDir ? 'folder' : 'file'}`,
    fields: [],
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: async () => {
      try {
        await API.deleteFile(path);
        const tab = State.openTabs.find(t => t.path === path);
        if (tab) Editor.closeTab(path);
        await Editor.loadFileTree();
        toast(`Deleted ${name}`, 'ok');
      } catch(e) { toast(e.message, 'err'); }
    },
  });
}

function openNewTaskModal() {
  const modal = document.getElementById('new-task-modal');
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('nti-task')?.focus(), 50);
}

window.showCtxMenu = showCtxMenu;
window.hideCtxMenu = hideCtxMenu;
window.showModal = showModal;
window.closeModal = closeModal;
window.showNewFileModal = showNewFileModal;
window.showNewFolderModal = showNewFolderModal;
window.showRenameModal = showRenameModal;
window.deletePathConfirm = deletePathConfirm;
window.openNewTaskModal = openNewTaskModal;