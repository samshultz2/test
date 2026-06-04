import sqlite3
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
from flask import current_app


def all_periods_up_to_today(start_date_str):
    """Return list of (payment_month_str, due_date) tuples from start+1m up to and including first period > today."""
    start = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    today = date.today()
    periods = []
    n = 1
    while True:
        due = start + relativedelta(months=n)
        periods.append((due.strftime("%Y-%m"), due))
        if due > today:
            break
        n += 1
    return periods


def current_period(start_date_str):
    """Return the last period tuple (the current/upcoming one)."""
    return all_periods_up_to_today(start_date_str)[-1]


def _get_connection():
    """Get a fresh SQLite connection (for use outside request context)."""
    db = sqlite3.connect(
        current_app.config["DATABASE"],
        detect_types=sqlite3.PARSE_DECLTYPES,
    )
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db


def ensure_all_records(student_id, db=None, update_unpaid_amount=False):
    """Auto-create payment records for all billing periods up to today for an individual student."""
    close_after = False
    if db is None:
        db = _get_connection()
        close_after = True

    try:
        student = db.execute(
            "SELECT id, start_date, monthly_fee, family_group_id, on_hold, is_active, full_name "
            "FROM students WHERE id=?",
            (student_id,),
        ).fetchone()

        if not student:
            return
        # Only auto-create for active, non-hold, individual (no group) students
        if not student["is_active"] or student["on_hold"] or student["family_group_id"]:
            return

        start_date_str = student["start_date"]
        monthly_fee = student["monthly_fee"]
        full_name = student["full_name"]

        periods = all_periods_up_to_today(start_date_str)

        for month_str, due_date in periods:
            existing = db.execute(
                "SELECT id, amount, is_paid FROM payments WHERE student_id=? AND payment_month=?",
                (student_id, month_str),
            ).fetchone()

            if not existing:
                db.execute(
                    "INSERT INTO payments (student_id, amount, payment_month, due_date, is_paid) "
                    "VALUES (?, ?, ?, ?, 0)",
                    (student_id, monthly_fee, month_str, due_date.strftime("%Y-%m-%d")),
                )
            elif update_unpaid_amount and not existing["is_paid"]:
                db.execute(
                    "UPDATE payments SET amount=? WHERE id=?",
                    (monthly_fee, existing["id"]),
                )

        db.commit()
    finally:
        if close_after:
            db.close()


def ensure_all_group_records(group_id, db=None, update_unpaid_amount=False):
    """Auto-create group payment records for all billing periods up to today."""
    close_after = False
    if db is None:
        db = _get_connection()
        close_after = True

    try:
        group = db.execute(
            "SELECT id, start_date, monthly_fee, on_hold, is_active, group_name "
            "FROM family_groups WHERE id=?",
            (group_id,),
        ).fetchone()

        if not group:
            return
        if not group["is_active"] or group["on_hold"]:
            return
        if not group["start_date"]:
            return

        start_date_str = group["start_date"]
        monthly_fee = group["monthly_fee"]

        periods = all_periods_up_to_today(start_date_str)

        for month_str, due_date in periods:
            existing = db.execute(
                "SELECT id, amount, is_paid FROM group_payments WHERE group_id=? AND payment_month=?",
                (group_id, month_str),
            ).fetchone()

            if not existing:
                db.execute(
                    "INSERT INTO group_payments (group_id, amount, payment_month, due_date, is_paid) "
                    "VALUES (?, ?, ?, ?, 0)",
                    (group_id, monthly_fee, month_str, due_date.strftime("%Y-%m-%d")),
                )
            elif update_unpaid_amount and not existing["is_paid"]:
                db.execute(
                    "UPDATE group_payments SET amount=? WHERE id=?",
                    (monthly_fee, existing["id"]),
                )

        db.commit()
    finally:
        if close_after:
            db.close()


def migrate_payment_months(db=None):
    """Fix payment_month to equal due_date[:7] on every startup."""
    close_after = False
    if db is None:
        db = _get_connection()
        close_after = True

    try:
        db.execute("""
            UPDATE payments
            SET payment_month = substr(due_date, 1, 7)
            WHERE due_date IS NOT NULL
              AND due_date != ''
              AND payment_month != substr(due_date, 1, 7)
        """)
        db.execute("""
            UPDATE group_payments
            SET payment_month = substr(due_date, 1, 7)
            WHERE due_date IS NOT NULL
              AND due_date != ''
              AND payment_month != substr(due_date, 1, 7)
        """)
        db.commit()
    finally:
        if close_after:
            db.close()


def log_activity(entity_type, entity_id, entity_name, action, detail="", db=None):
    """Insert a record into activity_log."""
    close_after = False
    if db is None:
        db = _get_connection()
        close_after = True

    try:
        db.execute(
            "INSERT INTO activity_log (entity_type, entity_id, entity_name, action, detail) "
            "VALUES (?, ?, ?, ?, ?)",
            (entity_type, entity_id, entity_name, action, detail),
        )
        db.commit()
    finally:
        if close_after:
            db.close()


def sync_all_billing(db=None):
    """Run ensure_all_records for every eligible student and group."""
    close_after = False
    if db is None:
        db = _get_connection()
        close_after = True

    try:
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
    finally:
        if close_after:
            db.close()
