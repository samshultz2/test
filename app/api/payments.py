from datetime import date
from flask import Blueprint, request, jsonify, session
from ..database import get_db
from ..models import log_activity, ensure_all_records, ensure_all_group_records

payments_bp = Blueprint("payments", __name__)


def _require_auth():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401
    return None


# ---------------------------------------------------------------------------
# POST /api/payments  — add a payment record
# ---------------------------------------------------------------------------
@payments_bp.route("/api/payments", methods=["POST"])
def add_payment():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    student_id = data.get("student_id")
    amount = data.get("amount")
    payment_month = data.get("payment_month", "")
    due_date = data.get("due_date", "")

    if not student_id or amount is None or not payment_month or not due_date:
        return jsonify({"error": "student_id, amount, payment_month, due_date required"}), 400

    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    cur = db.execute(
        """INSERT INTO payments
           (student_id, amount, payment_month, due_date, is_paid)
           VALUES (?,?,?,?,0)""",
        (student_id, float(amount), payment_month, due_date),
    )
    db.commit()
    log_activity("payment", cur.lastrowid, student["full_name"], "record added",
                 f"month: {payment_month}", db=db)
    return jsonify({"success": True, "id": cur.lastrowid}), 201


# ---------------------------------------------------------------------------
# DELETE /api/payments/<id>
# ---------------------------------------------------------------------------
@payments_bp.route("/api/payments/<int:pid>", methods=["DELETE"])
def delete_payment(pid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    row = db.execute(
        "SELECT p.*, s.full_name FROM payments p JOIN students s ON p.student_id=s.id WHERE p.id=?",
        (pid,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Payment not found"}), 404

    db.execute("DELETE FROM payments WHERE id=?", (pid,))
    db.commit()
    log_activity("payment", pid, row["full_name"], "record deleted", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/payments/<id>/mark_paid
# ---------------------------------------------------------------------------
@payments_bp.route("/api/payments/<int:pid>/mark_paid", methods=["POST"])
def mark_paid(pid):
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute(
        "SELECT p.*, s.full_name FROM payments p JOIN students s ON p.student_id=s.id WHERE p.id=?",
        (pid,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Payment not found"}), 404

    paid_date = data.get("paid_date") or date.today().isoformat()
    payment_method = data.get("payment_method", "cash")
    paid_by = data.get("paid_by", "")
    payer_type = data.get("payer_type", "parent")
    receipt_note = data.get("receipt_note", "")

    db.execute(
        """UPDATE payments SET is_paid=1, paid_date=?, payment_method=?,
           paid_by=?, payer_type=?, receipt_note=? WHERE id=?""",
        (paid_date, payment_method, paid_by, payer_type, receipt_note, pid),
    )
    db.commit()
    log_activity("payment", pid, row["full_name"], "marked paid",
                 f"method: {payment_method}, month: {row['payment_month']}", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/payments/<id>/unmark
# ---------------------------------------------------------------------------
@payments_bp.route("/api/payments/<int:pid>/unmark", methods=["POST"])
def unmark_paid(pid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    row = db.execute(
        "SELECT p.*, s.full_name FROM payments p JOIN students s ON p.student_id=s.id WHERE p.id=?",
        (pid,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Payment not found"}), 404

    db.execute(
        """UPDATE payments SET is_paid=0, paid_date=NULL, payment_method=NULL,
           paid_by=NULL, payer_type=NULL, receipt_note=NULL WHERE id=?""",
        (pid,),
    )
    db.commit()
    log_activity("payment", pid, row["full_name"], "unmarked paid", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/payments/bulk_paid
# ---------------------------------------------------------------------------
@payments_bp.route("/api/payments/bulk_paid", methods=["POST"])
def bulk_paid():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    pids = data.get("pids", [])          # individual payment IDs
    group_pids = data.get("group_pids", [])  # group payment IDs
    paid_date = data.get("paid_date") or date.today().isoformat()
    payment_method = data.get("payment_method", "cash")
    paid_by = data.get("paid_by", "")
    payer_type = data.get("payer_type", "parent")
    receipt_note = data.get("receipt_note", "")

    db = get_db()

    updated = 0
    for pid in pids:
        row = db.execute(
            "SELECT p.*, s.full_name FROM payments p JOIN students s ON p.student_id=s.id WHERE p.id=?",
            (pid,),
        ).fetchone()
        if row:
            db.execute(
                """UPDATE payments SET is_paid=1, paid_date=?, payment_method=?,
                   paid_by=?, payer_type=?, receipt_note=? WHERE id=?""",
                (paid_date, payment_method, paid_by, payer_type, receipt_note, pid),
            )
            log_activity("payment", pid, row["full_name"], "bulk marked paid",
                         f"method: {payment_method}", db=db)
            updated += 1

    for gpid in group_pids:
        row = db.execute(
            "SELECT gp.*, fg.group_name FROM group_payments gp "
            "JOIN family_groups fg ON gp.group_id=fg.id WHERE gp.id=?",
            (gpid,),
        ).fetchone()
        if row:
            db.execute(
                """UPDATE group_payments SET is_paid=1, paid_date=?, payment_method=?,
                   paid_by=?, payer_type=?, receipt_note=? WHERE id=?""",
                (paid_date, payment_method, paid_by, payer_type, receipt_note, gpid),
            )
            log_activity("group_payment", gpid, row["group_name"], "bulk marked paid",
                         f"method: {payment_method}", db=db)
            updated += 1

    db.commit()
    return jsonify({"success": True, "updated": updated}), 200


# ---------------------------------------------------------------------------
# POST /api/payments/check_duplicate
# ---------------------------------------------------------------------------
@payments_bp.route("/api/payments/check_duplicate", methods=["POST"])
def check_duplicate_payment():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    student_id = data.get("student_id")
    payment_month = data.get("payment_month", "")

    if not student_id or not payment_month:
        return jsonify({"error": "student_id and payment_month required"}), 400

    db = get_db()
    existing = db.execute(
        "SELECT id, is_paid FROM payments WHERE student_id=? AND payment_month=? AND is_paid=1",
        (student_id, payment_month),
    ).fetchone()

    return jsonify({"duplicate": bool(existing)}), 200
