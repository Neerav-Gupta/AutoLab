// AI Chat — tool-use assistant that can read/write files and run commands

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(text) {
  text = text.replace(/```(\w*)\n?([\s\S]+?)```/g, (_, lang, code) => {
    const l = (lang || '').toLowerCase();
    const isRunnable = ['python','py','bash','sh',''].includes(l);
    const safeCode = esc(code.trimEnd());
    const rawCode  = code.trimEnd();
    const safeLang = esc(lang || '');
    // Embed raw code as data attribute for action buttons
    const encoded  = btoa(unescape(encodeURIComponent(rawCode))).replace(/"/g, '&quot;');
    return `<div class="code-block">
      <div class="code-block-header">
        <span class="code-lang">${safeLang || 'code'}</span>
        <div style="display:flex;gap:4px">
          ${isRunnable ? `<button class="code-btn run" onclick="Chat.runFromBtn(this)" data-code="${encoded}" data-lang="${safeLang}">&#9654; Run</button>` : ''}
          <button class="code-btn copy" onclick="Chat.copyFromBtn(this)" data-code="${encoded}">Copy</button>
          <button class="code-btn save" onclick="Chat.saveFromBtn(this)" data-code="${encoded}" data-lang="${safeLang}">Save</button>
        </div>
      </div>
      <pre data-lang="${safeLang}">${safeCode}</pre>
    </div>`;
  });
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>');
  text = text.replace(/^## (.+)$/gm,  '<div class="md-h2">$1</div>');
  text = text.replace(/^# (.+)$/gm,   '<div class="md-h1">$1</div>');
  text = text.replace(/^[-*] (.+)$/gm, '<div class="md-li">$1</div>');
  text = text.replace(/^\d+\. (.+)$/gm,'<div class="md-li">$1</div>');
  text = text.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border2);margin:8px 0">');
  text = text.replace(/\n/g, '<br>');
  return text;
}

function decodeCode(encoded) {
  try { return decodeURIComponent(escape(atob(encoded))); } catch { return ''; }
}

// ── Append messages ───────────────────────────────────────────────────────────

function appendMsg(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = role === 'user' ? esc(content).replace(/\n/g,'<br>') : renderMarkdown(content);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  // Track last code block
  const m = content.match(/```(?:\w+)?\n?([\s\S]+?)```/g);
  if (m) {
    const last = m[m.length-1].replace(/^```\w*\n?/,'').replace(/```$/,'');
    const lang = (m[m.length-1].match(/^```(\w+)/)||[])[1]||'';
    State.lastCodeBlock = { code: last, lang };
  }
}

// ── Context builder ───────────────────────────────────────────────────────────

async function buildContextualMessage(userMsg) {
  const lower = userMsg.toLowerCase();
  let ctx = '';

  // Auto-attach current file when message references it
  const fileWords = ['this file','current file','fix','explain','refactor','debug',
                     'review','improve','rewrite','complete','what does','edit','update','change'];
  if (fileWords.some(w => lower.includes(w)) && State.activeTab) {
    const content = Editor.getCurrentContent();
    const trunc = content.length > 8000 ? content.slice(0,8000)+'\n…(truncated)' : content;
    ctx += `\n\n[Current file: ${State.activeTab}]\n\`\`\`${detectLang(State.activeTab)}\n${trunc}\n\`\`\``;
  }

  // Explicit file read
  const readMatch = userMsg.match(/read\s+(?:file\s+)?([\/\w.\-_]+\.[\w]+)/i);
  if (readMatch) {
    try {
      const d = await API.readFile(readMatch[1]);
      const trunc = d.content.length > 4000 ? d.content.slice(0,4000)+'\n…' : d.content;
      ctx += `\n\n[File: ${readMatch[1]}]\n\`\`\`${detectLang(readMatch[1])}\n${trunc}\n\`\`\``;
    } catch {}
  }

  // Workspace listing
  if (['workspace','what files','list files','directory'].some(w=>lower.includes(w))) {
    try {
      const d = await API.files('/workspace');
      const names = [...d.dirs.map(x=>'[dir] '+x.name), ...d.files.map(x=>x.name)].join('\n');
      ctx += `\n\n[Workspace /workspace]\n${names}`;
    } catch {}
  }

  // GPU info
  if (['gpu','vram','cuda','nvidia','memory'].some(w=>lower.includes(w))) {
    try {
      const d = await API.shell('nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null || echo "No GPU"');
      ctx += `\n\n[GPU]\n${d.stdout}`;
    } catch {}
  }

  return userMsg + ctx;
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.style.height = '';

  appendMsg('user', msg);
  const fullMsg = await buildContextualMessage(msg);
  State.chatHistory.push({ role: 'user', content: fullMsg });

  const container = document.getElementById('chat-messages');
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(typing);
  container.scrollTop = container.scrollHeight;

  document.getElementById('chat-send-btn').disabled = true;

  try {
    const data = await API.chat(fullMsg, State.chatHistory.slice(0,-1));
    typing.remove();
    const reply = data.reply || 'No response';
    State.chatHistory.push({ role: 'assistant', content: reply });
    appendMsg('assistant', reply);

    // Auto-detect file write instructions and offer button
    _offerFileActions(reply, container);
  } catch(e) {
    typing.remove();
    appendMsg('assistant', `Error: ${e.message}`);
  }

  document.getElementById('chat-send-btn').disabled = false;
  document.getElementById('chat-input').focus();
}

// If the AI mentions saving to a specific path, surface a quick-save button
function _offerFileActions(reply, container) {
  const pathMatch = reply.match(/(?:save|write|create)\s+(?:to\s+)?[`'"]?(\/workspace\/[\w\/.\-_]+\.\w+)[`'"]?/i);
  if (!pathMatch || !State.lastCodeBlock) return;
  const path = pathMatch[1];
  const banner = document.createElement('div');
  banner.className = 'chat-action-banner';
  banner.innerHTML = `
    <span style="font-size:11px;color:var(--fg-muted)">Save to <code>${esc(path)}</code>?</span>
    <button class="code-btn save" onclick="Chat.saveToPath('${esc(path)}',this.closest('.chat-action-banner'))">Save</button>
    <button class="code-btn" onclick="this.closest('.chat-action-banner').remove()">Dismiss</button>`;
  container.appendChild(banner);
  container.scrollTop = container.scrollHeight;
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  e.target.style.height = '';
  e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
}

// ── Code block actions ────────────────────────────────────────────────────────

const Chat = {
  runFromBtn(btn) {
    const code = decodeCode(btn.dataset.code);
    const lang = btn.dataset.lang || '';
    this.execCode(code, lang);
  },

  copyFromBtn(btn) {
    const code = decodeCode(btn.dataset.code);
    navigator.clipboard.writeText(code).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = orig, 1500);
    });
  },

  saveFromBtn(btn) {
    const code = decodeCode(btn.dataset.code);
    const lang = btn.dataset.lang || '';

    if (State.activeTab) {
      // Save to open file
      const tab = State.openTabs.find(t => t.path === State.activeTab);
      const fileName = State.activeTab.split('/').pop();
      showModal({
        title: 'Save code',
        fields: [],
        confirmLabel: `Replace ${fileName}`,
        onConfirm: () => this._applyToEditor(code),
      });
    } else {
      // No file open — prompt for path
      showModal({
        title: 'Save code to file',
        fields: [{ id: 'path', label: 'File path', placeholder: '/workspace/script.py', value: lang==='python'||lang==='py' ? '/workspace/script.py' : '/workspace/output.txt' }],
        confirmLabel: 'Save',
        onConfirm: async ({ path }) => {
          if (!path) return;
          try {
            await API.writeFile(path, code);
            await Editor.loadFileTree();
            Editor.openFile(path, path.split('/').pop());
            toast(`Saved to ${path}`, 'ok');
          } catch(e) { toast(e.message, 'err'); }
        },
      });
    }
  },

  _applyToEditor(code) {
    const tab = State.openTabs.find(t => t.path === State.activeTab);
    if (!tab) return;
    if (tab.cmView) {
      tab.cmView.dispatch({
        changes: { from: 0, to: tab.cmView.state.doc.length, insert: code }
      });
    } else {
      // Textarea fallback
      const cid = 'cm_' + State.activeTab.replace(/[^a-zA-Z0-9]/g,'_');
      const ta = document.getElementById(cid)?.querySelector('textarea');
      if (ta) { ta.value = code; ta.dispatchEvent(new Event('input')); }
    }
    tab.dirty = true;
    Editor.renderTabs();
    toast('Code applied to editor', 'ok');
  },

  async saveToPath(path, banner) {
    if (!State.lastCodeBlock) return;
    try {
      await API.writeFile(path, State.lastCodeBlock.code);
      await Editor.loadFileTree();
      Editor.openFile(path, path.split('/').pop());
      if (banner) banner.remove();
      toast(`Saved to ${path}`, 'ok');
    } catch(e) { toast(e.message, 'err'); }
  },

  async execCode(code, lang = '') {
    const isPython = ['python','py'].includes(lang.toLowerCase()) ||
      (!lang && (code.includes('import ') || code.includes('def ') || code.includes('print(')));
    if (isPython) {
      const path = `/tmp/chat_${Date.now()}.py`;
      try {
        await API.writeFile(path, code);
        TermManager.send(`python ${path}\r`);
        toast('Running in terminal…', 'info');
      } catch(e) { toast(e.message, 'err'); }
    } else {
      const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      if (typeof _panelVisible !== 'undefined' && !_panelVisible) togglePanel();
      switchPanelTab('terminal');
      lines.forEach((line, i) => setTimeout(() => TermManager.send(line + '\r'), i * 80));
    }
  },

  runLast() {
    if (!State.lastCodeBlock) { toast('No code block in chat yet', 'info'); return; }
    this.execCode(State.lastCodeBlock.code, State.lastCodeBlock.lang || '');
  },

  async addFileContext() {
    if (!State.activeTab) { toast('No file open', 'info'); return; }
    const content = Editor.getCurrentContent();
    const name = State.activeTab.split('/').pop();
    const input = document.getElementById('chat-input');
    const snippet = `Here is ${name}:\n\`\`\`${detectLang(State.activeTab)}\n${content.slice(0,4000)}\n\`\`\`\n\n`;
    input.value = snippet + input.value;
    input.focus();
    toast(`Added ${name} to message`, 'ok');
  },

  createTaskFromChat() {
    const last = [...State.chatHistory].reverse().find(m => m.role === 'user');
    if (!last) { toast('No conversation yet', 'info'); return; }
    openNewTaskModal();
    setTimeout(() => {
      const el = document.getElementById('nti-task');
      if (el) el.value = last.content.split('\n')[0].slice(0,200);
    }, 50);
  },

  clear() {
    State.chatHistory = [];
    State.lastCodeBlock = null;
    document.getElementById('chat-messages').innerHTML = '';
    toast('Chat cleared', 'ok');
  },
};

window.Chat = Chat;
window.sendChat = sendChat;
window.handleChatKey = handleChatKey;