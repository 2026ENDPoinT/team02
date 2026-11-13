import truststore

truststore.inject_into_ssl()

import eel

from backend.shared import WEB_DIR
from backend.auth import login_eclass, logout_eclass
from backend.courses import (
    add_user_course,
    delete_user_course,
    get_courses_for_term,
    save_timer_course_preferences,
    set_course_grade,
    update_user_course,
)
from backend.timer import (
    get_study_timer_status,
    resume_study_timer,
    start_study_timer,
    stop_study_timer,
)
from backend.todos import delete_user_todo, save_user_todo, set_user_todo_done
from backend.assistant import ask_study_assistant, chat_with_star, generate_monthly_study_advice


def main() -> None:
    eel.init(str(WEB_DIR))
    eel.start(
        "index.html",
        size=(1440, 920),
        port=0
    )


if __name__ == "__main__":
    main()
