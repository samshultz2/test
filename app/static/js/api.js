/**
 * LessonPay — api.js
 * API client with CSRF token management and auth handling.
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

    // Refresh CSRF token if server rotated it
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
      } catch (_) {
        // ignore JSON parse error
      }
      throw new Error(errMsg);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  get(url) { return this._fetch('GET', url); }
  post(url, body) { return this._fetch('POST', url, body); }
  put(url, body) { return this._fetch('PUT', url, body); }
  delete(url) { return this._fetch('DELETE', url); }

  // ── Domain methods ──────────────────────────────────────────

  // Auth
  authStatus() { return this.get('/auth/status'); }
  login(credential, type) { return this.post('/auth/login', { credential, type }); }
  logout() { return this.post('/auth/logout', {}); }
  changePassword(data) { return this.post('/auth/change-password', data); }
  changePin(data) { return this.post('/auth/change-pin', data); }

  // Dashboard
  getDashboard(month) { return this.get(`/api/dashboard?month=${month || ''}`); }

  // Students
  getStudents() { return this.get('/api/students'); }
  getStudent(id) { return this.get(`/api/students/${id}`); }
  createStudent(data) { return this.post('/api/students', data); }
  updateStudent(id, data) { return this.put(`/api/students/${id}`, data); }
  archiveStudent(id) { return this.delete(`/api/students/${id}`); }
  restoreStudent(id) { return this.post(`/api/students/${id}/restore`, {}); }
  getArchive() { return this.get('/api/students/archive'); }
  getStudentPayments(id) { return this.get(`/api/students/${id}/payments`); }

  // Payments
  getPayments(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/payments${qs ? '?' + qs : ''}`);
  }
  markPaid(id, data) { return this.post(`/api/payments/${id}/pay`, data); }
  undoPayment(id) { return this.post(`/api/payments/${id}/undo`, {}); }
  deletePayment(id) { return this.delete(`/api/payments/${id}`); }
  bulkPay(ids, data) { return this.post('/api/payments/bulk-pay', { ids, ...data }); }

  // Groups
  getGroups() { return this.get('/api/groups'); }
  getGroup(id) { return this.get(`/api/groups/${id}`); }
  createGroup(data) { return this.post('/api/groups', data); }
  updateGroup(id, data) { return this.put(`/api/groups/${id}`, data); }
  archiveGroup(id) { return this.delete(`/api/groups/${id}`); }
  payGroup(id, data) { return this.post(`/api/groups/${id}/pay`, data); }
  holdGroup(id) { return this.post(`/api/groups/${id}/hold`, {}); }
  resumeGroup(id) { return this.post(`/api/groups/${id}/resume`, {}); }

  // Reports
  getReports(month) { return this.get(`/api/reports?month=${month || ''}`); }
  getActivityLog() { return this.get('/api/reports/log'); }
  exportCsv() { return this.get('/api/reports/export/csv'); }
  getBackupStatus() { return this.get('/api/backup/status'); }
  triggerBackup() { return this.post('/api/backup/trigger', {}); }

  // Attendance
  getAttendance(date) { return this.get(`/api/attendance?date=${date}`); }
  saveAttendance(date, records) { return this.post('/api/attendance', { date, records }); }

  // Timetable
  getTimetable() { return this.get('/api/timetable'); }
  createTimetableSlot(data) { return this.post('/api/timetable', data); }
  deleteTimetableSlot(id) { return this.delete(`/api/timetable/${id}`); }

  // Student hold/resume
  holdStudent(id) { return this.post(`/api/students/${id}/hold`, {}); }
  resumeStudent(id) { return this.post(`/api/students/${id}/resume`, {}); }

  // Sync
  sync() { return this.post('/api/sync', {}); }
}

export const api = new ApiClient();
