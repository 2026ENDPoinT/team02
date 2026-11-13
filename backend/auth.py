import eel
import requests
from firebase_admin import exceptions
from uuid import uuid4

import functions as planit_functions
from .shared import ECLASS_HEADERS, active_sessions, ensure_firebase_initialized, study_timer
from .courses import _course_matches_term
from .timer import stop_study_timer

@eel.expose
def login_eclass(student_id: str, password: str) -> dict:
    student_id = student_id.strip() if isinstance(student_id, str) else ""
    if not student_id or not isinstance(password, str) or not password:
        return {"success": False, "error": "학번과 비밀번호를 입력해 주세요."}

    try:
        ensure_firebase_initialized()
    except (FileNotFoundError, ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "Firebase 설정을 확인해 주세요."}

    session = requests.Session()
    try:
        planit_functions.login_eclass(session, ECLASS_HEADERS, student_id, password)
        profile = planit_functions.get_user_eclass_data(session, ECLASS_HEADERS)
        courses = planit_functions.get_user_courses(session, ECLASS_HEADERS)
        todos = planit_functions.get_user_eclass_todos(session, ECLASS_HEADERS)
    except planit_functions.LoginError as error:
        session.close()
        return {"success": False, "error": str(error)}
    except requests.exceptions.RequestException:
        session.close()
        return {"success": False, "error": "eClass 연결에 실패했습니다. 네트워크를 확인해 주세요."}
    except (AttributeError, IndexError, ValueError):
        session.close()
        return {"success": False, "error": "eClass 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요."}

    user_data = {
        "id": student_id,
        **profile,
        "courses": courses,
        "todos": todos,
        "timer_hidden_course_ids": [],
        "timer_custom_courses": [],
    }
    try:
        existing_user_data = planit_functions.load_user_data(student_id)
        if isinstance(existing_user_data, dict):
            existing_courses = existing_user_data.get("courses", [])
            existing_todos = existing_user_data.get("todos", [])
            existing_study_sessions = existing_user_data.get("study_sessions", [])
            hidden_course_ids = existing_user_data.get("timer_hidden_course_ids", [])
            custom_timer_courses = existing_user_data.get("timer_custom_courses", [])
            if hidden_course_ids is None:
                hidden_course_ids = []
            if custom_timer_courses is None:
                custom_timer_courses = []
            if (
                not isinstance(existing_courses, list)
                or not isinstance(existing_todos, list)
                or not isinstance(existing_study_sessions, list)
                or not isinstance(hidden_course_ids, list)
                or any(not isinstance(course_id, str) or not course_id.strip() for course_id in hidden_course_ids)
                or not isinstance(custom_timer_courses, list)
                or any(
                    not isinstance(course, dict)
                    or not isinstance(course.get("id"), str)
                    or not course["id"].strip()
                    or not isinstance(course.get("title"), str)
                    or not course["title"].strip()
                    for course in custom_timer_courses
                )
            ):
                raise ValueError("Firebase에 저장된 학습 데이터 형식이 올바르지 않습니다.")
            user_data["study_sessions"] = existing_study_sessions
            user_data["timer_hidden_course_ids"] = hidden_course_ids
            user_data["timer_custom_courses"] = custom_timer_courses
            current_year = planit_functions.get_now_year()
            current_term = planit_functions.get_now_term()
            for existing_course in existing_courses:
                if not isinstance(existing_course, dict):
                    continue
                if existing_course.get("by_user") is True:
                    existing_course.setdefault("year", current_year)
                    existing_course.setdefault("term", current_term)
                    user_data["courses"].append(existing_course)
                    continue
                if not _course_matches_term(existing_course, current_year, current_term):
                    existing_course.setdefault("course_id", str(uuid4()))
                    user_data["courses"].append(existing_course)
                    continue
                for course in user_data["courses"]:
                    if (
                        course.get("code") == existing_course.get("code")
                        and course.get("title") == existing_course.get("title")
                    ):
                        if "grade" in existing_course:
                            course["grade"] = existing_course["grade"]
                        if existing_course.get("course_id"):
                            course["course_id"] = existing_course["course_id"]
                        break
            user_data["todos"].extend(
                todo for todo in existing_todos
                if isinstance(todo, dict) and todo.get("by_user") is True
            )
        for course in user_data["courses"]:
            course.setdefault("course_id", str(uuid4()))
            course.setdefault("year", planit_functions.get_now_year())
            course.setdefault("term", planit_functions.get_now_term())
        planit_functions.save_user_data(user_data)
        saved_user_data = planit_functions.load_user_data(student_id)
    except (ValueError, exceptions.FirebaseError):
        session.close()
        return {"success": False, "error": "Firebase에 사용자 정보를 저장하지 못했습니다."}

    if saved_user_data is None:
        session.close()
        return {"success": False, "error": "Firebase에서 저장된 사용자 정보를 확인할 수 없습니다."}

    previous_session = active_sessions.pop(student_id, None)
    if previous_session is not None:
        previous_session.close()
    active_sessions[student_id] = session

    schedulable_courses = [
        course for course in saved_user_data["courses"]
        if _course_matches_term(
            course, planit_functions.get_now_year(), planit_functions.get_now_term()
        )
        and isinstance(course.get("times"), list)
        and all(isinstance(time, str) for time in course["times"])
    ]
    return {
        "success": True,
        "user": {
            "id": saved_user_data["id"],
            "name": saved_user_data.get("name", ""),
            "major": saved_user_data.get("major", ""),
            "grade": saved_user_data.get("grade", ""),
            "phone": saved_user_data.get("phone", ""),
            "email": saved_user_data.get("email", ""),
            "courses": saved_user_data["courses"],
            "todos": saved_user_data["todos"],
            "studySessions": saved_user_data.get("study_sessions", []),
            "todayCourses": planit_functions.get_today_courses(schedulable_courses),
            "hiddenTimerCourseIds": saved_user_data.get("timer_hidden_course_ids", []),
            "customTimerCourses": saved_user_data.get("timer_custom_courses", []),
        },
    }

@eel.expose
def logout_eclass(student_id: str) -> dict:
    if study_timer["student_id"] == student_id and (
        study_timer["running"]
        or study_timer["course"]
        or study_timer["pending_record"] is not None
    ):
        result = stop_study_timer()
        if not result["success"]:
            return result
    session = active_sessions.pop(student_id, None)
    if session is not None:
        session.close()
    return {"success": True}
