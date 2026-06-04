/**
 * LessonPay — modules/attendance.js
 * Attendance marking for a given date.
 */

import { escHtml, toast, initials, avatarColor, today, fmtDate } from '../utils.js';

const STATUS = { present: 'P', absent: 'A', excused: 'E' };

export class AttendanceModule {
  constructor(container, api) {
    this.container = container;
    this.api = api;
    this._date = today();
    this._records = {}; // studentId → status
    this._students = [];
  }

  async load() {
    this._renderLayout();
    await this._fetchAttendance();
  }

  _renderLayout() {
    this.container.innerHTML = `
      <div class="page-header">
        <div class="page-title">Attendance</div>
        <div class="page-subtitle">Mark daily attendance</div>
      </div>

      <!-- Date navigator -->
      <div class="date-nav mb-3">
        <button class="icon-btn" id="att-prev-day" title="Previous day">
          <i data-lucide="arrow-left"></i>
        </button>
        <div class="date-nav-label">
          <input type="date" id="att-date-input" value="${this._date}" class="form-input" style="text-align:center;color-scheme:dark">
        </div>
        <button class="icon-btn" id="att-next-day" title="Next day">
          <i data-lucide="arrow-right"></i>
        </button>
      </div>

      <!-- Summary strip -->
      <div class="att-summary-strip" id="att-summary"></div>

      <!-- Quick action -->
      <div class="flex gap-2 mb-3">
        <button class="btn btn-ghost btn-sm flex-1" id="att-mark-all-present">
          <i data-lucide="check-circle"></i> Mark All Present
        </button>
        <button class="btn btn-ghost btn-sm flex-1" id="att-clear-all">
          <i data-lucide="x"></i> Clear All
        </button>
      </div>

      <!-- Student list -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i data-lucide="clipboard-check"></i> Students</span>
          <span class="count-badge" id="att-student-count">0</span>
        </div>
        <div class="card-body" style="padding:8px 16px" id="att-student-list">
          <div class="empty-state"><i data-lucide="refresh-cw" class="spin"></i><div class="empty-state-text">Loading…</div></div>
        </div>
      </div>

      <!-- Save button -->
      <div style="position:sticky;bottom:calc(var(--bottom-nav-height) + 12px);padding-top:12px">
        <button class="btn btn-success btn-block" id="att-save-btn">
          <i data-lucide="check-circle"></i> Save Attendance
        </button>
      </div>
    `;

    if (window.lucide) lucide.createIcons();

    // Date navigation
    document.getElementById('att-prev-day')?.addEventListener('click', () => {
      const d = new Date(this._date);
      d.setDate(d.getDate() - 1);
      this._date = d.toISOString().slice(0, 10);
      document.getElementById('att-date-input').value = this._date;
      this._fetchAttendance();
    });

    document.getElementById('att-next-day')?.addEventListener('click', () => {
      const d = new Date(this._date);
      d.setDate(d.getDate() + 1);
      this._date = d.toISOString().slice(0, 10);
      document.getElementById('att-date-input').value = this._date;
      this._fetchAttendance();
    });

    document.getElementById('att-date-input')?.addEventListener('change', (e) => {
      this._date = e.target.value;
      this._fetchAttendance();
    });

    document.getElementById('att-mark-all-present')?.addEventListener('click', () => {
      this._students.forEach(s => { this._records[s.id] = 'present'; });
      this._renderStudentList();
      this._renderSummary();
    });

    document.getElementById('att-clear-all')?.addEventListener('click', () => {
      this._students.forEach(s => { this._records[s.id] = ''; });
      this._renderStudentList();
      this._renderSummary();
    });

    document.getElementById('att-save-btn')?.addEventListener('click', () => this._save());
  }

  async _fetchAttendance() {
    const listEl = document.getElementById('att-student-list');
    if (listEl) listEl.innerHTML = `<div class="empty-state"><i data-lucide="refresh-cw" class="spin"></i><div class="empty-state-text">Loading…</div></div>`;
    if (window.lucide) lucide.createIcons();

    try {
      const [attData, students] = await Promise.all([
        this.api.getAttendance(this._date),
        this._students.length > 0 ? Promise.resolve(this._students) : this.api.getStudents(),
      ]);

      this._students = students || [];
      this._records = {};

      // Populate from existing records
      (attData?.records || []).forEach(r => {
        this._records[r.student_id] = r.status;
      });

      // Default unmarked students
      this._students.forEach(s => {
        if (!this._records[s.id]) this._records[s.id] = '';
      });

      const countEl = document.getElementById('att-student-count');
      if (countEl) countEl.textContent = this._students.length;

      this._renderStudentList();
      this._renderSummary();
    } catch (e) {
      if (listEl) listEl.innerHTML = `<div class="empty-state"><i data-lucide="alert-triangle"></i><div class="empty-state-text">${e.message}</div></div>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  _renderSummary() {
    const el = document.getElementById('att-summary');
    if (!el) return;

    const counts = { present: 0, absent: 0, excused: 0, unmarked: 0 };
    this._students.forEach(s => {
      const st = this._records[s.id];
      if (st === 'present') counts.present++;
      else if (st === 'absent') counts.absent++;
      else if (st === 'excused') counts.excused++;
      else counts.unmarked++;
    });

    el.innerHTML = `
      <div class="att-summary-item">
        <div class="att-summary-count text-green">${counts.present}</div>
        <div class="att-summary-label">Present</div>
      </div>
      <div class="att-summary-item">
        <div class="att-summary-count text-red">${counts.absent}</div>
        <div class="att-summary-label">Absent</div>
      </div>
      <div class="att-summary-item">
        <div class="att-summary-count text-yellow">${counts.excused}</div>
        <div class="att-summary-label">Excused</div>
      </div>
      <div class="att-summary-item">
        <div class="att-summary-count text-muted">${counts.unmarked}</div>
        <div class="att-summary-label">Unmarked</div>
      </div>
    `;
  }

  _renderStudentList() {
    const el = document.getElementById('att-student-list');
    if (!el) return;

    if (this._students.length === 0) {
      el.innerHTML = `<div class="empty-state"><i data-lucide="users"></i><div class="empty-state-text">No students found</div></div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    el.innerHTML = this._students.map(s => {
      const status = this._records[s.id] || '';
      return `
        <div class="attendance-item">
          <div class="avatar avatar-sm" style="background:${avatarColor(s.name)}">${initials(s.name)}</div>
          <div class="att-info">
            <div class="att-name">${escHtml(s.name)}</div>
            <div class="att-meta">${escHtml(s.class_name || '')}${s.subject ? ' · ' + escHtml(s.subject) : ''}</div>
          </div>
          <div class="att-btns">
            <button class="att-btn present ${status === 'present' ? 'active' : ''}" data-sid="${s.id}" data-status="present" title="Present">P</button>
            <button class="att-btn absent ${status === 'absent' ? 'active' : ''}" data-sid="${s.id}" data-status="absent" title="Absent">A</button>
            <button class="att-btn excused ${status === 'excused' ? 'active' : ''}" data-sid="${s.id}" data-status="excused" title="Excused">E</button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();

    // Bind buttons
    el.querySelectorAll('.att-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sid = parseInt(btn.dataset.sid);
        const newStatus = btn.dataset.status;
        // Toggle off if already active
        if (this._records[sid] === newStatus) {
          this._records[sid] = '';
        } else {
          this._records[sid] = newStatus;
        }
        // Update button states without full re-render for performance
        const row = btn.closest('.attendance-item');
        row?.querySelectorAll('.att-btn').forEach(b => {
          b.classList.toggle('active', this._records[sid] === b.dataset.status);
        });
        this._renderSummary();
      });
    });
  }

  async _save() {
    const btn = document.getElementById('att-save-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="refresh-cw" class="spin"></i> Saving…'; if (window.lucide) lucide.createIcons(); }

    const records = this._students
      .filter(s => this._records[s.id])
      .map(s => ({ student_id: s.id, status: this._records[s.id] }));

    try {
      await this.api.saveAttendance(this._date, records);
      toast('Attendance saved', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check-circle"></i> Save Attendance';
        if (window.lucide) lucide.createIcons();
      }
    }
  }
}
