import json
import math
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import eel
from dotenv import load_dotenv
from firebase_admin import exceptions

import functions as planit_functions
from backend.shared import GRADE_POINTS, PROJECT_ROOT, active_sessions

load_dotenv(PROJECT_ROOT / ".env")

DEFAULT_MODEL = "gemini-3.6-flash"
MAX_MESSAGES = 20
MAX_MESSAGE_LENGTH = 4000

STAR_SYSTEM_PROMPT = (
    "너는 대학생의 공부 친구 '별이'야. 반짝이는 별 캐릭터이고, 다정하고 밝은 반말로 대화해. "
    "사용자의 하루와 감정에 공감하고, 필요할 때만 공부 계획, 일정 우선순위, 학점 향상 전략을 "
    "구체적이고 실천 가능하게 제안해. 답변은 한국어로 2~5문장 정도로 짧게 하고, "
    "이모지는 ✦ 정도만 가끔 사용해. 모르는 사실을 지어내지 마. "
    "마크다운 문법은 사용하지 말고, 제목·목록·굵게·기울임·코드 표시 없이 일반 문장으로만 답해."
)

STUDY_SYSTEM_PROMPT = (
    "너는 대학생의 학습 계획과 공부 방법을 돕는 AI 도우미야. 한국어 존댓말로 간결하고 "
    "실용적으로 답해."
)

ADVICE_SYSTEM_PROMPT = (
    "너는 대학생 공부 친구 별이야. 다정하고 친근한 한국어 반말로 말해. "
    "제공된 월간 과목별 학습 시간과 저장된 성적을 함께 살펴보고, 먼저 기록으로 확인되는 객관적 사실을 "
    "짚은 뒤 네가 생각하는 주관적 분석과 구체적인 학습 조언을 덧붙여. "
    "성적과 공부 시간 사이의 인과관계를 데이터가 뒷받침하지 않으면 단정하지 말고, "
    "성적 미입력은 성적이 낮다는 뜻으로 해석하지 마. 근거 없는 평가나 데이터를 만들지 말고, "
    "사용자가 바로 실행할 수 있는 제안을 3~6문장으로 간결하게 전해. "
    "마크다운 문법은 사용하지 말고, 제목·목록·굵게·기울임·코드 표시 없이 일반 문장으로만 답해."
)


def _build_student_context(student_id: str) -> str:
    user_data = planit_functions.load_user_data(student_id)
    if not isinstance(user_data, dict):
        return ""

    courses = [c for c in user_data.get("courses", []) if isinstance(c, dict)]
    todos = [t for t in user_data.get("todos", []) if isinstance(t, dict)]
    current_year = planit_functions.get_now_year()
    current_term = planit_functions.get_now_term()

    course_lines = []
    earned_points = 0.0
    earned_credits = 0
    for course in courses:
        grade = course.get("grade")
        unit = course.get("unit") if isinstance(course.get("unit"), int) else 0
        if grade in GRADE_POINTS:
            earned_points += GRADE_POINTS[grade] * unit
            earned_credits += unit
        current = str(course.get("year")) == str(current_year) and str(course.get("term")) == str(current_term)
        course_lines.append(
            f"- [{course.get('year', '?')}년 {course.get('term', '?')}학기{' (이번 학기)' if current else ''}] "
            f"{course.get('title', '')} / 교수: {course.get('prof', '') or '미상'} / "
            f"{unit}학점 / 시간: {', '.join(str(t) for t in course.get('times', []) or []) or '미정'} / "
            f"성적: {grade or '미입력'}"
        )

    todo_lines = []
    for todo in todos:
        todo_lines.append(
            f"- {todo.get('title', '')} (과목: {todo.get('course') or '없음'}, 유형: {todo.get('type', '')}, "
            f"마감: {todo.get('deadline') or todo.get('date', '')}, "
            f"{'완료' if todo.get('done') else '미완료'})"
            + (f" 메모: {todo['note']}" if todo.get("note") else "")
        )

    gpa = f"{earned_points / earned_credits:.2f} / 4.5 (성적 입력 {earned_credits}학점 기준)" if earned_credits else "성적 입력 없음"
    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %A")
    return (
        "[사용자 정보]\n"
        f"오늘 날짜: {today}\n"
        f"이름: {user_data.get('name', '')}, 학과: {user_data.get('major', '')}, 학년: {user_data.get('grade', '')}\n"
        f"현재 평점(GPA): {gpa}\n"
        f"[수강 과목]\n{chr(10).join(course_lines) or '없음'}\n"
        f"[할 일/일정]\n{chr(10).join(todo_lines) or '없음'}\n"
        "위 정보를 이미 알고 있는 것처럼 자연스럽게 활용해서 대화해."
    )


def _get_model(system_instruction: str):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(".env 파일에 GEMINI_API_KEY가 설정되어 있지 않습니다.")
    model_name = os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_MODEL

    import google.generativeai as genai

    genai.configure(api_key=api_key)
    return genai.GenerativeModel(model_name, system_instruction=system_instruction)


def _to_contents(messages: Any) -> list[dict]:
    if not isinstance(messages, list):
        raise ValueError("대화 내용이 올바르지 않습니다.")
    contents: list[dict] = []
    for item in messages[-MAX_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("content", "")).strip()[:MAX_MESSAGE_LENGTH]
        if not text:
            continue
        role = "user" if item.get("role") == "user" else "model"
        if contents and contents[-1]["role"] == role:
            contents[-1]["parts"][0] += "\n" + text
        else:
            contents.append({"role": role, "parts": [text]})
    while contents and contents[0]["role"] != "user":
        contents.pop(0)
    if not contents or contents[-1]["role"] != "user":
        raise ValueError("보낼 메시지가 없습니다.")
    return contents


def _generate(system_instruction: str, contents: Any) -> dict:
    try:
        model = _get_model(system_instruction)
        response = model.generate_content(contents)
        try:
            answer = (response.text or "").strip()
        except ValueError:
            answer = ""
        if not answer:
            return {"success": False, "error": "응답을 받지 못했어요. 다른 말로 다시 시도해 주세요."}
        return {"success": True, "answer": answer}
    except Exception as error:
        return {"success": False, "error": f"Gemini 요청에 실패했습니다: {error}"}


@eel.expose
def chat_with_star(student_id: str, messages: list[dict]) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "별이와 대화하려면 먼저 로그인해 주세요."}
    try:
        contents = _to_contents(messages)
        context = _build_student_context(student_id)
    except ValueError as error:
        return {"success": False, "error": str(error)}
    except exceptions.FirebaseError:
        return {"success": False, "error": "사용자 정보를 불러오지 못했어요."}
    return _generate(f"{STAR_SYSTEM_PROMPT}\n\n{context}" if context else STAR_SYSTEM_PROMPT, contents)


@eel.expose
def ask_study_assistant(messages: list[dict]) -> dict:
    try:
        contents = _to_contents(messages)
    except ValueError as error:
        return {"success": False, "error": str(error)}
    return _generate(STUDY_SYSTEM_PROMPT, contents)


@eel.expose
def generate_monthly_study_advice(student_id: str, summary: dict) -> dict:
    if not isinstance(student_id, str) or student_id not in active_sessions:
        return {"success": False, "error": "별이의 조언을 받으려면 먼저 로그인해 주세요."}
    if not isinstance(summary, dict):
        return {"success": False, "error": "분석할 학습 기록이 올바르지 않습니다."}
    raw_subjects = summary.get("subjects")
    if not isinstance(raw_subjects, list) or any(not isinstance(item, dict) for item in raw_subjects):
        return {"success": False, "error": "과목별 학습 기록 형식이 올바르지 않습니다."}
    try:
        user_data = planit_functions.load_user_data(student_id)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "과목과 성적 정보를 불러오지 못했습니다."}
    if not isinstance(user_data, dict):
        return {"success": False, "error": "저장된 과목과 성적 정보를 찾지 못했습니다."}

    courses_by_title = {}
    stored_courses = user_data.get("courses", [])
    if not isinstance(stored_courses, list):
        return {"success": False, "error": "저장된 과목 정보 형식이 올바르지 않습니다."}
    for course in stored_courses:
        if not isinstance(course, dict):
            continue
        title = course.get("title")
        if isinstance(title, str) and title.strip():
            grade = course.get("grade")
            unit = course.get("unit")
            courses_by_title[title.strip()] = {
                "grade": grade if isinstance(grade, str) and grade in GRADE_POINTS else "미입력",
                "credits": unit if isinstance(unit, int) and not isinstance(unit, bool) else None,
            }

    subjects = []
    for subject in raw_subjects:
        title = subject.get("title")
        seconds = subject.get("study_seconds")
        if (
            not isinstance(title, str)
            or not title.strip()
            or isinstance(seconds, bool)
            or not isinstance(seconds, (int, float))
            or not math.isfinite(seconds)
            or seconds < 0
        ):
            continue
        course = courses_by_title.get(title.strip(), {})
        subjects.append({
            "title": title.strip(),
            "study_seconds": round(seconds),
            "grade": course.get("grade", "미입력"),
            "credits": course.get("credits"),
        })

    prompt_summary = {**summary, "subjects": subjects}
    prompt = (
        "다음은 사용자의 월간 학습 기록이야. 시간과 성적은 기록된 데이터 그대로야. "
        "객관적 사실과 별이의 분석/조언을 구분해 답해 줘.\n"
        + json.dumps(prompt_summary, ensure_ascii=False)
    )
    return _generate(ADVICE_SYSTEM_PROMPT, prompt)
