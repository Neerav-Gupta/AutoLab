// Editor — CodeMirror 6
// importmap in index.html pins all @codemirror/* to exact versions,
// ensuring a single @codemirror/state instance across all packages.

const WORKSPACE = '/workspace';
let _cmLoaded = false;
let _CM = null;

async function loadCodeMirror() {
  if (_cmLoaded) return;
  try {
    // These bare specifiers are resolved via the importmap in index.html.
    // All packages share the same @codemirror/state instance because the
    // importmap pins them to one URL each.
    const { EditorView, keymap, lineNumbers, highlightActiveLine,
            highlightActiveLineGutter, drawSelection }  = await import('@codemirror/view');
    const { EditorState }                               = await import('@codemirror/state');
    const { defaultKeymap, indentWithTab,
            history, historyKeymap }                    = await import('@codemirror/commands');
    const { syntaxHighlighting, StreamLanguage,
            indentOnInput }                             = await import('@codemirror/language');
    const { classHighlighter }                          = await import('@lezer/highlight');
    const { closeBrackets, autocompletion,
            completionKeymap, closeBracketsKeymap }     = await import('@codemirror/autocomplete');

    // Language packs
    const { python }     = await import('@codemirror/lang-python');
    const { javascript } = await import('@codemirror/lang-javascript');
    const { json }       = await import('@codemirror/lang-json');
    const { markdown }   = await import('@codemirror/lang-markdown');
    const { yaml }       = await import('@codemirror/lang-yaml');

    // Shell mode — optional
    let shellLang = null;
    try {
      const { shell } = await import('@codemirror/legacy-modes/mode/shell');
      shellLang = StreamLanguage.define(shell);
    } catch { /* shell highlighting unavailable */ }

    function getLangExt(path) {
      const ext = (path || '').split('.').pop().toLowerCase();
      const map = {
        py:       [python()],
        js:       [javascript()],
        jsx:      [javascript({ jsx: true })],
        ts:       [javascript({ typescript: true })],
        tsx:      [javascript({ jsx: true, typescript: true })],
        json:     [json()],
        md:       [markdown()],
        markdown: [markdown()],
        yaml:     [yaml()],
        yml:      [yaml()],
        sh:       shellLang ? [shellLang] : [],
        bash:     shellLang ? [shellLang] : [],
      };
      return map[ext] || [];
    }

    _CM = {
      EditorState, EditorView, keymap,
      lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
      defaultKeymap, indentWithTab, history, historyKeymap,
      syntaxHighlighting, classHighlighter, indentOnInput,
      closeBrackets, autocompletion, completionKeymap, closeBracketsKeymap,
      getLangExt,
    };
    _cmLoaded = true;
    console.log('CodeMirror 6 loaded');
    _upgradeFallbackTabs();
  } catch(e) {
    console.error('CodeMirror load failed:', e);
  }
}

function createCMView(container, content, path, onChange) {
  if (!_CM) return null;
  container.querySelector('textarea')?.remove();

  const {
    EditorState, EditorView, keymap,
    lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
    defaultKeymap, indentWithTab, history, historyKeymap,
    syntaxHighlighting, classHighlighter, indentOnInput,
    closeBrackets, autocompletion, completionKeymap, closeBracketsKeymap,
    getLangExt,
  } = _CM;

  return new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        closeBrackets(),
        indentOnInput(),
        autocompletion(),
        syntaxHighlighting(classHighlighter),
        ...getLangExt(path),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          indentWithTab,
          { key: 'Mod-s', run: () => { Editor.saveCurrentFile(); return true; } },
          { key: 'Mod-w', run: () => { if (State.activeTab) Editor.closeTab(State.activeTab); return true; } },
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged && onChange) onChange();
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': {
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            lineHeight: '1.6',
            overflow: 'auto',
          },
          '.cm-content': { caretColor: 'var(--accent)', padding: '4px 0 200px' },
          '.cm-line':    { paddingLeft: '8px', paddingRight: '12px' },
        }),
      ],
    }),
    parent: container,
  });
}

function _upgradeFallbackTabs() {
  State.openTabs.forEach(tab => {
    if (tab.cmView) return;
    const el = document.getElementById('cm_' + tab.path.replace(/[^a-zA-Z0-9]/g, '_'));
    if (!el) return;
    const onChange = () => { if (!tab.dirty) { tab.dirty = true; renderTabs(); } };
    tab.cmView = createCMView(el, tab.content, tab.path, onChange);
  });
}

// ── File tree ─────────────────────────────────────────────────────────────────

async function loadFileTree() {
  const container = document.getElementById('file-tree');
  container.innerHTML = '<div class="tree-loading">Loading…</div>';
  try {
    const data = await API.files(WORKSPACE);
    container.innerHTML = '';
    renderDirContents(data, container, 0);
    if (!data.dirs.length && !data.files.length)
      container.innerHTML = '<div class="tree-loading">Workspace is empty</div>';
  } catch(e) {
    console.error('loadFileTree:', e);
    container.innerHTML = `<div class="tree-loading" style="color:var(--red)">${esc(e.message || String(e))}</div>`;
  }
}

function renderDirContents(data, container, depth) {
  const dirs  = (data.dirs  || []).sort((a,b) => a.name.localeCompare(b.name));
  const files = (data.files || []).sort((a,b) => a.name.localeCompare(b.name));
  [...dirs, ...files].forEach(e => renderEntry(e, container, depth));
}

function renderEntry(entry, container, depth) {
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.dataset.path = entry.path;
  row.dataset.type = entry.type;
  const pad = depth * 12;

  if (entry.type === 'dir') {
    const expanded = State.expandedDirs.has(entry.path);
    row.innerHTML = `
      <div class="tree-row-indent" style="width:${pad}px"></div>
      <div class="tree-row-arrow ${expanded ? 'open' : 'closed'}"></div>
      <span class="tree-row-icon">${expanded ? svgIcon('folder-open') : svgIcon('folder')}</span>
      <span class="tree-row-name">${esc(entry.name)}</span>`;
    row.addEventListener('click', e => { e.stopPropagation(); toggleDir(entry, row, depth); });
    row.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, [
      { label: 'New File',      onClick: () => showNewFileModal(entry.path) },
      { label: 'New Folder',    onClick: () => showNewFolderModal(entry.path) },
      'sep',
      { label: 'Refresh',       onClick: () => loadFileTree() },
      'sep',
      { label: 'Delete Folder', danger: true, onClick: () => deletePathConfirm(entry.path, true) },
    ]); });
  } else {
    row.classList.toggle('active', State.activeTab === entry.path);
    row.innerHTML = `
      <div class="tree-row-indent" style="width:${pad + 16}px"></div>
      <span class="tree-row-icon">${fileIconSvg(entry.name)}</span>
      <span class="tree-row-name">${esc(entry.name)}</span>`;
    row.addEventListener('click', e => { e.stopPropagation(); openFile(entry.path, entry.name); });
    row.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, [
      { label: 'Open',        onClick: () => openFile(entry.path, entry.name) },
      { label: 'Run File',    onClick: () => TermManager.send(`python ${entry.path}\r`) },
      'sep',
      { label: 'Copy Path',   onClick: () => { navigator.clipboard.writeText(entry.path); toast('Path copied', 'ok'); } },
      { label: 'Rename',      onClick: () => showRenameModal(entry.path) },
      'sep',
      { label: 'Delete File', danger: true, onClick: () => deletePathConfirm(entry.path, false) },
    ]); });
  }
  container.appendChild(row);

  if (entry.type === 'dir' && State.expandedDirs.has(entry.path)) {
    const cw = document.createElement('div');
    cw.id = dirContainerId(entry.path);
    container.appendChild(cw);
    loadDirInto(entry.path, cw, depth + 1);
  }
}

function dirContainerId(p) { return 'dc_' + p.replace(/[^a-zA-Z0-9]/g, '_'); }

async function loadDirInto(path, container, depth) {
  container.innerHTML = `<div class="tree-loading" style="padding-left:${depth*12+12}px">…</div>`;
  try {
    const data = await API.files(path);
    container.innerHTML = '';
    renderDirContents(data, container, depth);
  } catch(e) {
    container.innerHTML = `<div class="tree-loading" style="color:var(--red);padding-left:${depth*12+12}px">Error</div>`;
  }
}

async function toggleDir(entry, row, depth) {
  const cid = dirContainerId(entry.path);
  const existing = document.getElementById(cid);
  const arrowEl = row.querySelector('.tree-row-arrow');
  const iconEl  = row.querySelector('.tree-row-icon');
  if (State.expandedDirs.has(entry.path)) {
    State.expandedDirs.delete(entry.path);
    existing?.remove();
    arrowEl.className = 'tree-row-arrow closed';
    iconEl.innerHTML = svgIcon('folder');
  } else {
    State.expandedDirs.add(entry.path);
    arrowEl.className = 'tree-row-arrow open';
    iconEl.innerHTML = svgIcon('folder-open');
    const cw = document.createElement('div');
    cw.id = cid;
    row.insertAdjacentElement('afterend', cw);
    await loadDirInto(entry.path, cw, depth + 1);
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

async function openFile(path, name) {
  const binary = ['png','jpg','jpeg','gif','webp','ico','woff','woff2','ttf',
                  'pt','pth','ckpt','safetensors','pkl','bin','zip','gz','tar','mp4','mp3'];
  if (binary.includes(path.split('.').pop().toLowerCase())) {
    toast('Binary file — cannot display', 'info'); return;
  }
  const existing = State.openTabs.find(t => t.path === path);
  if (existing) { activateTab(path); return; }
  try {
    const { content } = await API.readFile(path);
    State.openTabs.push({ path, name: name || path.split('/').pop(),
                          content, dirty: false, cmView: null });
    activateTab(path);
    renderTabs();
  } catch(e) { toast(`Cannot open: ${e.message}`, 'err'); }
}

function getOrCreateTabContainer(path) {
  const wrapper = document.getElementById('editor-wrapper');
  const id = 'cm_' + path.replace(/[^a-zA-Z0-9]/g, '_');
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'display:none;flex:1;height:100%;overflow:hidden;min-height:0;';
    wrapper.appendChild(el);
  }
  return el;
}

function activateTab(path) {
  State.activeTab = path;
  const tab = State.openTabs.find(t => t.path === path);
  if (!tab) return;
  document.getElementById('editor-placeholder').style.display = 'none';
  document.querySelectorAll('[id^="cm_"]').forEach(el => el.style.display = 'none');
  const container = getOrCreateTabContainer(path);
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;min-height:0;';

  if (!tab.cmView) {
    if (_cmLoaded) {
      const onChange = () => { if (!tab.dirty) { tab.dirty = true; renderTabs(); } };
      tab.cmView = createCMView(container, tab.content, path, onChange);
    } else if (!container.querySelector('textarea')) {
      const ta = document.createElement('textarea');
      ta.style.cssText = 'flex:1;background:var(--bg-editor);color:var(--fg);font-family:var(--font-mono);font-size:13px;padding:12px 16px;border:none;outline:none;resize:none;line-height:1.6;tab-size:4;';
      ta.value = tab.content;
      ta.oninput = () => { tab.content = ta.value; if (!tab.dirty) { tab.dirty = true; renderTabs(); } };
      container.appendChild(ta);
    }
  }

  updateBreadcrumb(path);
  setStatusItem('status-lang', detectLangLabel(path));
  renderTabs();
  document.querySelectorAll('.tree-row[data-type="file"]').forEach(el =>
    el.classList.toggle('active', el.dataset.path === path));
}

function getCurrentContent() {
  if (!State.activeTab) return '';
  const tab = State.openTabs.find(t => t.path === State.activeTab);
  if (!tab) return '';
  if (tab.cmView) return tab.cmView.state.doc.toString();
  const cid = 'cm_' + State.activeTab.replace(/[^a-zA-Z0-9]/g, '_');
  return document.getElementById(cid)?.querySelector('textarea')?.value ?? tab.content;
}

function renderTabs() {
  const bar = document.getElementById('tabbar');
  if (!State.openTabs.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = State.openTabs.map(t => `
    <div class="editor-tab ${t.path === State.activeTab ? 'active' : ''}"
         onclick="Editor.activateTab('${esc(t.path)}')">
      <span class="tab-icon">${fileIconSvg(t.name)}</span>
      <span class="tab-label ${t.dirty ? 'tab-dirty' : ''}">${esc(t.name)}</span>
      <span class="tab-close" onclick="event.stopPropagation();Editor.closeTab('${esc(t.path)}')">${svgIcon('close')}</span>
    </div>`).join('');
}

function _closeTabForce(path) {
  const tab = State.openTabs.find(t => t.path === path);
  try { tab?.cmView?.destroy(); } catch {}
  document.getElementById('cm_' + path.replace(/[^a-zA-Z0-9]/g,'_'))?.remove();
  State.openTabs = State.openTabs.filter(t => t.path !== path);
  if (State.activeTab === path) {
    const next = State.openTabs.at(-1);
    if (next) { activateTab(next.path); }
    else {
      State.activeTab = null;
      document.getElementById('editor-placeholder').style.display = 'flex';
      document.getElementById('breadcrumb').innerHTML = '';
      setStatusItem('status-lang', '');
    }
  }
  renderTabs();
}

function closeTab(path) {
  const tab = State.openTabs.find(t => t.path === path);
  if (tab?.dirty) {
    // Use modal instead of confirm()
    showModal({
      title: 'Unsaved changes',
      fields: [],
      confirmLabel: 'Close without saving',
      danger: true,
      onConfirm: () => _closeTabForce(path),
    });
    return;
  }
  try { tab?.cmView?.destroy(); } catch {}
  document.getElementById('cm_' + path.replace(/[^a-zA-Z0-9]/g,'_'))?.remove();
  State.openTabs = State.openTabs.filter(t => t.path !== path);
  if (State.activeTab === path) {
    const next = State.openTabs.at(-1);
    if (next) { activateTab(next.path); }
    else {
      State.activeTab = null;
      document.getElementById('editor-placeholder').style.display = 'flex';
      document.getElementById('breadcrumb').innerHTML = '';
      setStatusItem('status-lang', '');
    }
  }
  renderTabs();
}

async function saveCurrentFile() {
  if (!State.activeTab) return;
  const tab = State.openTabs.find(t => t.path === State.activeTab);
  if (!tab) return;
  const content = getCurrentContent();
  try {
    await API.writeFile(tab.path, content);
    tab.content = content; tab.dirty = false; renderTabs();
    toast(`Saved ${tab.name}`, 'ok');
  } catch(e) { toast(`Save failed: ${e.message}`, 'err'); }
}

async function runCurrentFile() {
  if (!State.activeTab) return;
  await saveCurrentFile();
  TermManager.send(`python ${State.activeTab}\r`);
}

function updateBreadcrumb(path) {
  const parts = path.split('/').filter(Boolean);
  document.getElementById('breadcrumb').innerHTML = parts.map((p,i) =>
    `<span class="bc-item">${esc(p)}</span>${i < parts.length-1 ? '<span class="bc-sep"> › </span>' : ''}`
  ).join('');
}

const Editor = {
  loadFileTree, openFile, activateTab, closeTab,
  saveCurrentFile, runCurrentFile, renderTabs, getCurrentContent,
  init: async () => { await Promise.all([loadCodeMirror(), loadFileTree()]); },
};

window.Editor = Editor;
window.openFile = openFile;