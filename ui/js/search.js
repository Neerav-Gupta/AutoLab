// File search — SSE streaming, results display as found

let _searchTimer = null;
let _activeSearch = null;   // current EventSource

async function searchFiles(query) {
  const results = document.getElementById('search-results');
  query = (query || '').trim();

  // Cancel any in-flight search
  if (_activeSearch) { _activeSearch.close(); _activeSearch = null; }
  clearTimeout(_searchTimer);

  if (query.length < 2) {
    results.innerHTML = '<div class="search-hint">Type at least 2 characters…</div>';
    return;
  }

  results.innerHTML = '<div class="search-hint">Searching…</div>';
  let count = 0;

  _searchTimer = setTimeout(() => {
    const url = `/api/files/search/stream?query=${encodeURIComponent(query)}`;
    const es = new EventSource(url);
    _activeSearch = es;

    es.onmessage = e => {
      const msg = JSON.parse(e.data);

      if (msg.type === 'result') {
        // Clear "Searching…" on first result
        if (count === 0) results.innerHTML = '';
        count++;
        const row = document.createElement('div');
        row.className = 'search-result';
        row.innerHTML = `
          <div class="search-result-name">
            <span>${fileIcon(msg.name)}</span>
            <span>${esc(msg.name)}</span>
            <span class="search-badge ${msg.match_type}">${msg.match_type}</span>
          </div>
          <div class="search-result-path">${esc(msg.path)}</div>
          ${msg.preview ? `<div class="search-result-preview">${esc(msg.preview)}</div>` : ''}`;
        row.onclick = () => {
          openFile(msg.path, msg.name);
          setSidebarView('explorer');
        };
        results.appendChild(row);
      }

      if (msg.type === 'done') {
        es.close();
        _activeSearch = null;
        if (count === 0) {
          results.innerHTML = `<div class="search-hint">No results for "${esc(query)}"</div>`;
        } else {
          const summary = document.createElement('div');
          summary.className = 'search-hint';
          summary.textContent = `${count} result${count !== 1 ? 's' : ''}`;
          results.insertBefore(summary, results.firstChild);
        }
      }

      if (msg.type === 'error') {
        es.close();
        _activeSearch = null;
        results.innerHTML = `<div class="search-hint" style="color:var(--red)">Error: ${esc(msg.message || 'Search failed')}</div>`;
      }
    };

    es.onerror = () => {
      es.close();
      _activeSearch = null;
      if (count === 0) {
        results.innerHTML = `<div class="search-hint" style="color:var(--red)">Search failed — check SSH connection</div>`;
      }
    };
  }, 300);
}

window.searchFiles = searchFiles;