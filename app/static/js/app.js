/**
 * LessonPay — app.js
 * Main application entry point.
 */

import { api } from './api.js';
import { toast, fmt, fmtMonth, escHtml, today, todayLocal, currentMonth, initials, avatarColor } from './utils.js';
import { AuthModule }       from './modules/auth.js';
import { DashboardModule }  from './modules/dashboard.js';
import { StudentsModule }   from './modules/students.js';
import { PaymentsModule }   from './modules/payments.js';
import { GroupsModule }     from './modules/groups.js';
import { ReportsModule }    from './modules/reports.js';
import { AttendanceModule } from './modules/attendance.js';

// ── Auto-lock timer ────────────────────────────────────────

const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 minutes

class App {
  constructor() {
    this.modules = {};
    this.currentPage = 'dashboard';
    this._lockTimer = null;
    this._drawerOpen = false;
  }

  // ── Initialization ─────────────────────────────────────────

  async init() {
    // Instantiate auth module first
    this.modules.auth = new AuthModule(api);
    this.modules.auth.init();
    this.modules.auth.onAuthenticated = (mode) => {
      if (mode === 'login') {
        this._afterLogin();
      }
      this._resetLockTimer();
    };

    // Listen for auth:required
    document.addEventListener('auth:required', () => {
      this.modules.auth.showLogin();
    });

    // Check auth status
    const authenticated = await this.modules.auth.checkStatus();

    if (!authenticated) {
      this.modules.auth.showLogin();
      return;
    }

    this._afterLogin();
  }

  _afterLogin() {
    this._initModules();
    this._setupNav();
    this._setupFAB();
    this._setupLockButton();
    this._setupSyncButton();
    this._setupDrawer();
    this.setupAutoLock();
    this.navigate(this.currentPage);
  }

  _initModules() {
    this.modules.dashboard  = new DashboardModule(document.getElementById('page-dashboard'), api);
    this.modules.students   = new StudentsModule(document.getElementById('page-students'), api);
    this.modules.payments   = new PaymentsModule(document.getElementById('page-payments'), api);
    this.modules.groups     = new GroupsModule(document.getElementById('page-groups'), api);
    this.modules.reports    = new ReportsModule(document.getElementById('page-reports'), api);
    this.modules.attendance = new AttendanceModule(document.getElementById('page-attendance'), api);

    // Archive & Timetable use inline rendering (see navigate)
    this._archiveContainer   = document.getElementById('page-archive');
    this._timetableContainer = document.getElementById('page-timetable');
  }

  // ── Navigation ─────────────────────────────────────────────

  _setupNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.page));
    });
  }

  navigate(page) {
    this.currentPage = page;

    // Update nav items
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Show/hide page sections
    document.querySelectorAll('.page-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `page-${page}`);
    });

    // FAB visibility
    const fabPages = ['students', 'payments', 'groups'];
    const fab = document.getElementById('fab-add');
    if (fab) fab.classList.toggle('hidden', !fabPages.includes(page));

    // Load page data
    switch (page) {
      case 'dashboard':
        this.modules.dashboard?.load();
        break;
      case 'students':
        this.modules.students?.load();
        break;
      case 'payments':
        this.modules.payments?.load();
        break;
      case 'groups':
        this.modules.groups?.load();
        break;
      case 'reports':
        this.modules.reports?.load();
        break;
      case 'attendance':
        this.modules.attendance?.load();
        break;
      case 'archive':
        this._loadArchive();
        break;
      case 'timetable':
        this._loadTimetable();
        break;
    }
  }

  // ── Archive page ───────────────────────────────────────────

  async _loadArchive() {
    const el = this._archiveContainer;
    if (!el) return;
    el.innerHTML = `
      <div class="page-header flex justify-between" style="align-items:center">
        <div>
          <div class="page-title">Archive</div>
          <div class="page-subtitle">Archived students</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.app.navigate('students')">
          <i data-lucide="arrow-left"></i> Back
        </button>
      </div>
      <div id="archive-list"><div class="empty-state"><i data-lucide="refresh-cw" class="spin"></i><div class="empty-state-text">Loading…</div></div></div>
    `;
    if (window.lucide) lucide.createIcons();

    try {
      const archived = await api.getArchive();
      const listEl = document.getElementById('archive-list');
      if (!listEl) return;

      if (!archived || archived.length === 0) {
        listEl.innerHTML = `<div class="empty-state"><i data-lucide="archive"></i><div class="empty-state-title">Archive is empty</div><div class="empty-state-text">Archived students appear here.</div></div>`;
      } else {
        listEl.innerHTML = archived.map(s => `
          <div class="archive-item">
            <div class="avatar avatar-sm" style="background:${avatarColor(s.name)}">${initials(s.name)}</div>
            <div class="archive-info">
              <div class="archive-name">${escHtml(s.name)}</div>
              <div class="archive-meta">${escHtml(s.class_name || '')} · Archived ${s.archived_at ? new Date(s.archived_at).toLocaleDateString() : ''}</div>
            </div>
            <button class="btn btn-ghost btn-xs" onclick="window.app.restoreStudent(${s.id}, '${escHtml(s.name)}')">
              <i data-lucide="undo-2"></i> Restore
            </button>
          </div>
        `).join('');
      }
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      document.getElementById('archive-list').innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  async restoreStudent(id, name) {
    try {
      await api.restoreStudent(id);
      toast(`${name} restored`, 'success');
      this._loadArchive();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Timetable page ─────────────────────────────────────────

  async _loadTimetable() {
    const el = this._timetableContainer;
    if (!el) return;
    el.innerHTML = `
      <div class="page-header flex justify-between" style="align-items:center">
        <div>
          <div class="page-title">Timetable</div>
          <div class="page-subtitle">Lesson schedule</div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" onclick="window.app.navigate('students')">
            <i data-lucide="arrow-left"></i> Back
          </button>
          <button class="btn btn-primary btn-sm" id="tt-add-slot-btn">
            <i data-lucide="plus"></i> Add Slot
          </button>
        </div>
      </div>
      <!-- Day filter -->
      <div class="filter-row" id="tt-day-filter">
        ${['All','Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i) => `
          <button class="btn btn-ghost btn-sm ${i === 0 ? 'btn-primary' : ''}" data-day="${d}" onclick="window.app._filterTimetable('${d}', this)">${d}</button>
        `).join('')}
      </div>
      <div id="timetable-slots"><div class="empty-state"><i data-lucide="refresh-cw" class="spin"></i><div class="empty-state-text">Loading…</div></div></div>
    `;
    if (window.lucide) lucide.createIcons();

    document.getElementById('tt-add-slot-btn')?.addEventListener('click', () => this._openTimetableForm());

    try {
      const slots = await api.getTimetable();
      this._timetableData = slots || [];
      this._renderTimetable(this._timetableData);
    } catch (e) {
      document.getElementById('timetable-slots').innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  _filterTimetable(day, btn) {
    document.querySelectorAll('#tt-day-filter button').forEach(b => {
      b.className = b.className.replace('btn-primary', '').trim() + (b === btn ? ' btn-primary' : '');
    });
    const filtered = day === 'All' ? this._timetableData : (this._timetableData || []).filter(s => s.day === day);
    this._renderTimetable(filtered);
  }

  _renderTimetable(slots) {
    const el = document.getElementById('timetable-slots');
    if (!el) return;
    if (!slots || slots.length === 0) {
      el.innerHTML = `<div class="empty-state"><i data-lucide="calendar-days"></i><div class="empty-state-title">No slots</div><div class="empty-state-text">Add lesson slots to your timetable.</div></div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }
    const dayOrder = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };
    const sorted = [...slots].sort((a, b) => {
      const dDiff = (dayOrder[a.day] ?? 7) - (dayOrder[b.day] ?? 7);
      return dDiff !== 0 ? dDiff : (a.time || '').localeCompare(b.time || '');
    });
    el.innerHTML = `<div class="timetable-grid">${sorted.map(s => `
      <div class="timetable-slot">
        <div class="slot-time">${escHtml(s.day || '')} ${escHtml(s.time || '')}</div>
        <div class="slot-info">
          <div class="slot-name">${escHtml(s.student_name || s.name || '')}</div>
          <div class="slot-meta">${escHtml(s.subject || '')} ${s.class_name ? '· ' + escHtml(s.class_name) : ''}</div>
        </div>
        <button class="icon-btn" onclick="window.app._deleteTimetableSlot(${s.id})" title="Delete">
          <i data-lucide="x"></i>
        </button>
      </div>
    `).join('')}</div>`;
    if (window.lucide) lucide.createIcons();
  }

  async _deleteTimetableSlot(id) {
    if (!confirm('Remove this timetable slot?')) return;
    try {
      await api.deleteTimetableSlot(id);
      toast('Slot removed', 'info');
      this._loadTimetable();
    } catch (e) { toast(e.message, 'error'); }
  }

  async _openTimetableForm() {
    let students = [];
    try { students = await api.getStudents(); } catch (_) {}

    this.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="calendar-days"></i> Add Timetable Slot</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div class="form-group">
          <label class="form-label">Student</label>
          <select class="form-select" id="tt-student">
            <option value="">Select student…</option>
            ${students.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Day</label>
            <select class="form-select" id="tt-day">
              ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<option>${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Time</label>
            <input class="form-input" id="tt-time" type="time" value="09:00">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" id="tt-notes" placeholder="Optional notes">
        </div>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost flex-1" onclick="window.app.closeDrawer()">Cancel</button>
        <button class="btn btn-primary flex-1" id="tt-save-btn"><i data-lucide="plus"></i> Add Slot</button>
      </div>
    `);
    if (window.lucide) lucide.createIcons();

    document.getElementById('tt-save-btn')?.addEventListener('click', async () => {
      const studentId = document.getElementById('tt-student')?.value;
      const day = document.getElementById('tt-day')?.value;
      const time = document.getElementById('tt-time')?.value;
      if (!studentId) { toast('Select a student', 'error'); return; }
      try {
        await api.createTimetableSlot({ student_id: parseInt(studentId), day, time, notes: document.getElementById('tt-notes')?.value });
        toast('Slot added', 'success');
        this.closeDrawer();
        this._loadTimetable();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ── Payment Form (shared drawer) ───────────────────────────

  openPaymentForm({ studentId, groupId, paymentId, name, amount, month, isGroup }) {
    const titleName = name || 'Payment';

    this.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="check-circle"></i> Mark Paid</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div class="kpi-card green mb-3">
          <div class="kpi-label">${isGroup ? 'Group' : 'Student'}</div>
          <div class="kpi-value" style="font-size:16px">${escHtml(titleName)}</div>
          <div class="kpi-sub">${fmtMonth(month || currentMonth())}</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Amount (₦)</label>
            <input class="form-input" id="pf-amount" type="number" min="0" value="${amount || ''}" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">Period</label>
            <input class="form-input" id="pf-month" type="month" value="${month || currentMonth()}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Date & Time Paid</label>
          <input class="form-input" id="pf-datetime" type="datetime-local" value="${todayLocal()}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Method</label>
            <select class="form-select" id="pf-method">
              <option value="cash">Cash</option>
              <option value="transfer">Bank Transfer</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Who Paid</label>
            <select class="form-select" id="pf-payer-type">
              <option value="parent">Parent</option>
              <option value="student">Student</option>
              <option value="guardian">Guardian</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Payer Name</label>
          <input class="form-input" id="pf-payer-name" placeholder="Name of person who paid">
        </div>
        <div class="form-group">
          <label class="form-label">Reference / Note</label>
          <textarea class="form-textarea" id="pf-ref" placeholder="Optional reference, note, or transaction ID" style="min-height:64px"></textarea>
        </div>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost flex-1" onclick="window.app.closeDrawer()">Cancel</button>
        <button class="btn btn-success flex-1" id="pf-submit">
          <i data-lucide="check-circle"></i> Confirm Payment
        </button>
      </div>
    `);

    if (window.lucide) lucide.createIcons();

    document.getElementById('pf-submit')?.addEventListener('click', async () => {
      const amtVal = parseFloat(document.getElementById('pf-amount')?.value);
      if (!amtVal || amtVal <= 0) { toast('Enter a valid amount', 'error'); return; }

      const payload = {
        amount: amtVal,
        month: document.getElementById('pf-month')?.value || currentMonth(),
        paid_at: document.getElementById('pf-datetime')?.value,
        method: document.getElementById('pf-method')?.value,
        payer_type: document.getElementById('pf-payer-type')?.value,
        payer_name: document.getElementById('pf-payer-name')?.value.trim(),
        reference: document.getElementById('pf-ref')?.value.trim(),
      };

      if (studentId) payload.student_id = studentId;
      if (groupId) payload.group_id = groupId;

      const btn = document.getElementById('pf-submit');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="refresh-cw" class="spin"></i> Processing…'; if (window.lucide) lucide.createIcons(); }

      try {
        if (paymentId) {
          await api.markPaid(paymentId, payload);
        } else {
          await api.post('/api/payments', payload);
        }
        toast('Payment recorded', 'success');
        this.closeDrawer();
        // Reload current page
        if (this.currentPage === 'payments') this.modules.payments?.load();
        if (this.currentPage === 'students') this.modules.students?.load();
        if (this.currentPage === 'groups') this.modules.groups?.load();
        if (this.currentPage === 'dashboard') this.modules.dashboard?.load();
      } catch (e) {
        toast(e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check-circle"></i> Confirm Payment'; if (window.lucide) lucide.createIcons(); }
      }
    });
  }

  // ── FAB ────────────────────────────────────────────────────

  _setupFAB() {
    const fab = document.getElementById('fab-add');
    if (!fab) return;
    fab.addEventListener('click', () => {
      switch (this.currentPage) {
        case 'students': this.modules.students?.openForm(); break;
        case 'payments': this.openPaymentForm({}); break;
        case 'groups':   this.modules.groups?.openForm(); break;
      }
    });
  }

  // ── Lock button ────────────────────────────────────────────

  _setupLockButton() {
    document.getElementById('btn-lock')?.addEventListener('click', () => this.lock());
  }

  lock() {
    this.modules.auth?.showLock();
    this.modules.auth.onAuthenticated = () => {
      this.modules.auth.hideLock();
      this._resetLockTimer();
    };
  }

  // ── Sync button ────────────────────────────────────────────

  _setupSyncButton() {
    const btn = document.getElementById('btn-sync');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.querySelector('i, svg')?.classList?.add('spin');
      try {
        await api.sync();
        toast('Synced', 'success', 2000);
        // Refresh current page
        this.navigate(this.currentPage);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.querySelector('i, svg')?.classList?.remove('spin');
      }
    });
  }

  // ── Drawer ─────────────────────────────────────────────────

  _setupDrawer() {
    const backdrop = document.getElementById('drawer-backdrop');
    backdrop?.addEventListener('click', () => this.closeDrawer());

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._drawerOpen) this.closeDrawer();
    });
  }

  openDrawer(html) {
    const drawer = document.getElementById('main-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.innerHTML = html;
    drawer.classList.add('open');
    backdrop.classList.add('open');
    this._drawerOpen = true;
    document.body.style.overflow = 'hidden';
    if (window.lucide) lucide.createIcons();
  }

  closeDrawer() {
    const drawer = document.getElementById('main-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    this._drawerOpen = false;
    document.body.style.overflow = '';
    setTimeout(() => { if (drawer) drawer.innerHTML = ''; }, 300);
  }

  // ── Auto-lock ──────────────────────────────────────────────

  setupAutoLock() {
    const resetEvents = ['click', 'touchstart', 'keydown', 'scroll', 'mousemove'];
    resetEvents.forEach(ev => document.addEventListener(ev, () => this._resetLockTimer(), { passive: true }));
    this._resetLockTimer();
  }

  _resetLockTimer() {
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => {
      if (!this._drawerOpen) this.lock();
    }, AUTO_LOCK_MS);
  }
}

// ── Bootstrap ──────────────────────────────────────────────

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
window.app = app;
