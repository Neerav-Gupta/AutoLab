// Feature 2: Diff viewer — show changes before applying AI edits

const Diff = {
  // Store original content before agent/chat modifies a file
  _originals: {},  // path → content

  snapshotFile(path, content) {
    this._originals[path] = content;
  },

  async showDiff(path, originalContent, modifiedContent) {
    try {
      const data = await API.diff(path, originalContent, modifiedContent);
      if (!data.diff || !data.diff.length) {
        toast('No changes detected', 'info');
        return;
      }
      this._renderDiffModal(path, data.diff, data.additions, data.deletions, modifiedContent);
    } catch(e) {
      toast(`Diff error: ${e.message}`, 'err');
    }
  },

  _renderDiffModal(path, diffLines, additions, deletions, modifiedContent) {
    const overlay = document.createElement('div');
    overlay.id = 'diff-modal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'z-index:300';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    const diffHtml = diffLines.map(line => {
      const safe = esc(line);
      if (line.startsWith('+++') || line.startsWith('---')) return `<div class="diff-header">${safe}</div>`;
      if (line.startsWith('@@'))  return `<div class="diff-hunk">${safe}</div>`;
      if (line.startsWith('+'))   return `<div class="diff-add">${safe}</div>`;
      if (line.startsWith('-'))   return `<div class="diff-del">${safe}</div>`;
      return `<div class="diff-ctx">${safe}</div>`;
    }).join('');

    overlay.innerHTML = `
      <div class="modal" style="max-width:780px;width:95vw">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <h2 style="margin:0;flex:1">Changes — ${esc(path.split('/').pop())}</h2>
          <span style="font-size:11px;color:var(--green)">+${additions}</span>
          <span style="font-size:11px;color:var(--red)">-${deletions}</span>
        </div>
        <div class="diff-view">${diffHtml}</div>
        <div class="modal-footer" style="margin-top:12px">
          <button class="btn btn-ghost" onclick="document.getElementById('diff-modal').remove()">Discard</button>
          <button class="btn btn-primary" onclick="Diff._applyAndClose('${esc(path)}', this)">Apply changes</button>
        </div>
      </div>`;

    overlay._modifiedContent = modifiedContent;
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); });
  },

  async _applyAndClose(path, btn) {
    const overlay = document.getElementById('diff-modal');
    if (!overlay) return;
    const content = overlay._modifiedContent;
    btn.disabled = true; btn.textContent = 'Applying…';
    try {
      await API.writeFile(path, content);
      // Update open tab if present
      const tab = State.openTabs.find(t => t.path === path);
      if (tab) {
        tab.content = content;
        tab.dirty = false;
        if (tab.cmView) {
          tab.cmView.dispatch({ changes: { from: 0, to: tab.cmView.state.doc.length, insert: content } });
        }
        Editor.renderTabs();
      }
      await Editor.loadFileTree();
      overlay.remove();
      toast(`Applied changes to ${path.split('/').pop()}`, 'ok');
    } catch(e) {
      toast(`Failed to apply: ${e.message}`, 'err');
      btn.disabled = false; btn.textContent = 'Apply changes';
    }
  },

  // Called from agent SSE stream when a write_file tool runs
  async onAgentFileWrite(path, newContent) {
    const original = this._originals[path];
    if (original !== undefined && original !== newContent) {
      await this.showDiff(path, original, newContent);
    } else if (original === undefined) {
      // New file created by agent — just refresh tree
      await Editor.loadFileTree();
    }
  },
};

window.Diff = Diff;