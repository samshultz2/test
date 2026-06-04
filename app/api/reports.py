from datetime import date, datetime, timedelta
from dateutil.relativedelta import relativedelta
from flask import Blueprint, request, jsonify, session
from ..database import get_db
from ..models import ensure_all_records, ensure_all_group_records, log_activity

reports_bp = Blueprint("reports", __name__)


def _require_auth():
    if not session.get("authenticated"):
        return jsonify({"error": "Unauthorized"}), 401
    return None


# ---------------------------------------------------------------------------
# GET /api/dashboard
# ---------------------------------------------------------------------------
@reports_bp.route("/api/dashboard", methods=["GET"])
def dashboard():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    today_dt = date.today()
    month = request.args.get("month", "") or today_dt.strftime("%Y-%m")
    today_str = today_dt.isoformat()
    last_month_str = (today_dt.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    # Sync billing
    for s in db.execute("SELECT id FROM students WHERE is_active=1 AND on_hold=0 AND family_group_id IS NULL").fetchall():
        ensure_all_records(s["id"], db=db)
    for g in db.execute("SELECT id FROM family_groups WHERE is_active=1 AND on_hold=0 AND start_date IS NOT NULL").fetchall():
        ensure_all_group_records(g["id"], db=db)

    # ── KPIs ─────────────────────────────────────────────────────────────────
    student_count = db.execute("SELECT COUNT(*) FROM students WHERE is_active=1").fetchone()[0]
    group_count   = db.execute("SELECT COUNT(*) FROM family_groups WHERE is_active=1").fetchone()[0]

    collected_ind = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?", (month,)).fetchone()[0]
    collected_grp = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?", (month,)).fetchone()[0]
    collected = collected_ind + collected_grp

    expected_ind = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE payment_month=?", (month,)).fetchone()[0]
    expected_grp = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE payment_month=?", (month,)).fetchone()[0]
    expected = expected_ind + expected_grp

    alltime_ind = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1").fetchone()[0]
    alltime_grp = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1").fetchone()[0]
    alltime = alltime_ind + alltime_grp

    overdue_ind = db.execute(
        "SELECT p.id, p.amount, p.due_date FROM payments p JOIN students s ON p.student_id=s.id "
        "WHERE p.is_paid=0 AND p.due_date < ? AND s.is_active=1", (today_str,)
    ).fetchall()
    overdue_grp = db.execute(
        "SELECT gp.id, gp.amount, gp.due_date FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id "
        "WHERE gp.is_paid=0 AND gp.due_date < ? AND fg.is_active=1", (today_str,)
    ).fetchall()
    overdue_count  = len(overdue_ind) + len(overdue_grp)
    overdue_amount = sum(r["amount"] for r in overdue_ind) + sum(r["amount"] for r in overdue_grp)

    collection_rate = round(collected / expected * 100, 1) if expected > 0 else 0.0

    # ── Chart: last 6 months ─────────────────────────────────────────────────
    chart = []
    for i in range(5, -1, -1):
        d = today_dt.replace(day=1) - relativedelta(months=i)
        mo = d.strftime("%Y-%m")
        ind_amt = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?", (mo,)).fetchone()[0]
        grp_amt = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?", (mo,)).fetchone()[0]
        chart.append({"label": d.strftime("%b"), "amount": ind_amt + grp_amt})

    # ── Overdue list ─────────────────────────────────────────────────────────
    overdue_list = []
    for r in db.execute(
        "SELECT p.id as pid, s.full_name as name, p.amount, p.due_date, p.payment_month "
        "FROM payments p JOIN students s ON p.student_id=s.id "
        "WHERE p.is_paid=0 AND p.due_date < ? AND s.is_active=1 ORDER BY p.due_date", (today_str,)
    ).fetchall():
        overdue_list.append({"pid": r["pid"], "name": r["name"], "amount": r["amount"], "due_date": r["due_date"], "month": r["payment_month"], "is_group": False})
    for r in db.execute(
        "SELECT gp.id as pid, fg.group_name as name, gp.amount, gp.due_date, gp.payment_month "
        "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id "
        "WHERE gp.is_paid=0 AND gp.due_date < ? AND fg.is_active=1 ORDER BY gp.due_date", (today_str,)
    ).fetchall():
        overdue_list.append({"pid": r["pid"], "name": r["name"], "amount": r["amount"], "due_date": r["due_date"], "month": r["payment_month"], "is_group": True})

    # ── Due soon (next 7 days) ───────────────────────────────────────────────
    soon_cutoff = (today_dt + timedelta(days=7)).isoformat()
    due_soon = []
    for r in db.execute(
        "SELECT p.id as pid, s.full_name as name, p.amount, p.due_date "
        "FROM payments p JOIN students s ON p.student_id=s.id "
        "WHERE p.is_paid=0 AND p.due_date >= ? AND p.due_date <= ? AND s.is_active=1", (today_str, soon_cutoff)
    ).fetchall():
        due_soon.append({"pid": r["pid"], "name": r["name"], "amount": r["amount"], "due_date": r["due_date"], "is_group": False})
    for r in db.execute(
        "SELECT gp.id as pid, fg.group_name as name, gp.amount, gp.due_date "
        "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id "
        "WHERE gp.is_paid=0 AND gp.due_date >= ? AND gp.due_date <= ? AND fg.is_active=1", (today_str, soon_cutoff)
    ).fetchall():
        due_soon.append({"pid": r["pid"], "name": r["name"], "amount": r["amount"], "due_date": r["due_date"], "is_group": True})

    # ── Unpaid this period ───────────────────────────────────────────────────
    unpaid = []
    for r in db.execute(
        "SELECT p.id as pid, s.full_name as name, s.class as class_name, p.amount, p.due_date "
        "FROM payments p JOIN students s ON p.student_id=s.id "
        "WHERE p.is_paid=0 AND p.payment_month=? AND s.is_active=1 ORDER BY p.due_date", (month,)
    ).fetchall():
        days = (today_dt - date.fromisoformat(r["due_date"])).days if r["due_date"] else 0
        unpaid.append({"pid": r["pid"], "name": r["name"], "class_name": r["class_name"] or "", "amount": r["amount"], "due_date": r["due_date"], "days_overdue": max(0, days), "is_group": False})
    for r in db.execute(
        "SELECT gp.id as pid, fg.group_name as name, gp.amount, gp.due_date "
        "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id "
        "WHERE gp.is_paid=0 AND gp.payment_month=? AND fg.is_active=1 ORDER BY gp.due_date", (month,)
    ).fetchall():
        days = (today_dt - date.fromisoformat(r["due_date"])).days if r["due_date"] else 0
        unpaid.append({"pid": r["pid"], "name": r["name"], "class_name": "", "amount": r["amount"], "due_date": r["due_date"], "days_overdue": max(0, days), "is_group": True})

    # ── Top payers (by streak) ───────────────────────────────────────────────
    top_payers = []
    for s in db.execute("SELECT id, full_name FROM students WHERE is_active=1").fetchall():
        pm = db.execute("SELECT payment_month FROM payments WHERE student_id=? AND is_paid=1 ORDER BY payment_month DESC", (s["id"],)).fetchall()
        streak = 0
        if pm:
            ml = [p["payment_month"] for p in pm]
            streak = 1
            for i in range(1, len(ml)):
                exp = (datetime.strptime(ml[i-1], "%Y-%m").replace(day=1) - relativedelta(months=1)).strftime("%Y-%m")
                if ml[i] == exp:
                    streak += 1
                else:
                    break
        total_paid = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE student_id=? AND is_paid=1", (s["id"],)).fetchone()[0]
        if streak > 0:
            top_payers.append({"name": s["full_name"], "total_paid": total_paid, "streak": streak})
    top_payers.sort(key=lambda x: x["streak"], reverse=True)
    top_payers = top_payers[:5]

    # ── Income by class ──────────────────────────────────────────────────────
    class_rows = db.execute(
        "SELECT s.class as name, COALESCE(SUM(CASE WHEN p.is_paid=1 AND p.payment_month=? THEN p.amount ELSE 0 END),0) as amount "
        "FROM students s LEFT JOIN payments p ON p.student_id=s.id "
        "WHERE s.is_active=1 GROUP BY s.class ORDER BY amount DESC", (month,)
    ).fetchall()
    total_cls = sum(r["amount"] for r in class_rows)
    income_by_class = [{"name": r["name"] or "No class", "amount": r["amount"], "pct": round(r["amount"] / total_cls * 100) if total_cls > 0 else 0} for r in class_rows if r["amount"] > 0]

    # ── Worst debtors ────────────────────────────────────────────────────────
    worst_debtors = []
    for r in db.execute(
        "SELECT s.full_name as name, COUNT(p.id) as months_owed, COALESCE(SUM(p.amount),0) as total_owed "
        "FROM students s JOIN payments p ON p.student_id=s.id "
        "WHERE p.is_paid=0 AND s.is_active=1 GROUP BY s.id, s.full_name "
        "HAVING months_owed >= 1 ORDER BY total_owed DESC LIMIT 10"
    ).fetchall():
        worst_debtors.append({"name": r["name"], "months_owed": r["months_owed"], "total_owed": r["total_owed"]})

    # ── Recent payments ──────────────────────────────────────────────────────
    recent_ind = [{"name": r["name"], "paid_at": r["paid_at"], "method": r["method"] or "cash", "amount": r["amount"]} for r in db.execute(
        "SELECT s.full_name as name, p.paid_date as paid_at, p.payment_method as method, p.amount "
        "FROM payments p JOIN students s ON p.student_id=s.id WHERE p.is_paid=1 ORDER BY p.paid_date DESC LIMIT 10"
    ).fetchall()]
    recent_grp = [{"name": r["name"], "paid_at": r["paid_at"], "method": r["method"] or "cash", "amount": r["amount"]} for r in db.execute(
        "SELECT fg.group_name as name, gp.paid_date as paid_at, gp.payment_method as method, gp.amount "
        "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id WHERE gp.is_paid=1 ORDER BY gp.paid_date DESC LIMIT 10"
    ).fetchall()]
    recent_payments = sorted(recent_ind + recent_grp, key=lambda x: x.get("paid_at") or "", reverse=True)[:10]

    # ── Month-over-month ─────────────────────────────────────────────────────
    this_m_ind  = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?", (month,)).fetchone()[0]
    this_m_grp  = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?", (month,)).fetchone()[0]
    this_month_total = this_m_ind + this_m_grp

    last_m_ind  = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?", (last_month_str,)).fetchone()[0]
    last_m_grp  = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?", (last_month_str,)).fetchone()[0]
    last_month_total = last_m_ind + last_m_grp

    change = round((this_month_total - last_month_total) / last_month_total * 100, 1) if last_month_total > 0 else 0.0

    # ── Payment split ────────────────────────────────────────────────────────
    cash_ind = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_method='cash'").fetchone()[0]
    cash_grp = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_method='cash'").fetchone()[0]
    xfer_ind = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_method='transfer'").fetchone()[0]
    xfer_grp = db.execute("SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_method='transfer'").fetchone()[0]
    cash_total = cash_ind + cash_grp
    xfer_total = xfer_ind + xfer_grp
    split_total = cash_total + xfer_total
    payment_split = {
        "cash": cash_total,
        "cash_pct": round(cash_total / split_total * 100) if split_total > 0 else 0,
        "transfer": xfer_total,
        "transfer_pct": round(xfer_total / split_total * 100) if split_total > 0 else 0,
    }

    return jsonify({
        "kpis": {
            "collected": collected,
            "student_count": student_count,
            "group_count": group_count,
            "overdue_count": overdue_count,
            "overdue_amount": overdue_amount,
            "collection_rate": collection_rate,
            "expected": expected,
            "alltime": alltime,
        },
        "chart": chart,
        "overdue": overdue_list,
        "due_soon": due_soon,
        "unpaid": unpaid,
        "top_payers": top_payers,
        "income_by_class": income_by_class,
        "worst_debtors": worst_debtors,
        "recent_payments": recent_payments,
        "month_over_month": {"this_month": this_month_total, "last_month": last_month_total, "change": change},
        "payment_split": payment_split,
    }), 200


# ---------------------------------------------------------------------------
# GET /api/stats
# ---------------------------------------------------------------------------
@reports_bp.route("/api/stats", methods=["GET"])
def stats():
    err = _require_auth()
    if err:
        return err

    db = get_db()

    students = db.execute(
        "SELECT s.*, "
        "(SELECT COALESCE(SUM(amount),0) FROM payments WHERE student_id=s.id AND is_paid=1) as total_paid, "
        "(SELECT COALESCE(SUM(amount),0) FROM payments WHERE student_id=s.id AND is_paid=0) as total_owed, "
        "(SELECT COUNT(*) FROM payments WHERE student_id=s.id AND is_paid=1) as paid_count, "
        "(SELECT COUNT(*) FROM payments WHERE student_id=s.id AND is_paid=0) as unpaid_count "
        "FROM students s WHERE s.is_active=1 ORDER BY s.full_name"
    ).fetchall()

    groups = db.execute(
        "SELECT fg.*, "
        "(SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE group_id=fg.id AND is_paid=1) as total_paid, "
        "(SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE group_id=fg.id AND is_paid=0) as total_owed, "
        "(SELECT COUNT(*) FROM group_payments WHERE group_id=fg.id AND is_paid=1) as paid_count, "
        "(SELECT COUNT(*) FROM group_payments WHERE group_id=fg.id AND is_paid=0) as unpaid_count "
        "FROM family_groups fg WHERE fg.is_active=1 ORDER BY fg.group_name"
    ).fetchall()

    result = []
    for s in students:
        d = dict(s)
        d["type"] = "individual"
        result.append(d)
    for g in groups:
        d = dict(g)
        d["type"] = "group"
        result.append(d)
    return jsonify(result), 200


# ---------------------------------------------------------------------------
# GET /api/monthly_breakdown
# ---------------------------------------------------------------------------
@reports_bp.route("/api/monthly_breakdown", methods=["GET"])
def monthly_breakdown():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    today = date.today()
    months = []
    for i in range(11, -1, -1):
        d = today.replace(day=1) - relativedelta(months=i)
        mo = d.strftime("%Y-%m")
        ind_paid = db.execute(
            "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?",
            (mo,),
        ).fetchone()[0]
        grp_paid = db.execute(
            "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?",
            (mo,),
        ).fetchone()[0]
        ind_owed = db.execute(
            "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=0 AND payment_month=?",
            (mo,),
        ).fetchone()[0]
        grp_owed = db.execute(
            "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=0 AND payment_month=?",
            (mo,),
        ).fetchone()[0]
        months.append({
            "month": mo,
            "collected": ind_paid + grp_paid,
            "owed": ind_owed + grp_owed,
        })

    return jsonify(months), 200


# ---------------------------------------------------------------------------
# GET /api/by_subject
# ---------------------------------------------------------------------------
@reports_bp.route("/api/by_subject", methods=["GET"])
def by_subject():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    rows = db.execute(
        "SELECT COALESCE(s.subject, 'Unknown') as subject, "
        "COALESCE(SUM(p.amount),0) as total_paid, "
        "COUNT(DISTINCT s.id) as student_count "
        "FROM students s "
        "LEFT JOIN payments p ON p.student_id=s.id AND p.is_paid=1 "
        "WHERE s.is_active=1 "
        "GROUP BY COALESCE(s.subject,'Unknown') ORDER BY total_paid DESC"
    ).fetchall()

    return jsonify([dict(r) for r in rows]), 200


# ---------------------------------------------------------------------------
# GET /api/activity_log
# ---------------------------------------------------------------------------
@reports_bp.route("/api/activity_log", methods=["GET"])
def activity_log():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    logs = db.execute(
        "SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    return jsonify([dict(l) for l in logs]), 200


# ---------------------------------------------------------------------------
# GET /api/receipt/<ptype>/<pid>
# ---------------------------------------------------------------------------
@reports_bp.route("/api/receipt/<ptype>/<int:pid>", methods=["GET"])
def receipt_data(ptype, pid):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    if ptype == "individual":
        row = db.execute(
            "SELECT p.*, s.full_name, s.class, s.subject, s.contact_name, s.contact_phone "
            "FROM payments p JOIN students s ON p.student_id=s.id WHERE p.id=?",
            (pid,),
        ).fetchone()
    elif ptype == "group":
        row = db.execute(
            "SELECT gp.*, fg.group_name, fg.contact_name, fg.contact_phone "
            "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id WHERE gp.id=?",
            (pid,),
        ).fetchone()
    else:
        return jsonify({"error": "Invalid ptype"}), 400

    if not row:
        return jsonify({"error": "Record not found"}), 404

    return jsonify(dict(row)), 200


# ---------------------------------------------------------------------------
# GET /api/timetable
# ---------------------------------------------------------------------------
@reports_bp.route("/api/timetable", methods=["GET"])
def timetable():
    err = _require_auth()
    if err:
        return err

    db = get_db()
    students = db.execute(
        "SELECT s.id, s.full_name, s.class, s.subject "
        "FROM students s "
        "WHERE s.is_active=1 AND EXISTS (SELECT 1 FROM lesson_schedule ls WHERE ls.student_id=s.id) "
        "ORDER BY s.full_name"
    ).fetchall()

    result = []
    for s in students:
        slots = db.execute(
            "SELECT * FROM lesson_schedule WHERE student_id=? ORDER BY id",
            (s["id"],),
        ).fetchall()
        d = dict(s)
        d["schedule"] = [dict(slot) for slot in slots]
        result.append(d)

    return jsonify(result), 200


# ---------------------------------------------------------------------------
# GET /api/attendance/<date>
# ---------------------------------------------------------------------------
@reports_bp.route("/api/attendance/<att_date>", methods=["GET"])
def attendance_for_date(att_date):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    records = db.execute(
        "SELECT a.*, s.full_name, s.class FROM attendance a "
        "JOIN students s ON a.student_id=s.id WHERE a.date=? ORDER BY s.full_name",
        (att_date,),
    ).fetchall()
    return jsonify([dict(r) for r in records]), 200


# ---------------------------------------------------------------------------
# POST /api/attendance  — mark single attendance
# ---------------------------------------------------------------------------
@reports_bp.route("/api/attendance", methods=["POST"])
def mark_attendance():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    student_id = data.get("student_id")
    att_date = data.get("date") or date.today().isoformat()
    status = data.get("status", "present")
    note = data.get("note", "")

    if not student_id:
        return jsonify({"error": "student_id required"}), 400
    if status not in ("present", "absent", "excused"):
        return jsonify({"error": "status must be present/absent/excused"}), 400

    db = get_db()
    db.execute(
        """INSERT INTO attendance (student_id, date, status, note)
           VALUES (?,?,?,?)
           ON CONFLICT(student_id, date) DO UPDATE SET status=excluded.status, note=excluded.note""",
        (student_id, att_date, status, note),
    )
    db.commit()
    return jsonify({"success": True}), 200


# ---------------------------------------------------------------------------
# POST /api/attendance/bulk
# ---------------------------------------------------------------------------
@reports_bp.route("/api/attendance/bulk", methods=["POST"])
def bulk_attendance():
    err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    records = data.get("records", [])  # list of {student_id, date, status, note}

    db = get_db()
    for rec in records:
        student_id = rec.get("student_id")
        att_date = rec.get("date") or date.today().isoformat()
        status = rec.get("status", "present")
        note = rec.get("note", "")
        if not student_id:
            continue
        if status not in ("present", "absent", "excused"):
            continue
        db.execute(
            """INSERT INTO attendance (student_id, date, status, note)
               VALUES (?,?,?,?)
               ON CONFLICT(student_id, date) DO UPDATE SET status=excluded.status, note=excluded.note""",
            (student_id, att_date, status, note),
        )
    db.commit()
    return jsonify({"success": True, "count": len(records)}), 200


# ---------------------------------------------------------------------------
# GET /api/attendance/summary/<date>
# ---------------------------------------------------------------------------
@reports_bp.route("/api/attendance/summary/<att_date>", methods=["GET"])
def attendance_summary(att_date):
    err = _require_auth()
    if err:
        return err

    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM students WHERE is_active=1").fetchone()[0]
    present = db.execute(
        "SELECT COUNT(*) FROM attendance WHERE date=? AND status='present'",
        (att_date,),
    ).fetchone()[0]
    absent = db.execute(
        "SELECT COUNT(*) FROM attendance WHERE date=? AND status='absent'",
        (att_date,),
    ).fetchone()[0]
    excused = db.execute(
        "SELECT COUNT(*) FROM attendance WHERE date=? AND status='excused'",
        (att_date,),
    ).fetchone()[0]

    return jsonify({
        "date": att_date,
        "total_students": total,
        "present": present,
        "absent": absent,
        "excused": excused,
        "unmarked": total - (present + absent + excused),
    }), 200


# ---------------------------------------------------------------------------
# GET /api/reports  — combined summary / monthly / subjects
# ---------------------------------------------------------------------------
@reports_bp.route("/api/reports", methods=["GET"])
def reports_combined():
    err = _require_auth()
    if err:
        return err

    month = request.args.get("month", "") or date.today().strftime("%Y-%m")
    today_dt = date.today()
    db = get_db()

    # ── Per-student stats ────────────────────────────────────────────────────
    student_stats = {}
    for row in db.execute(
        "SELECT student_id, "
        "SUM(CASE WHEN is_paid=1 THEN amount ELSE 0 END) as total_paid, "
        "SUM(CASE WHEN is_paid=0 THEN amount ELSE 0 END) as total_owed, "
        "COUNT(CASE WHEN is_paid=1 THEN 1 END) as months_paid, "
        "COUNT(*) as months_total "
        "FROM payments GROUP BY student_id"
    ).fetchall():
        student_stats[row["student_id"]] = dict(row)

    current_paid_ind = set(
        r["student_id"]
        for r in db.execute(
            "SELECT DISTINCT student_id FROM payments WHERE is_paid=1 AND payment_month=?",
            (month,),
        ).fetchall()
    )

    students = db.execute(
        "SELECT id, full_name, class, subject FROM students WHERE is_active=1 ORDER BY full_name"
    ).fetchall()

    summary = []
    for s in students:
        sid = s["id"]
        st = student_stats.get(sid, {"total_paid": 0, "total_owed": 0, "months_paid": 0, "months_total": 0})
        paid_months_rows = db.execute(
            "SELECT payment_month FROM payments WHERE student_id=? AND is_paid=1 ORDER BY payment_month DESC",
            (sid,),
        ).fetchall()
        streak = 0
        if paid_months_rows:
            ml = [r["payment_month"] for r in paid_months_rows]
            streak = 1
            for i in range(1, len(ml)):
                expected = (
                    datetime.strptime(ml[i - 1], "%Y-%m").replace(day=1) - relativedelta(months=1)
                ).strftime("%Y-%m")
                if ml[i] == expected:
                    streak += 1
                else:
                    break
        mp = st["months_paid"] or 0
        mt = st["months_total"] or 0
        summary.append({
            "name": s["full_name"],
            "type": "individual",
            "class_name": s["class"] or "",
            "streak": streak,
            "current_paid": sid in current_paid_ind,
            "total_paid": st["total_paid"] or 0,
            "total_owed": st["total_owed"] or 0,
            "months_paid": mp,
            "months_total": mt,
            "rate": round(mp / mt * 100) if mt > 0 else 0,
        })

    # ── Per-group stats ──────────────────────────────────────────────────────
    group_stats = {}
    for row in db.execute(
        "SELECT group_id, "
        "SUM(CASE WHEN is_paid=1 THEN amount ELSE 0 END) as total_paid, "
        "SUM(CASE WHEN is_paid=0 THEN amount ELSE 0 END) as total_owed, "
        "COUNT(CASE WHEN is_paid=1 THEN 1 END) as months_paid, "
        "COUNT(*) as months_total "
        "FROM group_payments GROUP BY group_id"
    ).fetchall():
        group_stats[row["group_id"]] = dict(row)

    current_paid_grp = set(
        r["group_id"]
        for r in db.execute(
            "SELECT DISTINCT group_id FROM group_payments WHERE is_paid=1 AND payment_month=?",
            (month,),
        ).fetchall()
    )

    groups = db.execute(
        "SELECT id, group_name FROM family_groups WHERE is_active=1 ORDER BY group_name"
    ).fetchall()

    for g in groups:
        gid = g["id"]
        st = group_stats.get(gid, {"total_paid": 0, "total_owed": 0, "months_paid": 0, "months_total": 0})
        paid_months_rows = db.execute(
            "SELECT payment_month FROM group_payments WHERE group_id=? AND is_paid=1 ORDER BY payment_month DESC",
            (gid,),
        ).fetchall()
        streak = 0
        if paid_months_rows:
            ml = [r["payment_month"] for r in paid_months_rows]
            streak = 1
            for i in range(1, len(ml)):
                expected = (
                    datetime.strptime(ml[i - 1], "%Y-%m").replace(day=1) - relativedelta(months=1)
                ).strftime("%Y-%m")
                if ml[i] == expected:
                    streak += 1
                else:
                    break
        mp = st["months_paid"] or 0
        mt = st["months_total"] or 0
        summary.append({
            "name": g["group_name"],
            "type": "group",
            "class_name": "",
            "streak": streak,
            "current_paid": gid in current_paid_grp,
            "total_paid": st["total_paid"] or 0,
            "total_owed": st["total_owed"] or 0,
            "months_paid": mp,
            "months_total": mt,
            "rate": round(mp / mt * 100) if mt > 0 else 0,
        })

    # ── Monthly breakdown (last 12 months) ───────────────────────────────────
    # Aggregate from DB using a single query per table then merge in Python
    ind_monthly = {}
    for r in db.execute(
        "SELECT payment_month, "
        "SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END) as cash, "
        "SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END) as xfer, "
        "COUNT(*) as cnt, SUM(amount) as total "
        "FROM payments WHERE is_paid=1 GROUP BY payment_month"
    ).fetchall():
        ind_monthly[r["payment_month"]] = dict(r)

    grp_monthly = {}
    for r in db.execute(
        "SELECT payment_month, "
        "SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END) as cash, "
        "SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END) as xfer, "
        "COUNT(*) as cnt, SUM(amount) as total "
        "FROM group_payments WHERE is_paid=1 GROUP BY payment_month"
    ).fetchall():
        grp_monthly[r["payment_month"]] = dict(r)

    monthly = []
    for i in range(11, -1, -1):
        d = today_dt.replace(day=1) - relativedelta(months=i)
        mo = d.strftime("%Y-%m")
        im = ind_monthly.get(mo, {"cash": 0, "xfer": 0, "cnt": 0, "total": 0})
        gm = grp_monthly.get(mo, {"cash": 0, "xfer": 0, "cnt": 0, "total": 0})
        cash = (im["cash"] or 0) + (gm["cash"] or 0)
        xfer = (im["xfer"] or 0) + (gm["xfer"] or 0)
        monthly.append({
            "month": mo,
            "total": cash + xfer,
            "cash": cash,
            "transfer": xfer,
            "count": (im["cnt"] or 0) + (gm["cnt"] or 0),
        })

    # ── By subject ────────────────────────────────────────────────────────────
    subject_rows = db.execute(
        "SELECT COALESCE(s.subject, 'Unknown') as subject, "
        "COALESCE(SUM(CASE WHEN p.is_paid=1 THEN p.amount ELSE 0 END), 0) as amount, "
        "COUNT(DISTINCT s.id) as student_count "
        "FROM students s LEFT JOIN payments p ON p.student_id=s.id "
        "WHERE s.is_active=1 GROUP BY COALESCE(s.subject, 'Unknown') ORDER BY amount DESC"
    ).fetchall()

    subjects = []
    for sr in subject_rows:
        d = dict(sr)
        paid_count = db.execute(
            "SELECT COUNT(DISTINCT p.student_id) FROM payments p "
            "JOIN students s ON p.student_id=s.id "
            "WHERE s.is_active=1 AND COALESCE(s.subject,'Unknown')=? "
            "AND p.is_paid=1 AND p.payment_month=?",
            (d["subject"], month),
        ).fetchone()[0]
        d["paid_count"] = paid_count
        subjects.append(d)

    return jsonify({"summary": summary, "monthly": monthly, "subjects": subjects}), 200
