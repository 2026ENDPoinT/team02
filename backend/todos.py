from datetime import datetime
import re
from uuid import uuid4

import eel
from firebase_admin import exceptions

import functions as planit_functions
from .shared import active_sessions

@eel.expose
def save_user_todo(student_id: str, todo: dict) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "일정을 저장하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(todo, dict):
        return {"success": False, "error": "일정 데이터 형식이 올바르지 않습니다."}

    title = todo.get("title")
    due_date = todo.get("date")
    raw_dates = todo.get("dates", [due_date])
    note = todo.get("note", "")
    todo_id = todo.get("id")
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 120:
        return {"success": False, "error": "일정 제목은 1~120자로 입력해 주세요."}
    if not isinstance(due_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
        return {"success": False, "error": "올바른 일정 날짜를 입력해 주세요."}
    if not isinstance(raw_dates, list) or not 1 <= len(raw_dates) <= 366:
        return {"success": False, "error": "일정 날짜는 연속된 1~366일 범위로 선택해 주세요."}
    dates = []
    try:
        for date_value in raw_dates:
            if not isinstance(date_value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_value):
                return {"success": False, "error": "올바른 일정 날짜를 입력해 주세요."}
            datetime.strptime(date_value, "%Y-%m-%d")
            dates.append(date_value)
    except ValueError:
        return {"success": False, "error": "존재하지 않는 일정 날짜입니다."}
    if dates != sorted(set(dates)) or dates[0] != due_date:
        return {"success": False, "error": "일정 날짜는 시작일부터 연속된 순서로 입력해 주세요."}
    parsed_dates = [datetime.strptime(date_value, "%Y-%m-%d").date() for date_value in dates]
    if any((right - left).days != 1 for left, right in zip(parsed_dates, parsed_dates[1:])):
        return {"success": False, "error": "일정 날짜는 연속된 날짜만 선택할 수 있습니다."}
    if not isinstance(note, str) or len(note.strip()) > 300:
        return {"success": False, "error": "메모는 300자 이내로 입력해 주세요."}
    if todo_id is not None and (not isinstance(todo_id, str) or not todo_id):
        return {"success": False, "error": "일정 식별자가 올바르지 않습니다."}

    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        todos = user_data.get("todos", [])
        if not isinstance(todos, list):
            return {"success": False, "error": "저장된 일정 데이터 형식이 올바르지 않습니다."}
        if todo_id is None:
            todo_id = str(uuid4())
            todos.append({
                "id": todo_id,
                "title": title.strip(),
                "date": due_date,
                "dates": dates,
                "deadline": dates[-1],
                "course": "",
                "type": "개인 일정",
                "note": note.strip(),
                "done": False,
                "by_user": True,
            })
        else:
            matching_todo = next(
                (item for item in todos if isinstance(item, dict) and item.get("id") == todo_id and item.get("by_user") is True),
                None,
            )
            if matching_todo is None:
                return {"success": False, "error": "수정할 개인 일정을 찾지 못했습니다."}
            matching_todo.update({
                "title": title.strip(),
                "date": due_date,
                "dates": dates,
                "deadline": dates[-1],
                "note": note.strip(),
            })
        user_data["todos"] = todos
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "Firebase에 일정을 저장하지 못했습니다."}

    return {"success": True, "todo": next(item for item in todos if item.get("id") == todo_id)}

@eel.expose
def set_user_todo_done(student_id: str, todo_id: str, done: bool) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "일정을 수정하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(todo_id, str) or not isinstance(done, bool):
        return {"success": False, "error": "일정 변경 값이 올바르지 않습니다."}
    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        todos = user_data.get("todos", [])
        if not isinstance(todos, list):
            return {"success": False, "error": "저장된 일정 데이터 형식이 올바르지 않습니다."}
        matching_todo = next(
            (
                item for item in todos
                if isinstance(item, dict)
                and item.get("id") == todo_id
                and item.get("by_user") is True
            ),
            None,
        )
        if matching_todo is None:
            return {"success": False, "error": "완료 상태를 변경할 수 있는 개인 일정을 찾지 못했습니다."}
        matching_todo["done"] = done
        user_data["todos"] = todos
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "일정 완료 상태를 저장하지 못했습니다."}
    return {"success": True, "todo": matching_todo}

@eel.expose
def delete_user_todo(student_id: str, todo_id: str) -> dict:
    if student_id not in active_sessions:
        return {"success": False, "error": "일정을 삭제하려면 먼저 eClass에 로그인해 주세요."}
    if not isinstance(todo_id, str) or not todo_id:
        return {"success": False, "error": "일정 식별자가 올바르지 않습니다."}
    try:
        user_data = planit_functions.load_user_data(student_id)
        if user_data is None:
            return {"success": False, "error": "저장된 사용자 정보를 찾지 못했습니다."}
        todos = user_data.get("todos", [])
        if not isinstance(todos, list):
            return {"success": False, "error": "저장된 일정 데이터 형식이 올바르지 않습니다."}
        remaining_todos = [
            item for item in todos
            if not (isinstance(item, dict) and item.get("id") == todo_id and item.get("by_user") is True)
        ]
        if len(remaining_todos) == len(todos):
            return {"success": False, "error": "삭제할 개인 일정을 찾지 못했습니다."}
        user_data["todos"] = remaining_todos
        planit_functions.save_user_data(user_data)
    except (ValueError, exceptions.FirebaseError):
        return {"success": False, "error": "일정을 삭제하지 못했습니다."}
    return {"success": True}
