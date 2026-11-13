function currentTermCourses(courses) {
  return (Array.isArray(courses) ? courses : []).filter((course) =>
    termMatches(course, currentYear, currentTerm),
  );
}

function termName(term) {
  return ({ 1: "1학기", 2: "여름학기", 3: "2학기", 4: "겨울학기" })[term] || "학기";
}

function termMatches(course, year, term) {
  return Number(course.year || currentYear) === year && Number(course.term || currentTerm) === term;
}

function initializeTermControls() {
  const yearSelect = document.querySelector("#course-year");
  yearSelect.replaceChildren();
  for (let year = currentYear + 1; year >= currentYear - 10; year -= 1) {
    yearSelect.add(new Option(`${year}년`, String(year)));
  }
  const termSelect = document.querySelector("#course-term");
  termSelect.replaceChildren(
    ...[[1, "1학기"], [2, "여름학기"], [3, "2학기"], [4, "겨울학기"]]
      .map(([term, label]) => new Option(label, String(term))),
  );
  const gradeTermSelect = document.querySelector("#grade-term-select");
  gradeTermSelect.replaceChildren();
  for (let year = currentYear + 1; year >= currentYear - 10; year -= 1) {
    for (const [term, label] of [[1, "1학기"], [2, "여름학기"], [3, "2학기"], [4, "겨울학기"]]) {
      gradeTermSelect.add(new Option(`${year}년 ${label}`, `${year}:${term}`));
    }
  }
  syncTermControls();
}

function syncTermControls() {
  document.querySelector("#course-year").value = String(selectedCourseYear);
  document.querySelector("#course-term").value = String(selectedCourseTerm);
  document.querySelector("#grade-term-select").value = `${selectedCourseYear}:${selectedCourseTerm}`;
}

function renderCourseViews() {
  const rows = document.querySelector("#course-rows");
  const courses = (currentUser?.courses || []).filter((course) =>
    termMatches(course, selectedCourseYear, selectedCourseTerm),
  );
  rows.replaceChildren();
  let credits = 0;
  courses.forEach((course, index) => {
    credits += Number(course.unit) || 0;
    const row = document.createElement("tr");
    const title = document.createElement("td");
    const color = document.createElement("span");
    color.className = `course-color ${["purple", "mint", "orange", "pink"][index % 4]}`;
    color.setAttribute("aria-hidden", "true");
    title.append(color, document.createTextNode(course.title || "과목명 없음"));
    row.append(title);
    [
      course.code || "—",
      course.prof || "—",
      Array.isArray(course.times) && course.times.length ? course.times.join(", ") : "—",
      course.unit ?? "—",
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    });
    const actions = document.createElement("td");
    if (course.by_user === true) {
      const actionButtons = document.createElement("div");
      actionButtons.className = "course-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "course-edit-button";
      editButton.textContent = "수정";
      editButton.setAttribute("aria-label", `${course.title || "과목"} 수정`);
      editButton.addEventListener("click", () => openCourseDialog(course));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "course-delete-button";
      deleteButton.textContent = "삭제";
      deleteButton.setAttribute("aria-label", `${course.title || "과목"} 삭제`);
      deleteButton.addEventListener("click", () => deleteUserCourse(course, deleteButton));
      actionButtons.append(editButton, deleteButton);
      actions.append(actionButtons);
    } else {
      actions.textContent = "—";
    }
    row.append(actions);
    rows.append(row);
  });
  if (!courses.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "table-empty";
    cell.textContent = currentUser
      ? "이 학기에 등록된 과목이 없습니다. eClass에서 불러오거나 과목을 추가해 주세요."
      : "eClass에 로그인하면 선택한 학기의 과목을 불러올 수 있어요.";
    row.append(cell);
    rows.append(row);
  }
  document.querySelector("#course-count").textContent = `${courses.length}개 과목`;
  document.querySelector("#course-credit-total").innerHTML = `${credits}<span> 학점</span>`;
  renderCourseTimetable(courses);
  renderGradeView();
  refreshHomeTimetable();
}

function parseCourseTime(time) {
  if (typeof time !== "string") return null;
  const match = time.match(/^([월화수목금토일])\(([1-9]|1[0-6]) ~ ([1-9]|1[0-6])\)$/);
  if (!match) return null;
  const startPeriod = Number(match[2]);
  const endPeriod = Number(match[3]);
  if (startPeriod > endPeriod) return null;
  return { weekday: match[1], startPeriod, endPeriod };
}

function renderCourseTimetable(courses) {
  const timetable = document.querySelector("#course-timetable");
  const caption = document.querySelector("#course-timetable-caption");
  timetable.replaceChildren();

  const meetings = courses.flatMap((course, courseIndex) =>
    (Array.isArray(course.times) ? course.times : []).flatMap((time) => {
      const parsed = parseCourseTime(time);
      return parsed ? [{ ...parsed, course, courseIndex }] : [];
    }),
  );
  if (!meetings.length) {
    caption.textContent = "선택한 학기의 등록된 수업 시간이 없습니다.";
    const empty = document.createElement("p");
    empty.className = "course-timetable-empty";
    empty.textContent = currentUser
      ? "시간표에 표시할 수업이 없습니다."
      : "로그인하면 선택한 학기의 시간표를 확인할 수 있어요.";
    timetable.append(empty);
    return;
  }

  const weekdayNames = ["월", "화", "수", "목", "금", "토", "일"];
  const minPeriod = Math.min(...meetings.map((meeting) => meeting.startPeriod));
  const maxPeriod = Math.max(...meetings.map((meeting) => meeting.endPeriod));
  const periodCount = maxPeriod - minPeriod + 1;
  caption.textContent = "";

  const grid = document.createElement("div");
  grid.className = "course-timetable-grid";
  grid.style.gridTemplateColumns = "54px repeat(7, minmax(90px, 1fr))";
  grid.style.gridTemplateRows = `42px repeat(${periodCount}, 56px)`;

  const corner = document.createElement("span");
  corner.className = "course-timetable-corner";
  grid.append(corner);
  weekdayNames.forEach((weekday, index) => {
    const heading = document.createElement("span");
    heading.className = "course-timetable-day-heading";
    heading.style.gridColumn = String(index + 2);
    heading.textContent = `${weekday}요일`;
    grid.append(heading);
  });

  for (let period = minPeriod; period <= maxPeriod; period += 1) {
    const row = period - minPeriod + 2;
    const label = document.createElement("span");
    label.className = "course-timetable-period-label";
    label.style.gridRow = String(row);
    label.textContent = `${period}교시`;
    grid.append(label);
    weekdayNames.forEach((weekday, index) => {
      const slot = document.createElement("span");
      slot.className = "course-timetable-slot";
      slot.style.gridColumn = String(index + 2);
      slot.style.gridRow = String(row);
      grid.append(slot);
    });
  }

  weekdayNames.forEach((weekday, dayIndex) => {
    const dayMeetings = meetings
      .filter((meeting) => meeting.weekday === weekday)
      .sort((left, right) =>
        left.startPeriod - right.startPeriod || left.endPeriod - right.endPeriod,
      );
    const laneEnds = [];
    dayMeetings.forEach((meeting) => {
      let lane = laneEnds.findIndex((endPeriod) => endPeriod < meeting.startPeriod);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = meeting.endPeriod;
      meeting.lane = lane;
    });

    dayMeetings.forEach((meeting) => {
      const block = document.createElement("article");
      const colors = ["purple", "mint", "orange", "pink"];
      block.className = `course-schedule-event ${colors[meeting.courseIndex % colors.length]}`;
      const rowStart = meeting.startPeriod - minPeriod + 2;
      const rowEnd = meeting.endPeriod - minPeriod + 3;
      block.style.gridColumn = String(dayIndex + 2);
      block.style.gridRow = `${rowStart} / ${rowEnd}`;
      block.style.width = `calc(${100 / laneEnds.length}% - 6px)`;
      block.style.marginLeft = `calc(${(100 * meeting.lane) / laneEnds.length}% + 3px)`;
      block.setAttribute(
        "aria-label",
        `${meeting.course.title || "과목명 없음"} · ${weekday}요일 ${meeting.startPeriod}교시부터 ${meeting.endPeriod}교시까지`,
      );

      const title = document.createElement("strong");
      title.textContent = meeting.course.title || "과목명 없음";
      title.title = title.textContent;
      block.append(title);
      if (meeting.course.prof) {
        const professor = document.createElement("small");
        professor.textContent = meeting.course.prof;
        block.append(professor);
      }
      grid.append(block);
    });
  });
  timetable.append(grid);
}

function renderGradeView() {
  const allCourses = currentUser?.courses || [];
  const semesterCourses = allCourses.filter((course) =>
    termMatches(course, selectedCourseYear, selectedCourseTerm),
  );
  const gradeRows = document.querySelector("#grade-rows");
  gradeRows.replaceChildren();
  const gradePoints = { "A+": 4.5, A0: 4.0, "B+": 3.5, B0: 3.0, "C+": 2.5, C0: 2.0, "D+": 1.5, D0: 1.0, F: 0 };
  const grades = allCourses.filter((course) => Object.hasOwn(gradePoints, course.grade));
  const semesterGrades = semesterCourses.filter((course) => Object.hasOwn(gradePoints, course.grade));
  const weightedGpa = (courses) => {
    const credits = courses.reduce((sum, course) => sum + (Number(course.unit) || 0), 0);
    return credits
      ? courses.reduce((sum, course) => sum + gradePoints[course.grade] * (Number(course.unit) || 0), 0) / credits
      : null;
  };
  const setGpa = (selector, value) => {
    document.querySelector(selector).innerHTML =
      `${value === null ? "—" : value.toFixed(2)}<small> / 4.5</small>`;
  };
  setGpa("#cumulative-gpa", weightedGpa(grades));
  setGpa("#semester-gpa", weightedGpa(semesterGrades));
  const earnedCredits = grades
    .filter((course) => course.grade !== "F")
    .reduce((sum, course) => sum + (Number(course.unit) || 0), 0);
  document.querySelector("#total-earned-credits").innerHTML =
    `${earnedCredits}<small> / 130학점</small>`;
  document.querySelector("#earned-credits-progress").style.width =
    `${Math.min(100, (earnedCredits / 130) * 100)}%`;
  document.querySelector("#grade-term-badge").textContent =
    `${selectedCourseYear}년 ${termName(selectedCourseTerm)}`;

  semesterCourses.forEach((course) => {
    const row = document.createElement("tr");
    const titleCell = document.createElement("td");
    titleCell.textContent = course.title || "과목명 없음";
    const creditCell = document.createElement("td");
    creditCell.textContent = String(course.unit ?? "—");
    const gradeCell = document.createElement("td");
    const gradeSelect = document.createElement("select");
    gradeSelect.className = "grade-select";
    gradeSelect.setAttribute("aria-label", `${course.title || "과목"} 성적`);
    gradeSelect.add(new Option("미입력", ""));
    Object.keys(gradePoints).forEach((grade) => gradeSelect.add(new Option(grade, grade)));
    gradeSelect.value = course.grade || "";
    gradeSelect.disabled = !currentUser;
    gradeSelect.addEventListener("change", () => saveCourseGrade(course, gradeSelect));
    gradeCell.append(gradeSelect);
    const pointCell = document.createElement("td");
    pointCell.textContent = Object.hasOwn(gradePoints, course.grade)
      ? gradePoints[course.grade].toFixed(1)
      : "—";
    const studyCell = document.createElement("td");
    const seconds = (currentUser?.studySessions || [])
      .filter((session) => session.course === course.title)
      .reduce((sum, session) => sum + (Number(session.duration_seconds) || 0), 0);
    studyCell.textContent = seconds ? formatStudyDuration(seconds) : "—";
    row.append(titleCell, creditCell, gradeCell, pointCell, studyCell);
    gradeRows.append(row);
  });
  if (!semesterCourses.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "table-empty";
    cell.textContent = currentUser
      ? "선택한 학기의 과목이 없습니다. 수강 과목 탭에서 과목을 불러오거나 추가해 주세요."
      : "로그인하면 수강 과목과 성적을 관리할 수 있어요.";
    row.append(cell);
    gradeRows.append(row);
  }
}

async function loadCoursesForSelectedTerm() {
  renderCourseViews();
  if (!currentUser) return;
  const requestVersion = ++courseFetchVersion;
  const year = selectedCourseYear;
  const term = selectedCourseTerm;
  document.querySelector("#course-timetable-caption").textContent =
    `${year}년 ${termName(term)} · eClass 과목을 불러오는 중...`;
  try {
    const result = await callBackend("get_courses_for_term", currentUser.id, year, term);
    if (!result.success) throw new Error(result.error || "과목을 불러오지 못했습니다.");
    if (requestVersion !== courseFetchVersion) return;
    currentUser.courses = (currentUser.courses || []).filter(
      (course) => !termMatches(course, year, term),
    );
    currentUser.courses.push(...result.courses);
    renderCourseViews();
  } catch (error) {
    if (requestVersion !== courseFetchVersion) return;
    document.querySelector("#course-timetable-caption").textContent =
      `${year}년 ${termName(term)} · 저장된 과목을 표시 중`;
    showToast(error instanceof Error ? error.message : "과목을 불러오지 못했습니다.");
  }
}

async function saveCourseGrade(course, select) {
  if (!currentUser) return;
  const previousGrade = course.grade || "";
  select.disabled = true;
  try {
    const result = await callBackend("set_course_grade", currentUser.id, course.course_id, select.value);
    if (!result.success) throw new Error(result.error || "성적을 저장하지 못했습니다.");
    if (select.value) course.grade = select.value;
    else delete course.grade;
    renderGradeView();
    showToast("성적을 저장했습니다.");
  } catch (error) {
    select.value = previousGrade;
    select.disabled = false;
    showToast(error instanceof Error ? error.message : "성적을 저장하지 못했습니다.");
  }
}

const weekdays = ["월", "화", "수", "목", "금", "토", "일"];

function addCourseTimeRow(time = null) {
  const row = document.createElement("div");
  row.className = "course-time-row";
  const day = document.createElement("select");
  day.className = "course-time-day";
  day.setAttribute("aria-label", "수업 요일");
  day.add(new Option("요일 선택", ""));
  weekdays.forEach((weekday) => day.add(new Option(`${weekday}요일`, weekday)));
  const start = document.createElement("select");
  start.className = "course-time-start";
  start.setAttribute("aria-label", "시작 교시");
  start.add(new Option("시작", ""));
  const end = document.createElement("select");
  end.className = "course-time-end";
  end.setAttribute("aria-label", "끝 교시");
  end.add(new Option("끝", ""));
  for (let period = 1; period <= 16; period += 1) {
    start.add(new Option(`${period}교시`, String(period)));
    end.add(new Option(`${period}교시`, String(period)));
  }
  const separator = document.createElement("span");
  separator.className = "course-time-separator";
  separator.textContent = "~";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "course-time-remove";
  remove.textContent = "삭제";
  remove.setAttribute("aria-label", "수업 시간 삭제");
  remove.addEventListener("click", () => {
    if (document.querySelectorAll(".course-time-row").length === 1) {
      day.value = "";
      start.value = "";
      end.value = "";
      return;
    }
    row.remove();
  });
  row.append(day, start, separator, end, remove);
  document.querySelector("#course-time-list").append(row);
  if (time) {
    const parsed = parseCourseTime(time);
    if (parsed) {
      day.value = parsed.weekday;
      start.value = String(parsed.startPeriod);
      end.value = String(parsed.endPeriod);
    }
  }
}

function openCourseDialog(course = null) {
  if (!currentUser) {
    showToast("과목을 추가하려면 eClass에 먼저 로그인해 주세요.");
    return;
  }
  editingCourseId = course?.course_id || null;
  document.querySelector("#course-dialog-title").textContent = course ? "과목 수정" : "과목 추가";
  document.querySelector('#course-form button[type="submit"]').textContent = course ? "저장" : "추가";
  document.querySelector("#course-form").reset();
  document.querySelector("#course-title").value = course?.title || "";
  document.querySelector("#course-code").value = course?.code || "";
  document.querySelector("#course-professor").value = course?.prof || "";
  document.querySelector("#course-credits").value = String(course?.unit || 3);
  document.querySelector("#course-form-error").textContent = "";
  const timeList = document.querySelector("#course-time-list");
  timeList.replaceChildren();
  const times = Array.isArray(course?.times) ? course.times : [];
  const parseableTimes = times.filter((time) => parseCourseTime(time));
  if (parseableTimes.length) parseableTimes.forEach((time) => addCourseTimeRow(time));
  else addCourseTimeRow();
  document.querySelector("#course-dialog").showModal();
  document.querySelector("#course-title").focus();
}

function refreshTimerCourseOptions() {
  renderTimerCourseList();
}

async function deleteUserCourse(course, deleteButton) {
  if (!currentUser || course.by_user !== true || deleteButton.disabled) return;
  const requestingUser = currentUser;
  deleteButton.disabled = true;
  deleteButton.textContent = "삭제 중...";
  try {
    const result = await callBackend("delete_user_course", requestingUser.id, course.course_id);
    if (!result.success) throw new Error(result.error || "과목을 삭제하지 못했습니다.");
    if (currentUser !== requestingUser) return;
    currentUser.courses = currentUser.courses.filter(
      (item) => item.course_id !== course.course_id,
    );
    if (Array.isArray(currentUser.hiddenTimerCourseIds)) {
      currentUser.hiddenTimerCourseIds = currentUser.hiddenTimerCourseIds.filter(
        (courseId) => courseId !== course.course_id,
      );
    }
    refreshTimerCourseOptions();
    renderCourseViews();
    showToast("직접 추가한 과목을 삭제했습니다.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "과목을 삭제하지 못했습니다.");
  } finally {
    if (deleteButton.isConnected) {
      deleteButton.disabled = false;
      deleteButton.textContent = "삭제";
    }
  }
}

async function submitCourse(event) {
  event.preventDefault();
  const form = document.querySelector("#course-form");
  const submitButton = form.querySelector('button[type="submit"]');
  const errorMessage = document.querySelector("#course-form-error");
  errorMessage.textContent = "";
  if (!currentUser) {
    errorMessage.textContent = "과목을 추가하려면 eClass에 먼저 로그인해 주세요.";
    return;
  }
  if (!document.querySelector("#course-title").value.trim()) {
    errorMessage.textContent = "과목명을 입력해 주세요.";
    document.querySelector("#course-title").focus();
    return;
  }

  const courseTimes = [...document.querySelectorAll(".course-time-row")].map((row) => {
    const day = row.querySelector(".course-time-day").value;
    const start = Number(row.querySelector(".course-time-start").value);
    const end = Number(row.querySelector(".course-time-end").value);
    return day && start && end && start <= end ? `${day}(${start} ~ ${end})` : null;
  });
  if (!courseTimes.length || courseTimes.some((time) => time === null)) {
    errorMessage.textContent =
      "수업 요일과 시작·끝 교시를 모두 선택해 주세요. 끝 교시는 시작 교시보다 빠를 수 없습니다.";
    return;
  }
  const credits = Number(document.querySelector("#course-credits").value);
  if (!Number.isInteger(credits) || credits < 1 || credits > 30) {
    errorMessage.textContent = "학점은 1~30 사이의 정수로 입력해 주세요.";
    document.querySelector("#course-credits").focus();
    return;
  }

  const courseData = {
    title: document.querySelector("#course-title").value.trim(),
    code: document.querySelector("#course-code").value.trim(),
    prof: document.querySelector("#course-professor").value.trim(),
    times: courseTimes,
    unit: credits,
  };
  if (submitButton.disabled) return;
  const originalButtonText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = editingCourseId ? "저장 중..." : "추가 중...";
  errorMessage.textContent = "과목 정보를 저장하고 있습니다.";
  try {
    const result = editingCourseId
      ? await callBackend("update_user_course", currentUser.id, editingCourseId, courseData)
      : await callBackend(
          "add_user_course", currentUser.id, courseData, selectedCourseYear, selectedCourseTerm,
        );
    if (!result.success) throw new Error(result.error || "과목을 추가하지 못했습니다.");
    const index = currentUser.courses.findIndex((course) => course.course_id === result.course.course_id);
    if (index >= 0) currentUser.courses[index] = result.course;
    else currentUser.courses.push(result.course);
    document.querySelector("#course-dialog").close();
    form.reset();
    document.querySelector("#course-credits").value = "3";
    editingCourseId = null;
    refreshTimerCourseOptions();
    renderCourseViews();
    showToast(index >= 0 ? "과목 정보를 수정했습니다." : "과목을 추가했습니다.");
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : "과목을 추가하지 못했습니다.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalButtonText;
  }
}
