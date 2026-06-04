from flask import Blueprint, request, jsonify, session
from ..database import get_db
from ..models import (
    ensure_all_records,
    log_activity,
    all_periods_up_to_today,
)

students_bp = Blueprint("students", __name__)


def _require_auth():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _row_to_dict(row):
    return dict(row) if row else None


def _student_summary(db, student):
    """Return student dict with payment summary fields."""
    sid = student["id"]
    ensure_all_records(sid, db=db)

    payments = db.execute(
        "SELECT id, amount, is_paid, payment_month, due_date, paid_date, "
        "payment_method, paid_by, payer_type, receipt_note "
        "FROM payments WHERE student_id=? ORDER BY due_date",
        (sid,),
    ).fetchall()

    total_paid = sum(p["amount"] for p in payments if p["is_paid"])
    total_owed = sum(p["amount"] for p in payments if not p["is_paid"])
    paid_count = sum(1 for p in payments if p["is_paid"])
    unpaid_count = sum(1 for p in payments if not p["is_paid"])

    d = dict(student)
    d["total_paid"] = total_paid
    d["total_owed"] = total_owed
    d["paid_count"] = paid_count
    d["unpaid_count"] = unpaid_count
    d["payments"] = [dict(p) for p in payments]
    return d


# ---------------------------------------------------------------------------
# GET /api/students
# ---------------------------------------------------------------------------
@students_bp.route("/api/students", methods=["GET"])
def list_students():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    rows = db.execute("""
        SELECT s.*, fg.group_name, fg.monthly_fee as group_fee,
            (SELECT COUNT(*) FROM payments p
             WHERE p.student_id=s.id AND p.is_paid=0
               AND p.due_date < date('now','localtime')) as overdue_count,
            (SELECT COALESCE(SUM(amount),0) FROM payments p
             WHERE p.student_id=s.id AND p.is_paid=0) as total_owed,
            (SELECT COALESCE(SUM(amount),0) FROM payments p
             WHERE p.student_id=s.id AND p.is_paid=1) as total_paid,
            (SELECT COUNT(*) FROM payments p
             WHERE p.student_id=s.id AND p.is_paid=1) as paid_count,
            (SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END),0)
             FROM payments p WHERE p.student_id=s.id AND p.is_paid=1) as cash_paid,
            (SELECT COALESCE(SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END),0)
             FROM payments p WHERE p.student_id=s.id AND p.is_paid=1) as transfer_paid
        FROM students s LEFT JOIN family_groups fg ON s.family_group_id=fg.id
        WHERE s.is_active=1 ORDER BY s.full_name
    """).fetchall()
    return jsonify([dict(r) for r in rows]), 200


# ---------------------------------------------------------------------------
# POST /api/students
# ---------------------------------------------------------------------------
@students_bp.route("/api/students", methods=["POST"])
def add_student():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    full_name = (data.get("full_name") or "").strip()
    cls = (data.get("class") or "").strip()
    start_date = (data.get("start_date") or "").strip()
    monthly_fee = float(data.get("monthly_fee") or 0)

    if not full_name or not cls or not start_date:
        return jsonify({"error": "full_name, class, and start_date are required"}), 400

    db = get_db()
    cur = db.execute(
        """INSERT INTO students
           (full_name, class, subject, monthly_fee, start_date,
            family_group_id, contact_name, contact_phone, notes, is_active, on_hold)
           VALUES (?,?,?,?,?,?,?,?,?,1,0)""",
        (
            full_name,
            cls,
            data.get("subject", ""),
            monthly_fee,
            start_date,
            data.get("family_group_id"),
            data.get("contact_name", ""),
            data.get("contact_phone", ""),
            data.get("notes", ""),
        ),
    )
    db.commit()
    new_id = cur.lastrowid
    ensure_all_records(new_id, db=db)
    log_activity("student", new_id, full_name, "created", f"Fee: {monthly_fee}", db=db)
    return jsonify({"success": True, "id": new_id}), 201


# ---------------------------------------------------------------------------
# PUT /api/students/<id>
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>", methods=["PUT"])
def update_student(sid):
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    full_name = data.get("full_name", student["full_name"])
    cls = data.get("class", student["class"])
    subject = data.get("subject", student["subject"])
    monthly_fee = float(data.get("monthly_fee", student["monthly_fee"]))
    start_date = data.get("start_date", student["start_date"])
    family_group_id = data.get("family_group_id", student["family_group_id"])
    contact_name = data.get("contact_name", student["contact_name"])
    contact_phone = data.get("contact_phone", student["contact_phone"])
    notes = data.get("notes", student["notes"])

    db.execute(
        """UPDATE students SET full_name=?, class=?, subject=?, monthly_fee=?,
           start_date=?, family_group_id=?, contact_name=?, contact_phone=?, notes=?
           WHERE id=?""",
        (full_name, cls, subject, monthly_fee, start_date, family_group_id,
         contact_name, contact_phone, notes, sid),
    )
    db.commit()

    old_fee = student["monthly_fee"]
    fee_changed = abs(old_fee - monthly_fee) > 0.001
    ensure_all_records(sid, db=db, update_unpaid_amount=fee_changed)
    log_activity("student", sid, full_name, "updated", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# DELETE /api/students/<id>  (archive)
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>", methods=["DELETE"])
def archive_student(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    db.execute("UPDATE students SET is_active=0 WHERE id=?", (sid,))
    db.commit()
    log_activity("student", sid, student["full_name"], "archived", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/students/<id>/hold  (toggle hold)
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/hold", methods=["POST"])
def toggle_hold(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    new_hold = 0 if student["on_hold"] else 1
    db.execute("UPDATE students SET on_hold=? WHERE id=?", (new_hold, sid))
    db.commit()
    action = "put on hold" if new_hold else "removed from hold"
    log_activity("student", sid, student["full_name"], action, "", db=db)
    return jsonify({"success": True, "on_hold": bool(new_hold)}), 200


# ---------------------------------------------------------------------------
# GET /api/students/archived
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/archived", methods=["GET"])
def list_archived():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    students = db.execute(
        "SELECT * FROM students WHERE is_active=0 ORDER BY full_name"
    ).fetchall()
    return jsonify([dict(s) for s in students]), 200


# ---------------------------------------------------------------------------
# POST /api/students/<id>/restore
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/restore", methods=["POST"])
def restore_student(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    db.execute("UPDATE students SET is_active=1 WHERE id=?", (sid,))
    db.commit()
    ensure_all_records(sid, db=db)
    log_activity("student", sid, student["full_name"], "restored", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# GET /api/students/<id>/payments/archived
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/payments/archived", methods=["GET"])
def archived_student_payments(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    payments = db.execute(
        "SELECT * FROM payments WHERE student_id=? ORDER BY due_date DESC",
        (sid,),
    ).fetchall()
    return jsonify([dict(p) for p in payments]), 200


# ---------------------------------------------------------------------------
# GET /api/students/check_duplicate?name=<name>
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/check_duplicate", methods=["GET"])
def check_duplicate():
    err = _require_auth()
    if err:
        return err

    name = (request.args.get("name") or "").strip().lower()
    if not name:
        return jsonify([]), 200

    db = get_db()
    students = db.execute(
        "SELECT id, full_name, class FROM students WHERE is_active=1"
    ).fetchall()

    name_words = set(name.split())
    matches = []
    for s in students:
        sname = s["full_name"].lower()
        existing_words = set(sname.split())
        shared = name_words & existing_words
        if len(shared) >= 2 or sname == name:
            matches.append(dict(s))

    return jsonify(matches), 200


# ---------------------------------------------------------------------------
# GET /api/students/<id>/payments
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/payments", methods=["GET"])
def student_payments(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    ensure_all_records(sid, db=db)
    payments = db.execute(
        "SELECT * FROM payments WHERE student_id=? ORDER BY due_date DESC",
        (sid,),
    ).fetchall()
    return jsonify([dict(p) for p in payments]), 200


# ---------------------------------------------------------------------------
# GET /api/students/<id>/log
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/log", methods=["GET"])
def student_log(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    logs = db.execute(
        "SELECT * FROM activity_log WHERE entity_type='student' AND entity_id=? ORDER BY created_at DESC LIMIT 100",
        (sid,),
    ).fetchall()
    return jsonify([dict(l) for l in logs]), 200


# ---------------------------------------------------------------------------
# GET /api/students/<id>/schedule
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/schedule", methods=["GET"])
def get_schedule(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    slots = db.execute(
        "SELECT * FROM lesson_schedule WHERE student_id=? ORDER BY id",
        (sid,),
    ).fetchall()
    return jsonify([dict(s) for s in slots]), 200


# ---------------------------------------------------------------------------
# POST /api/students/<id>/schedule  (replace all slots)
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/schedule", methods=["POST"])
def save_schedule(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404

    data = request.get_json(silent=True) or {}
    slots = data.get("slots", [])

    db.execute("DELETE FROM lesson_schedule WHERE student_id=?", (sid,))
    for slot in slots:
        day = (slot.get("day_of_week") or "").strip()
        if not day:
            continue
        db.execute(
            "INSERT INTO lesson_schedule (student_id, day_of_week, start_time, end_time, location, notes) "
            "VALUES (?,?,?,?,?,?)",
            (
                sid,
                day,
                slot.get("start_time", ""),
                slot.get("end_time", ""),
                slot.get("location", ""),
                slot.get("notes", ""),
            ),
        )
    db.commit()
    log_activity("student", sid, student["full_name"], "schedule updated", "", db=db)
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# GET /api/students/<id>/attendance
# ---------------------------------------------------------------------------
@students_bp.route("/api/students/<int:sid>/attendance", methods=["GET"])
def student_attendance(sid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    records = db.execute(
        "SELECT * FROM attendance WHERE student_id=? ORDER BY date DESC",
        (sid,),
    ).fetchall()
    return jsonify([dict(r) for r in records]), 200
