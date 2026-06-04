/**
 * LessonPay — modules/dashboard.js
 * Dashboard with KPIs, chart, alerts, and recent payments.
 */

import { fmt, fmtShort, fmtDate, fmtMonth, currentMonth, addMonths, initials, avatarColor, skeletonCards, daysUntil, toast } from '../utils.js';

export class DashboardModule {
  constructor(container, api) {
    this.container = container;
    this.api = api;
    this._chartCtx = null;
    this._chartInstance = null;
    this._currentMonth = currentMonth();
  }

  async load() {
    this._renderSkeleton();
    try {
      const data = await this.api.getDashboard(this._currentMonth);
      this._render(data);
    } catch (e) {
      this.container.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-title">Failed to load dashboard</div><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="page-header">
        <div class="skeleton skeleton-line medium mb-2" style="height:22px;width:55%"></div>
        <div class="skeleton skeleton-line short" style="height:13px;width:40%"></div>
      </div>
      <div class="kpi-grid">${Array(4).fill('<div class="skeleton skeleton-card"></div>').join('')}</div>
      <div class="skeleton skeleton-card mb-3" style="height:180px"></div>
      ${skeletonCards(3)}
    `;
  }

  _render(data) {
    const d = data || {};
    const kpis = d.kpis || {};
    const chart = d.chart || [];
    const overdue = d.overdue || [];
    const dueSoon = d.due_soon || [];
    const unpaid = d.unpaid || [];
    const topPayers = d.top_payers || [];
    const income_by_class = d.income_by_class || [];
    const worst_debtors = d.worst_debtors || [];
    const recent = d.recent_payments || [];
    const mom = d.month_over_month || {};
    const split = d.payment_split || {};

    const collectionRate = kpis.collection_rate || 0;
    const rateClass = collectionRate >= 80 ? 'good' : collectionRate >= 50 ? 'ok' : 'bad';

    this.container.innerHTML = `
      <!-- Page Header -->
      <div class="page-header flex justify-between" style="align-items:flex-start">
        <div>
          <div class="page-title">Dashboard</div>
          <div class="page-subtitle">${fmtMonth(this._currentMonth)}</div>
        </div>
        <div class="period-nav" style="margin:0;padding:5px 8px">
          <button class="period-nav-btn" id="dash-prev-month" title="Previous month">
            <i data-lucide="chevron-left"></i>
          </button>
          <span class="period-nav-label" style="padding:0 10px;font-size:12px">${fmtMonth(this._currentMonth)}</span>
          <button class="period-nav-btn" id="dash-next-month" title="Next month">
            <i data-lucide="chevron-right"></i>
          </button>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card green">
          <div class="kpi-label">Collected</div>
          <div class="kpi-value">${fmtShort(kpis.collected || 0)}</div>
          <div class="kpi-sub">This period</div>
          <div class="kpi-icon"><i data-lucide="banknote"></i></div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-label">Students</div>
          <div class="kpi-value">${kpis.student_count || 0}</div>
          <div class="kpi-sub">${kpis.group_count || 0} group(s)</div>
          <div class="kpi-icon"><i data-lucide="users"></i></div>
        </div>
        <div class="kpi-card red">
          <div class="kpi-label">Overdue</div>
          <div class="kpi-value">${kpis.overdue_count || 0}</div>
          <div class="kpi-sub">${fmt(kpis.overdue_amount || 0)}</div>
          <div class="kpi-icon"><i data-lucide="alert-triangle"></i></div>
        </div>
        <div class="kpi-card purple">
          <div class="kpi-label">All-time</div>
          <div class="kpi-value">${fmtShort(kpis.alltime || 0)}</div>
          <div class="kpi-sub">Total collected</div>
          <div class="kpi-icon"><i data-lucide="bar-chart-2"></i></div>
        </div>
      </div>

      <!-- Collection Rate -->
      <div class="card mb-3">
        <div class="card-body" style="padding:14px 16px">
          <div class="flex justify-between mb-2" style="align-items:center">
            <span class="section-title">Collection Rate</span>
            <span class="fw-800 text-${rateClass === 'good' ? 'green' : rateClass === 'ok' ? 'yellow' : 'red'}" style="font-size:15px">${collectionRate}%</span>
          </div>
          <div class="progress-wrap">
            <div class="progress-bar ${rateClass}" style="width:${Math.min(100, collectionRate)}%"></div>
          </div>
          <div class="flex justify-between mt-2">
            <span class="text-xs text-muted">${fmt(kpis.collected || 0)} collected</span>
            <span class="text-xs text-muted">${fmt((kpis.expected || 0) - (kpis.collected || 0))} remaining</span>
          </div>
        </div>
      </div>

      <!-- Month-over-month mini KPIs -->
      <div class="mini-kpi-row">
        <div class="mini-kpi">
          <div class="mini-kpi-val">${fmtShort(mom.this_month || 0)}</div>
          <div class="mini-kpi-lbl">This month</div>
        </div>
        <div class="mini-kpi">
          <div class="mini-kpi-val">${fmtShort(mom.last_month || 0)}</div>
          <div class="mini-kpi-lbl">Last month</div>
        </div>
        <div class="mini-kpi">
          <div class="mini-kpi-val ${mom.change >= 0 ? 'text-green' : 'text-red'}">${mom.change >= 0 ? '+' : ''}${mom.change || 0}%</div>
          <div class="mini-kpi-lbl">Change</div>
        </div>
      </div>

      <!-- Cash vs Transfer -->
      <div class="kpi-grid mb-3">
        <div class="kpi-card green" style="border-top-color:var(--green)">
          <div class="kpi-label"><i data-lucide="banknote" style="display:inline;width:10px;height:10px"></i> Cash</div>
          <div class="kpi-value">${fmtShort(split.cash || 0)}</div>
          <div class="kpi-sub">${split.cash_pct || 0}% of total</div>
        </div>
        <div class="kpi-card blue" style="border-top-color:var(--accent)">
          <div class="kpi-label"><i data-lucide="smartphone" style="display:inline;width:10px;height:10px"></i> Transfer</div>
          <div class="kpi-value">${fmtShort(split.transfer || 0)}</div>
          <div class="kpi-sub">${split.transfer_pct || 0}% of total</div>
        </div>
      </div>

      <!-- Overdue Alert Banner -->
      ${overdue.length > 0 ? `
      <div class="alert-banner alert-red mb-3">
        <i data-lucide="alert-triangle"></i>
        <div class="alert-banner-text">
          <strong>${overdue.length} overdue payment${overdue.length > 1 ? 's' : ''}</strong>
          <span>${overdue.slice(0,3).map(o => o.name).join(', ')}${overdue.length > 3 ? ` +${overdue.length - 3} more` : ''}</span>
        </div>
      </div>` : ''}

      <!-- Due Soon Banner -->
      ${dueSoon.length > 0 ? `
      <div class="alert-banner alert-orange mb-3">
        <i data-lucide="clock"></i>
        <div class="alert-banner-text">
          <strong>${dueSoon.length} payment${dueSoon.length > 1 ? 's' : ''} due within 5 days</strong>
          <span>${dueSoon.slice(0,3).map(d => d.name).join(', ')}${dueSoon.length > 3 ? ` +${dueSoon.length - 3} more` : ''}</span>
        </div>
      </div>` : ''}

      <!-- 6-month Revenue Chart -->
      <div class="card mb-3">
        <div class="card-header">
          <span class="card-title"><i data-lucide="bar-chart-2"></i> 6-Month Revenue</span>
        </div>
        <div class="card-body">
          <div class="chart-wrap" style="height:160px">
            <canvas id="dash-revenue-chart"></canvas>
          </div>
        </div>
      </div>

      <!-- Unpaid this period -->
      ${unpaid.length > 0 ? `
      <div class="card mb-3">
        <div class="card-header">
          <span class="card-title"><i data-lucide="credit-card"></i> Unpaid This Period</span>
          <span class="count-badge">${unpaid.length}</span>
        </div>
        <div class="card-body" style="padding:10px 16px">
          ${unpaid.slice(0,5).map(u => `
            <div class="recent-item">
              <div class="avatar avatar-sm" style="background:${avatarColor(u.name)}">${initials(u.name)}</div>
              <div class="recent-item-info">
                <div class="recent-item-name">${u.name}</div>
                <div class="recent-item-meta">${u.class_name || ''}</div>
              </div>
              <span class="tag tag-${u.days_overdue > 0 ? 'red' : 'yellow'}">${u.days_overdue > 0 ? u.days_overdue + 'd overdue' : 'Due ' + fmtDate(u.due_date)}</span>
            </div>
          `).join('')}
          ${unpaid.length > 5 ? `<div class="text-xs text-muted mt-2" style="text-align:center">+${unpaid.length - 5} more</div>` : ''}
        </div>
      </div>` : ''}

      <!-- Income by class -->
      ${income_by_class.length > 0 ? `
      <div class="card mb-3">
        <div class="card-header">
          <span class="card-title"><i data-lucide="layout-dashboard"></i> Income by Class</span>
        </div>
        <div class="card-body">
          ${income_by_class.map(cls => {
            const pct = cls.pct || 0;
            const barClass = pct >= 80 ? 'good' : pct >= 50 ? 'ok' : 'bad';
            return `
              <div class="subject-row">
                <div class="subject-row-header">
                  <span class="subject-row-name">${cls.name}</span>
                  <span>
                    <span class="subject-row-amount">${fmt(cls.amount)}</span>
                    <span class="subject-row-pct">${pct}%</span>
                  </span>
                </div>
                <div class="progress-wrap">
                  <div class="progress-bar ${barClass}" style="width:${pct}%"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Top Reliable Payers -->
      ${topPayers.length > 0 ? `
      <div class="card mb-3">
        <div class="card-header">
          <span class="card-title"><i data-lucide="flame"></i> Top Payers</span>
        </div>
        <div class="card-body" style="padding:8px 16px">
          ${topPayers.slice(0,5).map((p, i) => `
            <div class="top-payer-row">
              <span class="top-payer-rank">${i + 1}</span>
              <div class="avatar avatar-sm" style="background:${avatarColor(p.name)}">${initials(p.name)}</div>
              <div class="top-payer-info">
                <div class="top-payer-name">${p.name}</div>
                <div class="top-payer-sub">${fmt(p.total_paid)} total</div>
              </div>
              <div class="streak-badge"><i data-lucide="flame"></i> ${p.streak || 0}</div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <!-- Worst Debtors -->
      ${worst_debtors.length > 0 ? `
      <div class="card mb-3">
        <div class="card-header">
          <span class="card-title"><i data-lucide="alert-triangle"></i> Worst Debtors</span>
        </div>
        <div class="card-body" style="padding:8px 16px">
          ${worst_debtors.slice(0,5).map(w => `
            <div class="recent-item">
              <div class="avatar avatar-sm" style="background:${avatarColor(w.name)}">${initials(w.name)}</div>
              <div class="recent-item-info">
                <div class="recent-item-name">${w.name}</div>
                <div class="recent-item-meta">${w.months_owed || 0} month(s) owed</div>
              </div>
              <span class="fw-bold text-red" style="font-size:13px">${fmt(w.total_owed)}</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <!-- Recent Payments -->
      <div class="card mb-3">
        <div class="card-header">
          <span class="card-title"><i data-lucide="receipt"></i> Recent Payments</span>
        </div>
        <div class="card-body" style="padding:8px 16px">
          ${recent.length === 0 ? `<div class="empty-state" style="padding:20px"><i data-lucide="credit-card"></i><div class="empty-state-text">No recent payments</div></div>` :
            recent.slice(0,10).map(p => `
              <div class="recent-item">
                <div class="avatar avatar-sm" style="background:${avatarColor(p.name)}">${initials(p.name)}</div>
                <div class="recent-item-info">
                  <div class="recent-item-name">${p.name}</div>
                  <div class="recent-item-meta">${fmtDate(p.paid_at)} · ${p.method || 'Cash'}</div>
                </div>
                <span class="recent-item-amount">${fmt(p.amount)}</span>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;

    // Init icons
    if (window.lucide) lucide.createIcons();

    // Period nav buttons
    document.getElementById('dash-prev-month')?.addEventListener('click', () => {
      this._currentMonth = addMonths(this._currentMonth, -1);
      this.load();
    });
    document.getElementById('dash-next-month')?.addEventListener('click', () => {
      this._currentMonth = addMonths(this._currentMonth, 1);
      this.load();
    });

    // Draw chart
    this._drawChart(chart);
  }

  _drawChart(chartData) {
    const canvas = document.getElementById('dash-revenue-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = chartData.map(c => c.label || '');
    const values = chartData.map(c => c.amount || 0);
    const max = Math.max(...values, 1);

    const W = canvas.offsetWidth || 300;
    const H = 140;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, W, H);

    const barCount = labels.length;
    if (barCount === 0) return;

    const padL = 10, padR = 10, padT = 12, padB = 24;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const gap = 8;
    const barW = (chartW - gap * (barCount - 1)) / barCount;

    // Grid lines
    ctx.strokeStyle = 'rgba(30,58,95,0.6)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = padT + chartH - (chartH * i / 4);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    values.forEach((val, i) => {
      const bH = (val / max) * chartH;
      const x = padL + i * (barW + gap);
      const y = padT + chartH - bH;

      // Gradient fill
      const grad = ctx.createLinearGradient(x, y, x, padT + chartH);
      grad.addColorStop(0, 'rgba(56,189,248,0.85)');
      grad.addColorStop(1, 'rgba(14,165,233,0.15)');
      ctx.fillStyle = grad;

      // Rounded top bar
      const r = Math.min(4, barW / 2, bH / 2);
      if (bH > 0) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.arcTo(x + barW, y, x + barW, y + r, r);
        ctx.lineTo(x + barW, padT + chartH);
        ctx.lineTo(x, padT + chartH);
        ctx.arcTo(x, y + r, x + r, y, r);
        ctx.closePath();
        ctx.fill();
      }

      // Label
      ctx.fillStyle = 'rgba(122,156,192,0.8)';
      ctx.font = `500 9px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x + barW / 2, H - 6);
    });
  }
}
