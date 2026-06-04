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
    today = date.today()
    today_str = today.isoformat()
    this_month = today.strftime("%Y-%m")
    last_month = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    # Sync billing for all eligible students and groups
    students_all = db.execute(
        "SELECT id FROM students WHERE is_active=1 AND on_hold=0 AND family_group_id IS NULL"
    ).fetchall()
    for s in students_all:
        ensure_all_records(s["id"], db=db)

    groups_all = db.execute(
        "SELECT id FROM family_groups WHERE is_active=1 AND on_hold=0 AND start_date IS NOT NULL"
    ).fetchall()
    for g in groups_all:
        ensure_all_group_records(g["id"], db=db)

    # Counts
    total_students = db.execute(
        "SELECT COUNT(*) FROM students WHERE is_active=1"
    ).fetchone()[0]
    total_groups = db.execute(
        "SELECT COUNT(*) FROM family_groups WHERE is_active=1"
    ).fetchone()[0]
    on_hold_students = db.execute(
        "SELECT COUNT(*) FROM students WHERE is_active=1 AND on_hold=1"
    ).fetchone()[0]
    on_hold_groups = db.execute(
        "SELECT COUNT(*) FROM family_groups WHERE is_active=1 AND on_hold=1"
    ).fetchone()[0]
    on_hold_count = on_hold_students + on_hold_groups

    # Total collected (all time)
    total_collected_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1"
    ).fetchone()[0]
    total_collected_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1"
    ).fetchone()[0]
    total_collected = total_collected_ind + total_collected_grp

    # This period: current month expected vs collected
    this_period_collected_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?",
        (this_month,),
    ).fetchone()[0]
    this_period_collected_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?",
        (this_month,),
    ).fetchone()[0]
    this_period_collected = this_period_collected_ind + this_period_collected_grp

    this_period_expected_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE payment_month=?",
        (this_month,),
    ).fetchone()[0]
    this_period_expected_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE payment_month=?",
        (this_month,),
    ).fetchone()[0]
    this_period_expected = this_period_expected_ind + this_period_expected_grp

    # Overdue: unpaid records with due_date < today
    overdue_ind = db.execute(
        "SELECT p.id, p.amount, p.due_date, p.payment_month, s.full_name, s.subject, s.id as sid "
        "FROM payments p JOIN students s ON p.student_id=s.id "
        "WHERE p.is_paid=0 AND p.due_date < ? AND s.is_active=1",
        (today_str,),
    ).fetchall()
    overdue_grp = db.execute(
        "SELECT gp.id, gp.amount, gp.due_date, gp.payment_month, fg.group_name, fg.id as gid "
        "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id "
        "WHERE gp.is_paid=0 AND gp.due_date < ? AND fg.is_active=1",
        (today_str,),
    ).fetchall()

    overdue_names = []
    for r in overdue_ind:
        overdue_names.append({
            "name": r["full_name"],
            "amount": r["amount"],
            "due_date": r["due_date"],
            "pid": r["id"],
            "sid": r["sid"],
            "month": r["payment_month"],
            "subject": r["subject"],
            "is_group": False,
        })
    for r in overdue_grp:
        overdue_names.append({
            "name": r["group_name"],
            "amount": r["amount"],
            "due_date": r["due_date"],
            "pid": r["id"],
            "gid": r["gid"],
            "month": r["payment_month"],
            "subject": "",
            "is_group": True,
        })

    overdue = len(overdue_names)
    overdue_amount = sum(x["amount"] for x in overdue_names)

    # Due soon: unpaid with due_date between today and 7 days from now
    soon_cutoff = (today + timedelta(days=7)).isoformat()
    due_soon_ind = db.execute(
        "SELECT p.id, p.amount, p.due_date, p.payment_month, s.full_name, s.subject, s.id as sid "
        "FROM payments p JOIN students s ON p.student_id=s.id "
        "WHERE p.is_paid=0 AND p.due_date >= ? AND p.due_date <= ? AND s.is_active=1",
        (today_str, soon_cutoff),
    ).fetchall()
    due_soon_grp = db.execute(
        "SELECT gp.id, gp.amount, gp.due_date, gp.payment_month, fg.group_name, fg.id as gid "
        "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id "
        "WHERE gp.is_paid=0 AND gp.due_date >= ? AND gp.due_date <= ? AND fg.is_active=1",
        (today_str, soon_cutoff),
    ).fetchall()

    due_soon = []
    for r in due_soon_ind:
        due_soon.append({
            "name": r["full_name"],
            "amount": r["amount"],
            "due_date": r["due_date"],
            "pid": r["id"],
            "sid": r["sid"],
            "month": r["payment_month"],
            "subject": r["subject"],
            "is_group": False,
        })
    for r in due_soon_grp:
        due_soon.append({
            "name": r["group_name"],
            "amount": r["amount"],
            "due_date": r["due_date"],
            "pid": r["id"],
            "gid": r["gid"],
            "month": r["payment_month"],
            "subject": "",
            "is_group": True,
        })

    # Recent payments (last 10)
    recent_ind = db.execute(
        "SELECT p.amount, p.payment_month, p.paid_date, p.payment_method, p.paid_by, "
        "s.full_name as name, s.class as cls, 'individual' as ptype "
        "FROM payments p JOIN students s ON p.student_id=s.id "
        "WHERE p.is_paid=1 ORDER BY p.paid_date DESC LIMIT 10",
    ).fetchall()
    recent_grp = db.execute(
        "SELECT gp.amount, gp.payment_month, gp.paid_date, gp.payment_method, gp.paid_by, "
        "fg.group_name as name, '' as cls, 'group' as ptype "
        "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id "
        "WHERE gp.is_paid=1 ORDER BY gp.paid_date DESC LIMIT 10",
    ).fetchall()

    combined_recent = sorted(
        [dict(r) for r in recent_ind] + [dict(r) for r in recent_grp],
        key=lambda x: x.get("paid_date") or "",
        reverse=True,
    )[:10]

    # Trend: last 6 months
    trend = []
    for i in range(5, -1, -1):
        d = today.replace(day=1) - relativedelta(months=i)
        mo = d.strftime("%Y-%m")
        ind_amt = db.execute(
            "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?",
            (mo,),
        ).fetchone()[0]
        grp_amt = db.execute(
            "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?",
            (mo,),
        ).fetchone()[0]
        trend.append({"month": mo, "amount": ind_amt + grp_amt})

    # Cash vs transfer totals
    cash_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_method='cash'"
    ).fetchone()[0]
    cash_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_method='cash'"
    ).fetchone()[0]
    cash_total = cash_ind + cash_grp

    transfer_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_method='transfer'"
    ).fetchone()[0]
    transfer_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_method='transfer'"
    ).fetchone()[0]
    transfer_total = transfer_ind + transfer_grp

    # This month vs last month
    this_month_collected_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?",
        (this_month,),
    ).fetchone()[0]
    this_month_collected_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?",
        (this_month,),
    ).fetchone()[0]
    this_month_collected = this_month_collected_ind + this_month_collected_grp

    last_month_collected_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_paid=1 AND payment_month=?",
        (last_month,),
    ).fetchone()[0]
    last_month_collected_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments WHERE is_paid=1 AND payment_month=?",
        (last_month,),
    ).fetchone()[0]
    last_month_collected = last_month_collected_ind + last_month_collected_grp

    if last_month_collected > 0:
        mom_change = ((this_month_collected - last_month_collected) / last_month_collected) * 100
    else:
        mom_change = 0.0

    # Collection rate
    total_expected_ind = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments"
    ).fetchone()[0]
    total_expected_grp = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM group_payments"
    ).fetchone()[0]
    total_expected = total_expected_ind + total_expected_grp
    collection_rate = (total_collected / total_expected * 100) if total_expected > 0 else 0.0

    # Average monthly (from trend data)
    trend_amounts = [t["amount"] for t in trend if t["amount"] > 0]
    avg_monthly = sum(trend_amounts) / len(trend_amounts) if trend_amounts else 0.0
    projected_annual = avg_monthly * 12

    # Top payers: students with most consecutive paid months
    all_students = db.execute(
        "SELECT id, full_name, class FROM students WHERE is_active=1"
    ).fetchall()
    top_payers = []
    for s in all_students:
        paid_months = db.execute(
            "SELECT payment_month FROM payments WHERE student_id=? AND is_paid=1 ORDER BY payment_month DESC",
            (s["id"],),
        ).fetchall()
        streak = 0
        if paid_months:
            months_list = [p["payment_month"] for p in paid_months]
            streak = 1
            for i in range(1, len(months_list)):
                expected = (
                    datetime.strptime(months_list[i-1], "%Y-%m").replace(day=1)
                    - relativedelta(months=1)
                ).strftime("%Y-%m")
                if months_list[i] == expected:
                    streak += 1
                else:
                    break
        if streak > 0:
            top_payers.append({"name": s["full_name"], "class": s["class"], "streak": streak})

    top_payers.sort(key=lambda x: x["streak"], reverse=True)
    top_payers = top_payers[:5]

    # Debtors: students with multiple unpaid months
    debtors = []
    for s in all_students:
        unpaid = db.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as amt FROM payments "
            "WHERE student_id=? AND is_paid=0",
            (s["id"],),
        ).fetchone()
        if unpaid["cnt"] >= 2:
            debtors.append({
                "name": s["full_name"],
                "class": s["class"],
                "months": unpaid["cnt"],
                "amount": unpaid["amt"],
            })
    debtors.sort(key=lambda x: x["amount"], reverse=True)
    debtors = debtors[:10]

    # Class breakdown
    classes = db.execute(
        "SELECT DISTINCT class FROM students WHERE is_active=1"
    ).fetchall()
    class_breakdown = []
    for cls_row in classes:
        cls = cls_row["class"]
        count = db.execute(
            "SELECT COUNT(*) FROM students WHERE is_active=1 AND class=?",
            (cls,),
        ).fetchone()[0]
        paid = db.execute(
            "SELECT COALESCE(SUM(p.amount),0) FROM payments p "
            "JOIN students s ON p.student_id=s.id "
            "WHERE s.is_active=1 AND s.class=? AND p.is_paid=1",
            (cls,),
        ).fetchone()[0]
        owed = db.execute(
            "SELECT COALESCE(SUM(p.amount),0) FROM payments p "
            "JOIN students s ON p.student_id=s.id "
            "WHERE s.is_active=1 AND s.class=? AND p.is_paid=0",
            (cls,),
        ).fetchone()[0]
        class_breakdown.append({"class": cls, "count": count, "paid": paid, "owed": owed})

    # Unpaid this period
    unpaid_this_period_ind = db.execute(
        "SELECT COUNT(*) FROM payments WHERE is_paid=0 AND payment_month=?",
        (this_month,),
    ).fetchone()[0]
    unpaid_this_period_grp = db.execute(
        "SELECT COUNT(*) FROM group_payments WHERE is_paid=0 AND payment_month=?",
        (this_month,),
    ).fetchone()[0]
    unpaid_this_period = unpaid_this_period_ind + unpaid_this_period_grp

    return jsonify({
        "total_students": total_students,
        "total_groups": total_groups,
        "on_hold_count": on_hold_count,
        "total_collected": total_collected,
        "this_period_collected": this_period_collected,
        "this_period_expected": this_period_expected,
        "overdue": overdue,
        "overdue_amount": overdue_amount,
        "overdue_names": overdue_names,
        "due_soon": due_soon,
        "recent_payments": combined_recent,
        "trend": trend,
        "cash_total": cash_total,
        "transfer_total": transfer_total,
        "this_month_collected": this_month_collected,
        "last_month_collected": last_month_collected,
        "mom_change": round(mom_change, 2),
        "collection_rate": round(collection_rate, 2),
        "avg_monthly": round(avg_monthly, 2),
        "projected_annual": round(projected_annual, 2),
        "top_payers": top_payers,
        "debtors": debtors,
        "class_breakdown": class_breakdown,
        "unpaid_this_period": unpaid_this_period,
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

    return jsonify({
        "students": [dict(s) for s in students],
        "groups": [dict(g) for g in groups],
    }), 200


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
