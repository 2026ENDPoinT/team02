function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function currentTimerElapsedSeconds() {
  return timerState.elapsedSeconds + (
    timerState.running ? (performance.now() - timerState.syncedAt) / 1000 : 0
  );
}

let timerCoursePreferencesSaving = false;

function timerCoursePreferenceId(course) {
  return course.course_id || course.id || "";
}

function editableTimerCourses() {
  if (!currentUser) return [];
  return [
    ...currentTermCourses(currentUser.courses),
    ...(currentUser.customTimerCourses || []),
  ];
}

function timerCourses() {
  const courses = currentUser
    ? editableTimerCourses()
    : ["데이터베이스", "사용자 경험 디자인", "컴퓨터 네트워크", "기술과 사회"]
      .map((title) => ({ title }));
  const hiddenCourseIds = new Set(currentUser?.hiddenTimerCourseIds || []);
  const visibleCourses = courses.filter((course) => {
    const courseId = timerCoursePreferenceId(course);
    return !courseId
      || !hiddenCourseIds.has(courseId)
      || timerState.course === course.title;
  });
  if (timerState.course && !visibleCourses.some((course) => course.title === timerState.course)) {
    return [...visibleCourses, { title: timerState.course }];
  }
  return visibleCourses;
}

function renderTimerCourseEditorList(list, courses, hidden) {
  list.replaceChildren();
  if (!courses.length) {
    const empty = document.createElement("p");
    empty.className = "timer-course-editor-empty";
    empty.textContent = hidden ? "숨김 과목이 없습니다." : "표시할 과목이 없습니다.";
    list.append(empty);
    return;
  }

  courses.forEach((course) => {
    const title = course.title || "과목명 없음";
    const courseId = timerCoursePreferenceId(course);
    const row = document.createElement("div");
    row.className = "timer-course-editor-row";
    row.setAttribute("role", "listitem");

    const name = document.createElement("span");
    name.textContent = title;

    const action = document.createElement("button");
    action.type = "button";
    action.className = "secondary-button timer-course-visibility-button";
    action.textContent = hidden ? "보이기" : "숨기기";
    action.setAttribute("aria-label", `${title} ${hidden ? "보이기" : "숨기기"}`);
    const isActive = !hidden && timerState.course === title;
    action.disabled = timerCoursePreferencesSaving || !courseId || isActive;
    if (isActive) action.title = "학습 중인 과목은 타이머를 종료한 뒤 숨길 수 있어요.";
    action.addEventListener("click", () => updateTimerCourseVisibility(course, !hidden));

    row.append(name, action);
    list.append(row);
  });
}

function renderTimerCourseEditor() {
  const visibleList = document.querySelector("#visible-timer-courses");
  const hiddenList = document.querySelector("#hidden-timer-courses");
  if (!visibleList || !hiddenList) return;

  const hiddenIds = new Set(currentUser?.hiddenTimerCourseIds || []);
  const courses = editableTimerCourses();
  const visibleCourses = courses.filter((course) => !hiddenIds.has(timerCoursePreferenceId(course)));
  const hiddenCourses = courses.filter((course) => hiddenIds.has(timerCoursePreferenceId(course)));
  document.querySelector("#visible-timer-course-count").textContent = `${visibleCourses.length}개`;
  document.querySelector("#hidden-timer-course-count").textContent = `${hiddenCourses.length}개`;
  renderTimerCourseEditorList(visibleList, visibleCourses, false);
  renderTimerCourseEditorList(hiddenList, hiddenCourses, true);

  document.querySelectorAll("#timer-course-add-form input, #timer-course-add-form button")
    .forEach((control) => {
      control.disabled = timerCoursePreferencesSaving;
    });
}

function openTimerCourseEditor() {
  if (!currentUser) {
    showToast("과목을 수정하려면 eClass에 먼저 로그인해 주세요.");
    return;
  }
  renderTimerCourseEditor();
  document.querySelector("#timer-course-editor-error").textContent = "";
  document.querySelector("#timer-course-dialog").showModal();
  document.querySelector("#timer-course-new-title").focus();
}

async function saveTimerCoursePreferences(hiddenCourseIds, customCourses, successMessage) {
  if (!currentUser || timerCoursePreferencesSaving) return false;
  const previousHiddenCourseIds = currentUser.hiddenTimerCourseIds;
  const previousCustomCourses = currentUser.customTimerCourses;
  timerCoursePreferencesSaving = true;
  currentUser.hiddenTimerCourseIds = hiddenCourseIds;
  currentUser.customTimerCourses = customCourses;
  renderTimerCourseEditor();
  renderTimerCourseList();

  try {
    const result = await callBackend(
      "save_timer_course_preferences",
      currentUser.id,
      hiddenCourseIds,
      customCourses,
    );
    if (!result.success) {
      throw new Error(result.error || "학습 과목 설정을 저장하지 못했습니다.");
    }
    currentUser.hiddenTimerCourseIds = result.hiddenCourseIds;
    currentUser.customTimerCourses = result.customCourses;
    showToast(successMessage);
    return true;
  } catch (error) {
    currentUser.hiddenTimerCourseIds = previousHiddenCourseIds;
    currentUser.customTimerCourses = previousCustomCourses;
    showToast(error instanceof Error ? error.message : "학습 과목 설정을 저장하지 못했습니다.");
    return false;
  } finally {
    timerCoursePreferencesSaving = false;
    renderTimerCourseEditor();
    renderTimerCourseList();
  }
}

async function updateTimerCourseVisibility(course, hidden) {
  if (!currentUser || timerCoursePreferencesSaving) return;
  if (hidden && timerState.course === course.title) {
    showToast("학습 중인 과목은 타이머를 종료한 뒤 숨길 수 있어요.");
    return;
  }

  const courseId = timerCoursePreferenceId(course);
  if (!courseId) {
    showToast("과목을 식별할 수 없어 표시 설정을 변경하지 못했습니다.");
    return;
  }
  const hiddenIds = new Set(currentUser.hiddenTimerCourseIds || []);
  if (hidden) hiddenIds.add(courseId);
  else hiddenIds.delete(courseId);
  await saveTimerCoursePreferences(
    [...hiddenIds],
    currentUser.customTimerCourses || [],
    hidden ? "과목을 숨겼습니다." : "과목을 표시했습니다.",
  );
}

function createTimerCourseId() {
  return globalThis.crypto?.randomUUID?.()
    || `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function addTimerCourse(event) {
  event.preventDefault();
  if (!currentUser || timerCoursePreferencesSaving) return;

  const input = document.querySelector("#timer-course-new-title");
  const error = document.querySelector("#timer-course-editor-error");
  const title = input.value.trim();
  error.textContent = "";
  if (!title) {
    error.textContent = "과목명을 입력해 주세요.";
    input.focus();
    return;
  }
  const normalizedTitle = title.toLocaleLowerCase();
  if (editableTimerCourses().some((course) =>
    (course.title || "").trim().toLocaleLowerCase() === normalizedTitle,
  )) {
    error.textContent = "이미 등록된 과목입니다.";
    input.focus();
    return;
  }

  const customCourses = [
    ...(currentUser.customTimerCourses || []),
    { id: createTimerCourseId(), title },
  ];
  const previousTitle = input.value;
  input.value = "";
  const saved = await saveTimerCoursePreferences(
    currentUser.hiddenTimerCourseIds || [],
    customCourses,
    "학습 과목에 추가했습니다.",
  );
  if (!saved) input.value = previousTitle;
  input.focus();
}

function todayCourseStudySeconds() {
  const todayKey = seoulDateKey(new Date());
  const secondsByCourse = new Map();
  (currentUser?.studySessions || []).forEach((session) => {
    if (seoulDateKey(session.started_at) !== todayKey) return;
    const course = session.course || "과목 없음";
    secondsByCourse.set(course, (secondsByCourse.get(course) || 0) + (Number(session.duration_seconds) || 0));
  });
  if (timerState.course && seoulDateKey(timerState.startedAt) === todayKey) {
    secondsByCourse.set(
      timerState.course,
      (secondsByCourse.get(timerState.course) || 0) + currentTimerElapsedSeconds(),
    );
  }
  return secondsByCourse;
}

function renderTimerCourseList() {
  const list = document.querySelector("#timer-course-list");
  if (!list) return;
  const courses = timerCourses();
  const secondsByCourse = todayCourseStudySeconds();
  const todayKey = seoulDateKey(new Date());
  if (timerState.course && seoulDateKey(timerState.startedAt) !== todayKey) {
    secondsByCourse.set(timerState.course, (secondsByCourse.get(timerState.course) || 0) + currentTimerElapsedSeconds());
  }
  const totalSeconds = [...secondsByCourse.values()].reduce((total, seconds) => total + seconds, 0);
  document.querySelector("#timer-display").textContent = formatDuration(totalSeconds);
  document.querySelector("#timer-active-course").textContent =
    timerState.course || "과목을 선택해 공부를 시작하세요";
  list.replaceChildren();
  if (!courses.length) {
    const empty = document.createElement("p");
    empty.className = "timer-course-empty";
    empty.textContent = currentUser
      ? "표시할 과목이 없습니다. 과목 수정에서 숨김 과목을 표시하거나 새 과목을 추가해 주세요."
      : "로그인하면 이번 학기 과목을 확인할 수 있어요.";
    list.append(empty);
    return;
  }
  const longestStudySeconds = Math.max(...secondsByCourse.values(), 1);
  courses.forEach((course) => {
    const title = course.title || "과목명 없음";
    const isActive = timerState.course === title;
    const row = document.createElement("div");
    row.className = "timer-course-row";
    if (isActive) row.classList.add("is-active");

    const details = document.createElement("div");
    details.className = "timer-course-details";
    const name = document.createElement("strong");
    name.textContent = title;
    details.append(name);

    const progressTrack = document.createElement("span");
    progressTrack.className = "timer-course-progress";
    progressTrack.setAttribute("aria-hidden", "true");
    const progressBar = document.createElement("span");
    progressBar.className = "timer-course-progress-bar";
    const courseSeconds = secondsByCourse.get(title) || 0;
    progressBar.style.width = `${courseSeconds > 0 ? Math.max(2, (courseSeconds / longestStudySeconds) * 100) : 0}%`;
    progressTrack.append(progressBar);

    const duration = document.createElement("time");
    duration.className = "timer-course-duration";
    const elapsedSeconds = Math.floor(courseSeconds);
    const formattedDuration = formatDuration(elapsedSeconds);
    duration.textContent = elapsedSeconds < 3600 ? formattedDuration.slice(3) : formattedDuration;
    duration.setAttribute("aria-label", formatStudyDuration(elapsedSeconds));

    const actions = document.createElement("div");
    actions.className = "timer-course-actions";
    if (!isActive) {
      const startButton = document.createElement("button");
      startButton.type = "button";
      startButton.className = "primary-button";
      startButton.disabled = timerActionInFlight;
      startButton.textContent = "시작";
      startButton.addEventListener("click", () => startStudyTimer(title));
      actions.append(startButton);
    } else if (timerState.savePending) {
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.className = "timer-finish-button timer-save-button";
      retryButton.disabled = timerActionInFlight;
      retryButton.textContent = "저장 재시도";
      retryButton.addEventListener("click", stopStudyTimer);
      actions.append(retryButton);
    } else if (timerState.autoPaused) {
      const resumeButton = document.createElement("button");
      resumeButton.type = "button";
      resumeButton.className = "primary-button";
      resumeButton.disabled = timerActionInFlight;
      resumeButton.textContent = "다시 시작";
      resumeButton.addEventListener("click", resumeStudyTimer);
      actions.append(resumeButton);
    }

    if (isActive && !timerState.savePending) {
      const finishButton = document.createElement("button");
      finishButton.type = "button";
      finishButton.className = "timer-finish-button timer-stop-button";
      finishButton.disabled = timerActionInFlight;
      finishButton.textContent = "중단";
      finishButton.addEventListener("click", stopStudyTimer);
      actions.append(finishButton);
    }

    row.append(details, progressTrack, duration, actions);
    list.append(row);
  });
}

function renderTimerState() {
  const display = document.querySelector("#timer-display");
  const status = document.querySelector("#timer-status");
  const timerHero = document.querySelector(".timer-hero");
  const disclaimer = document.querySelector("#timer-disclaimer");
  const mascotImage = document.querySelector("#timer-mascot-image");
  const mascotMessage = document.querySelector("#timer-mascot-message");
  const mascotBanner = document.querySelector(".timer-star-banner");
  renderTimerCourseList();
  display.setAttribute("aria-label", `오늘의 총 공부 시간 ${display.textContent}`);
  timerHero.classList.toggle("is-running", timerState.running);
  timerHero.classList.toggle("is-auto-paused", timerState.autoPaused);
  if (mascotBanner) {
    mascotBanner.classList.toggle("is-running", timerState.running);
    mascotBanner.setAttribute(
      "aria-label",
      timerState.running
        ? "공부 중인 별이. 별이도 열심히 집중할게."
        : "공부 시작하면 깨워줘... 조금만 잘게. 잠자는 별이."
    );
  }
  if (mascotImage && mascotMessage) {
    const source = timerState.running
      ? mascotImage.dataset.studyingSrc
      : mascotImage.dataset.sleepingSrc;
    if (source && mascotImage.getAttribute("src") !== source) mascotImage.setAttribute("src", source);
    mascotMessage.textContent = timerState.running
      ? "공부 시작했네! 별이도 열심히 집중할게."
      : "공부 시작하면 깨워줘... 조금만 잘게.";
  }
  status.classList.toggle("is-running", timerState.running);
  const statusText = timerState.running
    ? "학습 중"
    : timerState.course
      ? timerState.autoPaused
        ? "비허용 앱 감지 · 자동 일시정지"
        : "저장 대기"
      : "준비 중";
  status.querySelector("span:last-child").textContent = statusText;
  disclaimer.textContent =
    timerState.reason ||
    "허용 목록에 없는 집중 앱을 감지하면 타이머를 일시정지합니다.";
  renderStudyStats();
}

function updateTimerFromResponse(result) {
  if (!result.success) throw new Error(result.error || "타이머 상태를 불러오지 못했습니다.");
  timerState.running = result.running;
  timerState.course = result.course;
  timerState.elapsedSeconds = result.elapsed_seconds;
  timerState.syncedAt = performance.now();
  timerState.startedAt = result.started_at || timerState.startedAt;
  timerState.reason = result.reason;
  timerState.autoPaused = Boolean(result.auto_paused);
  timerState.savePending = false;
  renderTimerState();
  if (timerState.running) startTimerDisplay();
  else stopTimerDisplay();

  if (result.reason && result.reason !== lastTimerReason) showToast(result.reason);
  lastTimerReason = result.reason;
}

async function pollTimerStatus() {
  if (timerPollInFlight || timerActionInFlight || !timerState.running) return;
  timerPollInFlight = true;
  const requestVersion = timerStateVersion;
  try {
    const result = await callBackend("get_study_timer_status", getAllowedApps());
    if (requestVersion === timerStateVersion && !timerActionInFlight) {
      updateTimerFromResponse(result);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "집중 상태를 확인하지 못했습니다.");
  } finally {
    timerPollInFlight = false;
  }
}

function startTimerPolling() {
  if (timerPollHandle !== null) return;
  timerPollHandle = window.setInterval(pollTimerStatus, 1000);
}

function startTimerDisplay() {
  if (timerDisplayHandle !== null) return;
  timerDisplayHandle = window.setInterval(() => {
    if (timerState.running) renderTimerState();
  }, 1000);
}

function stopTimerDisplay() {
  if (timerDisplayHandle !== null) {
    window.clearInterval(timerDisplayHandle);
    timerDisplayHandle = null;
  }
}

async function startStudyTimer(course) {
  if (timerActionInFlight) return;
  timerActionInFlight = true;
  timerStateVersion += 1;
  try {
    if (timerState.course && !(await finishCurrentTimer())) return;
    const result = await callBackend(
      "start_study_timer",
      course,
      getAllowedApps(),
      currentUser?.id || "",
    );
    updateTimerFromResponse(result);
    if (timerState.running) startTimerPolling();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "타이머를 시작하지 못했습니다.");
  } finally {
    timerActionInFlight = false;
    renderTimerCourseList();
  }
}

async function resumeStudyTimer() {
  if (timerActionInFlight || !timerState.autoPaused) return;
  timerActionInFlight = true;
  timerStateVersion += 1;
  try {
    const result = await callBackend("resume_study_timer", getAllowedApps());
    updateTimerFromResponse(result);
    if (timerState.running) startTimerPolling();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "타이머를 다시 시작하지 못했습니다.");
  } finally {
    timerActionInFlight = false;
    renderTimerCourseList();
  }
}

async function stopStudyTimer() {
  if (timerActionInFlight) return;
  timerActionInFlight = true;
  timerStateVersion += 1;
  try {
    await finishCurrentTimer();
  } finally {
    timerActionInFlight = false;
    renderTimerCourseList();
  }
}

async function finishCurrentTimer() {
  const elapsedBeforeStop = currentTimerElapsedSeconds();
  renderTimerCourseList();
  try {
    const result = await callBackend("stop_study_timer");
    if (!result.success) throw new Error(result.error || "학습 기록을 저장하지 못했습니다.");
    timerState.running = false;
    stopTimerDisplay();
    timerState.course = null;
    timerState.elapsedSeconds = result.elapsed_seconds;
    timerState.startedAt = null;
    timerState.reason = null;
    timerState.autoPaused = false;
    timerState.savePending = false;
    if (result.record && currentUser) {
      currentUser.studySessions = [...(currentUser.studySessions || []), result.record];
    }
    renderTimerState();
    showToast(result.message);
    return true;
  } catch (error) {
    timerState.running = false;
    timerState.elapsedSeconds = elapsedBeforeStop;
    timerState.autoPaused = false;
    stopTimerDisplay();
    timerState.savePending = true;
    timerState.reason =
      error instanceof Error ? error.message : "학습 기록을 저장하지 못했습니다.";
    renderTimerState();
    showToast(timerState.reason);
    return false;
  }
}
