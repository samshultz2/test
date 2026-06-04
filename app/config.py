import os
import secrets

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    DATABASE = os.path.join(BASE_DIR, "lessonpay.db")
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Strict"
    SESSION_COOKIE_SECURE = False  # Set True in production with HTTPS
    BACKUP_DIR = os.path.join(BASE_DIR, "auto_backups")
    DEFAULT_PASSWORD = "posyhubcomng"
    RATELIMIT_DEFAULT = "200 per day"
    RATELIMIT_STORAGE_URL = "memory://"
