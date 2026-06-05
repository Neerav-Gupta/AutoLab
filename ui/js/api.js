// API — all server calls go through here
const API = (() => {
  async function req(path, opts = {}) {
    const r = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || r.statusText);
    }
    return r.json();
  }

  return {
    status:       ()               => req('/api/status'),
    tasks:        ()               => req('/api/tasks'),
    task:         (id)             => req(`/api/tasks/${id}`),
    createTask:   (task, maxIter)  => req('/api/tasks', { method: 'POST', body: JSON.stringify({ task, max_iterations: maxIter }) }),
    cancelTask:   (id)             => req(`/api/tasks/${id}`, { method: 'DELETE' }),
    streamTask:   (id)             => new EventSource(`/api/tasks/${id}/stream`),

    files:        (path)           => req(`/api/files?path=${encodeURIComponent(path)}`),
    readFile:     (path)           => req(`/api/files/read?path=${encodeURIComponent(path)}`),
    writeFile:    (path, content)  => req('/api/files/write', { method: 'POST', body: JSON.stringify({ path, content }) }),
    deleteFile:   (path)           => req(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    searchFiles:  (query, path)    => req('/api/files/search', { method: 'POST', body: JSON.stringify({ query, path }) }),

    shell:        (command)        => req('/api/shell', { method: 'POST', body: JSON.stringify({ command }) }),
    chat:         (message, hist)  => req('/api/chat', { method: 'POST', body: JSON.stringify({ message, history: hist }) }),

    // New feature endpoints
    experiments:  ()               => req('/api/experiments'),
    gpu:          ()               => req('/api/gpu'),
    checkpoints:  ()               => req('/api/checkpoints'),
    deleteCheckpoint: (path)       => req(`/api/checkpoints?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    diff:         (path, orig, mod) => req('/api/diff', { method: 'POST', body: JSON.stringify({ path, original: orig, modified: mod }) }),
    autoInstall:  (traceback)      => req('/api/autoinstall', { method: 'POST', body: JSON.stringify({ command: traceback }) }),
  };
})();

window.API = API;