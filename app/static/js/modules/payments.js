/**
 * LessonPay — modules/payments.js
 * Payment list with bulk selection and payment form.
 */

import {
  fmt, fmtDate, fmtMonth, fmtDateTime, initials, avatarColor,
  escHtml, toast, debounce, skeletonCards, currentMonth, today, todayLocal, daysLabel, daysUntil, statusColor
} from '../utils.js';

export class PaymentsModule {
  constructor(container, api) {
    this.container = container;
    this.api = api;
    this.payments = [];
    this._filter = { search: '', month: currentMonth(), status: '', method: '' };
    this._selected = new Set();
    this._bulkVisible = false;
  }

  async load() {
    this._renderSkeleton();
    try {
      this.payments = await this.api.getPayments({ month: this._filter.month });
      this._renderPage();
    } catch (e) {
      this.container.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-title">Failed to load payments</div><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="page-header"><div class="skeleton skeleton-line" style="height:22px;width:50%;margin-bottom:8px"></div></div>
      <div class="skeleton skeleton-card mb-3" style="height:40px"></div>
      ${skeletonCards(4)}
    `;
  }

  _renderPage() {
    this.container.innerHTML = `
      <div class="page-header flex justify-between" style="align-items:center">
        <div>
          <div class="page-title">Payments</div>
          <div class="page-subtitle" id="payment-count"></div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="window.app.openPaymentForm({})">
          <i data-lucide="plus"></i> Add
        </button>
      </div>

      <!-- Search -->
      <div class="search-bar">
        <div class="search-wrap">
          <span class="search-icon"><i data-lucide="search"></i></span>
          <input type="text" class="search-input" id="payment-search" placeholder="Search payments…" value="${escHtml(this._filter.search)}">
        </div>
      </div>

      <!-- Filters -->
      <div class="filter-row">
        <input type="month" class="filter-select" id="payment-month" value="${this._filter.month}" style="padding:7px 10px;color:var(--text-2);font-size:12px;color-scheme:dark">
        <select class="filter-select" id="payment-status">
          <option value="">All Status</option>
          <option value="paid" ${this._filter.status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="unpaid" ${this._filter.status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
          <option value="overdue" ${this._filter.status === 'overdue' ? 'selected' : ''}>Overdue</option>
        </select>
        <select class="filter-select" id="payment-method">
          <option value="">All Methods</option>
          <option value="cash" ${this._filter.method === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="transfer" ${this._filter.method === 'transfer' ? 'selected' : ''}>Transfer</option>
        </select>
      </div>

      <!-- Summary row -->
      <div id="payment-summary" class="mini-kpi-row mb-3" style="grid-template-columns:repeat(3,1fr)"></div>

      <!-- Bulk action bar -->
      <div class="bulk-bar" id="bulk-bar">
        <span class="bulk-info" id="bulk-info">0 selected</span>
        <div class="bulk-actions">
          <button class="btn btn-success btn-sm" id="bulk-pay-btn"><i data-lucide="check-circle"></i> Pay All</button>
          <button class="btn btn-ghost btn-sm" id="bulk-clear-btn"><i data-lucide="x"></i></button>
        </div>
      </div>

      <!-- List -->
      <div class="payment-list" id="payment-list"></div>
    `;

    if (window.lucide) lucide.createIcons();

    // Events
    const searchInput = document.getElementById('payment-search');
    searchInput?.addEventListener('input', debounce(() => {
      this._filter.search = searchInput.value;
      this._renderList();
    }, 250));

    document.getElementById('payment-month')?.addEventListener('change', async (e) => {
      this._filter.month = e.target.value;
      await this.load();
    });

    document.getElementById('payment-status')?.addEventListener('change', (e) => {
      this._filter.status = e.target.value;
      this._renderList();
    });

    document.getElementById('payment-method')?.addEventListener('change', (e) => {
      this._filter.method = e.target.value;
      this._renderList();
    });

    document.getElementById('bulk-pay-btn')?.addEventListener('click', () => this._bulkPay());
    document.getElementById('bulk-clear-btn')?.addEventListener('click', () => {
      this._selected.clear();
      this._updateBulkBar();
      this._renderList();
    });

    this._renderList();
  }

  _filtered() {
    let list = [...this.payments];
    const q = this._filter.search.toLowerCase();
    if (q) {
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.class_name || '').toLowerCase().includes(q)
      );
    }
    if (this._filter.status) list = list.filter(p => p.status === this._filter.status);
    if (this._filter.method) list = list.filter(p => (p.method || '').toLowerCase() === this._filter.method);
    return list;
  }

  _renderList() {
    const el = document.getElementById('payment-list');
    if (!el) return;
    const list = this._filtered();

    // Update count & summary
    const countEl = document.getElementById('payment-count');
    if (countEl) countEl.textContent = `${list.length} payment${list.length !== 1 ? 's' : ''}`;

    const totalCollected = list.filter(p => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0);
    const totalUnpaid = list.filter(p => p.status !== 'paid').reduce((s, p) => s + (p.amount || 0), 0);
    const overdueCount = list.filter(p => p.status === 'overdue').length;

    const summaryEl = document.getElementById('payment-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="mini-kpi"><div class="mini-kpi-val text-green">${fmt(totalCollected)}</div><div class="mini-kpi-lbl">Collected</div></div>
        <div class="mini-kpi"><div class="mini-kpi-val text-yellow">${fmt(totalUnpaid)}</div><div class="mini-kpi-lbl">Pending</div></div>
        <div class="mini-kpi"><div class="mini-kpi-val text-red">${overdueCount}</div><div class="mini-kpi-lbl">Overdue</div></div>
      `;
    }

    if (list.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <i data-lucide="credit-card"></i>
          <div class="empty-state-title">No payments found</div>
          <div class="empty-state-text">Try adjusting your filters.</div>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    el.innerHTML = list.map(p => this._paymentCard(p)).join('');
    if (window.lucide) lucide.createIcons();

    // Bind checkboxes
    el.querySelectorAll('.pay-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) this._selected.add(id);
        else this._selected.delete(id);
        this._updateBulkBar();
      });
      cb.checked = this._selected.has(parseInt(cb.dataset.id));
    });
  }

  _paymentCard(p) {
    const days = p.due_date ? daysUntil(p.due_date) : null;
    const color = statusColor(p.status);
    const isPaid = p.status === 'paid';

    return `
      <div class="payment-card ${p.status}">
        <div class="payment-top">
          <div>
            <div class="payment-name">${escHtml(p.name || '')}</div>
            <div class="payment-meta">
              ${fmtMonth(p.month)} · ${escHtml(p.class_name || '')}
            </div>
            ${isPaid && p.paid_at ? `<div class="paid-info mt-1"><i data-lucide="clock"></i> ${fmtDate(p.paid_at)} · ${p.method || 'Cash'}${p.payer_name ? ' · ' + escHtml(p.payer_name) : ''}</div>` : ''}
          </div>
          <div>
            <div class="payment-amount">${fmt(p.amount)}</div>
            <span class="tag tag-${color}" style="float:right;margin-top:4px">${p.status}</span>
          </div>
        </div>
        <div class="flex justify-between" style="align-items:center">
          <div class="flex gap-1" style="align-items:center">
            ${!isPaid ? `<label class="checkbox-wrap"><input type="checkbox" class="pay-checkbox" data-id="${p.id}"><span class="text-xs text-muted">Select</span></label>` : ''}
            ${days !== null && !isPaid ? `<span class="tag tag-${days < 0 ? 'red' : days <= 5 ? 'orange' : 'gray'}">${daysLabel(days)}</span>` : ''}
          </div>
          <div class="payment-actions">
            ${!isPaid ? `<button class="btn btn-success btn-sm" onclick="window.app.modules.payments.pay(${p.id})"><i data-lucide="check-circle"></i> Pay</button>` : ''}
            ${isPaid ? `<button class="btn btn-ghost btn-sm" onclick="window.app.modules.payments.receipt(${p.id})"><i data-lucide="receipt"></i></button>` : ''}
            ${isPaid ? `<button class="btn btn-warning btn-sm" onclick="window.app.modules.payments.undo(${p.id})"><i data-lucide="undo-2"></i></button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="window.app.modules.payments.remove(${p.id})"><i data-lucide="archive"></i></button>
          </div>
        </div>
      </div>
    `;
  }

  _updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const info = document.getElementById('bulk-info');
    const count = this._selected.size;
    if (bar) bar.classList.toggle('visible', count > 0);
    if (info) info.textContent = `${count} selected`;
  }

  // ── Actions ────────────────────────────────────────────────

  pay(id) {
    const p = this.payments.find(x => x.id === id);
    if (!p) return;
    window.app.openPaymentForm({ paymentId: id, name: p.name, amount: p.amount, month: p.month });
  }

  async undo(id) {
    if (!confirm('Undo this payment? It will be marked as unpaid.')) return;
    try {
      await this.api.undoPayment(id);
      toast('Payment undone', 'info');
      await this.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async remove(id) {
    if (!confirm('Delete this payment record?')) return;
    try {
      await this.api.deletePayment(id);
      toast('Payment deleted', 'info');
      await this.load();
    } catch (e) { toast(e.message, 'error'); }
  }

  receipt(id) {
    const p = this.payments.find(x => x.id === id);
    if (!p) return;
    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="receipt"></i> Receipt</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div style="text-align:center;padding:16px 0">
          <div class="auth-brand-icon" style="width:56px;height:56px;margin:0 auto 12px;border-radius:14px">
            <i data-lucide="receipt" style="width:28px;height:28px;stroke:#fff"></i>
          </div>
          <div style="font-size:22px;font-weight:800;color:var(--green)">${fmt(p.amount)}</div>
          <div class="text-muted text-sm mt-1">Payment Received</div>
        </div>
        <div class="divider"></div>
        <div style="display:grid;gap:10px">
          ${[
            ['Student/Group', p.name],
            ['Period', fmtMonth(p.month)],
            ['Date Paid', fmtDateTime(p.paid_at)],
            ['Method', p.method || 'Cash'],
            ['Paid By', p.payer_name || '—'],
            ['Reference', p.reference || '—'],
          ].map(([k, v]) => `
            <div class="flex justify-between">
              <span class="text-xs text-muted">${k}</span>
              <span class="fw-bold text-sm">${escHtml(String(v || '—'))}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost flex-1" onclick="window.print()"><i data-lucide="printer"></i> Print</button>
        <button class="btn btn-ghost flex-1" onclick="window.app.closeDrawer()">Close</button>
      </div>
    `);
    if (window.lucide) lucide.createIcons();
  }

  async _bulkPay() {
    const ids = [...this._selected];
    if (ids.length === 0) return;
    const total = ids.reduce((s, id) => {
      const p = this.payments.find(x => x.id === id);
      return s + (p ? p.amount : 0);
    }, 0);

    window.app.openDrawer(`
      <div class="drawer-handle"><div class="drawer-handle-bar"></div></div>
      <div class="drawer-header">
        <div class="drawer-title"><i data-lucide="check-circle"></i> Bulk Pay (${ids.length})</div>
        <button class="icon-btn" onclick="window.app.closeDrawer()"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div class="kpi-card green mb-3">
          <div class="kpi-label">Total Amount</div>
          <div class="kpi-value">${fmt(total)}</div>
          <div class="kpi-sub">${ids.length} payments</div>
        </div>
        <div class="form-group">
          <label class="form-label">Date & Time</label>
          <input class="form-input" id="bulk-datetime" type="datetime-local" value="${todayLocal()}">
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="form-select" id="bulk-method">
            <option value="cash">Cash</option>
            <option value="transfer">Bank Transfer</option>
          </select>
        </div>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-ghost flex-1" onclick="window.app.closeDrawer()">Cancel</button>
        <button class="btn btn-success flex-1" id="bulk-pay-confirm"><i data-lucide="check-circle"></i> Confirm</button>
      </div>
    `);
    if (window.lucide) lucide.createIcons();

    document.getElementById('bulk-pay-confirm')?.addEventListener('click', async () => {
      const btn = document.getElementById('bulk-pay-confirm');
      if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
      try {
        await this.api.bulkPay(ids, {
          paid_at: document.getElementById('bulk-datetime')?.value,
          method: document.getElementById('bulk-method')?.value,
        });
        toast(`${ids.length} payments marked paid`, 'success');
        this._selected.clear();
        window.app.closeDrawer();
        await this.load();
      } catch (e) {
        toast(e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm'; }
      }
    });
  }
}
