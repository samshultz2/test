/**
 * LessonPay — modules/auth.js
 * Handles login, PIN pad, and lock screen.
 */

import { toast } from '../utils.js';

export class AuthModule {
  constructor(api) {
    this.api = api;
    this.onAuthenticated = null; // callback
    this._pinBuffer = '';
    this._mode = 'login'; // 'login' | 'lock'
    this._activeTab = 'pin';
    this._hasPin = false;
  }

  /** Initialize auth module — bind DOM elements */
  init() {
    this._overlay     = document.getElementById('auth-overlay');
    this._lockOverlay = document.getElementById('lock-overlay');

    // Login screen elements
    this._tabPin      = document.getElementById('auth-tab-pin');
    this._tabPass     = document.getElementById('auth-tab-password');
    this._pinSection  = document.getElementById('auth-pin-section');
    this._passSection = document.getElementById('auth-pass-section');
    this._pinDots     = document.querySelectorAll('.pin-dot');
    this._pinKeys     = document.querySelectorAll('.pin-key');
    this._passInput   = document.getElementById('auth-password-input');
    this._passSubmit  = document.getElementById('auth-pass-submit');
    this._authError   = document.getElementById('auth-error');

    // Lock screen elements
    this._lockPinSection  = document.getElementById('lock-pin-section');
    this._lockPassSection = document.getElementById('lock-pass-section');
    this._lockTabPin      = document.getElementById('lock-tab-pin');
    this._lockTabPass     = document.getElementById('lock-tab-password');
    this._lockPinDots     = document.querySelectorAll('.lock-pin-dot');
    this._lockPinKeys     = document.querySelectorAll('.lock-pin-key');
    this._lockPassInput   = document.getElementById('lock-password-input');
    this._lockPassSubmit  = document.getElementById('lock-pass-submit');
    this._lockError       = document.getElementById('lock-error');

    this._bindLoginEvents();
    this._bindLockEvents();

    // Listen for auth:required events from api.js
    document.addEventListener('auth:required', () => this.showLogin());
  }

  /** Check auth status on app load */
  async checkStatus() {
    try {
      const status = await this.api.authStatus();
      this._hasPin = status.has_pin;
      return status.authenticated;
    } catch (e) {
      return false;
    }
  }

  /** Show the login overlay */
  showLogin() {
    this._mode = 'login';
    this._pinBuffer = '';
    this._updatePinDots(this._pinDots);
    if (this._authError) this._authError.textContent = '';
    this._overlay?.classList.remove('hidden');
    // Default to PIN if available
    if (this._hasPin) {
      this._switchLoginTab('pin');
    } else {
      this._switchLoginTab('password');
    }
  }

  /** Hide the login overlay */
  hideLogin() {
    this._overlay?.classList.add('hidden');
  }

  /** Show the auto-lock overlay */
  showLock() {
    this._mode = 'lock';
    this._pinBuffer = '';
    this._updatePinDots(this._lockPinDots);
    if (this._lockError) this._lockError.textContent = '';
    this._lockOverlay?.classList.add('visible');
    if (this._hasPin) {
      this._switchLockTab('pin');
    } else {
      this._switchLockTab('password');
    }
  }

  /** Hide the auto-lock overlay */
  hideLock() {
    this._lockOverlay?.classList.remove('visible');
  }

  // ── Private: Login Events ──────────────────────────────────

  _bindLoginEvents() {
    this._tabPin?.addEventListener('click', () => this._switchLoginTab('pin'));
    this._tabPass?.addEventListener('click', () => this._switchLoginTab('password'));

    // PIN keys
    this._pinKeys?.forEach((key) => {
      key.addEventListener('click', () => {
        const val = key.dataset.val;
        if (val !== undefined) this._handlePinInput(val, 'login');
      });
    });

    // Password submit
    this._passSubmit?.addEventListener('click', () => this._submitPassword('login'));
    this._passInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitPassword('login');
    });
  }

  // ── Private: Lock Events ───────────────────────────────────

  _bindLockEvents() {
    this._lockTabPin?.addEventListener('click', () => this._switchLockTab('pin'));
    this._lockTabPass?.addEventListener('click', () => this._switchLockTab('password'));

    this._lockPinKeys?.forEach((key) => {
      key.addEventListener('click', () => {
        const val = key.dataset.val;
        if (val !== undefined) this._handlePinInput(val, 'lock');
      });
    });

    this._lockPassSubmit?.addEventListener('click', () => this._submitPassword('lock'));
    this._lockPassInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitPassword('lock');
    });
  }

  // ── Tab switching ──────────────────────────────────────────

  _switchLoginTab(tab) {
    this._activeTab = tab;
    const isPIN = tab === 'pin';
    this._tabPin?.classList.toggle('active', isPIN);
    this._tabPass?.classList.toggle('active', !isPIN);
    this._pinSection?.classList.toggle('hidden', !isPIN);
    this._passSection?.classList.toggle('hidden', isPIN);
    if (!isPIN) this._passInput?.focus();
  }

  _switchLockTab(tab) {
    const isPIN = tab === 'pin';
    this._lockTabPin?.classList.toggle('active', isPIN);
    this._lockTabPass?.classList.toggle('active', !isPIN);
    this._lockPinSection?.classList.toggle('hidden', !isPIN);
    this._lockPassSection?.classList.toggle('hidden', isPIN);
    if (!isPIN) this._lockPassInput?.focus();
  }

  // ── PIN input ──────────────────────────────────────────────

  _handlePinInput(val, mode) {
    const dots = mode === 'login' ? this._pinDots : this._lockPinDots;
    const errEl = mode === 'login' ? this._authError : this._lockError;

    if (val === 'clear') {
      this._pinBuffer = this._pinBuffer.slice(0, -1);
    } else if (val === 'enter') {
      if (this._pinBuffer.length === 4) {
        this._submitPin(mode);
      }
      return;
    } else {
      if (this._pinBuffer.length >= 4) return;
      this._pinBuffer += val;
    }

    if (errEl) errEl.textContent = '';
    this._updatePinDots(dots);

    if (this._pinBuffer.length === 4) {
      setTimeout(() => this._submitPin(mode), 200);
    }
  }

  _updatePinDots(dots) {
    if (!dots) return;
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < this._pinBuffer.length);
    });
  }

  // ── Submission ─────────────────────────────────────────────

  async _submitPin(mode) {
    if (this._pinBuffer.length !== 4) return;
    const pin = this._pinBuffer;
    this._pinBuffer = '';
    const dots = mode === 'login' ? this._pinDots : this._lockPinDots;
    const errEl = mode === 'login' ? this._authError : this._lockError;
    this._updatePinDots(dots);

    try {
      await this.api.login(pin, 'pin');
      this._onSuccess(mode);
    } catch (e) {
      if (errEl) errEl.textContent = 'Incorrect PIN. Try again.';
      this._shakeError(errEl);
    }
  }

  async _submitPassword(mode) {
    const input = mode === 'login' ? this._passInput : this._lockPassInput;
    const errEl = mode === 'login' ? this._authError : this._lockError;
    const password = input?.value?.trim();

    if (!password) { if (errEl) errEl.textContent = 'Please enter your password.'; return; }

    try {
      await this.api.login(password, 'password');
      if (input) input.value = '';
      this._onSuccess(mode);
    } catch (e) {
      if (errEl) errEl.textContent = 'Incorrect password. Try again.';
      this._shakeError(errEl);
    }
  }

  _onSuccess(mode) {
    if (mode === 'login') {
      this.hideLogin();
    } else {
      this.hideLock();
    }
    if (this.onAuthenticated) this.onAuthenticated(mode);
    toast('Welcome back!', 'success', 2000);
  }

  _shakeError(el) {
    if (!el) return;
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'toastIn 0.3s ease';
  }
}
