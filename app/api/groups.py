from datetime import date
from flask import Blueprint, request, jsonify, session
from ..database import get_db
from ..models import ensure_all_group_records, log_activity

groups_bp = Blueprint("groups", __name__)


def _require_auth():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _group_summary(db, group):
    """Return group dict with payment stats."""
    gid = group["id"]
    if group["start_date"]:
        ensure_all_group_records(gid, db=db)

    payments = db.execute(
        "SELECT id, amount, is_paid, payment_month, due_date, paid_date, "
        "payment_method, paid_by, payer_type, receipt_note "
        "FROM group_payments WHERE group_id=? ORDER BY due_date",
        (gid,),
    ).fetchall()

    members = db.execute(
        "SELECT id, full_name, class, subject FROM students WHERE family_group_id=? AND is_active=1",
        (gid,),
    ).fetchall()

    total_paid = sum(p["amount"] for p in payments if p["is_paid"])
    total_owed = sum(p["amount"] for p in payments if not p["is_paid"])
    paid_count = sum(1 for p in payments if p["is_paid"])
    unpaid_count = sum(1 for p in payments if not p["is_paid"])

    d = dict(group)
    d["total_paid"] = total_paid
    d["total_owed"] = total_owed
    d["paid_count"] = paid_count
    d["unpaid_count"] = unpaid_count
    d["member_count"] = len(members)
    d["members"] = [dict(m) for m in members]
    d["payments"] = [dict(p) for p in payments]
    return d


# ---------------------------------------------------------------------------
# GET /api/groups
# ---------------------------------------------------------------------------
@groups_bp.route("/api/groups", methods=["GET"])
def list_groups():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    rows = db.execute("""
        SELECT fg.*,
            COUNT(s.id) as member_count,
            (SELECT COUNT(*) FROM group_payments gp
             WHERE gp.group_id=fg.id AND gp.is_paid=0
               AND gp.due_date < date('now','localtime')) as overdue_count,
            (SELECT COALESCE(SUM(amount),0) FROM group_payments gp
             WHERE gp.group_id=fg.id AND gp.is_paid=1) as total_paid,
            (SELECT COALESCE(SUM(amount),0) FROM group_payments gp
             WHERE gp.group_id=fg.id AND gp.is_paid=0) as total_owed,
            (SELECT COUNT(*) FROM group_payments gp
             WHERE gp.group_id=fg.id AND gp.is_paid=1) as paid_count
        FROM family_groups fg
        LEFT JOIN students s ON s.family_group_id=fg.id AND s.is_active=1
        WHERE fg.is_active=1 GROUP BY fg.id ORDER BY fg.group_name
    """).fetchall()
    return jsonify([dict(r) for r in rows]), 200


# ---------------------------------------------------------------------------
# POST /api/groups
# ---------------------------------------------------------------------------
@groups_bp.route("/api/groups", methods=["POST"])
def add_group():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    group_name = (data.get("group_name") or "").strip()
    if not group_name:
        return jsonify({"error": "group_name is required"}), 400

    monthly_fee = float(data.get("monthly_fee") or 0)
    db = get_db()
    cur = db.execute(
        """INSERT INTO family_groups
           (group_name, monthly_fee, start_date, contact_name, contact_phone, notes, is_active, on_hold)
           VALUES (?,?,?,?,?,?,1,0)""",
        (
            group_name,
            monthly_fee,
            data.get("start_date", ""),
            data.get("contact_name", ""),
            data.get("contact_phone", ""),
            data.get("notes", ""),
        ),
    )
    db.commit()
    new_id = cur.lastrowid
    if data.get("start_date"):
        ensure_all_group_records(new_id, db=db)
    log_activity("group", new_id, group_name, "created", f"Fee: {monthly_fee}", db=db)
    return jsonify({"success": True, "id": new_id}), 201


# ---------------------------------------------------------------------------
# PUT /api/groups/<id>
# ---------------------------------------------------------------------------
@groups_bp.route("/api/groups/<int:gid>", methods=["PUT"])
def update_group(gid):
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    db = get_db()
    group = db.execute("SELECT * FROM family_groups WHERE id=?", (gid,)).fetchone()
    if not group:
        return jsonify({"error": "Group not found"}), 404

    group_name = data.get("group_name", group["group_name"])
    monthly_fee = float(data.get("monthly_fee", group["monthly_fee"]))
    start_date = data.get("start_date", group["start_date"])
    contact_name = data.get("contact_name", group["contact_name"])
    contact_phone = data.get("contact_phone", group["contact_phone"])
    notes = data.get("notes", group["notes"])

    db.execute(
        """UPDATE family_groups SET group_name=?, monthly_fee=?, start_date=?,
           contact_name=?, contact_phone=?, notes=? WHERE id=?""",
        (group_name, monthly_fee, start_date, contact_name, contact_phone, notes, gid),
    )
    db.commit()

    old_fee = group["monthly_fee"]
    fee_changed = abs(old_fee - monthly_fee) > 0.001
    if start_date:
        ensure_all_group_records(gid, db=db, update_unpaid_amount=fee_changed)
    log_activity("group", gid, group_name, "updated", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# DELETE /api/groups/<id>  (archive)
# ---------------------------------------------------------------------------
@groups_bp.route("/api/groups/<int:gid>", methods=["DELETE"])
def archive_group(gid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    group = db.execute("SELECT * FROM family_groups WHERE id=?", (gid,)).fetchone()
    if not group:
        return jsonify({"error": "Group not found"}), 404

    db.execute("UPDATE family_groups SET is_active=0 WHERE id=?", (gid,))
    db.commit()
    log_activity("group", gid, group["group_name"], "archived", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/groups/<id>/hold
# ---------------------------------------------------------------------------
@groups_bp.route("/api/groups/<int:gid>/hold", methods=["POST"])
def toggle_group_hold(gid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    group = db.execute("SELECT * FROM family_groups WHERE id=?", (gid,)).fetchone()
    if not group:
        return jsonify({"error": "Group not found"}), 404

    new_hold = 0 if group["on_hold"] else 1
    db.execute("UPDATE family_groups SET on_hold=? WHERE id=?", (new_hold, gid))
    db.commit()
    action = "put on hold" if new_hold else "removed from hold"
    log_activity("group", gid, group["group_name"], action, "", db=db)
    return jsonify({"success": True, "on_hold": bool(new_hold)}), 200


# ---------------------------------------------------------------------------
# GET /api/groups/<id>/payments
# ---------------------------------------------------------------------------
@groups_bp.route("/api/groups/<int:gid>/payments", methods=["GET"])
def group_payments(gid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    group = db.execute("SELECT * FROM family_groups WHERE id=?", (gid,)).fetchone()
    if not group:
        return jsonify({"error": "Group not found"}), 404

    if group["start_date"]:
        ensure_all_group_records(gid, db=db)

    payments = db.execute(
        "SELECT * FROM group_payments WHERE group_id=? ORDER BY due_date",
        (gid,),
    ).fetchall()
    return jsonify([dict(p) for p in payments]), 200


# ---------------------------------------------------------------------------
# POST /api/group_payments  — add group payment record
# ---------------------------------------------------------------------------
@groups_bp.route("/api/group_payments", methods=["POST"])
def add_group_payment():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    group_id = data.get("group_id")
    amount = data.get("amount")
    payment_month = data.get("payment_month", "")
    due_date = data.get("due_date", "")

    if not group_id or amount is None or not payment_month or not due_date:
        return jsonify({"error": "group_id, amount, payment_month, due_date required"}), 400

    db = get_db()
    group = db.execute("SELECT * FROM family_groups WHERE id=?", (group_id,)).fetchone()
    if not group:
        return jsonify({"error": "Group not found"}), 404

    cur = db.execute(
        """INSERT INTO group_payments (group_id, amount, payment_month, due_date, is_paid)
           VALUES (?,?,?,?,0)""",
        (group_id, float(amount), payment_month, due_date),
    )
    db.commit()
    log_activity("group_payment", cur.lastrowid, group["group_name"], "record added",
                 f"month: {payment_month}", db=db)
    return jsonify({"success": True, "id": cur.lastrowid}), 201


# ---------------------------------------------------------------------------
# DELETE /api/group_payments/<id>
# ---------------------------------------------------------------------------
@groups_bp.route("/api/group_payments/<int:gpid>", methods=["DELETE"])
def delete_group_payment(gpid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    row = db.execute(
        "SELECT gp.*, fg.group_name FROM group_payments gp "
        "JOIN family_groups fg ON gp.group_id=fg.id WHERE gp.id=?",
        (gpid,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Group payment not found"}), 404

    db.execute("DELETE FROM group_payments WHERE id=?", (gpid,))
    db.commit()
    log_activity("group_payment", gpid, row["group_name"], "record deleted", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/group_payments/<id>/mark_paid
# ---------------------------------------------------------------------------
@groups_bp.route("/api/group_payments/<int:gpid>/mark_paid", methods=["POST"])
def mark_group_paid(gpid):
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute(
        "SELECT gp.*, fg.group_name FROM group_payments gp "
        "JOIN family_groups fg ON gp.group_id=fg.id WHERE gp.id=?",
        (gpid,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Group payment not found"}), 404

    paid_date = data.get("paid_date") or date.today().isoformat()
    payment_method = data.get("payment_method", "cash")
    paid_by = data.get("paid_by", "")
    payer_type = data.get("payer_type", "parent")
    receipt_note = data.get("receipt_note", "")

    db.execute(
        """UPDATE group_payments SET is_paid=1, paid_date=?, payment_method=?,
           paid_by=?, payer_type=?, receipt_note=? WHERE id=?""",
        (paid_date, payment_method, paid_by, payer_type, receipt_note, gpid),
    )
    db.commit()
    log_activity("group_payment", gpid, row["group_name"], "marked paid",
                 f"method: {payment_method}, month: {row['payment_month']}", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/group_payments/<id>/unmark
# ---------------------------------------------------------------------------
@groups_bp.route("/api/group_payments/<int:gpid>/unmark", methods=["POST"])
def unmark_group_paid(gpid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    row = db.execute(
        "SELECT gp.*, fg.group_name FROM group_payments gp "
        "JOIN family_groups fg ON gp.group_id=fg.id WHERE gp.id=?",
        (gpid,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Group payment not found"}), 404

    db.execute(
        """UPDATE group_payments SET is_paid=0, paid_date=NULL, payment_method=NULL,
           paid_by=NULL, payer_type=NULL, receipt_note=NULL WHERE id=?""",
        (gpid,),
    )
    db.commit()
    log_activity("group_payment", gpid, row["group_name"], "unmarked paid", "", db=db)
    return jsonify({"success": True}), 200
