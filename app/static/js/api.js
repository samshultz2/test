/**
 * LessonPay — api.js
 * API client with CSRF token management and 401/auth handling.
 */

export class ApiClient {
  constructor() {
    this._csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  refreshCsrf(token) {
    if (token) this._csrf = token;
  }

  async _fetch(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this._csrf && method !== 'GET') {
      headers['X-CSRF-Token'] = this._csrf;
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      throw new Error('Network error — please check your connection');
    }

    const newCsrf = res.headers.get('X-CSRF-Token');
    if (newCsrf) this.refreshCsrf(newCsrf);

    if (res.status === 401) {
      document.dispatchEvent(new CustomEvent('auth:required'));
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      let errMsg = 'Request failed';
      try {
        const errBody = await res.json();
        errMsg = errBody.error || errBody.message || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  get(url)          { return this._fetch('GET', url); }
  post(url, body)   { return this._fetch('POST', url, body); }
  put(url, body)    { return this._fetch('PUT', url, body); }
  delete(url)       { return this._fetch('DELETE', url); }

  // ── Auth ────────────────────────────────────────────────────────
  authStatus()                  { return this.get('/auth/status'); }
  login(credential, type)       { return this.post('/auth/login', { credential, type }); }
  logout()                      { return this.post('/auth/logout', {}); }
  changePassword(data)          { return this.post('/auth/change-password', data); }
  changePin(data)               { return this.post('/auth/change-pin', data); }
  getCsrfToken()                { return this.get('/auth/csrf-token'); }

  // ── Dashboard ───────────────────────────────────────────────────
  getDashboard(month)           { return this.get('/api/dashboard' + (month ? '?month=' + encodeURIComponent(month) : '')); }

  // ── Students ────────────────────────────────────────────────────
  getStudents()                 { return this.get('/api/students'); }
  createStudent(data)           { return this.post('/api/students', data); }
  updateStudent(id, data)       { return this.put(`/api/students/${id}`, data); }
  archiveStudent(id)            { return this.delete(`/api/students/${id}`); }
  restoreStudent(id)            { return this.post(`/api/students/${id}/restore`, {}); }
  getArchivedStudents()         { return this.get('/api/students/archived'); }
  getStudentPayments(id)        { return this.get(`/api/students/${id}/payments`); }
  getStudentPaymentsArchived(id){ return this.get(`/api/students/${id}/payments/archived`); }
  getStudentLog(id)             { return this.get(`/api/students/${id}/log`); }
  getStudentSchedule(id)        { return this.get(`/api/students/${id}/schedule`); }
  saveStudentSchedule(id, slots){ return this.post(`/api/students/${id}/schedule`, slots); }
  getStudentAttendance(id)      { return this.get(`/api/students/${id}/attendance`); }
  holdStudent(id)               { return this.post(`/api/students/${id}/hold`, {}); }
  checkDuplicateStudent(name)   { return this.get(`/api/students/check_duplicate?name=${encodeURIComponent(name)}`); }

  // ── Payments ────────────────────────────────────────────────────
  addPaymentRecord(data)        { return this.post('/api/payments', data); }
  deletePayment(id)             { return this.delete(`/api/payments/${id}`); }
  markPaid(id, data)            { return this.post(`/api/payments/${id}/mark_paid`, data); }
  unmarkPaid(id)                { return this.post(`/api/payments/${id}/unmark`, {}); }
  bulkMarkPaid(data)            { return this.post('/api/payments/bulk_paid', data); }
  checkDuplicatePayment(data)   { return this.post('/api/payments/check_duplicate', data); }
  getPayments(params = {})    { const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v))).toString(); return this.get(`/api/payments${qs ? '?' + qs : ''}`); }
  undoPayment(id, isGroup)    { return isGroup ? this.unmarkGroupPaid(id) : this.unmarkPaid(id); }
  bulkPay(indIds, grpIds, d)  { return this.bulkMarkPaid({ pids: indIds, group_pids: grpIds, paid_date: d.paid_at, payment_method: d.method }); }

  // ── Groups ──────────────────────────────────────────────────────
  getGroups()                   { return this.get('/api/groups'); }
  createGroup(data)             { return this.post('/api/groups', data); }
  updateGroup(id, data)         { return this.put(`/api/groups/${id}`, data); }
  archiveGroup(id)              { return this.delete(`/api/groups/${id}`); }
  holdGroup(id)                 { return this.post(`/api/groups/${id}/hold`, {}); }
  getGroupPayments(id)          { return this.get(`/api/groups/${id}/payments`); }
  addGroupPaymentRecord(data)   { return this.post('/api/group_payments', data); }
  deleteGroupPayment(id)        { return this.delete(`/api/group_payments/${id}`); }
  markGroupPaid(id, data)       { return this.post(`/api/group_payments/${id}/mark_paid`, data); }
  unmarkGroupPaid(id)           { return this.post(`/api/group_payments/${id}/unmark`, {}); }

  // ── Reports & Stats ─────────────────────────────────────────────
  getStats()                    { return this.get('/api/stats'); }
  getMonthlyBreakdown()         { return this.get('/api/monthly_breakdown'); }
  getBySubject()                { return this.get('/api/by_subject'); }
  getActivityLog()              { return this.get('/api/activity_log'); }
  getReports(month)            { return this.get(`/api/reports?month=${encodeURIComponent(month || '')}`); }

  // ── System ──────────────────────────────────────────────────────
  sync()                        { return this.post('/api/ensure_month', {}); }
  exportCsv()                   { return '/api/export/csv'; }   // direct URL for download
  getBackupStatus()             { return this.get('/api/backup/auto_status'); }
  downloadBackup()              { return '/api/backup'; }        // direct URL for download
  triggerBackup()               { return this.post('/api/backup/trigger', {}); }

  // ── Timetable ───────────────────────────────────────────────────
  getTimetable()                { return this.get('/api/timetable'); }

  // ── Attendance ──────────────────────────────────────────────────
  getAttendanceByDate(dateStr)  { return this.get(`/api/attendance/${dateStr}`); }
  getAttendanceSummary(dateStr) { return this.get(`/api/attendance/summary/${dateStr}`); }
  saveAttendance(data)          { return this.post('/api/attendance', data); }
  bulkSaveAttendance(data)      { return this.post('/api/attendance/bulk', data); }
}

export const api = new ApiClient();
