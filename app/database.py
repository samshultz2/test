import sqlite3
from flask import g, current_app


def get_db():
    """Return a database connection for the current request context."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


def close_db(e=None):
    """Close the database connection at the end of the request."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(app):
    """Initialize the database schema."""
    with app.app_context():
        db = get_db()
        db.executescript("""
            CREATE TABLE IF NOT EXISTS family_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_name TEXT NOT NULL,
                monthly_fee REAL NOT NULL DEFAULT 0,
                start_date TEXT,
                contact_name TEXT,
                contact_phone TEXT,
                notes TEXT,
                is_active INTEGER DEFAULT 1,
                on_hold INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                class TEXT NOT NULL,
                subject TEXT,
                monthly_fee REAL NOT NULL DEFAULT 0,
                start_date TEXT NOT NULL,
                family_group_id INTEGER REFERENCES family_groups(id),
                contact_name TEXT,
                contact_phone TEXT,
                notes TEXT,
                is_active INTEGER DEFAULT 1,
                on_hold INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id),
                amount REAL NOT NULL,
                payment_month TEXT NOT NULL,
                due_date TEXT NOT NULL,
                paid_date TEXT,
                payment_method TEXT CHECK(payment_method IN ('cash','transfer')),
                paid_by TEXT,
                payer_type TEXT CHECK(payer_type IN ('parent','student','guardian','other')),
                receipt_note TEXT,
                is_paid INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS group_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL REFERENCES family_groups(id),
                amount REAL NOT NULL,
                payment_month TEXT NOT NULL,
                due_date TEXT NOT NULL,
                paid_date TEXT,
                payment_method TEXT CHECK(payment_method IN ('cash','transfer')),
                paid_by TEXT,
                payer_type TEXT CHECK(payer_type IN ('parent','student','guardian','other')),
                receipt_note TEXT,
                is_paid INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT,
                entity_id INTEGER,
                entity_name TEXT,
                action TEXT,
                detail TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS lesson_schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id),
                day_of_week TEXT NOT NULL,
                start_time TEXT,
                end_time TEXT,
                location TEXT,
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id),
                date TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('present','absent','excused')),
                note TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                UNIQUE(student_id, date)
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        """)
        db.commit()
