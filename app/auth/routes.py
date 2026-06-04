import secrets
from flask import Blueprint, request, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash

from ..database import get_db
from .. import limiter

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


def _get_setting(db, key):
    row = db.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def _set_setting(db, key, value):
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        (key, value),
    )
    db.commit()


def _ensure_csrf():
    """Ensure a CSRF token exists in the session; return it."""
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(32)
    return session["csrf_token"]


@auth_bp.route("/login", methods=["POST"])
@limiter.limit("10 per 15 minutes")
def login():
    data = request.get_json(silent=True) or {}
    credential = data.get("credential", "")
    cred_type = data.get("type", "password")  # 'password' or 'pin'

    if not credential:
        return jsonify({"error": "Credential required"}), 400

    db = get_db()

    if cred_type == "pin":
        pin_hash = _get_setting(db, "pin_hash")
        if not pin_hash:
            return jsonify({"error": "PIN not configured"}), 401
        if not check_password_hash(pin_hash, credential):
            return jsonify({"error": "Invalid PIN"}), 401
    else:
        password_hash = _get_setting(db, "password_hash")
        if not password_hash:
            return jsonify({"error": "No password configured"}), 500
        if not check_password_hash(password_hash, credential):
            return jsonify({"error": "Invalid password"}), 401

    session.clear()
    session["authenticated"] = True
    csrf_token = secrets.token_hex(32)
    session["csrf_token"] = csrf_token

    return jsonify({"success": True, "csrf_token": csrf_token}), 200


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"success": True}), 200


@auth_bp.route("/status", methods=["GET"])
def status():
    db = get_db()
    has_pin = bool(_get_setting(db, "pin_hash"))
    _ensure_csrf()
    return jsonify({
        "authenticated": bool(session.get("authenticated")),
        "has_pin": has_pin,
    }), 200


@auth_bp.route("/csrf-token", methods=["GET"])
def csrf_token():
    token = _ensure_csrf()
    return jsonify({"csrf_token": token}), 200


@auth_bp.route("/change-password", methods=["POST"])
def change_password():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    current = data.get("current", "")
    new_password = data.get("new_password", "")

    if not current or not new_password:
        return jsonify({"error": "current and new_password are required"}), 400

    db = get_db()
    password_hash = _get_setting(db, "password_hash")
    if not password_hash or not check_password_hash(password_hash, current):
        return jsonify({"error": "Current password is incorrect"}), 401

    if len(new_password) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400

    _set_setting(db, "password_hash", generate_password_hash(new_password))
    return jsonify({"success": True}), 200


@auth_bp.route("/change-pin", methods=["POST"])
def change_pin():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password", "")
    pin = data.get("pin", "")

    if not current_password:
        return jsonify({"error": "current_password is required"}), 400

    db = get_db()
    password_hash = _get_setting(db, "password_hash")
    if not password_hash or not check_password_hash(password_hash, current_password):
        return jsonify({"error": "Current password is incorrect"}), 401

    if pin == "":
        # Remove PIN
        db.execute("DELETE FROM app_settings WHERE key='pin_hash'")
        db.commit()
        return jsonify({"success": True, "message": "PIN removed"}), 200

    if len(pin) < 4:
        return jsonify({"error": "PIN must be at least 4 digits"}), 400

    _set_setting(db, "pin_hash", generate_password_hash(pin))
    return jsonify({"success": True}), 200
