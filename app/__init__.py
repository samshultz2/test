import os
import secrets
import threading
import time
import json
from datetime import datetime

from flask import Flask, session, request, jsonify, g
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import generate_password_hash

from .config import Config
from .database import get_db, close_db, init_db


limiter = Limiter(key_func=get_remote_address)


def create_app(config_class=Config):
    app = Flask(__name__, template_folder="templates")
    app.config.from_object(config_class)

    # Ensure backup directory exists
    os.makedirs(app.config["BACKUP_DIR"], exist_ok=True)

    # Initialize extensions
    limiter.init_app(app)

    # Register DB teardown
    app.teardown_appcontext(close_db)

    # Initialize DB schema
    init_db(app)

    # Seed default credentials if missing
    _seed_credentials(app)

    # Run billing migration on startup
    with app.app_context():
        from .models import migrate_payment_months, sync_all_billing
        migrate_payment_months()
        sync_all_billing()

    # Register blueprints
    from .auth.routes import auth_bp
    from .api.students import students_bp
    from .api.payments import payments_bp
    from .api.groups import groups_bp
    from .api.reports import reports_bp
    from .api.system import system_bp
    from .main.routes import main_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(students_bp)
    app.register_blueprint(payments_bp)
    app.register_blueprint(groups_bp)
    app.register_blueprint(reports_bp)
    app.register_blueprint(system_bp)
    app.register_blueprint(main_bp)

    # Security headers + CSRF token injection on every response
    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Inject CSRF token header if one exists in session
        if "csrf_token" in session:
            response.headers["X-CSRF-Token"] = session["csrf_token"]
        return response

    # CSRF enforcement middleware
    @app.before_request
    def enforce_csrf():
        # Skip CSRF for safe methods and exempt endpoints
        exempt_paths = {"/auth/login", "/auth/logout", "/auth/status", "/auth/csrf-token"}
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        if request.path in exempt_paths:
            return None
        # Only enforce on /api/* routes
        if not request.path.startswith("/api/") and not request.path.startswith("/auth/"):
            return None

        token_in_session = session.get("csrf_token")
        token_in_header = request.headers.get("X-CSRF-Token")

        if not token_in_session or not token_in_header:
            return jsonify({"error": "CSRF token missing"}), 403
        if token_in_session != token_in_header:
            return jsonify({"error": "CSRF token invalid"}), 403

    # Start auto-backup background thread
    t = threading.Thread(target=auto_backup_scheduler, args=(app,), daemon=True)
    t.start()

    return app


def _seed_credentials(app):
    """Ensure default password hash exists in app_settings."""
    with app.app_context():
        db = get_db()
        row = db.execute("SELECT value FROM app_settings WHERE key='password_hash'").fetchone()
        if not row:
            hashed = generate_password_hash(app.config["DEFAULT_PASSWORD"])
            db.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('password_hash', ?)",
                (hashed,),
            )
            db.commit()


def auto_backup_scheduler(app):
    """Background thread: create a daily JSON backup, keep last 7."""
    import sqlite3 as _sqlite3

    backup_dir = app.config["BACKUP_DIR"]
    db_path = app.config["DATABASE"]

    while True:
        try:
            now = datetime.now()
            filename = f"backup_{now.strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(backup_dir, filename)

            conn = _sqlite3.connect(db_path)
            conn.row_factory = _sqlite3.Row

            data = {}
            tables = [
                "family_groups", "students", "payments", "group_payments",
                "activity_log", "lesson_schedule", "attendance", "app_settings",
            ]
            for table in tables:
                rows = conn.execute(f"SELECT * FROM {table}").fetchall()
                data[table] = [dict(r) for r in rows]
            conn.close()

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, default=str)

            # Prune: keep only last 7 backups
            backups = sorted(
                [f for f in os.listdir(backup_dir) if f.startswith("backup_") and f.endswith(".json")]
            )
            while len(backups) > 7:
                os.remove(os.path.join(backup_dir, backups.pop(0)))

        except Exception:
            pass  # Never crash the background thread

        # Sleep 24 hours
        time.sleep(86400)
