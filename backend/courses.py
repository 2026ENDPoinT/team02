import eel
import requests
from firebase_admin import exceptions
from uuid import uuid4
import re

import functions as planit_functions
from .shared import ECLASS_HEADERS, GRADE_POINTS, active_sessions

@eel.expose
def get_courses_for_term(student_id: str, year: int, term: int) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "수강 과목을 불러오려면 먼저 eClass에 로그인해 주세요."}
    if (
        isinstance(year, bool) or not isinstance(year, int) or year < 2000 or year > 2100
        or isinstance(term, bool) or not isinstance(term, int) or term not in (1, 2, 3, 4)
    ):
        return {"success": False, "error": "연도 또는 학기 선택 값이 올바르지 않습니다."}

    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        courses = user_data.get("courses", [])
        if not isinstance(courses, list):
            return {"success": False, "error": "저장된 과목 데이터 형식이 올바르지 않습니다."}

        fetched_courses = planit_functions.get_user_courses(
            active_sessions[student_id], ECLASS_HEADERS, year, term
        )
        for course in fetched_courses:
            course["course_id"] = str(uuid4())
            existing = next(
                (
                    item for item in courses
                    if isinstance(item, dict)
                    and item.get("by_user") is not True
                    and _course_matches_term(item, year, term)
                    and item.get("code") == course.get("code")
                    and item.get("title") == course.get("title")
                ),
                None,
            )
            if existing is not None:
                course["course_id"] = existing.get("course_id", course["course_id"])
                if "grade" in existing:
                    course["grade"] = existing["grade"]
        remaining_courses = [
            item for item in courses
            if not (
                isinstance(item, dict)
                and item.get("by_user") is not True
                and _course_matches_term(item, year, term)
            )
        ]
        remaining_courses.extend(fetched_courses)
        user_data["courses"] = remaining_courses
        planit_functions.save_user_data(user_data)
    except requests.exceptions.RequestException:
        return {"success": False, "error": "eClass에서 해당 학기 과목을 불러오지 못했습니다. 네트워크를 확인해 주세요."}
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "과목 정보를 Firebase에 저장하지 못했습니다."}
    return {"success": True, "courses": [course for course in remaining_courses if _course_matches_term(course, year, term)]}

def _course_matches_term(course: dict, year: int, term: int) -> bool:
    try:
        stored_year = int(course.get("year", planit_functions.get_now_year()))
        stored_term = int(course.get("term", planit_functions.get_now_term()))
    except (TypeError, ValueError):
        return False
    return stored_year == year and stored_term == term

@eel.expose
def add_user_course(student_id: str, course_data: dict, year: int, term: int) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "과목을 추가하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(course_data, dict) or not _valid_course_term(year, term):
        return {"success": False, "error": "과목 정보 또는 학기 선택 값이 올바르지 않습니다."}

    title = course_data.get("title")
    code = course_data.get("code", "")
    professor = course_data.get("prof", "")
    times = course_data.get("times")
    credits = course_data.get("unit")
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 120:
        return {"success": False, "error": "과목명은 1~120자로 입력해 주세요."}
    if not isinstance(code, str) or len(code.strip()) > 40:
        return {"success": False, "error": "과목 코드는 40자 이내로 입력해 주세요."}
    if not isinstance(professor, str) or len(professor.strip()) > 80:
        return {"success": False, "error": "담당 교수명은 80자 이내로 입력해 주세요."}
    if not _valid_course_times(times):
        return {"success": False, "error": "수업 시간은 요일(시작 교시 ~ 끝 교시) 형식으로 한 개 이상 선택해 주세요."}
    if isinstance(credits, bool) or not isinstance(credits, int) or not 1 <= credits <= 30:
        return {"success": False, "error": "학점은 1~30 사이의 정수로 입력해 주세요."}

    course = {
        "course_id": str(uuid4()),
        "title": title.strip(),
        "code": code.strip(),
        "prof": professor.strip(),
        "times": times,
        "unit": credits,
        "year": year,
        "term": term,
        "by_user": True,
    }
    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        courses = user_data.get("courses", [])
        if not isinstance(courses, list):
            return {"success": False, "error": "저장된 과목 데이터 형식이 올바르지 않습니다."}
        courses.append(course)
        user_data["courses"] = courses
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "과목을 Firebase에 저장하지 못했습니다."}
    return {"success": True, "course": course}

@eel.expose
def update_user_course(student_id: str, course_id: str, course_data: dict) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "과목을 수정하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(course_id, str) or not course_id or not isinstance(course_data, dict):
        return {"success": False, "error": "과목 정보가 올바르지 않습니다."}

    title = course_data.get("title")
    code = course_data.get("code", "")
    professor = course_data.get("prof", "")
    times = course_data.get("times")
    credits = course_data.get("unit")
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 120:
        return {"success": False, "error": "과목명은 1~120자로 입력해 주세요."}
    if not isinstance(code, str) or len(code.strip()) > 40:
        return {"success": False, "error": "과목 코드는 40자 이내로 입력해 주세요."}
    if not isinstance(professor, str) or len(professor.strip()) > 80:
        return {"success": False, "error": "담당 교수명은 80자 이내로 입력해 주세요."}
    if not _valid_course_times(times):
        return {"success": False, "error": "수업 시간은 요일(시작 교시 ~ 끝 교시) 형식으로 한 개 이상 선택해 주세요."}
    if isinstance(credits, bool) or not isinstance(credits, int) or not 1 <= credits <= 30:
        return {"success": False, "error": "학점은 1~30 사이의 정수로 입력해 주세요."}

    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        courses = user_data.get("courses", [])
        if not isinstance(courses, list):
            return {"success": False, "error": "저장된 과목 데이터 형식이 올바르지 않습니다."}
        course = next(
            (
                item for item in courses
                if isinstance(item, dict)
                and item.get("course_id") == course_id
                and item.get("by_user") is True
            ),
            None,
        )
        if course is None:
            return {"success": False, "error": "수정할 사용자 추가 과목을 찾지 못했습니다."}
        course.update({
            "title": title.strip(),
            "code": code.strip(),
            "prof": professor.strip(),
            "times": times,
            "unit": credits,
        })
        user_data["courses"] = courses
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "과목 정보를 Firebase에 저장하지 못했습니다."}
    return {"success": True, "course": course}

@eel.expose
def delete_user_course(student_id: str, course_id: str) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "과목을 삭제하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(course_id, str) or not course_id.strip():
        return {"success": False, "error": "과목 식별자가 올바르지 않습니다."}

    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        courses = user_data.get("courses", [])
        if not isinstance(courses, list):
            return {"success": False, "error": "저장된 과목 데이터 형식이 올바르지 않습니다."}
        course = next(
            (
                item for item in courses
                if isinstance(item, dict)
                and item.get("course_id") == course_id
                and item.get("by_user") is True
            ),
            None,
        )
        if course is None:
            return {"success": False, "error": "삭제할 사용자 추가 과목을 찾지 못했습니다."}
        user_data["courses"] = [item for item in courses if item is not course]
        hidden_course_ids = user_data.get("timer_hidden_course_ids")
        if isinstance(hidden_course_ids, list):
            user_data["timer_hidden_course_ids"] = [
                hidden_id for hidden_id in hidden_course_ids if hidden_id != course_id
            ]
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "과목을 Firebase에서 삭제하지 못했습니다."}
    return {"success": True, "courseId": course_id}

@eel.expose
def save_timer_course_preferences(
    student_id: str,
    hidden_course_ids: list,
    custom_courses: list,
) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "학습 과목을 수정하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(hidden_course_ids, list) or any(
        not isinstance(course_id, str) or not course_id.strip() or len(course_id) > 128
        for course_id in hidden_course_ids
    ):
        return {"success": False, "error": "숨김 과목 정보가 올바르지 않습니다."}
    if not isinstance(custom_courses, list):
        return {"success": False, "error": "추가 과목 목록이 올바르지 않습니다."}

    normalized_custom_courses = []
    seen_ids = set()
    seen_titles = set()
    for custom_course in custom_courses:
        if not isinstance(custom_course, dict):
            return {"success": False, "error": "추가 과목 정보가 올바르지 않습니다."}
        course_id = custom_course.get("id")
        title = custom_course.get("title")
        if (
            not isinstance(course_id, str)
            or not course_id.strip()
            or len(course_id) > 128
            or not isinstance(title, str)
            or not title.strip()
            or len(title.strip()) > 120
        ):
            return {"success": False, "error": "과목명은 1~120자로 입력해 주세요."}
        normalized_id = course_id.strip()
        normalized_title = title.strip()
        title_key = normalized_title.casefold()
        if normalized_id in seen_ids or title_key in seen_titles:
            return {"success": False, "error": "추가 과목은 이름과 식별자가 서로 달라야 합니다."}
        seen_ids.add(normalized_id)
        seen_titles.add(title_key)
        normalized_custom_courses.append({"id": normalized_id, "title": normalized_title})

    normalized_hidden_course_ids = list(dict.fromkeys(
        course_id.strip() for course_id in hidden_course_ids
    ))
    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        courses = user_data.get("courses", [])
        if not isinstance(courses, list):
            return {"success": False, "error": "저장된 과목 데이터 형식이 올바르지 않습니다."}
        current_year = planit_functions.get_now_year()
        current_term = planit_functions.get_now_term()
        current_course_titles = {
            course.get("title", "").strip().casefold()
            for course in courses
            if isinstance(course, dict)
            and _course_matches_term(course, current_year, current_term)
            and isinstance(course.get("title"), str)
        }
        if any(
            course["title"].casefold() in current_course_titles
            for course in normalized_custom_courses
        ):
            return {"success": False, "error": "수강 과목과 같은 이름은 추가할 수 없습니다."}
        user_data["timer_hidden_course_ids"] = normalized_hidden_course_ids
        user_data["timer_custom_courses"] = normalized_custom_courses
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "학습 과목 설정을 Firebase에 저장하지 못했습니다."}

    return {
        "success": True,
        "hiddenCourseIds": normalized_hidden_course_ids,
        "customCourses": normalized_custom_courses,
    }

def _valid_course_times(times: object) -> bool:
    if not isinstance(times, list) or not times:
        return False
    pattern = re.compile(r"([월화수목금토일])\(([1-9]|1[0-6]) ~ ([1-9]|1[0-6])\)")
    for time in times:
        if not isinstance(time, str):
            return False
        match = pattern.fullmatch(time)
        if match is None or int(match.group(2)) > int(match.group(3)):
            return False
    return True

def _valid_course_term(year: int, term: int) -> bool:
    return (
        isinstance(year, int) and not isinstance(year, bool) and 2000 <= year <= 2100
        and isinstance(term, int) and not isinstance(term, bool) and term in (1, 2, 3, 4)
    )

@eel.expose
def set_course_grade(student_id: str, course_id: str, grade: str) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "성적을 저장하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(course_id, str) or not course_id:
        return {"success": False, "error": "과목 식별자가 올바르지 않습니다."}
    if grade not in (*GRADE_POINTS.keys(), ""):
        return {"success": False, "error": "성적 등급이 올바르지 않습니다."}

    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        courses = user_data.get("courses", [])
        if not isinstance(courses, list):
            return {"success": False, "error": "저장된 과목 데이터 형식이 올바르지 않습니다."}
        course = next(
            (item for item in courses if isinstance(item, dict) and item.get("course_id") == course_id),
            None,
        )
        if course is None:
            return {"success": False, "error": "성적을 입력할 과목을 찾지 못했습니다."}
        if grade:
            course["grade"] = grade
        else:
            course.pop("grade", None)
        user_data["courses"] = courses
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "성적을 Firebase에 저장하지 못했습니다."}
    return {"success": True, "course": course}
