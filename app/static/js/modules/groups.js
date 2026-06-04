/**
 * LessonPay — modules/groups.js
 * Group management — cards, pay, hold/resume, edit, archive.
 */

import {
  fmt, fmtDate, fmtMonth, initials, avatarColor, escHtml,
  toast, whatsappReminder, skeletonCards, currentMonth, todayLocal
} from '../utils.js';

export class GroupsModule {
  constructor(container, api) {
    this.container = container;
    this.api = api;
    this.groups = [];
    this._editId = null;
  }

  async load() {
    this._renderSkeleton();
    try {
      this.groups = await this.api.getGroups();
      this._renderPage();
    } catch (e) {
      this.container.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-title">Failed to load groups</div><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="page-header"><div class="skeleton skeleton-line" style="height:22px;width:50%;margin-bottom:8px"></div></div>
      ${skeletonCards(3)}
    `;
  }

  _renderPage() {
    this.container.innerHTML = `
      <div class="page-header flex justify-between" style="align-items:center">
        <div>
          <div class="page-title">Groups</div>
          <div class="page-subtitle">${this.groups.length} group${this.groups.length !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn btn-primary btn-sm" id="add-group-btn">
          <i data-lucide="plus"></i> New Group
        </button>
      </div>

      <div class="group-list" id="group-list"></div>
    `;

    if (window.lucide) lucide.createIcons();
    document.getElementById('add-group-btn')?.addEventListener('click', () => this.openForm());
    this._renderList();
  }

  _renderList() {
    const el = document.getElementById('group-list');
    if (!el) return;

    if (this.groups.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <i data-lucide="home"></i>
          <div class="empty-state-title">No groups yet</div>
          <div class="empty-state-text">Create a group for families or batch students sharing a fee.</div>
          <button class="btn btn-primary mt-3" onclick="window.app.modules.groups.openForm()"><i data-lucide="plus"></i> Add Group</button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    el.innerHTML = this.groups.map(g => this._groupCard(g)).join('');
    if (window.lucide) lucide.createIcons();
  }

  _groupCard(g) {
    const members = g.members || [];
    const isHeld = g.on_hold;
    const overdueCount = g.overdue_count || 0;
    const paidCount = g.paid_count || 0;

    return `
      <div class="group-card ${isHeld ? 'on-hold' : ''}">
        <div class="group-card-header">
          <div class="flex gap-2" style="align-items:center;flex:1">
            <div class="group-icon"><i data-lucide="home"></i></div>
            <div>
              <div class="group-name">${escHtml(g.name)}</div>
              <div class="group-meta">
                ${g.contact_name ? escHtml(g.contact_name) : ''}
                ${g.contact_phone ? ' · ' + escHtml(g.contact_phone) : ''}
              </div>
            </div>
          </div>
          <div class="flex gap-1">
            ${isHeld ? `<span class="tag tag-yellow"><i data-lucide="pause-circle"></i> Hold</span>` : ''}
            ${overdueCount > 0 ? `<span class="tag tag-red">${overdueCount} overdue</span>` : ''}
          </div>
        </div>

        <!-- Stats grid -->
        <div class="group-stats-grid mb-3">
          <div class="stat-item">
            <div class="stat-label">Fee / mo</div>
            <div class="stat-value">${fmt(g.monthly_fee || 0)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Members</div>
            <div class="stat-value">${members.length}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Paid this mo</div>
            <div class="stat-value text-green">${paidCount}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Total paid</div>
            <div class="stat-value">${fmt(g.total_paid || 0)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Total owed</div>
            <div class="stat-value ${(g.total_owed || 0) > 0 ? 'text-red' : ''}">${fmt(g.total_owed || 0)}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Status</div>
            <div class="stat-value">
              <span class="tag tag-${g.current_paid ? 'green' : 'red'}">${g.current_paid ? 'Paid' : 'Unpaid'}</span>
            </div>
          </div>
        </div>

        <!-- Member chips -->
        ${members.length > 0 ? `
        <div class="member-chips">
          ${members.slice(0, 6).map(m => `
            <span class="member-chip">
              ${escHtml(m.name || m)}
            </span>
          `).join('')}
          ${members.length > 6 ? `<span class="member-chip text-muted">+${members.length - 6} more</span>` : ''}
        </div>` : ''}

        <!-- Actions -->
        <div class="group-actions">
          ${!g.current_paid ? `<button class="btn btn-success btn-sm" onclick="window.app.modules.groups.payGroup(${g.id})">
            <i data-lucide="check-circle"></i> Pay
          </button>` : ''}
          ${g.contact_phone ? `<button class="btn btn-ghost btn-sm" onclick="window.app.modules.groups.sendWhatsApp(${g.id})" title="WhatsApp">
            <i data-lucide="message-circle"></i>
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="window.app.modules.groups.viewDetail(${g.id})">
            <i data-lucide="info"></i>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="window.app.modules.groups.openForm(${g.id})">
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="window.app.modules.groups.toggleHold(${g.id}, ${isHeld})" title="${isHeld ? 'Resume' : 'Hold'}">
            <i data-lucide="${isHeld ? 'play-circle' : 'pause-circle'}"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="window.app.modules.groups.archive(${g.id}, '${escHtml(g.name)}')">
            <i data-lucide="archive"></i>
          </button>
        </div>
      </div>
    `;
  }

  // ── Pay Group ──────────────────────────────────────────────

  payGroup(id) {
    const g = this.groups.find(x => x.id === id);
    if (!g) return;
    window.app.openPaymentForm({ groupId: id, name: g.name, amount: g.monthly_fee, month: currentMonth(), isGroup: true });
  }

  // ── WhatsApp ───────────────────────────────────────────────

  sendWhatsApp(id) {
    const g = this.groups.find(x => x.id === id);
    if (!g) return;
    whatsappReminder({
      phone: g.contact_phone,
      studentName: g.name + ' group',
      contactName: g.contact_name,
      amount: g.monthly_fee,
      month: g.current_month || currentMonth(),
      dueDate: g.due_date,
    });
  }

  // ── Hold / Resume ──────────────────────────────────────────

  async toggleHold(id, isHeld) {
    try {
      if (isHeld) {
        await this.api.resumeGroup(id);
        toast('Group resumed', 'success');
      } else {
        await this.api.holdGroup(id);
        toast('Group put on hold', 'info');
      }
      await this.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Detail ─────────────────────────────────────────────────

  async viewDetail(id) {
    const g = this.groups.find(x => x.id === id);
    if (!g) return;
    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="info"></i> ${escHtml(g.name)}</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div class="kpi-grid mb-3">
          <div class="kpi-card green"><div class="kpi-label">Total Paid</div><div class="kpi-value">${fmt(g.total_paid || 0)}</div></div>
          <div class="kpi-card red"><div class="kpi-label">Total Owed</div><div class="kpi-value">${fmt(g.total_owed || 0)}</div></div>
        </div>
        <div class="section-title mb-2">Members (${(g.members || []).length})</div>
        <div class="member-chips mb-3">
          ${(g.members || []).map(m => `<span class="member-chip">${escHtml(m.name || m)}</span>`).join('')}
        </div>
        <div class="section-title mb-2">Payment History</div>
        <div id="group-pay-history"><div class="text-xs text-muted">Loading…</div></div>
      </div>
    `);
    if (window.lucide) lucide.createIcons();

    try {
      const payments = await this.api.getPayments({ group_id: id });
      const el = document.getElementById('group-pay-history');
      if (!el) return;
      if (!payments || payments.length === 0) {
        el.innerHTML = `<div class="empty-state"><i data-lucide="credit-card"></i><div class="empty-state-text">No payments</div></div>`;
      } else {
        el.innerHTML = payments.map(p => `
          <div class="recent-item">
            <div class="recent-item-info">
              <div class="recent-item-name">${fmtMonth(p.month)}</div>
              <div class="recent-item-meta">${p.paid_at ? fmtDate(p.paid_at) : 'Unpaid'}</div>
            </div>
            <span class="tag tag-${p.status === 'paid' ? 'green' : p.status === 'overdue' ? 'red' : 'yellow'}">${p.status}</span>
          </div>
        `).join('');
      }
      if (window.lucide) lucide.createIcons();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Archive ────────────────────────────────────────────────

  async archive(id, name) {
    if (!confirm(`Archive group "${name}"?`)) return;
    try {
      await this.api.archiveGroup(id);
      toast(`${name} archived`, 'info');
      await this.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Form (Add / Edit) ──────────────────────────────────────

  async openForm(id = null) {
    this._editId = id;
    let g = {};
    if (id) g = this.groups.find(x => x.id === id) || {};

    // Get students for member selection
    let students = [];
    try { students = await this.api.getStudents(); } catch (_) {}

    const memberIds = new Set((g.members || []).map(m => m.id || m));

    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="${id ? 'pencil' : 'plus'}"></i> ${id ? 'Edit' : 'New'} Group</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <form id="group-form" autocomplete="off">
          <div class="form-group">
            <label class="form-label">Group Name *</label>
            <input class="form-input" id="gf-name" placeholder="e.g. Ade Family" value="${escHtml(g.name || '')}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Monthly Fee (₦)</label>
            <input class="form-input" id="gf-fee" type="number" min="0" placeholder="20000" value="${g.monthly_fee || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Contact Name</label>
              <input class="form-input" id="gf-contact-name" placeholder="Parent/Guardian" value="${escHtml(g.contact_name || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Contact Phone</label>
              <input class="form-input" id="gf-contact-phone" type="tel" placeholder="08012345678" value="${escHtml(g.contact_phone || '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Day of month due</label>
              <input class="form-input" id="gf-due-day" type="number" min="1" max="31" placeholder="1" value="${g.due_day || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Start Month</label>
              <input class="form-input" id="gf-start-month" type="month" value="${g.start_month || currentMonth()}">
            </div>
          </div>
          ${students.length > 0 ? `
          <div class="form-group">
            <label class="form-label">Members</label>
            <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-xs);padding:10px;max-height:180px;overflow-y:auto">
              ${students.map(s => `
                <label class="checkbox-wrap" style="padding:5px 0;border-bottom:1px solid var(--border)">
                  <input type="checkbox" name="member" value="${s.id}" ${memberIds.has(s.id) ? 'checked' : ''}>
                  <span style="font-size:13px;color:var(--text)">${escHtml(s.name)}</span>
                  <span class="text-xs text-muted ml-auto">${escHtml(s.class_name || '')}</span>
                </label>
              `).join('')}
            </div>
          </div>` : ''}
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea class="form-textarea" id="gf-notes">${escHtml(g.notes || '')}</textarea>
          </div>
        </form>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost flex-1" onclick="window.app.closeDrawer()">Cancel</button>
        <button class="btn btn-primary flex-1" id="group-form-save">
          <i data-lucide="${id ? 'check-circle' : 'plus'}"></i> ${id ? 'Save' : 'Create Group'}
        </button>
      </div>
    `);

    if (window.lucide) lucide.createIcons();
    document.getElementById('group-form-save')?.addEventListener('click', () => this._saveForm());
  }

  async _saveForm() {
    const name = document.getElementById('gf-name')?.value.trim();
    if (!name) { toast('Group name is required', 'error'); return; }

    const memberCheckboxes = document.querySelectorAll('input[name="member"]:checked');
    const memberIds = [...memberCheckboxes].map(cb => parseInt(cb.value));

    const data = {
      name,
      monthly_fee: parseFloat(document.getElementById('gf-fee')?.value) || 0,
      contact_name: document.getElementById('gf-contact-name')?.value.trim() || '',
      contact_phone: document.getElementById('gf-contact-phone')?.value.trim() || '',
      due_day: parseInt(document.getElementById('gf-due-day')?.value) || 1,
      start_month: document.getElementById('gf-start-month')?.value || currentMonth(),
      notes: document.getElementById('gf-notes')?.value.trim() || '',
      member_ids: memberIds,
    };

    const btn = document.getElementById('group-form-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      if (this._editId) {
        await this.api.updateGroup(this._editId, data);
        toast('Group updated', 'success');
      } else {
        await this.api.createGroup(data);
        toast('Group created', 'success');
      }
      window.app.closeDrawer();
      await this.load();
    } catch (e) {
      toast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check-circle"></i> Save'; if (window.lucide) lucide.createIcons(); }
    }
  }
}
