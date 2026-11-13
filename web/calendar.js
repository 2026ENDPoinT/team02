function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(date);
}

function formatSelectedDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function parseTodoDateKey(rawDate) {
  if (typeof rawDate !== "string") return null;
  const isoDate = rawDate.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const koreanDate = rawDate.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const dottedDate = rawDate.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  const slashDate = rawDate.match(/(\d{1,2})\/(\d{1,2})/);
  let year;
  let month;
  let day;
  if (isoDate || dottedDate) {
    [, year, month, day] = isoDate || dottedDate;
  } else if (koreanDate || slashDate) {
    [, month, day] = koreanDate || slashDate;
    year = String(today.getFullYear());
    const candidate = new Date(Number(year), Number(month) - 1, Number(day));
    if (candidate < today && today - candidate > 180 * 86400000) {
      year = String(Number(year) + 1);
    }
  } else {
    return null;
  }
  const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) || dateKey(parsed) !== normalized ? null : normalized;
}

function todoDateKeys(todo) {
  if (Array.isArray(todo.dates) && todo.dates.length > 0) {
    return [...new Set(todo.dates.map(parseTodoDateKey).filter(Boolean))].sort();
  }
  const parsedDate = parseTodoDateKey(todo.date || todo.deadline);
  return parsedDate ? [parsedDate] : [];
}

function todoDateKey(todo) {
  return todoDateKeys(todo)[0] || null;
}

function formatTodoDateRange(todo) {
  const dates = todoDateKeys(todo);
  if (!dates.length) return todo.deadline || "날짜 미정";
  return dates.length > 1 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : dates[0];
}

function eventsFor(date) {
  if (currentUser) {
    return (currentUser.todos || [])
      .filter((todo) => todoDateKeys(todo).includes(dateKey(date)))
      .map((todo) => ({
        ...todo,
        detail: [
          todo.course || (todo.by_user ? "개인 일정" : todo.type || "eClass 할 일"),
          todo.note,
          todoDateKeys(todo).length > 1 ? formatTodoDateRange(todo) : "",
        ].filter(Boolean).join(" · "),
      }));
  }
  const offset = Math.round((date - today) / 86400000);
  if (offset === 0) {
    return [
      { title: "데이터베이스 복습", detail: "개인 할 일 · 미완료", kind: "todo" },
      { title: "주간 계획 정리", detail: "개인 일정 · 오후 6:00", kind: "schedule" },
    ];
  }
  if (offset === 2) {
    return [{ title: "컴퓨터 네트워크 과제", detail: "과제 · 오후 11:59 마감", kind: "todo" }];
  }
  if (offset === 5) {
    return [{ title: "사용자 경험 디자인", detail: "수업 · 오후 1:00", kind: "schedule" }];
  }
  return [];
}

function renderRemainingTodos() {
  const rows = document.querySelector("#remaining-todo-rows");
  const count = document.querySelector("#remaining-todo-count");
  if (!rows || !count) return;
  const todos = (currentUser?.todos || [])
    .filter((todo) => !todo.done)
    .slice()
    .sort((left, right) => (todoDateKey(left) || "9999-12-31").localeCompare(todoDateKey(right) || "9999-12-31"));
  rows.replaceChildren();
  count.textContent = `${todos.length}개`;
  todos.forEach((todo) => {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    title.textContent = todo.title || "제목 없는 할 일";
    const type = document.createElement("td");
    type.textContent = todo.course || (todo.by_user ? "개인 일정" : todo.type || "eClass 할 일");
    const date = document.createElement("td");
    date.textContent = formatTodoDateRange(todo);
    const status = document.createElement("td");
    status.textContent = todo.by_user ? "미완료" : "진행 중";
    const actions = document.createElement("td");
    if (todo.by_user) {
      const doneButton = document.createElement("button");
      doneButton.type = "button";
      doneButton.className = "todo-complete-button";
      doneButton.textContent = "완료";
      doneButton.setAttribute("aria-label", `${todo.title || "할 일"} 완료`);
      doneButton.addEventListener("click", () => changeTodoDone(todo, true));
      actions.append(doneButton);
    } else {
      actions.textContent = "—";
    }
    row.append(title, type, date, status, actions);
    rows.append(row);
  });
  if (!todos.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "table-empty";
    cell.textContent = currentUser ? "남은 할 일이 없습니다." : "로그인하면 할 일을 확인할 수 있어요.";
    row.append(cell);
    rows.append(row);
  }
}

function renderTodayTodos() {
  const list = document.querySelector("#today-todo-list");
  if (!list) return;
  list.replaceChildren();
  const todos = currentUser ? eventsFor(today) : [];
  if (todos.length === 0) {
    const empty = document.createElement("p");
    empty.className = "home-todo-empty";
    empty.textContent = currentUser
      ? "오늘 등록된 할 일이 없어요."
      : "로그인하면 오늘의 할 일을 확인할 수 있어요.";
    list.append(empty);
    return;
  }

  todos.forEach((todo) => {
    const item = document.createElement("div");
    item.className = "home-todo-item";
    item.setAttribute("role", "listitem");
    if (todo.done) item.classList.add("is-done");

    const marker = document.createElement("span");
    marker.className = "home-todo-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = todo.done ? "✓" : "";

    const copy = document.createElement("span");
    copy.className = "home-todo-copy";
    const title = document.createElement("strong");
    title.textContent = todo.title || "제목 없는 할 일";
    copy.append(title);
    if (todo.detail) {
      const detail = document.createElement("small");
      detail.textContent = todo.detail;
      copy.append(detail);
    }

    item.append(marker, copy);
    list.append(item);
  });
}

function renderHomeWeeklyCalendar(container) {
  container.replaceChildren();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  });
  document.querySelector("#home-week-range").textContent =
    `${dateFormatter.format(start)} ~ ${dateFormatter.format(weekEnd)}`;

  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const isToday = offset === 0;
    const events = eventsFor(date);
    const day = document.createElement("section");
    day.className = "home-week-day";
    if (isToday) day.classList.add("is-today");
    if (dateKey(date) === dateKey(selectedDate)) day.classList.add("is-selected");
    day.setAttribute("aria-label", formatSelectedDate(date));

    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "home-week-day-heading";
    heading.setAttribute(
      "aria-label",
      events.length
        ? `${formatSelectedDate(date)}: ${events.map((event) => event.title || "제목 없는 일정").join(", ")}`
        : formatSelectedDate(date),
    );
    const weekday = document.createElement("span");
    weekday.textContent = isToday
      ? "오늘"
      : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
    const dayNumber = document.createElement("strong");
    dayNumber.textContent = String(date.getDate());
    heading.append(weekday, dayNumber);
    heading.addEventListener("click", () => {
      selectedDate = new Date(date);
      visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendars();
      navigateTo("calendar");
    });

    const eventList = document.createElement("div");
    eventList.className = "home-week-events";
    if (events.length === 0) {
      const empty = document.createElement("span");
      empty.className = "home-week-empty";
      empty.textContent = "일정 없음";
      eventList.append(empty);
    } else {
      events.forEach((event) => {
        const eventItem = document.createElement("article");
        eventItem.className = "home-week-event";
        if (event.done) eventItem.classList.add("is-done");
        const title = document.createElement("strong");
        title.textContent = event.title || "제목 없는 일정";
        title.title = title.textContent;
        eventItem.append(title);
        const detailText = event.detail || event.course || event.type;
        if (detailText) {
          const detail = document.createElement("small");
          detail.textContent = detailText;
          eventItem.append(detail);
        }
        eventList.append(eventItem);
      });
    }

    day.append(heading, eventList);
    container.append(day);
  }
}

function renderCalendar(container) {
  container.replaceChildren();
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const inVisibleMonth = date.getMonth() === visibleMonth.getMonth();
    const isToday = dateKey(date) === dateKey(today);
    const isSelected = dateKey(date) === dateKey(selectedDate);
    const events = eventsFor(date);
    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.className = "full-day";
    const eventTitles = events.map((event) => event.title || "제목 없는 할 일");
    dayButton.setAttribute(
      "aria-label",
      eventTitles.length
        ? `${formatSelectedDate(date)}: ${eventTitles.join(", ")}`
        : formatSelectedDate(date),
    );
    dayButton.setAttribute("aria-pressed", String(isSelected));
    if (!inVisibleMonth) dayButton.classList.add("outside-month");
    if (isToday) dayButton.classList.add("is-today");
    if (isSelected) dayButton.classList.add("is-selected");

    const dayNumber = document.createElement("span");
    dayNumber.className = "day-number";
    dayNumber.textContent = String(date.getDate());
    dayButton.append(dayNumber);

    const rangedEvents = events.filter((event) => todoDateKeys(event).length > 1);
    if (rangedEvents.length > 0) {
      const bars = document.createElement("span");
      bars.className = "event-range-track";
      bars.setAttribute("aria-hidden", "true");
      const previousDate = new Date(date);
      previousDate.setDate(previousDate.getDate() - 1);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      rangedEvents.slice(0, 3).forEach((event) => {
        const eventDates = new Set(todoDateKeys(event));
        const bar = document.createElement("i");
        bar.className = "event-range-bar";
        const continuesLeft = index % 7 > 0 && eventDates.has(dateKey(previousDate));
        const continuesRight = index % 7 < 6 && eventDates.has(dateKey(nextDate));
        if (continuesLeft) bar.classList.add("continues-left");
        if (continuesRight) bar.classList.add("continues-right");
        if (!continuesLeft) bar.classList.add("range-start");
        if (!continuesRight) bar.classList.add("range-end");
        bars.append(bar);
      });
      dayButton.append(bars);
    }

    const singleDateEvents = events.filter((event) => todoDateKeys(event).length <= 1);
    if (singleDateEvents.length > 0) {
      const dots = document.createElement("span");
      dots.className = "event-dots";
      dots.setAttribute("aria-hidden", "true");
      singleDateEvents.slice(0, 3).forEach(() => dots.append(document.createElement("i")));
      dayButton.append(dots);
    }

    if (events.length > 0) {
      const titleList = document.createElement("span");
      titleList.className = "event-title-list";
      titleList.setAttribute("aria-hidden", "true");
      const visibleTitleCount = 2;
      events.slice(0, visibleTitleCount).forEach((event) => {
        const title = document.createElement("span");
        title.className = "event-title";
        title.textContent = event.title || "제목 없는 할 일";
        title.title = title.textContent;
        if (event.done) title.classList.add("is-done");
        titleList.append(title);
      });
      if (events.length > visibleTitleCount) {
        const more = document.createElement("span");
        more.className = "event-title-more";
        more.textContent = `+${events.length - visibleTitleCount}개 더`;
        titleList.append(more);
      }
      dayButton.append(titleList);
    }

    dayButton.addEventListener("click", () => {
      selectedDate = new Date(date);
      if (!inVisibleMonth) visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendars();
    });
    container.append(dayButton);
  }
}

function renderAgenda() {
  const label = document.querySelector("#selected-date-label");
  const list = document.querySelector("#agenda-list");
  label.textContent = formatSelectedDate(selectedDate);
  list.replaceChildren();

  const events = eventsFor(selectedDate);
  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "agenda-empty";
    empty.textContent = "등록된 일정이 없어요.";
    list.append(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("div");
    item.className = "agenda-item";
    if (event.done) item.classList.add("is-done");
    const dot = document.createElement("span");
    dot.className = "agenda-item-dot";
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = event.title;
    const detail = document.createElement("small");
    detail.textContent = currentUser ? event.detail || event.type || "eClass 일정" : `샘플 · ${event.detail}`;
    copy.append(title, detail);
    item.append(dot, copy);
    if (currentUser && event.by_user) {
      const actions = document.createElement("span");
      actions.className = "agenda-actions";
      const doneButton = document.createElement("button");
      doneButton.type = "button";
      doneButton.className = "agenda-action";
      doneButton.textContent = event.done ? "되돌리기" : "완료";
      doneButton.setAttribute("aria-label", `${event.title} ${event.done ? "완료 취소" : "완료 처리"}`);
      doneButton.addEventListener("click", () => changeTodoDone(event, !event.done));
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "agenda-action";
      editButton.textContent = "수정";
      editButton.addEventListener("click", () => openTodoDialog(event));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "agenda-action delete-action";
      deleteButton.textContent = "삭제";
      deleteButton.addEventListener("click", () => removeTodo(event));
      actions.append(doneButton, editButton, deleteButton);
      item.append(actions);
    }
    list.append(item);
  });
}

function renderCalendars() {
  const homeCalendar = document.querySelector('[data-calendar="home"]');
  if (homeCalendar) renderHomeWeeklyCalendar(homeCalendar);
  document.querySelectorAll('[data-calendar="full"]').forEach(renderCalendar);

  document.querySelectorAll("[data-calendar-month-label]").forEach((monthLabel) => {
    monthLabel.textContent = formatMonth(visibleMonth);
  });
  const todayHeading = document.querySelector(".timetable-card .section-kicker");
  if (todayHeading) {
    todayHeading.textContent = `${new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(today).toUpperCase()} · TODAY`;
  }
  renderStudyStats();
  renderTodayTodos();
  renderAgenda();
}

function openTodoDialog(todo = null) {
  if (!currentUser) {
    showToast("개인 일정을 관리하려면 eClass에 먼저 로그인해 주세요.");
    return;
  }
  editingTodoId = todo?.id || null;
  document.querySelector("#todo-dialog-title").textContent = todo ? "일정 수정" : "일정 추가";
  document.querySelector("#todo-title").value = todo?.title || "";
  const todoDates = todo ? todoDateKeys(todo) : [];
  document.querySelector("#todo-date-start").value = todoDates[0] || dateKey(selectedDate);
  document.querySelector("#todo-date-end").value = todoDates.length > 1 ? todoDates[todoDates.length - 1] : "";
  document.querySelector("#todo-date-end").min = document.querySelector("#todo-date-start").value;
  document.querySelector("#todo-note").value = todo?.note || "";
  document.querySelector("#todo-form-error").textContent = "";
  document.querySelector("#todo-dialog").showModal();
  document.querySelector("#todo-title").focus();
}

function updateLocalTodo(todo) {
  const index = currentUser.todos.findIndex((item) => item.id === todo.id);
  if (index >= 0) currentUser.todos[index] = todo;
  else currentUser.todos.push(todo);
  renderCalendars();
}

async function changeTodoDone(todo, done) {
  if (!currentUser) return;
  try {
    const result = await callBackend("set_user_todo_done", currentUser.id, todo.id, done);
    if (!result.success) throw new Error(result.error || "일정을 수정하지 못했습니다.");
    updateLocalTodo(result.todo);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "일정을 수정하지 못했습니다.");
  }
}

async function removeTodo(todo) {
  if (!currentUser) return;
  try {
    const result = await callBackend("delete_user_todo", currentUser.id, todo.id);
    if (!result.success) throw new Error(result.error || "일정을 삭제하지 못했습니다.");
    currentUser.todos = currentUser.todos.filter((item) => item.id !== todo.id);
    renderCalendars();
    showToast("일정을 삭제했습니다.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "일정을 삭제하지 못했습니다.");
  }
}

async function submitTodo(event) {
  event.preventDefault();
  if (!currentUser) return;
  const formError = document.querySelector("#todo-form-error");
  const saveButton = document.querySelector('#todo-form button[type="submit"]');
  saveButton.disabled = true;
  formError.textContent = "";
  const startDate = document.querySelector("#todo-date-start").value;
  const endDate = document.querySelector("#todo-date-end").value || startDate;
  const todo = {
    title: document.querySelector("#todo-title").value.trim(),
    date: startDate,
    dates: [],
    note: document.querySelector("#todo-note").value.trim(),
  };
  if (!startDate || !endDate || endDate < startDate) {
    formError.textContent = "종료 날짜는 시작 날짜와 같거나 이후여야 합니다.";
    saveButton.disabled = false;
    return;
  }
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const dayCount = (
    Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)
  ) / 86400000 + 1;
  if (!Number.isFinite(dayCount) || dayCount > 366) {
    formError.textContent = "일정은 최대 366일 범위로 등록할 수 있습니다.";
    saveButton.disabled = false;
    return;
  }
  const currentDate = new Date(`${startDate}T00:00:00`);
  const lastDate = new Date(`${endDate}T00:00:00`);
  while (currentDate <= lastDate) {
    todo.dates.push(dateKey(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  if (editingTodoId) todo.id = editingTodoId;

  try {
    const result = await callBackend("save_user_todo", currentUser.id, todo);
    if (!result.success) throw new Error(result.error || "일정을 저장하지 못했습니다.");
    updateLocalTodo(result.todo);
    document.querySelector("#todo-dialog").close();
    showToast(editingTodoId ? "일정을 수정했습니다." : "일정을 추가했습니다.");
    editingTodoId = null;
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : "일정을 저장하지 못했습니다.";
  } finally {
    saveButton.disabled = false;
  }
}
