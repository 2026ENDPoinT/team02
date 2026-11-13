import os
from datetime import datetime
from zoneinfo import ZoneInfo
import re

import requests
from bs4 import BeautifulSoup
import firebase_admin
from firebase_admin import credentials
from firebase_admin import db


def save_user_data(user_data: dict) -> None:
    """Firebase Realtime Database의 users/{학번} 경로에 사용자 딕셔너리를 저장합니다."""
    user_id = user_data.get("id")
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("사용자 정보에 올바른 학번이 없습니다.")

    for collection_name in ("courses", "todos"):
        collection = user_data.get(collection_name)
        if not isinstance(collection, list) or any(not isinstance(item, dict) for item in collection):
            raise ValueError(f"{collection_name} 정보는 딕셔너리 목록이어야 합니다.")

    db.reference(f"users/{user_id}").set(user_data)


def load_user_data(user_id: str) -> dict | None:
    """users/{학번}의 사용자 정보를 딕셔너리로 반환합니다."""
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("불러올 사용자 학번을 입력해 주세요.")

    user_data = db.reference(f"users/{user_id}").get()
    if user_data is None:
        return None
    if not isinstance(user_data, dict):
        raise ValueError("Firebase에 저장된 사용자 데이터 형식이 올바르지 않습니다.")
    return user_data


class LoginError(Exception):
    pass




def remove_hyphen_parentheses(text: str) -> str:
    """
    문자열 내에 '-'를 포함하는 소괄호를 모두 지우는 함수

    Args:
        text (str): 원본 문자열
        
    Returns:
        str: 가공된 문자열
    """
    pattern = r'\([^)]*-[^)]*\)'
    return re.sub(pattern, '', text)


def get_now_year() -> int:
    """
    현재 연도를 반환하는 함수
    
    Returns:
        int: 현재 연도 (예: 2026)
    """
    kst_now = datetime.now(ZoneInfo("Asia/Seoul"))
    return kst_now.year


def get_now_term() -> int:
    """
    현재 학기를 반환하는 함수
    
    Returns:
        int: 현재 학기 (1: 1학기, 2: 여름학기, 3: 2학기, 4: 겨울학기)
    """
    kst_now = datetime.now(ZoneInfo("Asia/Seoul"))
    month = kst_now.month
    if 3 <= month <= 6:
        return 1
    elif 7 <= month <= 8:
        return 2
    elif 9 <= month <= 12:
        return 3
    else:
        return 4
    

def get_now_weekday() -> str:
    """
    현재 요일을 반환하는 함수
    
    Returns:
        str: 현재 요일 (예: 금)
    """
    kst_now = datetime.now(ZoneInfo("Asia/Seoul"))
    weekdays = ['월', '화', '수', '목', '금', '토', '일']
    return weekdays[kst_now.weekday()]



def login_eclass(session: requests.Session, headers: dict, id: str, pw: str) -> None:
    """
    eclass에 로그인하는 함수

    Args:
        session (requests.Session): 로그인 세션 객체
        headers (dict): 요청 헤더 정보
        id (str): 사용자의 학번
        pw (str): 사용자의 eclass 비밀번호
    """
    try:
        login_url = "https://eclass.seoultech.ac.kr/ilos/lo/login.acl"
            
        login_payload = {
            "usr_id": id,
            "usr_pwd": pw
        }

        login_response = session.post(login_url, data=login_payload, headers=headers, timeout=10)
        login_response.raise_for_status()

    except requests.exceptions.RequestException as e:
        raise LoginError(f"네트워크 요청 중 오류 발생: {e}") from e

    if "로그인 정보가 일치하지 않습니다." in login_response.text:
        raise LoginError("로그인 실패: 학번과 비밀번호를 확인하세요.")



def get_user_eclass_data(session: requests.Session, headers: dict) -> dict:
    """
    사용자의 eclass 정보를 불러오는 함수

    Args:
        session (requests.Session): 로그인 세션 객체
        headers (dict): 요청 헤더 정보
        
    Returns:
        사용자 프로필 정보 딕셔너리
    """

    url = "https://eclass.seoultech.ac.kr/ilos/mp/myinfo_pop_form.acl"
    payload = { "encoding": "utf-8" }

    response = session.get(url, data=payload, headers=headers, timeout=10)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, 'html.parser')
    name_tag = soup.select_one('.user_name')
    grade_tag = soup.select_one('.dept_grade')

    contact_tag = soup.select('.contact')

    name = name_tag.text.strip()
    major = grade_tag.text.strip().split()[0]
    grade = int(grade_tag.text.strip().split()[1][0])
    phone = contact_tag[0].text.strip()[4:]
    email = contact_tag[1].text.strip()[3:]

    return {
        "name": name,
        "major": major,
        "grade": grade,
        "phone": phone,
        "email": email,
    }



def get_user_courses(
    session: requests.Session,
    headers: dict,
    year: int | str | None = None,
    term: int | str | None = None,
) -> list[dict]:
    """
    사용자의 수강 과목 목록을 eclass에서 불러오는 함수

    Args:
        session (requests.Session): 로그인 세션 객체
        headers (dict): 요청 헤더 정보
        
    Returns:
        list[dict]: 사용자의 수강 과목 딕셔너리 목록
    """

    courses_url = "https://eclass.seoultech.ac.kr/ilos/main/rg/regular_register_list.acl"

    selected_year = str(year if year is not None else get_now_year())
    selected_term = str(term if term is not None else get_now_term())
    
    courses_payload = {
        "YEAR": selected_year,
        "TERM": selected_term,
        "SCH_VALUE": "",
        "encoding": "utf-8"
    }

    courses_response = session.post(courses_url, data=courses_payload, headers=headers, timeout=10)
    courses_response.raise_for_status()

    soup_courses = BeautifulSoup(courses_response.text, 'html.parser')
    course_list = []

    cards = soup_courses.select('ul.main_card_list > li')
    
    for card in cards:
        title_tag = card.select_one('.card_title')
        prof_tag = card.select_one('.card_text')
        code_tag = card.select_one('.card_info')
        info_spans = card.select('.info_txt span')

        title = title_tag.text.strip()
        prof = prof_tag.text.strip()
        code = code_tag.text.strip()
        times = info_spans[0].text.strip().split(", ")
        unit = int(info_spans[1].text.strip()[0])

        course_list.append({
            "title": title,
            "prof": prof,
            "times": times,
            "code": code,
            "unit": unit,
            "year": int(selected_year),
            "term": int(selected_term),
            "by_user": False,
        })

    return course_list



def get_today_courses(user_courses: list[dict]) -> list[dict]:
    """
    사용자의 금일 수강 과목 목록을 불러오는 함수

    Args:
        user_courses (list[dict]): 전체 수강 과목 딕셔너리 목록
        
    Returns:
        list[dict]: 금일 수강 과목 딕셔너리 목록
    """
    today_courses = []

    for course in user_courses:
        if any(time.startswith(get_now_weekday()) for time in course["times"]):
            today_courses.append(course)
    
    return today_courses



def get_user_eclass_todos(session: requests.Session, headers: dict) -> list[dict]:
    """
    e-Class에서 사용자의 할일 목록을 가져오는 함수
    
    Args:
        session (requests.Session): 로그인 세션 객체
        headers (dict): 요청 헤더 정보
        
    Returns:
        list[dict]: 할일 정보가 담긴 딕셔너리 리스트
    """
    todo_url = "https://eclass.seoultech.ac.kr/ilos/mp/todo_list.acl"
    
    todo_payload = {
        "TODO_CNT": "",
        "is_todo": "Y",
        "encoding": "utf-8"
    }

    response = session.post(todo_url, data=todo_payload, headers=headers, timeout=10)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, 'html.parser')
    
    items = soup.select('.todo_wrap')
    todo_list = []
    
    for item in items:
        title_tag = item.select_one('.todo_title')
        course_tag = item.select_one('.todo_subjt')
        date_tag = item.select_one('.todo_date')

        title_raw = title_tag.text.strip()
        course_raw = course_tag.text.strip()
        deadline_raw = date_tag.text.strip()

        type = title_raw.split('\r\n         ')[0][1:-1]
        title = title_raw.split('\r\n         ')[1]
        course = remove_hyphen_parentheses(course_raw)
        deadline = deadline_raw[deadline_raw.index('월 ') - 2:].strip()

        todo_list.append({
            "type": type,
            "title": title,
            "course": course,
            "deadline": deadline,
            "by_user": False,
        })

    return todo_list



def login_system(id, pw):
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://eclass.seoultech.ac.kr/ilos/main/member/login_form.acl",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    }

    try:
        login_eclass(session, headers, id, pw)
    except (LoginError, requests.exceptions.RequestException, ValueError) as error:
        session.close()
        return str(error)

    ref = db.reference(f'users/{id}')
    saved_data = ref.get()
    if saved_data is not None:
        session.close()
        print("Firebase에 저장된 사용자 정보를 확인했습니다. eClass 인증에 성공했습니다.")
        return "success"

    try:
        profile = get_user_eclass_data(session, headers)
        user_data = {
            "id": id,
            **profile,
            "courses": get_user_courses(session, headers),
            "todos": get_user_eclass_todos(session, headers),
        }
    except (LoginError, requests.exceptions.RequestException, ValueError) as error:
        session.close()
        return str(error)

    save_user_data(user_data)
    session.close()
    print(f"Firebase에 {len(user_data['courses'])}개 과목과 {len(user_data['todos'])}개 할 일을 저장했습니다.")
    return "success"