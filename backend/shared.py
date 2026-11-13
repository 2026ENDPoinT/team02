import os
from pathlib import Path

import firebase_admin
import requests
from firebase_admin import credentials, exceptions

PROJECT_ROOT = Path(__file__).resolve().parent.parent

WEB_DIR = PROJECT_ROOT / "web"
FIREBASE_CREDENTIALS = PROJECT_ROOT / "com-hackathon-firebase-adminsdk-fbsvc-0b2c53509c.json"

FIREBASE_DATABASE_URL = "https://com-hackathon-default-rtdb.firebaseio.com/"

ECLASS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://eclass.seoultech.ac.kr/ilos/main/member/login_form.acl",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

GRADE_POINTS = {"A+": 4.5, "A0": 4.0, "B+": 3.5, "B0": 3.0, "C+": 2.5, "C0": 2.0, "D+": 1.5, "D0": 1.0, "F": 0.0}

active_sessions: dict[str, requests.Session] = {}

FOCUS_APPS = {
    "chrome": {"label": "Chrome", "processes": {"chrome.exe"}},
    "notion": {"label": "Notion", "processes": {"notion.exe"}},
    "discord": {"label": "Discord", "processes": {"discord.exe"}},
    "steam": {"label": "Steam", "processes": {"steam.exe", "steamwebhelper.exe"}},
}

study_timer = {
    "student_id": None,
    "course": None,
    "elapsed_seconds": 0.0,
    "started_at_monotonic": None,
    "started_at": None,
    "running": False,
    "allowed_apps": ["chrome", "notion"],
    "reason": None,
    "auto_paused": False,
    "pending_record": None,
}

def ensure_firebase_initialized() -> None:
    try:
        firebase_admin.get_app()
    except ValueError:
        if not FIREBASE_CREDENTIALS.is_file():
            raise FileNotFoundError("Firebase 서비스 계정 파일을 찾을 수 없습니다.")
        firebase_admin.initialize_app(
            credentials.Certificate(str(FIREBASE_CREDENTIALS)),
            {"databaseURL": FIREBASE_DATABASE_URL},
        )
