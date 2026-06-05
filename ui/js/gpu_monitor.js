// Feature 3: GPU live monitor — sparkline in status bar + detail panel

const GpuMonitor = {
  _history: [],      // [{util, memUsed, memTotal, temp, time}]
  _interval: null,
  _visible: false,
  MAX_POINTS: 60,    // 60 seconds of history

  start() {
    this._poll();
    this._interval = setInterval(() => this._poll(), 4000);
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  },

  async _poll() {
    try {
      const data = await API.gpu();
      if (!data.available || !data.gpus.length) {
        this._updateStatusBar(null);
        return;
      }
      const gpu = data.gpus[0]; // primary GPU
      const point = {
        util: gpu.util,
        memUsed: gpu.mem_used,
        memTotal: gpu.mem_total,
        temp: gpu.temp,
        power: gpu.power,
        name: gpu.name,
        time: Date.now(),
      };
      this._history.push(point);
      if (this._history.length > this.MAX_POINTS) this._history.shift();
      this._updateStatusBar(point);
      if (this._visible) this._updateDetailPanel();
    } catch { /* SSH not connected yet */ }
  },

  _updateStatusBar(point) {
    const el = document.getElementById('gpu-status-item');
    if (!el) return;
    if (!point) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    const memPct = point.memTotal ? Math.round(point.memUsed / point.memTotal * 100) : 0;
    const color = point.util > 80 ? 'var(--green)' : point.util > 30 ? 'var(--accent)' : 'var(--fg-muted)';
    el.innerHTML = `
      <svg id="gpu-sparkline" width="36" height="14" viewBox="0 0 36 14" style="flex-shrink:0">${this._sparkline()}</svg>
      <span style="color:${color};font-family:var(--font-mono)">${point.util}%</span>
      <span style="color:var(--fg-dim);font-size:10px">${point.memUsed}/${point.memTotal}MB</span>`;
  },

  _sparkline() {
    if (this._history.length < 2) return '';
    const pts = this._history.slice(-36);
    const maxUtil = 100;
    const W = 36, H = 14;
    const xs = pts.map((_, i) => Math.round(i / (pts.length - 1) * W));
    const ys = pts.map(p => Math.round(H - (p.util / maxUtil) * H));
    const path = pts.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i]},${ys[i]}`).join(' ');
    return `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>`;
  },

  showPanel() {
    this._visible = true;
    const overlay = document.createElement('div');
    overlay.id = 'gpu-panel';
    overlay.className = 'modal-overlay';
    overlay.onclick = e => { if (e.target === overlay) this.hidePanel(); };

    overlay.innerHTML = `
      <div class="modal" style="max-width:500px">
        <div style="display:flex;align-items:center;margin-bottom:14px">
          <h2 style="flex:1;margin:0">GPU Monitor</h2>
          <button class="btn btn-ghost" style="padding:3px 8px" onclick="GpuMonitor.hidePanel()">Close</button>
        </div>
        <div id="gpu-detail-body">Loading…</div>
      </div>`;

    document.body.appendChild(overlay);
    this._updateDetailPanel();
  },

  hidePanel() {
    this._visible = false;
    document.getElementById('gpu-panel')?.remove();
  },

  _updateDetailPanel() {
    const el = document.getElementById('gpu-detail-body');
    if (!el) return;
    const latest = this._history.at(-1);
    if (!latest) { el.innerHTML = '<div style="color:var(--fg-dim);font-size:12px">No GPU data available</div>'; return; }

    const memPct = latest.memTotal ? (latest.memUsed / latest.memTotal * 100).toFixed(1) : 0;
    const pts = this._history.slice(-60);
    const W = 440, H = 80;
    const xs = pts.map((_, i) => Math.round(i / Math.max(pts.length - 1, 1) * W));

    function polyline(getter, color) {
      const ys = pts.map(p => Math.round(H - (getter(p) / 100) * H));
      const d = pts.map((_, i) => `${i===0?'M':'L'}${xs[i]},${ys[i]}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
    }

    const utilPts = polyline(p => p.util, 'var(--accent)');
    const memPts  = polyline(p => latest.memTotal ? p.memUsed/latest.memTotal*100 : 0, 'var(--blue)');

    el.innerHTML = `
      <div style="font-size:12px;color:var(--fg-muted);margin-bottom:10px">${esc(latest.name)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
        ${[
          ['GPU Util', `${latest.util}%`, 'var(--accent)'],
          ['VRAM', `${latest.memUsed}/${latest.memTotal} MB`, 'var(--blue)'],
          ['Temp', `${latest.temp}°C`, latest.temp > 80 ? 'var(--red)' : 'var(--green)'],
          ['Power', `${latest.power}W`, 'var(--fg-muted)'],
          ['VRAM %', `${memPct}%`, 'var(--fg-muted)'],
          ['Samples', `${this._history.length}`, 'var(--fg-dim)'],
        ].map(([label, val, color]) => `
          <div style="background:var(--bg-input);padding:8px;border-radius:3px;border:1px solid var(--border2)">
            <div style="font-size:10px;color:var(--fg-dim);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px">${label}</div>
            <div style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:${color}">${val}</div>
          </div>`).join('')}
      </div>
      <div style="background:var(--bg-editor);border:1px solid var(--border2);border-radius:3px;padding:8px">
        <div style="font-size:10px;color:var(--fg-dim);margin-bottom:6px;display:flex;gap:12px">
          <span style="color:var(--accent)">— GPU utilization</span>
          <span style="color:var(--blue)">— VRAM usage</span>
        </div>
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
          <!-- Grid lines -->
          ${[0,25,50,75,100].map(pct => {
            const y = Math.round(H - pct/100*H);
            return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>
                    <text x="2" y="${y-2}" font-size="8" fill="var(--fg-dim)">${pct}%</text>`;
          }).join('')}
          ${utilPts}${memPts}
        </svg>
      </div>`;
  },
};

window.GpuMonitor = GpuMonitor;