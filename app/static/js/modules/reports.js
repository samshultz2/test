/**
 * LessonPay — modules/reports.js
 * Reports: Summary, Monthly, Subjects, Log + Settings.
 */

import {
  fmt, fmtShort, fmtDate, fmtMonth, escHtml, toast, currentMonth, addMonths
} from '../utils.js';

export class ReportsModule {
  constructor(container, api) {
    this.container = container;
    this.api = api;
    this._activeTab = 'summary';
    this._data = null;
    this._log = null;
  }

  async load() {
    this._renderLayout();
    await this._loadTab(this._activeTab);
  }

  _renderLayout() {
    this.container.innerHTML = `
      <div class="page-header flex justify-between" style="align-items:center">
        <div>
          <div class="page-title">Reports</div>
          <div class="page-subtitle">Analytics & Settings</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="reports-refresh-btn" title="Refresh">
          <i data-lucide="refresh-cw"></i>
        </button>
      </div>

      <!-- Tab bar -->
      <div class="tab-bar" id="reports-tab-bar">
        <button class="tab-btn ${this._activeTab === 'summary' ? 'active' : ''}" data-tab="summary">Summary</button>
        <button class="tab-btn ${this._activeTab === 'monthly' ? 'active' : ''}" data-tab="monthly">Monthly</button>
        <button class="tab-btn ${this._activeTab === 'subjects' ? 'active' : ''}" data-tab="subjects">Subjects</button>
        <button class="tab-btn ${this._activeTab === 'log' ? 'active' : ''}" data-tab="log">Log</button>
        <button class="tab-btn ${this._activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
      </div>

      <div id="reports-tab-content"></div>
    `;

    if (window.lucide) lucide.createIcons();

    document.getElementById('reports-tab-bar')?.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.tab;
        document.querySelectorAll('#reports-tab-bar .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._loadTab(this._activeTab);
      });
    });

    document.getElementById('reports-refresh-btn')?.addEventListener('click', async () => {
      this._data = null;
      this._log = null;
      await this._loadTab(this._activeTab);
    });
  }

  async _loadTab(tab) {
    const el = document.getElementById('reports-tab-content');
    if (!el) return;
    el.innerHTML = `<div class="empty-state"><i data-lucide="refresh-cw" class="spin"></i><div class="empty-state-text">Loading…</div></div>`;
    if (window.lucide) lucide.createIcons();

    try {
      switch (tab) {
        case 'summary': await this._renderSummary(el); break;
        case 'monthly': await this._renderMonthly(el); break;
        case 'subjects': await this._renderSubjects(el); break;
        case 'log': await this._renderLog(el); break;
        case 'settings': this._renderSettings(el); break;
      }
    } catch (e) {
      el.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-title">Error</div><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  // ── Summary Tab ────────────────────────────────────────────

  async _renderSummary(el) {
    if (!this._data) this._data = await this.api.getReports(currentMonth());
    const d = this._data || {};
    const items = d.summary || [];
    let sortKey = 'name';
    let sortDir = 1;

    const render = () => {
      const sorted = [...items].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'number') return (av - bv) * sortDir;
        return String(av || '').localeCompare(String(bv || '')) * sortDir;
      });

      el.innerHTML = `
        <div class="flex gap-2 mb-3">
          <select class="filter-select" id="summary-sort-key" style="flex:1">
            <option value="name" ${sortKey === 'name' ? 'selected' : ''}>Sort by Name</option>
            <option value="total_paid" ${sortKey === 'total_paid' ? 'selected' : ''}>Total Paid</option>
            <option value="total_owed" ${sortKey === 'total_owed' ? 'selected' : ''}>Total Owed</option>
            <option value="streak" ${sortKey === 'streak' ? 'selected' : ''}>Streak</option>
          </select>
          <button class="icon-btn" id="summary-sort-dir" title="Toggle direction">
            <i data-lucide="arrow-up-down"></i>
          </button>
        </div>
        ${sorted.length === 0 ? `<div class="empty-state"><i data-lucide="bar-chart-2"></i><div class="empty-state-text">No data available</div></div>` :
          sorted.map(s => `
            <div class="card mb-3">
              <div class="card-body" style="padding:12px 14px">
                <div class="flex justify-between mb-2" style="align-items:center">
                  <div>
                    <div class="fw-bold" style="font-size:14px">${escHtml(s.name)}</div>
                    <div class="text-xs text-muted">${escHtml(s.type === 'group' ? 'Group' : s.class_name || '')}</div>
                  </div>
                  <div class="flex gap-2">
                    ${s.streak > 0 ? `<div class="streak-badge"><i data-lucide="flame"></i> ${s.streak}</div>` : ''}
                    <span class="tag tag-${s.current_paid ? 'green' : 'red'}">${s.current_paid ? 'Paid' : 'Unpaid'}</span>
                  </div>
                </div>
                <div class="mini-kpi-row" style="grid-template-columns:repeat(3,1fr)">
                  <div class="mini-kpi"><div class="mini-kpi-val text-green">${fmtShort(s.total_paid || 0)}</div><div class="mini-kpi-lbl">Paid</div></div>
                  <div class="mini-kpi"><div class="mini-kpi-val text-red">${fmtShort(s.total_owed || 0)}</div><div class="mini-kpi-lbl">Owed</div></div>
                  <div class="mini-kpi"><div class="mini-kpi-val">${s.months_paid || 0}/${s.months_total || 0}</div><div class="mini-kpi-lbl">Months</div></div>
                </div>
                <div class="progress-wrap mt-2">
                  <div class="progress-bar ${(s.rate || 0) >= 80 ? 'good' : (s.rate || 0) >= 50 ? 'ok' : 'bad'}" style="width:${Math.min(100, s.rate || 0)}%"></div>
                </div>
              </div>
            </div>
          `).join('')
        }
      `;
      if (window.lucide) lucide.createIcons();

      document.getElementById('summary-sort-key')?.addEventListener('change', e => {
        sortKey = e.target.value;
        render();
      });
      document.getElementById('summary-sort-dir')?.addEventListener('click', () => {
        sortDir *= -1;
        render();
      });
    };

    render();
  }

  // ── Monthly Tab ────────────────────────────────────────────

  async _renderMonthly(el) {
    if (!this._data) this._data = await this.api.getReports(currentMonth());
    const d = this._data || {};
    const monthly = d.monthly || [];

    const totalAll = monthly.reduce((s, m) => s + (m.total || 0), 0);

    el.innerHTML = `
      <!-- Chart -->
      <div class="card mb-3">
        <div class="card-header"><span class="card-title"><i data-lucide="bar-chart-2"></i> Last 12 Months</span></div>
        <div class="card-body"><div class="chart-wrap" style="height:160px"><canvas id="monthly-chart"></canvas></div></div>
      </div>

      <!-- Summary -->
      <div class="kpi-grid mb-3">
        <div class="kpi-card blue">
          <div class="kpi-label">All-time Collected</div>
          <div class="kpi-value">${fmtShort(totalAll)}</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-label">Best Month</div>
          <div class="kpi-value">${fmtShort(Math.max(...monthly.map(m => m.total || 0), 0))}</div>
        </div>
      </div>

      <!-- Table -->
      <div class="card">
        <div class="card-header"><span class="card-title"><i data-lucide="calendar"></i> Monthly Breakdown</span></div>
        <div style="overflow-x:auto">
          <table class="report-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Total</th>
                <th>Cash</th>
                <th>Transfer</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              ${monthly.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-3)">No data</td></tr>` :
                monthly.map(m => `
                  <tr>
                    <td class="fw-bold">${fmtMonth(m.month)}</td>
                    <td class="text-green fw-bold">${fmt(m.total || 0)}</td>
                    <td class="text-muted">${fmt(m.cash || 0)}</td>
                    <td class="text-muted">${fmt(m.transfer || 0)}</td>
                    <td><span class="tag tag-blue">${m.count || 0}</span></td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();

    // Draw chart
    setTimeout(() => {
      const canvas = document.getElementById('monthly-chart');
      if (!canvas || !monthly.length) return;
      this._drawMonthlyChart(canvas, monthly.slice(-12));
    }, 50);
  }

  _drawMonthlyChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const labels = data.map(d => {
      const parts = (d.month || '').split('-');
      return parts[1] ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(parts[1]) - 1] : '';
    });
    const values = data.map(d => d.total || 0);
    const cashValues = data.map(d => d.cash || 0);
    const transferValues = data.map(d => d.transfer || 0);
    const max = Math.max(...values, 1);

    const W = canvas.offsetWidth || 300;
    const H = 140;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.clearRect(0, 0, W, H);

    const padL = 10, padR = 10, padT = 12, padB = 24;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const n = data.length;
    if (n === 0) return;

    const gap = 4;
    const barW = (chartW - gap * (n - 1)) / n;

    // Grid
    ctx.strokeStyle = 'rgba(30,58,95,0.6)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = padT + chartH - (chartH * i / 4);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    }

    values.forEach((val, i) => {
      const bH = Math.max(2, (val / max) * chartH);
      const cashH = Math.max(0, ((cashValues[i] || 0) / max) * chartH);
      const x = padL + i * (barW + gap);
      const y = padT + chartH - bH;

      // Transfer portion (blue)
      const transferH = bH - cashH;
      if (transferH > 0) {
        const grad = ctx.createLinearGradient(x, y, x, y + transferH);
        grad.addColorStop(0, 'rgba(167,139,250,0.8)');
        grad.addColorStop(1, 'rgba(14,165,233,0.3)');
        ctx.fillStyle = grad;
        const r = Math.min(4, barW / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.arcTo(x + barW, y, x + barW, y + r, r);
        ctx.lineTo(x + barW, y + transferH);
        ctx.lineTo(x, y + transferH);
        ctx.arcTo(x, y + r, x + r, y, r);
        ctx.closePath();
        ctx.fill();
      }

      // Cash portion (green)
      if (cashH > 0) {
        const cashY = padT + chartH - cashH;
        const grad2 = ctx.createLinearGradient(x, cashY, x, padT + chartH);
        grad2.addColorStop(0, 'rgba(52,211,153,0.85)');
        grad2.addColorStop(1, 'rgba(5,150,105,0.2)');
        ctx.fillStyle = grad2;
        ctx.beginPath();
        ctx.moveTo(x, cashY);
        ctx.lineTo(x + barW, cashY);
        ctx.lineTo(x + barW, padT + chartH);
        ctx.lineTo(x, padT + chartH);
        ctx.closePath();
        ctx.fill();
      }

      // Label
      ctx.fillStyle = 'rgba(122,156,192,0.8)';
      ctx.font = '500 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x + barW / 2, H - 6);
    });
  }

  // ── Subjects Tab ───────────────────────────────────────────

  async _renderSubjects(el) {
    if (!this._data) this._data = await this.api.getReports(currentMonth());
    const subjects = (this._data || {}).subjects || [];
    const total = subjects.reduce((s, x) => s + (x.amount || 0), 0);

    el.innerHTML = `
      <div class="kpi-card blue mb-3">
        <div class="kpi-label">Total Revenue</div>
        <div class="kpi-value">${fmtShort(total)}</div>
        <div class="kpi-sub">Across ${subjects.length} subject(s)</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title"><i data-lucide="bar-chart-2"></i> By Subject</span></div>
        <div class="card-body">
          ${subjects.length === 0 ? `<div class="empty-state"><i data-lucide="bar-chart-2"></i><div class="empty-state-text">No subject data</div></div>` :
            subjects.map(s => {
              const pct = total > 0 ? Math.round((s.amount / total) * 100) : 0;
              return `
                <div class="subject-row">
                  <div class="subject-row-header">
                    <span class="subject-row-name">${escHtml(s.subject || 'Other')}</span>
                    <span>
                      <span class="subject-row-amount">${fmt(s.amount || 0)}</span>
                      <span class="subject-row-pct">${pct}%</span>
                    </span>
                  </div>
                  <div class="progress-wrap">
                    <div class="progress-bar good" style="width:${pct}%"></div>
                  </div>
                  <div class="text-xs text-muted mt-1">${s.student_count || 0} student(s) · ${s.paid_count || 0} paid this month</div>
                </div>
              `;
            }).join('')
          }
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  // ── Log Tab ────────────────────────────────────────────────

  async _renderLog(el) {
    if (!this._log) this._log = await this.api.getActivityLog();
    const log = this._log || [];

    const colorMap = { pay: 'green', undo: 'yellow', add: 'blue', edit: 'blue', archive: 'red', restore: 'green', login: 'blue', hold: 'yellow', resume: 'green' };

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i data-lucide="clock"></i> Activity Log</span>
          <span class="count-badge">${log.length}</span>
        </div>
        <div class="card-body" style="padding:8px 16px">
          ${log.length === 0 ? `<div class="empty-state"><i data-lucide="clock"></i><div class="empty-state-text">No activity recorded</div></div>` :
            log.slice(0, 100).map(l => {
              const color = colorMap[l.action] || 'blue';
              return `
                <div class="log-item">
                  <div class="log-dot ${color}"></div>
                  <div class="log-text">${escHtml((l.entity_name ? l.entity_name + ': ' : '') + (l.action || '') + (l.details ? ' — ' + l.details : ''))}</div>
                  <div class="log-time">${fmtDate(l.created_at)}</div>
                </div>
              `;
            }).join('')
          }
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  // ── Settings Tab ───────────────────────────────────────────

  _renderSettings(el) {
    el.innerHTML = `
      <!-- Export / Backup -->
      <div class="section-title mb-2">Data Management</div>
      <div class="settings-card mb-3">
        <div class="settings-item" id="settings-export-csv">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:var(--green-a)"><i data-lucide="file-spreadsheet" style="color:var(--green)"></i></div>
            <div>
              <div class="settings-label">Export CSV</div>
              <div class="settings-sub">Download all payment data</div>
            </div>
          </div>
          <div class="settings-item-right"><i data-lucide="download"></i></div>
        </div>
        <div class="settings-item" id="settings-trigger-backup">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:var(--blue-a,rgba(56,189,248,.08))"><i data-lucide="hard-drive" style="color:var(--accent)"></i></div>
            <div>
              <div class="settings-label">Manual Backup</div>
              <div class="settings-sub" id="backup-status-text">Loading status…</div>
            </div>
          </div>
          <div class="settings-item-right"><i data-lucide="upload"></i></div>
        </div>
        <div class="settings-item" id="settings-print">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:var(--purple-a)"><i data-lucide="printer" style="color:var(--purple)"></i></div>
            <div>
              <div class="settings-label">Print Report</div>
              <div class="settings-sub">Print current view</div>
            </div>
          </div>
          <div class="settings-item-right"><i data-lucide="printer"></i></div>
        </div>
      </div>

      <!-- Security -->
      <div class="section-title mb-2">Security</div>
      <div class="settings-card mb-3">
        <div class="settings-item" id="settings-change-password">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:var(--yellow-a)"><i data-lucide="shield" style="color:var(--yellow)"></i></div>
            <div>
              <div class="settings-label">Change Password</div>
              <div class="settings-sub">Update your login password</div>
            </div>
          </div>
          <div class="settings-item-right"><i data-lucide="chevron-right"></i></div>
        </div>
        <div class="settings-item" id="settings-change-pin">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:var(--orange-a)"><i data-lucide="key" style="color:var(--orange)"></i></div>
            <div>
              <div class="settings-label">Change PIN</div>
              <div class="settings-sub">Update your 4-digit PIN</div>
            </div>
          </div>
          <div class="settings-item-right"><i data-lucide="chevron-right"></i></div>
        </div>
        <div class="settings-item" id="settings-logout">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:var(--red-a)"><i data-lucide="lock" style="color:var(--red)"></i></div>
            <div>
              <div class="settings-label">Lock Now</div>
              <div class="settings-sub">Lock the app immediately</div>
            </div>
          </div>
          <div class="settings-item-right"><i data-lucide="chevron-right"></i></div>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();

    // Load backup status
    this.api.getBackupStatus().then(s => {
      const el = document.getElementById('backup-status-text');
      if (el) el.textContent = s && s.last_backup ? `Last: ${fmtDate(s.last_backup)}` : 'Never backed up';
    }).catch(() => {});

    document.getElementById('settings-export-csv')?.addEventListener('click', () => this._exportCsv());
    document.getElementById('settings-trigger-backup')?.addEventListener('click', () => this._triggerBackup());
    document.getElementById('settings-print')?.addEventListener('click', () => window.print());
    document.getElementById('settings-change-password')?.addEventListener('click', () => this._openChangePassword());
    document.getElementById('settings-change-pin')?.addEventListener('click', () => this._openChangePin());
    document.getElementById('settings-logout')?.addEventListener('click', () => { window.app.lock(); });
  }

  _exportCsv() {
    const url = this.api.exportCsv();
    const a = document.createElement('a');
    a.href = url;
    a.download = `lessonpay-export-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('CSV download started', 'success');
  }

  async _triggerBackup() {
    try {
      await this.api.triggerBackup();
      toast('Backup completed', 'success');
      const el = document.getElementById('backup-status-text');
      if (el) el.textContent = `Last: ${new Date().toLocaleDateString()}`;
    } catch (e) { toast(e.message, 'error'); }
  }

  _openChangePassword() {
    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="shield"></i> Change Password</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div class="form-group">
          <label class="form-label">Current Password</label>
          <input class="form-input" id="cp-current" type="password" placeholder="Current password">
        </div>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input class="form-input" id="cp-new" type="password" placeholder="New password (min 6 chars)">
        </div>
        <div class="form-group">
          <label class="form-label">Confirm New Password</label>
          <input class="form-input" id="cp-confirm" type="password" placeholder="Repeat new password">
        </div>
        <div id="cp-error" class="text-red text-xs" style="min-height:16px"></div>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost flex-1" onclick="window.app.closeDrawer()">Cancel</button>
        <button class="btn btn-primary flex-1" id="cp-save"><i data-lucide="shield"></i> Update</button>
      </div>
    `);
    if (window.lucide) lucide.createIcons();

    document.getElementById('cp-save')?.addEventListener('click', async () => {
      const cur = document.getElementById('cp-current')?.value;
      const nw = document.getElementById('cp-new')?.value;
      const cn = document.getElementById('cp-confirm')?.value;
      const errEl = document.getElementById('cp-error');
      if (!cur || !nw) { if (errEl) errEl.textContent = 'All fields are required'; return; }
      if (nw !== cn) { if (errEl) errEl.textContent = 'Passwords do not match'; return; }
      if (nw.length < 6) { if (errEl) errEl.textContent = 'Password must be at least 6 characters'; return; }
      try {
        await this.api.changePassword({ current_password: cur, new_password: nw });
        toast('Password changed successfully', 'success');
        window.app.closeDrawer();
      } catch (e) {
        if (errEl) errEl.textContent = e.message;
      }
    });
  }

  _openChangePin() {
    let pinBuffer = '';
    let newPin = '';
    let step = 'enter'; // 'enter' | 'confirm'

    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="key"></i> Change PIN</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body" style="text-align:center">
        <div id="pin-change-title" class="text-muted mb-3" style="font-size:14px">Enter new 4-digit PIN</div>
        <div class="pin-display" id="pin-change-dots">
          ${Array(4).fill('<div class="pin-dot"></div>').join('')}
        </div>
        <div id="pin-change-error" class="text-red text-xs mb-3" style="min-height:16px"></div>
        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9,'clear',0,'enter'].map(k => {
            const val = k === 'clear' ? 'clear' : k === 'enter' ? 'enter' : String(k);
            const cls = k === 'clear' ? 'clear' : k === 'enter' ? 'enter' : '';
            return `<button class="pin-key ${cls}" data-pval="${val}">${k === 'clear' ? '⌫' : k === 'enter' ? '→' : k}</button>`;
          }).join('')}
        </div>
      </div>
    `);
    if (window.lucide) lucide.createIcons();

    const updateDots = () => {
      document.querySelectorAll('#pin-change-dots .pin-dot').forEach((d, i) => {
        d.classList.toggle('filled', i < pinBuffer.length);
      });
    };

    document.querySelectorAll('[data-pval]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const v = btn.dataset.pval;
        const errEl = document.getElementById('pin-change-error');
        if (v === 'clear') { pinBuffer = pinBuffer.slice(0, -1); }
        else if (v === 'enter') {
          if (pinBuffer.length !== 4) return;
          if (step === 'enter') {
            newPin = pinBuffer;
            pinBuffer = '';
            step = 'confirm';
            const title = document.getElementById('pin-change-title');
            if (title) title.textContent = 'Confirm new PIN';
            if (errEl) errEl.textContent = '';
          } else {
            if (pinBuffer !== newPin) {
              if (errEl) errEl.textContent = 'PINs do not match. Try again.';
              pinBuffer = ''; newPin = ''; step = 'enter';
              const title = document.getElementById('pin-change-title');
              if (title) title.textContent = 'Enter new 4-digit PIN';
            } else {
              try {
                await this.api.changePin({ new_pin: newPin });
                toast('PIN changed successfully', 'success');
                window.app.closeDrawer();
              } catch (e) {
                if (errEl) errEl.textContent = e.message;
              }
              return;
            }
          }
        } else {
          if (pinBuffer.length >= 4) return;
          pinBuffer += v;
          if (pinBuffer.length === 4 && step === 'enter') {
            setTimeout(() => {
              newPin = pinBuffer;
              pinBuffer = '';
              step = 'confirm';
              const title = document.getElementById('pin-change-title');
              if (title) title.textContent = 'Confirm new PIN';
              updateDots();
            }, 200);
            updateDots();
            return;
          }
        }
        if (errEl && v !== 'enter') errEl.textContent = '';
        updateDots();
      });
    });
  }
}
