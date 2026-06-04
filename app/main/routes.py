from flask import Blueprint, render_template, session, jsonify
from ..database import get_db

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
def index():
    return render_template("index.html")


@main_bp.route("/invoice/<ptype>/<int:eid>")
def invoice_page(ptype, eid):
    db = get_db()
    data = {}
    students = []
    payments = []

    if ptype == "individual":
        student = db.execute("SELECT * FROM students WHERE id=?", (eid,)).fetchone()
        if student:
            students = [dict(student)]
            payments = db.execute(
                "SELECT * FROM payments WHERE student_id=? ORDER BY due_date",
                (eid,),
            ).fetchall()
            payments = [dict(p) for p in payments]
            data = {
                "entity_name": student["full_name"],
                "entity_type": "individual",
                "contact_name": student["contact_name"],
                "contact_phone": student["contact_phone"],
                "monthly_fee": student["monthly_fee"],
                "class": student["class"],
                "subject": student["subject"],
            }
    elif ptype == "group":
        group = db.execute("SELECT * FROM family_groups WHERE id=?", (eid,)).fetchone()
        if group:
            members = db.execute(
                "SELECT * FROM students WHERE family_group_id=? AND is_active=1",
                (eid,),
            ).fetchall()
            students = [dict(m) for m in members]
            payments = db.execute(
                "SELECT * FROM group_payments WHERE group_id=? ORDER BY due_date",
                (eid,),
            ).fetchall()
            payments = [dict(p) for p in payments]
            data = {
                "entity_name": group["group_name"],
                "entity_type": "group",
                "contact_name": group["contact_name"],
                "contact_phone": group["contact_phone"],
                "monthly_fee": group["monthly_fee"],
            }

    unpaid = [p for p in payments if not p.get("is_paid")]
    total_due = sum(p["amount"] for p in unpaid)

    return render_template(
        "invoice.html",
        data=data,
        students=students,
        payments=payments,
        unpaid=unpaid,
        total_due=total_due,
        ptype=ptype,
        eid=eid,
    )


@main_bp.route("/receipt/<ptype>/<int:pid>")
def receipt_page(ptype, pid):
    db = get_db()
    payment = None
    entity = None

    if ptype == "individual":
        payment = db.execute(
            "SELECT p.*, s.full_name, s.class, s.subject, s.contact_name, s.contact_phone, "
            "s.monthly_fee "
            "FROM payments p JOIN students s ON p.student_id=s.id WHERE p.id=?",
            (pid,),
        ).fetchone()
        if payment:
            entity = {
                "name": payment["full_name"],
                "class": payment["class"],
                "subject": payment["subject"],
                "contact_name": payment["contact_name"],
                "contact_phone": payment["contact_phone"],
            }
    elif ptype == "group":
        payment = db.execute(
            "SELECT gp.*, fg.group_name, fg.contact_name, fg.contact_phone, fg.monthly_fee "
            "FROM group_payments gp JOIN family_groups fg ON gp.group_id=fg.id WHERE gp.id=?",
            (pid,),
        ).fetchone()
        if payment:
            entity = {
                "name": payment["group_name"],
                "contact_name": payment["contact_name"],
                "contact_phone": payment["contact_phone"],
            }

    payment_dict = dict(payment) if payment else {}

    return render_template(
        "receipt.html",
        payment=payment_dict,
        entity=entity,
        ptype=ptype,
        pid=pid,
    )
