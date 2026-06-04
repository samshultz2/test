/**
 * LessonPay — modules/students.js
 * Student list, forms, actions.
 */

import {
  fmt, fmtDate, fmtMonth, initials, avatarColor, escHtml,
  toast, whatsappReminder, debounce, skeletonCards, currentMonth, today, todayLocal
} from '../utils.js';

export class StudentsModule {
  constructor(container, api) {
    this.container = container;
    this.api = api;
    this.students = [];
    this._filter = { search: '', class: '', sort: 'name' };
    this._editId = null;
  }

  async load() {
    this._renderSkeleton();
    try {
      this.students = await this.api.getStudents();
      this._renderPage();
    } catch (e) {
      this.container.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-title">Failed to load students</div><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="page-header">
        <div class="skeleton skeleton-line" style="height:22px;width:50%;margin-bottom:8px"></div>
      </div>
      <div class="skeleton skeleton-card mb-3" style="height:40px"></div>
      ${skeletonCards(4)}
    `;
  }

  _renderPage() {
    const classes = [...new Set(this.students.map(s => s.class_name).filter(Boolean))].sort();

    this.container.innerHTML = `
      <div class="page-header flex justify-between" style="align-items:center">
        <div>
          <div class="page-title">Students</div>
          <div class="page-subtitle" id="student-count">${this.students.length} student${this.students.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" onclick="window.app.navigate('archive')">
            <i data-lucide="archive"></i> Archive
          </button>
          <button class="btn btn-ghost btn-sm" onclick="window.app.navigate('timetable')">
            <i data-lucide="calendar-days"></i>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="window.app.navigate('attendance')">
            <i data-lucide="clipboard-check"></i>
          </button>
        </div>
      </div>

      <!-- Search & filter -->
      <div class="search-bar">
        <div class="search-wrap">
          <span class="search-icon"><i data-lucide="search"></i></span>
          <input type="text" class="search-input" id="student-search" placeholder="Search students…" value="${escHtml(this._filter.search)}">
        </div>
        <button class="icon-btn" id="student-add-btn" title="Add student">
          <i data-lucide="plus"></i>
        </button>
      </div>
      <div class="filter-row">
        <select class="filter-select" id="student-class-filter">
          <option value="">All Classes</option>
          ${classes.map(c => `<option value="${escHtml(c)}" ${this._filter.class === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>
        <select class="filter-select" id="student-sort">
          <option value="name" ${this._filter.sort === 'name' ? 'selected' : ''}>Name A-Z</option>
          <option value="name_z" ${this._filter.sort === 'name_z' ? 'selected' : ''}>Name Z-A</option>
          <option value="overdue" ${this._filter.sort === 'overdue' ? 'selected' : ''}>Overdue first</option>
          <option value="streak" ${this._filter.sort === 'streak' ? 'selected' : ''}>Best streak</option>
        </select>
      </div>

      <!-- Student list -->
      <div class="student-list" id="student-list"></div>
    `;

    if (window.lucide) lucide.createIcons();

    // Events
    const searchInput = document.getElementById('student-search');
    searchInput?.addEventListener('input', debounce(() => {
      this._filter.search = searchInput.value;
      this._renderList();
    }, 250));

    document.getElementById('student-class-filter')?.addEventListener('change', (e) => {
      this._filter.class = e.target.value;
      this._renderList();
    });

    document.getElementById('student-sort')?.addEventListener('change', (e) => {
      this._filter.sort = e.target.value;
      this._renderList();
    });

    document.getElementById('student-add-btn')?.addEventListener('click', () => this.openForm());

    this._renderList();
  }

  _filtered() {
    let list = [...this.students];
    const q = this._filter.search.toLowerCase();
    if (q) {
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.class_name || '').toLowerCase().includes(q) ||
        (s.subject || '').toLowerCase().includes(q) ||
        (s.contact_name || '').toLowerCase().includes(q)
      );
    }
    if (this._filter.class) {
      list = list.filter(s => s.class_name === this._filter.class);
    }
    switch (this._filter.sort) {
      case 'name_z': list.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
      case 'overdue': list.sort((a, b) => (b.is_overdue ? 1 : 0) - (a.is_overdue ? 1 : 0)); break;
      case 'streak': list.sort((a, b) => (b.streak || 0) - (a.streak || 0)); break;
      default: list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return list;
  }

  _renderList() {
    const el = document.getElementById('student-list');
    if (!el) return;
    const list = this._filtered();
    document.getElementById('student-count').textContent = `${list.length} student${list.length !== 1 ? 's' : ''}`;

    if (list.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <i data-lucide="users"></i>
          <div class="empty-state-title">No students found</div>
          <div class="empty-state-text">Try adjusting your filters or add a new student.</div>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    el.innerHTML = list.map(s => this._studentCard(s)).join('');
    if (window.lucide) lucide.createIcons();
  }

  _studentCard(s) {
    const isGroup = !!s.group_id;
    const isHeld = s.on_hold;
    const isOverdue = s.is_overdue;

    const tags = [];
    if (isOverdue) tags.push(`<span class="tag tag-red"><i data-lucide="alert-triangle"></i> Overdue</span>`);
    if (isGroup) tags.push(`<span class="tag tag-purple"><i data-lucide="home"></i> Group</span>`);
    if (isHeld) tags.push(`<span class="tag tag-yellow"><i data-lucide="pause-circle"></i> On Hold</span>`);
    if (s.subject) tags.push(`<span class="tag tag-blue">${escHtml(s.subject)}</span>`);

    return `
      <div class="student-card ${isHeld ? 'on-hold' : ''}">
        <div class="student-card-top">
          <div class="avatar" style="background:${avatarColor(s.name)}">${initials(s.name)}</div>
          <div class="student-info">
            <div class="student-name">${escHtml(s.name)}</div>
            <div class="student-meta">
              ${s.class_name ? escHtml(s.class_name) + ' · ' : ''}${s.contact_name ? escHtml(s.contact_name) : ''}
            </div>
          </div>
          ${s.streak > 0 ? `<div class="streak-badge"><i data-lucide="flame"></i> ${s.streak}</div>` : ''}
        </div>
        ${tags.length > 0 ? `<div class="student-tags">${tags.join('')}</div>` : ''}
        <div class="student-stats">
          <div class="stat-item">
            <div class="stat-label">Fee / mo</div>
            <div class="stat-value">${isGroup ? 'Group' : fmt(s.monthly_fee || 0)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Paid</div>
            <div class="stat-value text-green">${fmt(s.total_paid || 0)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Owed</div>
            <div class="stat-value ${(s.total_owed || 0) > 0 ? 'text-red' : ''}">${fmt(s.total_owed || 0)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">This period</div>
            <div class="stat-value">
              <span class="tag ${s.current_paid ? 'tag-green' : 'tag-red'}">${s.current_paid ? 'Paid' : 'Unpaid'}</span>
            </div>
          </div>
        </div>
        <div class="student-actions">
          ${s.current_paid ? '' : `<button class="btn btn-success btn-sm" onclick="window.app.modules.students.quickPay(${s.id})">
            <i data-lucide="check-circle"></i> Pay
          </button>`}
          ${s.contact_phone ? `<button class="btn btn-ghost btn-sm" onclick="window.app.modules.students.sendWhatsApp(${s.id})" title="WhatsApp reminder">
            <i data-lucide="message-circle"></i>
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="window.app.modules.students.viewDetail(${s.id})" title="History">
            <i data-lucide="info"></i>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="window.app.modules.students.openInvoice(${s.id})" title="Invoice">
            <i data-lucide="file-text"></i>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="window.app.modules.students.openForm(${s.id})" title="Edit">
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="window.app.modules.students.toggleHold(${s.id}, ${isHeld})" title="${isHeld ? 'Resume' : 'Hold'}">
            <i data-lucide="${isHeld ? 'play-circle' : 'pause-circle'}"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="window.app.modules.students.archive(${s.id}, '${escHtml(s.name)}')" title="Archive">
            <i data-lucide="archive"></i>
          </button>
        </div>
      </div>
    `;
  }

  // ── Quick Pay ──────────────────────────────────────────────

  quickPay(id) {
    const s = this.students.find(x => x.id === id);
    if (!s) return;
    window.app.openPaymentForm({ studentId: id, name: s.name, amount: s.monthly_fee, month: currentMonth() });
  }

  // ── WhatsApp ───────────────────────────────────────────────

  sendWhatsApp(id) {
    const s = this.students.find(x => x.id === id);
    if (!s) return;
    whatsappReminder({
      phone: s.contact_phone,
      studentName: s.name,
      contactName: s.contact_name,
      amount: s.monthly_fee,
      month: s.current_month || currentMonth(),
      dueDate: s.due_date,
    });
  }

  // ── Hold / Resume ──────────────────────────────────────────

  async toggleHold(id, isHeld) {
    try {
      if (isHeld) {
        await this.api.resumeStudent(id);
        toast('Student resumed', 'success');
      } else {
        await this.api.holdStudent(id);
        toast('Student put on hold', 'info');
      }
      await this.load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── View Detail / History ──────────────────────────────────

  async viewDetail(id) {
    const s = this.students.find(x => x.id === id);
    if (!s) return;

    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="info"></i> ${escHtml(s.name)}</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div class="flex gap-2 mb-3" style="align-items:center">
          <div class="avatar" style="background:${avatarColor(s.name)};width:52px;height:52px;font-size:16px">${initials(s.name)}</div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--text)">${escHtml(s.name)}</div>
            <div class="text-muted text-sm">${escHtml(s.class_name || '')} ${s.subject ? '· ' + escHtml(s.subject) : ''}</div>
          </div>
        </div>
        <div class="kpi-grid mb-3">
          <div class="kpi-card green"><div class="kpi-label">Total Paid</div><div class="kpi-value">${fmt(s.total_paid || 0)}</div></div>
          <div class="kpi-card red"><div class="kpi-label">Total Owed</div><div class="kpi-value">${fmt(s.total_owed || 0)}</div></div>
        </div>
        <div id="student-history-list"><div class="empty-state"><i data-lucide="clock"></i><div class="empty-state-text">Loading history…</div></div></div>
      </div>
    `);
    if (window.lucide) lucide.createIcons();

    try {
      const payments = await this.api.getStudentPayments(id);
      const el = document.getElementById('student-history-list');
      if (!el) return;
      if (!payments || payments.length === 0) {
        el.innerHTML = `<div class="empty-state"><i data-lucide="credit-card"></i><div class="empty-state-text">No payment history</div></div>`;
      } else {
        el.innerHTML = `
          <div class="section-title mb-2">Payment History</div>
          ${payments.map(p => `
            <div class="recent-item">
              <div class="recent-item-info">
                <div class="recent-item-name">${fmtMonth(p.month)}</div>
                <div class="recent-item-meta">${p.paid_at ? fmtDate(p.paid_at) + ' · ' + (p.method || 'Cash') : 'Unpaid'}</div>
              </div>
              <div>
                <span class="tag tag-${p.status === 'paid' ? 'green' : p.status === 'overdue' ? 'red' : 'yellow'}">${p.status}</span>
                <div class="recent-item-amount" style="margin-top:3px">${fmt(p.amount)}</div>
              </div>
            </div>
          `).join('')}
        `;
      }
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Invoice ────────────────────────────────────────────────

  async openInvoice(id) {
    const s = this.students.find(x => x.id === id);
    if (!s) return;
    try {
      const payments = await this.api.getStudentPayments(id);
      const paidPayments = (payments || []).filter(p => p.status === 'paid');

      window.app.openDrawer(`
        <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
        <div class="drawer-header">
          <div class="drawer-title"><i data-lucide="file-text"></i> Invoice — ${escHtml(s.name)}</div>
          <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
        </div>
        <div class="drawer-body">
          <div class="flex justify-between mb-3">
            <div>
              <div class="fw-bold" style="font-size:15px">${escHtml(s.name)}</div>
              <div class="text-muted text-xs">${escHtml(s.class_name || '')} ${s.subject ? '· ' + escHtml(s.subject) : ''}</div>
            </div>
            <div class="text-right">
              <div class="fw-800 text-green" style="font-size:18px">${fmt(s.total_paid || 0)}</div>
              <div class="text-xs text-muted">Total paid</div>
            </div>
          </div>
          <div class="section-title mb-2">Payments</div>
          ${paidPayments.length === 0 ? '<div class="empty-state"><i data-lucide="receipt"></i><div class="empty-state-text">No payments found</div></div>' :
            paidPayments.map(p => `
              <div class="recent-item">
                <div class="recent-item-info">
                  <div class="recent-item-name">${fmtMonth(p.month)}</div>
                  <div class="recent-item-meta">${fmtDate(p.paid_at)} · ${p.method || 'Cash'}</div>
                </div>
                <span class="recent-item-amount">${fmt(p.amount)}</span>
              </div>
            `).join('')
          }
        </div>
        <div class="drawer-footer">
          <button class="btn btn-ghost btn-sm flex-1" onclick="window.print()"><i data-lucide="printer"></i> Print</button>
        </div>
      `);
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Archive ────────────────────────────────────────────────

  async archive(id, name) {
    if (!confirm(`Archive ${name}? Their payment history will be preserved.`)) return;
    try {
      await this.api.archiveStudent(id);
      toast(`${name} archived`, 'info');
      await this.load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Form (Add / Edit) ──────────────────────────────────────

  async openForm(id = null) {
    this._editId = id;
    let s = {};
    if (id) {
      s = this.students.find(x => x.id === id) || {};
    }

    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="${id ? 'pencil' : 'plus'}"></i> ${id ? 'Edit' : 'Add'} Student</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <form id="student-form" autocomplete="off">
          <div class="form-group">
            <label class="form-label">Student Name *</label>
            <input class="form-input" id="sf-name" placeholder="Full name" value="${escHtml(s.name || '')}" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Class</label>
              <input class="form-input" id="sf-class" placeholder="e.g. SS2" value="${escHtml(s.class_name || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Subject</label>
              <input class="form-input" id="sf-subject" placeholder="e.g. Maths" value="${escHtml(s.subject || '')}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Monthly Fee (₦)</label>
            <input class="form-input" id="sf-fee" type="number" min="0" placeholder="15000" value="${s.monthly_fee || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Contact Name</label>
            <input class="form-input" id="sf-contact-name" placeholder="Parent/Guardian name" value="${escHtml(s.contact_name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Contact Phone</label>
            <input class="form-input" id="sf-contact-phone" type="tel" placeholder="08012345678" value="${escHtml(s.contact_phone || '')}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Day of month due</label>
              <input class="form-input" id="sf-due-day" type="number" min="1" max="31" placeholder="1" value="${s.due_day || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Start Month</label>
              <input class="form-input" id="sf-start-month" type="month" value="${s.start_month || currentMonth()}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea class="form-textarea" id="sf-notes" placeholder="Optional notes">${escHtml(s.notes || '')}</textarea>
          </div>
        </form>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost flex-1" onclick="window.app.closeDrawer()">Cancel</button>
        <button class="btn btn-primary flex-1" id="student-form-save">
          <i data-lucide="${id ? 'check-circle' : 'plus'}"></i> ${id ? 'Save Changes' : 'Add Student'}
        </button>
      </div>
    `);

    if (window.lucide) lucide.createIcons();

    document.getElementById('student-form-save')?.addEventListener('click', () => this._saveForm());
  }

  async _saveForm() {
    const name = document.getElementById('sf-name')?.value.trim();
    if (!name) { toast('Student name is required', 'error'); return; }

    const data = {
      name,
      class_name: document.getElementById('sf-class')?.value.trim() || '',
      subject: document.getElementById('sf-subject')?.value.trim() || '',
      monthly_fee: parseFloat(document.getElementById('sf-fee')?.value) || 0,
      contact_name: document.getElementById('sf-contact-name')?.value.trim() || '',
      contact_phone: document.getElementById('sf-contact-phone')?.value.trim() || '',
      due_day: parseInt(document.getElementById('sf-due-day')?.value) || 1,
      start_month: document.getElementById('sf-start-month')?.value || currentMonth(),
      notes: document.getElementById('sf-notes')?.value.trim() || '',
    };

    const btn = document.getElementById('student-form-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      if (this._editId) {
        await this.api.updateStudent(this._editId, data);
        toast('Student updated', 'success');
      } else {
        await this.api.createStudent(data);
        toast('Student added', 'success');
      }
      window.app.closeDrawer();
      await this.load();
    } catch (e) {
      toast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check-circle"></i> Save'; if (window.lucide) lucide.createIcons(); }
    }
  }
}
