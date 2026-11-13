from datetime import datetime
from time import monotonic
from uuid import uuid4
from zoneinfo import ZoneInfo

import eel
import psutil
from firebase_admin import exceptions

import functions as planit_functions
from .shared import FOCUS_APPS, active_sessions, study_timer

def _validated_allowed_apps(app_ids: list[str]) -> list[str]:
    if not isinstance(app_ids, list) or any(not isinstance(app_id, str) for app_id in app_ids):
        raise ValueError("허용 앱 설정 형식이 올바르지 않습니다.")
    if any(app_id not in FOCUS_APPS for app_id in app_ids):
        raise ValueError("허용 앱 목록에 지원하지 않는 앱이 포함되어 있습니다.")
    return list(dict.fromkeys(app_ids))

def _find_disallowed_apps(allowed_apps: list[str]) -> list[str]:
    found_apps: set[str] = set()
    try:
        for process in psutil.process_iter(["name"]):
            try:
                process_name = (process.info.get("name") or "").lower()
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            for app_id, app in FOCUS_APPS.items():
                if app_id not in allowed_apps and process_name in app["processes"]:
                    found_apps.add(app["label"])
    except psutil.Error as error:
        raise RuntimeError("실행 중인 앱을 확인할 수 없습니다.") from error
    return sorted(found_apps)

def _elapsed_seconds() -> float:
    started_at = study_timer["started_at_monotonic"]
    if study_timer["running"] and started_at is not None:
        return study_timer["elapsed_seconds"] + monotonic() - started_at
    return study_timer["elapsed_seconds"]

def _pause_timer(reason: str | None = None) -> None:
    if not study_timer["running"]:
        return
    study_timer["elapsed_seconds"] = _elapsed_seconds()
    study_timer["started_at_monotonic"] = None
    study_timer["running"] = False
    study_timer["reason"] = reason
    study_timer["auto_paused"] = reason is not None

def _timer_response() -> dict:
    return {
        "success": True,
        "running": study_timer["running"],
        "course": study_timer["course"],
        "elapsed_seconds": int(_elapsed_seconds()),
        "started_at": study_timer["started_at"],
        "reason": study_timer["reason"],
        "auto_paused": study_timer["auto_paused"],
    }

@eel.expose
def start_study_timer(course: str, allowed_apps: list[str], student_id: str = "") -> dict:
    if study_timer["running"]:
        return {"success": False, "error": "이미 실행 중인 학습 타이머가 있습니다."}
    if study_timer["course"]:
        return {"success": False, "error": "일시정지된 학습 기록을 먼저 재개하거나 저장해 주세요."}
    if study_timer["pending_record"] is not None:
        return {"success": False, "error": "저장 대기 중인 학습 기록을 먼저 저장해 주세요."}
    if not isinstance(course, str) or not course.strip():
        return {"success": False, "error": "공부할 과목을 선택해 주세요."}
    try:
        app_ids = _validated_allowed_apps(allowed_apps)
    except ValueError as error:
        return {"success": False, "error": str(error)}

    try:
        disallowed_apps = _find_disallowed_apps(app_ids)
    except RuntimeError as error:
        return {"success": False, "error": str(error)}
    if disallowed_apps:
        return {
            "success": False,
            "error": f"집중 허용 목록에 없는 앱이 실행 중입니다: {', '.join(disallowed_apps)}. 앱을 닫거나 허용 목록을 조정해 주세요.",
        }

    study_timer.update({
        "student_id": student_id if isinstance(student_id, str) and student_id else None,
        "course": course.strip(),
        "elapsed_seconds": 0.0,
        "started_at_monotonic": monotonic(),
        "started_at": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        "running": True,
        "allowed_apps": app_ids,
        "reason": None,
        "auto_paused": False,
        "pending_record": None,
    })
    return _timer_response()

@eel.expose
def resume_study_timer(allowed_apps: list[str]) -> dict:
    if not study_timer["course"]:
        return {"success": False, "error": "다시 시작할 학습 기록이 없습니다."}
    if study_timer["pending_record"] is not None:
        return {"success": False, "error": "저장 대기 중인 학습 기록을 먼저 저장해 주세요."}
    if not study_timer["auto_paused"]:
        return {"success": False, "error": "비허용 앱 감지로 자동 일시정지된 경우에만 다시 시작할 수 있습니다."}
    try:
        app_ids = _validated_allowed_apps(allowed_apps)
    except ValueError as error:
        return {"success": False, "error": str(error)}
    if study_timer["running"]:
        return _timer_response()

    try:
        disallowed_apps = _find_disallowed_apps(app_ids)
    except RuntimeError as error:
        return {"success": False, "error": str(error)}
    if disallowed_apps:
        return {
            "success": False,
            "error": f"집중 허용 목록에 없는 앱이 실행 중입니다: {', '.join(disallowed_apps)}. 앱을 닫거나 허용 목록을 조정해 주세요.",
        }

    study_timer["allowed_apps"] = app_ids
    study_timer["started_at_monotonic"] = monotonic()
    study_timer["running"] = True
    study_timer["reason"] = None
    study_timer["auto_paused"] = False
    return _timer_response()

@eel.expose
def get_study_timer_status(allowed_apps: list[str]) -> dict:
    try:
        study_timer["allowed_apps"] = _validated_allowed_apps(allowed_apps)
    except ValueError as error:
        return {"success": False, "error": str(error)}

    if study_timer["running"]:
        try:
            disallowed_apps = _find_disallowed_apps(study_timer["allowed_apps"])
        except RuntimeError as error:
            return {"success": False, "error": str(error)}
        if disallowed_apps:
            reason = (
                f"{', '.join(disallowed_apps)} 앱이 감지되어 타이머를 일시정지했습니다. "
                "앱을 닫거나 허용 목록을 조정한 뒤 다시 시작해 주세요."
            )
            _pause_timer(reason)
    return _timer_response()

def _save_study_record(record: dict) -> dict:
    student_id = study_timer["student_id"]
    if not student_id or student_id not in active_sessions:
        return {
            "success": True,
            "saved": False,
            "message": "미리보기 세션의 기록은 저장되지 않았습니다.",
            "elapsed_seconds": record["duration_seconds"],
        }

    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "Firebase에서 사용자 정보를 찾지 못했습니다."}
        study_sessions = user_data.get("study_sessions", [])
        if not isinstance(study_sessions, list):
            return {"success": False, "error": "저장된 학습 기록 형식이 올바르지 않습니다."}
        study_sessions.append(record)
        user_data["study_sessions"] = study_sessions
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "학습 기록을 Firebase에 저장하지 못했습니다."}

    return {
        "success": True,
        "saved": True,
        "message": "학습 시간이 저장되었습니다.",
        "elapsed_seconds": record["duration_seconds"],
        "record": record,
    }

@eel.expose
def stop_study_timer() -> dict:
    if study_timer["running"]:
        _pause_timer()
    record = study_timer["pending_record"]
    if record is None:
        duration_seconds = int(study_timer["elapsed_seconds"])
        if not study_timer["course"] or duration_seconds <= 0:
            study_timer.update({
                "student_id": None,
                "course": None,
                "elapsed_seconds": 0.0,
                "started_at_monotonic": None,
                "started_at": None,
                "running": False,
                "reason": None,
                "auto_paused": False,
            })
            return {
                "success": True,
                "saved": False,
                "message": "1초 미만의 학습 시간은 기록하지 않았습니다.",
                "elapsed_seconds": duration_seconds,
            }
        record = {
            "id": str(uuid4()),
            "course": study_timer["course"],
            "duration_seconds": duration_seconds,
            "started_at": study_timer["started_at"],
            "ended_at": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
        }
        study_timer["pending_record"] = record

    result = _save_study_record(record)
    if result["success"]:
        study_timer["pending_record"] = None
        study_timer["course"] = None
        study_timer["student_id"] = None
        study_timer["elapsed_seconds"] = 0.0
        study_timer["started_at_monotonic"] = None
        study_timer["started_at"] = None
        study_timer["running"] = False
        study_timer["reason"] = None
        study_timer["auto_paused"] = False
    return result
