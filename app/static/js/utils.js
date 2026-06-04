/**
 * LessonPay — utils.js
 * Shared helper functions.
 */

// ── Currency formatting ─────────────────────────────────────

/** Format a number as ₦1,234 */
export function fmt(n) {
  const num = Number(n) || 0;
  return '₦' + num.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Format a number as ₦1.2k or ₦2.5M */
export function fmtShort(n) {
  const num = Number(n) || 0;
  if (Math.abs(num) >= 1_000_000) return '₦' + (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(num) >= 1_000) return '₦' + (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '₦' + num;
}

// ── Date formatting ─────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** "01 Jan 2024" */
export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dd} ${MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}`;
}

/** "01 January 2024, 10:30 AM" */
export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dd} ${MONTHS_LONG[dt.getMonth()]} ${dt.getFullYear()}, ${h}:${m} ${ampm}`;
}

/** "2024-01" → "January 2024" */
export function fmtMonth(m) {
  if (!m) return '—';
  const parts = m.split('-');
  if (parts.length < 2) return m;
  const year = parts[0];
  const month = parseInt(parts[1], 10) - 1;
  if (month < 0 || month > 11) return m;
  return `${MONTHS_LONG[month]} ${year}`;
}

/** Today's date as YYYY-MM-DD */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Current datetime as YYYY-MM-DDTHH:MM (for datetime-local inputs) */
export function todayLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Get current YYYY-MM month string */
export function currentMonth() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Add N months to a YYYY-MM string */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Days until a date (negative = overdue) */
export function daysUntil(dateStr) {
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86_400_000);
}

// ── String helpers ──────────────────────────────────────────

/** First letters of first 2 words of a name */
export function initials(name) {
  if (!name) return '??';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Escape HTML entities */
export function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Avatar colors ───────────────────────────────────────────

const AVATAR_COLORS = [
  'linear-gradient(135deg,#0ea5e9,#6366f1)',
  'linear-gradient(135deg,#a78bfa,#ec4899)',
  'linear-gradient(135deg,#34d399,#059669)',
  'linear-gradient(135deg,#fb923c,#ef4444)',
  'linear-gradient(135deg,#fbbf24,#f97316)',
  'linear-gradient(135deg,#38bdf8,#a78bfa)',
  'linear-gradient(135deg,#f472b6,#a78bfa)',
  'linear-gradient(135deg,#4ade80,#22d3ee)',
];

export function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Toast ───────────────────────────────────────────────────

/**
 * Show a toast notification.
 * @param {string} msg
 * @param {'info'|'success'|'error'|'warning'} type
 * @param {number} duration ms (default 3500)
 */
export function toast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const iconMap = {
    success: 'check-circle',
    error:   'alert-triangle',
    info:    'info',
    warning: 'alert-triangle',
  };

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <i data-lucide="${iconMap[type] || 'info'}"></i>
    <span>${escHtml(msg)}</span>
  `;
  container.appendChild(el);

  if (window.lucide) lucide.createIcons({ el });

  const remove = () => {
    el.classList.add('hide');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ── WhatsApp reminder ───────────────────────────────────────

/**
 * Open a WhatsApp chat with a pre-filled reminder message.
 * @param {object} opts
 * @param {string} opts.phone
 * @param {string} opts.studentName
 * @param {string} opts.contactName
 * @param {number} opts.amount
 * @param {string} opts.month  "YYYY-MM"
 * @param {string} opts.dueDate "YYYY-MM-DD"
 */
export function whatsappReminder({ phone, studentName, contactName, amount, month, dueDate }) {
  if (!phone) { toast('No phone number on record', 'error'); return; }
  const name = contactName || 'Parent/Guardian';
  const monthStr = fmtMonth(month);
  const dateStr = fmtDate(dueDate);
  const message =
    `Hello ${name}, this is a reminder that ${studentName}'s lesson fee of ${fmt(amount)} for ${monthStr} is due on ${dateStr}. ` +
    `Please make payment at your earliest convenience. Thank you!`;
  const cleaned = String(phone).replace(/\D/g, '').replace(/^0/, '');
  window.open(`https://wa.me/234${cleaned}?text=${encodeURIComponent(message)}`, '_blank');
}

// ── Misc ───────────────────────────────────────────────────

/** Debounce a function */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Generate a deterministic skeleton count */
export function skeletonCards(n = 3) {
  return Array.from({ length: n }, () =>
    `<div class="skeleton skeleton-card mb-3"></div>`
  ).join('');
}

/** Format payment days countdown text */
export function daysLabel(days) {
  if (days === 0) return 'Due today';
  if (days > 0) return `Due in ${days}d`;
  return `${Math.abs(days)}d overdue`;
}

/** Status color helper */
export function statusColor(status) {
  switch (status) {
    case 'paid': return 'green';
    case 'overdue': return 'red';
    case 'pending': return 'yellow';
    default: return 'gray';
  }
}
