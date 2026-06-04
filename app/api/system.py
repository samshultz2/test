import csv
import io
import json
import os
import time
import sqlite3 as _sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify, session, current_app, send_file

from ..database import get_db
from ..models import (
    log_activity,
    ensure_all_records,
    ensure_all_group_records,
    migrate_payment_months,
)

system_bp = Blueprint("system", __name__)

BACKUP_DIR = "auto_backups"


def _require_auth():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _get_backup_dir():
    return current_app.config.get("BACKUP_DIR", BACKUP_DIR)


# ---------------------------------------------------------------------------
# GET /api/export/csv
# ---------------------------------------------------------------------------
@system_bp.route("/api/export/csv", methods=["GET"])
def export_csv():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    rows = db.execute(
        "SELECT s.full_name, s.class, s.subject, s.monthly_fee, s.start_date, "
        "s.contact_name, s.contact_phone, s.notes, s.on_hold, "
        "p.payment_month, p.due_date, p.amount, p.is_paid, p.paid_date, "
        "p.payment_method, p.paid_by, p.payer_type "
        "FROM students s LEFT JOIN payments p ON p.student_id=s.id "
        "WHERE s.is_active=1 ORDER BY s.full_name, p.due_date"
    ).fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Name", "Class", "Subject", "Monthly Fee", "Start Date",
        "Contact Name", "Contact Phone", "Notes", "On Hold",
        "Payment Month", "Due Date", "Amount", "Is Paid", "Paid Date",
        "Payment Method", "Paid By", "Payer Type",
    ])
    for row in rows:
        writer.writerow([
            row["full_name"], row["class"], row["subject"], row["monthly_fee"],
            row["start_date"], row["contact_name"], row["contact_phone"],
            row["notes"], "Yes" if row["on_hold"] else "No",
            row["payment_month"] or "", row["due_date"] or "",
            row["amount"] or "", "Yes" if row["is_paid"] else "No",
            row["paid_date"] or "", row["payment_method"] or "",
            row["paid_by"] or "", row["payer_type"] or "",
        ])

    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"lessonpay_export_{datetime.now().strftime('%Y%m%d')}.csv",
    )


# ---------------------------------------------------------------------------
# GET /api/backup  — download JSON backup
# ---------------------------------------------------------------------------
@system_bp.route("/api/backup", methods=["GET"])
def backup():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    tables = [
        "family_groups", "students", "payments", "group_payments",
        "activity_log", "lesson_schedule", "attendance", "app_settings",
    ]
    data = {}
    for table in tables:
        rows = db.execute(f"SELECT * FROM {table}").fetchall()
        data[table] = [dict(r) for r in rows]

    data["_meta"] = {
        "exported_at": datetime.now().isoformat(),
        "version": "1.0",
    }

    json_bytes = json.dumps(data, ensure_ascii=False, default=str, indent=2).encode("utf-8")
    return send_file(
        io.BytesIO(json_bytes),
        mimetype="application/json",
        as_attachment=True,
        download_name=f"lessonpay_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
    )


# ---------------------------------------------------------------------------
# POST /api/restore  — restore from JSON backup
# ---------------------------------------------------------------------------
@system_bp.route("/api/restore", methods=["POST"])
def restore():
    err = _require_auth()
    if err:
        return err

    if "file" not in request.files:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "No backup file or JSON body provided"}), 400
    else:
        f = request.files["file"]
        try:
            data = json.loads(f.read().decode("utf-8"))
        except Exception:
            return jsonify({"error": "Invalid JSON backup file"}), 400

    db = get_db()
    tables = [
        "activity_log", "attendance", "lesson_schedule",
        "group_payments", "payments", "students", "family_groups", "app_settings",
    ]

    try:
        for table in tables:
            db.execute(f"DELETE FROM {table}")

        restore_order = [
            "family_groups", "students", "payments", "group_payments",
            "activity_log", "lesson_schedule", "attendance", "app_settings",
        ]

        for table in restore_order:
            rows = data.get(table, [])
            if not rows:
                continue
            cols = list(rows[0].keys())
            placeholders = ",".join(["?"] * len(cols))
            col_names = ",".join(cols)
            for row in rows:
                db.execute(
                    f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})",
                    [row.get(c) for c in cols],
                )

        db.commit()
        log_activity("system", 0, "system", "restore", "Database restored from backup", db=db)
        return jsonify({"success": True, "message": "Database restored successfully"}), 200

    except Exception as e:
        db.execute("ROLLBACK")
        return jsonify({"error": f"Restore failed: {str(e)}"}), 500


# ---------------------------------------------------------------------------
# POST /api/ensure_month  — trigger billing sync
# ---------------------------------------------------------------------------
@system_bp.route("/api/ensure_month", methods=["POST"])
def ensure_month():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    students = db.execute(
        "SELECT id FROM students WHERE is_active=1 AND on_hold=0 AND family_group_id IS NULL"
    ).fetchall()
    for s in students:
        ensure_all_records(s["id"], db=db)

    groups = db.execute(
        "SELECT id FROM family_groups WHERE is_active=1 AND on_hold=0 AND start_date IS NOT NULL"
    ).fetchall()
    for g in groups:
        ensure_all_group_records(g["id"], db=db)

    migrate_payment_months(db=db)
    return jsonify({"success": True, "synced_students": len(students), "synced_groups": len(groups)}), 200


# ---------------------------------------------------------------------------
# GET /api/backup/auto_status
# ---------------------------------------------------------------------------
@system_bp.route("/api/backup/auto_status", methods=["GET"])
def auto_backup_status():
    err = _require_auth()
    if err:
        return err

    backup_dir = _get_backup_dir()
    if not os.path.isdir(backup_dir):
        return jsonify({"backups": [], "count": 0}), 200

    files = sorted(
        [f for f in os.listdir(backup_dir) if f.startswith("backup_") and f.endswith(".json")],
        reverse=True,
    )
    result = []
    for fname in files:
        fpath = os.path.join(backup_dir, fname)
        stat = os.stat(fpath)
        result.append({
            "filename": fname,
            "size": stat.st_size,
            "created": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })

    return jsonify({"backups": result, "count": len(result)}), 200


# ---------------------------------------------------------------------------
# GET /api/backup/auto/<filename>  — download specific auto backup
# ---------------------------------------------------------------------------
@system_bp.route("/api/backup/auto/<path:filename>", methods=["GET"])
def download_auto_backup(filename):
    err = _require_auth()
    if err:
        return err

    # Security: only allow simple filenames, no path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "Invalid filename"}), 400

    backup_dir = _get_backup_dir()
    fpath = os.path.join(backup_dir, filename)

    if not os.path.isfile(fpath):
        return jsonify({"error": "Backup file not found"}), 404

    return send_file(
        fpath,
        mimetype="application/json",
        as_attachment=True,
        download_name=filename,
    )


# ---------------------------------------------------------------------------
# Background auto-backup scheduler
# ---------------------------------------------------------------------------
def auto_backup_scheduler(app=None):
    """Background thread: create a daily JSON backup, keep last 7."""
    if app is None:
        return

    backup_dir = app.config.get("BACKUP_DIR", BACKUP_DIR)
    db_path = app.config["DATABASE"]

    os.makedirs(backup_dir, exist_ok=True)

    while True:
        try:
            now = datetime.now()
            filename = f"backup_{now.strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(backup_dir, filename)

            conn = _sqlite3.connect(db_path)
            conn.row_factory = _sqlite3.Row

            tables = [
                "family_groups", "students", "payments", "group_payments",
                "activity_log", "lesson_schedule", "attendance", "app_settings",
            ]
            data = {}
            for table in tables:
                rows = conn.execute(f"SELECT * FROM {table}").fetchall()
                data[table] = [dict(r) for r in rows]
            conn.close()

            data["_meta"] = {
                "exported_at": now.isoformat(),
                "version": "1.0",
            }

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, default=str)

            # Prune: keep only last 7 backups
            backups = sorted(
                [
                    fn for fn in os.listdir(backup_dir)
                    if fn.startswith("backup_") and fn.endswith(".json")
                ]
            )
            while len(backups) > 7:
                os.remove(os.path.join(backup_dir, backups.pop(0)))

        except Exception:
            pass  # Never crash the background thread

        # Sleep 24 hours
        time.sleep(86400)
