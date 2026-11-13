const loginScreen = document.querySelector("#login-screen");
const appScreen = document.querySelector("#app-screen");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const pageTitle = document.querySelector("#page-title");
const homeDashboard = document.querySelector(".dashboard-placeholder");
const toast = document.querySelector("#toast");
let currentUser = null;

const pages = {
  home: { title: "홈", section: "Overview" },
  courses: { title: "수강 과목", section: "학사 관리" },
  grades: { title: "학점 관리", section: "학사 관리" },
  timer: { title: "학습 타이머", section: "학습 관리" },
  companion: { title: "별이와 대화", section: "별이" },
  analytics: { title: "학습 통계 및 분석", section: "학습 관리" },
  calendar: { title: "할일 관리", section: "학습 관리" },
};

const today = new Date();
today.setHours(0, 0, 0, 0);
let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDate = new Date(today);
let toastTimeout;
let timerPollHandle = null;
let timerDisplayHandle = null;
let timerPollInFlight = false;
let timerActionInFlight = false;
let timerStateVersion = 0;
let lastTimerReason = null;
let editingTodoId = null;
let editingCourseId = null;
let courseFetchVersion = 0;
let analyticsPeriod = "week";
let analyticsInsight = "pattern";
let monthlyAdviceState = { key: "", status: "idle", answer: "", error: "" };
const currentYear = new Date().getFullYear();
const currentTerm = (() => {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 6) return 1;
  if (month >= 7 && month <= 8) return 2;
  if (month >= 9) return 3;
  return 4;
})();
let selectedCourseYear = currentYear;
let selectedCourseTerm = currentTerm;
let chatBusy = false;
const chatHistory = [];
const timerState = {
  running: false,
  course: null,
  elapsedSeconds: 0,
  syncedAt: performance.now(),
  startedAt: null,
  autoPaused: false,
  savePending: false,
};

function sessionsForWeek(user, referenceDate = today) {
  const sessions = Array.isArray(user?.studySessions) ? user.studySessions : [];
  const weekStart = new Date(referenceDate);
  const dayOffset = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return sessions.flatMap((session) => {
    const startedAt = new Date(session.started_at);
    const duration = Number(session.duration_seconds);
    if (
      Number.isNaN(startedAt.getTime()) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      startedAt < weekStart ||
      startedAt >= weekEnd
    ) return [];
    return [{ ...session, startedAt, duration }];
  });
}

function renderStudyStats() {
  const weekSessions = sessionsForWeek(currentUser);
  const activeStartedAt = timerState.startedAt ? new Date(timerState.startedAt) : null;
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const hasActiveWeekSession = Boolean(
    timerState.course
    && activeStartedAt
    && !Number.isNaN(activeStartedAt.getTime())
    && activeStartedAt >= weekStart
    && activeStartedAt < weekEnd,
  );
  const activeSeconds = hasActiveWeekSession ? currentTimerElapsedSeconds() : 0;
  const totalSeconds = weekSessions.reduce((total, session) => total + session.duration, 0)
    + activeSeconds;
  const sessionCount = weekSessions.length + Number(hasActiveWeekSession);

  const dailySeconds = Array(7).fill(0);
  weekSessions.forEach((session) => {
    const dayIndex = (session.startedAt.getDay() + 6) % 7;
    dailySeconds[dayIndex] += session.duration;
  });
  if (hasActiveWeekSession) {
    const activeDayIndex = (activeStartedAt.getDay() + 6) % 7;
    dailySeconds[activeDayIndex] += activeSeconds;
  }
  const chart = document.querySelector("#study-chart");
  chart.replaceChildren();
  const maxDailySeconds = Math.max(...dailySeconds, 1);
  const weekdayNames = ["월", "화", "수", "목", "금", "토", "일"];
  dailySeconds.forEach((seconds, index) => {
    const column = document.createElement("div");
    column.className = "study-chart-column";
    const barTrack = document.createElement("span");
    barTrack.className = "study-chart-track";
    const bar = document.createElement("i");
    bar.className = "study-chart-bar";
    bar.style.height = `${Math.max(seconds > 0 ? 8 : 3, (seconds / maxDailySeconds) * 100)}%`;
    barTrack.append(bar);
    const label = document.createElement("small");
    label.textContent = weekdayNames[index];
    column.append(barTrack, label);
    chart.append(column);
  });
  const dailyTimes = document.querySelector("#study-chart-times");
  dailyTimes.replaceChildren();
  dailySeconds.forEach((seconds) => {
    const time = document.createElement("span");
    const totalMinutes = Math.floor(seconds / 60);
    time.textContent = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
    dailyTimes.append(time);
  });
  document.querySelector("#study-chart-summary").textContent = currentUser
    ? `${sessionCount}회 학습 · 총 ${formatStudyDuration(totalSeconds)}`
    : "로그인 후 학습 기록을 확인할 수 있어요.";

  const upcomingTodos = (currentUser?.todos || []).filter((todo) => !todo.done).length;
  const calendarBadge = document.querySelector('[data-page="calendar"] .nav-count');
  if (calendarBadge) {
    calendarBadge.textContent = String(upcomingTodos);
    calendarBadge.classList.toggle("is-hidden", upcomingTodos === 0);
  }
  renderRemainingTodos();
  if (appScreen.dataset.page === "analytics") renderAnalyticsStats();
}

function formatStudyDuration(totalSeconds) {
  const seconds = Math.floor(Math.max(0, totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${String(hours).padStart(2, "0")}시간`);
  if (minutes > 0 || hours > 0) parts.push(`${String(minutes).padStart(2, "0")}분`);
  parts.push(`${String(remainder).padStart(2, "0")}초`);
  return parts.join(" ");
}

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function seoulDateParts(timestamp) {
  const shifted = new Date(timestamp + SEOUL_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
  };
}

function seoulMidnight(year, month, day) {
  return Date.UTC(year, month - 1, day) - SEOUL_OFFSET_MS;
}

function seoulDateKeyFromParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function analyticsPeriodRange(period, now = Date.now()) {
  const parts = seoulDateParts(now);
  let start;
  let previousStart;
  let periodEnd;

  if (period === "week") {
    start = seoulMidnight(parts.year, parts.month, parts.day - ((parts.weekday + 6) % 7));
    periodEnd = start + 7 * DAY_MS;
    previousStart = start - 7 * DAY_MS;
  } else if (period === "month") {
    start = seoulMidnight(parts.year, parts.month, 1);
    periodEnd = seoulMidnight(parts.year, parts.month + 1, 1);
    const previousMonth = new Date(Date.UTC(parts.year, parts.month - 2, 1));
    previousStart = seoulMidnight(
      previousMonth.getUTCFullYear(),
      previousMonth.getUTCMonth() + 1,
      1,
    );
  } else {
    if (currentTerm === 1) {
      start = seoulMidnight(parts.year, 3, 1);
      periodEnd = seoulMidnight(parts.year, 7, 1);
      previousStart = seoulMidnight(parts.year, 1, 1);
    } else if (currentTerm === 2) {
      start = seoulMidnight(parts.year, 7, 1);
      periodEnd = seoulMidnight(parts.year, 9, 1);
      previousStart = seoulMidnight(parts.year, 3, 1);
    } else if (currentTerm === 3) {
      start = seoulMidnight(parts.year, 9, 1);
      periodEnd = seoulMidnight(parts.year + 1, 1, 1);
      previousStart = seoulMidnight(parts.year, 7, 1);
    } else {
      start = seoulMidnight(parts.year, 1, 1);
      periodEnd = seoulMidnight(parts.year, 3, 1);
      previousStart = seoulMidnight(parts.year - 1, 9, 1);
    }
  }

  const elapsed = Math.max(0, now - start);
  const previousPeriodEnd = Math.min(
    previousStart + (periodEnd - start),
    previousStart + elapsed,
  );
  return {
    start,
    end: Math.min(now, periodEnd),
    periodEnd,
    previousStart,
    previousEnd: previousPeriodEnd,
  };
}

function getStudyIntervals() {
  const sessions = Array.isArray(currentUser?.studySessions) ? currentUser.studySessions : [];
  const intervals = sessions.flatMap((session) => {
    const start = new Date(session.started_at).getTime();
    const duration = Number(session.duration_seconds);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
    return [{ start, end: start + duration * 1000, duration, course: session.course || "" }];
  });

  if (timerState.course && timerState.startedAt) {
    const start = new Date(timerState.startedAt).getTime();
    const duration = currentTimerElapsedSeconds();
    if (Number.isFinite(start) && duration > 0) {
      intervals.push({ start, end: start + duration * 1000, duration, course: timerState.course });
    }
  }
  return intervals;
}

function overlapStudySeconds(interval, rangeStart, rangeEnd) {
  const overlap = Math.max(0, Math.min(interval.end, rangeEnd) - Math.max(interval.start, rangeStart));
  const span = interval.end - interval.start;
  return span > 0 ? interval.duration * (overlap / span) : 0;
}

function sumStudySeconds(intervals, start, end) {
  return intervals.reduce(
    (total, interval) => total + overlapStudySeconds(interval, start, end),
    0,
  );
}

function analyticsChartBins(period, range) {
  if (period === "week") {
    const labels = ["월", "화", "수", "목", "금", "토", "일"];
    return labels.map((label, index) => ({
      label,
      start: range.start + index * DAY_MS,
      end: range.start + (index + 1) * DAY_MS,
    }));
  }

  const startParts = seoulDateParts(range.start);
  if (period === "month") {
    const daysInMonth = new Date(Date.UTC(startParts.year, startParts.month, 0)).getUTCDate();
    return Array.from({ length: Math.ceil(daysInMonth / 7) }, (_, index) => {
      const start = seoulMidnight(startParts.year, startParts.month, index * 7 + 1);
      return {
        label: `${index + 1}주`,
        start,
        end: Math.min(seoulMidnight(startParts.year, startParts.month, (index + 1) * 7 + 1), range.periodEnd),
      };
    });
  }

  const endParts = seoulDateParts(range.periodEnd);
  const monthCount = Math.max(
    1,
    (endParts.year - startParts.year) * 12 + endParts.month - startParts.month,
  );
  return Array.from({ length: monthCount }, (_, index) => {
    const monthDate = new Date(Date.UTC(startParts.year, startParts.month - 1 + index, 1));
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth() + 1;
    return {
      label: `${month}월`,
      start: seoulMidnight(year, month, 1),
      end: seoulMidnight(year, month + 1, 1),
    };
  });
}

function formatAnalyticsDuration(totalSeconds) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes}분`;
  return `${hours}시간 ${String(remainingMinutes).padStart(2, "0")}분`;
}

function formatChartAxis(seconds, axisMaximum) {
  if (axisMaximum >= 3600) {
    const hours = seconds / 3600;
    const value = axisMaximum / 3600 >= 4
      ? Math.round(hours)
      : Number(hours.toFixed(1));
    return `${value}시간`;
  }
  if (axisMaximum >= 60) {
    const minutes = seconds / 60;
    const value = axisMaximum / 60 >= 4
      ? Math.round(minutes)
      : Number(minutes.toFixed(1));
    return seconds === 0 ? "00분" : `${value}분`;
  }
  const value = axisMaximum >= 4 ? Math.round(seconds) : Number(seconds.toFixed(1));
  return seconds === 0 ? "00초" : `${value}초`;
}

function renderAnalyticsBarChart(container, bars) {
  container.replaceChildren();
  const maxValue = Math.max(...bars.map((bar) => bar.value), 0);
  const axisMaximum = maxValue;
  const stage = document.createElement("div");
  stage.className = "analytics-chart-stage";

  const axis = document.createElement("div");
  axis.className = "analytics-chart-axis";
  for (let index = 4; index >= 0; index -= 1) {
    const label = document.createElement("span");
    label.textContent = formatChartAxis((axisMaximum * index) / 4, axisMaximum);
    axis.append(label);
  }

  const plot = document.createElement("div");
  plot.className = "analytics-chart-plot";
  const grid = document.createElement("div");
  grid.className = "analytics-chart-gridlines";
  for (let index = 0; index < 5; index += 1) {
    grid.append(document.createElement("i"));
  }

  const columns = document.createElement("div");
  columns.className = "analytics-chart-columns";
  columns.style.gridTemplateColumns = `repeat(${bars.length}, minmax(0, 1fr))`;
  bars.forEach((item, index) => {
    const column = document.createElement("div");
    column.className = "analytics-chart-column";
    const track = document.createElement("span");
    track.className = "analytics-chart-track";
    const bar = document.createElement("i");
    bar.className = "analytics-chart-bar";
    const percent = axisMaximum > 0 ? Math.min(100, (item.value / axisMaximum) * 100) : 0;
    bar.style.height = item.value > 0 ? `${Math.max(2, percent)}%` : "0";
    bar.title = `${item.accessibleLabel || item.label}: ${formatAnalyticsDuration(item.value)}`;
    track.append(bar);
    const label = document.createElement("small");
    label.textContent = item.label;
    const accessibleLabel = item.accessibleLabel || item.label;
    column.setAttribute("aria-label", `${accessibleLabel} ${formatAnalyticsDuration(item.value)}`);
    column.append(track, label);
    columns.append(column);
  });

  plot.append(grid, columns);
  stage.append(axis, plot);
  container.append(stage);
}

function studySecondsByHour(intervals, range) {
  const secondsByHour = Array(24).fill(0);
  intervals.forEach((interval) => {
    let cursor = Math.max(interval.start, range.start);
    const end = Math.min(interval.end, range.end);
    const span = interval.end - interval.start;
    if (cursor >= end || span <= 0) return;
    while (cursor < end) {
      const parts = seoulDateParts(cursor);
      const nextHour = Math.min(
        end,
        seoulMidnight(parts.year, parts.month, parts.day) + (parts.hour + 1) * 60 * 60 * 1000,
      );
      secondsByHour[parts.hour] += interval.duration * ((nextHour - cursor) / span);
      cursor = nextHour;
    }
  });
  return secondsByHour;
}

function studyStreakDays(intervals, now) {
  const secondsByDate = new Map();
  intervals.forEach((interval) => {
    let cursor = interval.start;
    const span = interval.end - interval.start;
    if (span <= 0) return;
    while (cursor < interval.end) {
      const parts = seoulDateParts(cursor);
      const nextDay = seoulMidnight(parts.year, parts.month, parts.day + 1);
      const segmentEnd = Math.min(interval.end, nextDay);
      const key = seoulDateKeyFromParts(parts);
      secondsByDate.set(
        key,
        (secondsByDate.get(key) || 0) + interval.duration * ((segmentEnd - cursor) / span),
      );
      cursor = segmentEnd;
    }
  });

  const todayParts = seoulDateParts(now);
  let cursor = seoulMidnight(todayParts.year, todayParts.month, todayParts.day);
  if ((secondsByDate.get(seoulDateKeyFromParts(todayParts)) || 0) < 1) cursor -= DAY_MS;
  let streak = 0;
  while ((secondsByDate.get(seoulDateKeyFromParts(seoulDateParts(cursor))) || 0) >= 1) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

function renderAnalyticsStats() {
  const now = Date.now();
  const range = analyticsPeriodRange(analyticsPeriod, now);
  const intervals = getStudyIntervals();
  const totalSeconds = sumStudySeconds(intervals, range.start, range.end);
  const previousSeconds = sumStudySeconds(intervals, range.previousStart, range.previousEnd);
  const dateParts = seoulDateParts(now);
  const todayStart = seoulMidnight(dateParts.year, dateParts.month, dateParts.day);
  const elapsedDays = Math.max(1, Math.floor((todayStart - range.start) / DAY_MS) + 1);

  document.querySelectorAll("[data-analytics-period]").forEach((tab) => {
    const active = tab.dataset.analyticsPeriod === analyticsPeriod;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelector("#analytics-total-time").textContent = formatAnalyticsDuration(totalSeconds);
  document.querySelector("#analytics-daily-average").textContent =
    formatAnalyticsDuration(totalSeconds / elapsedDays);
  document.querySelector("#analytics-study-streak").textContent = `${studyStreakDays(intervals, now)}일`;

  const comparison = document.querySelector("#analytics-comparison");
  const comparisonLabel = {
    week: "지난주",
    month: "지난달",
    semester: "이전 학기",
  }[analyticsPeriod];
  const selectedPeriodLabel = {
    week: "이번 주",
    month: "이번 달",
    semester: "이번 학기",
  }[analyticsPeriod];
  comparison.classList.remove("is-positive", "is-negative", "is-neutral");
  if (previousSeconds <= 0) {
    comparison.textContent = totalSeconds > 0
      ? `${comparisonLabel} 학습 기록 없음`
      : "비교할 학습 기록이 없습니다.";
    comparison.classList.add("is-neutral");
  } else {
    const change = Math.round(((totalSeconds - previousSeconds) / previousSeconds) * 100);
    const direction = change > 0 ? "↗" : change < 0 ? "↘" : "→";
    const sign = change > 0 ? "+" : "";
    comparison.textContent = `${direction} ${comparisonLabel} 대비 ${sign}${change}%`;
    comparison.classList.add(change > 0 ? "is-positive" : change < 0 ? "is-negative" : "is-neutral");
  }

  const chartTitle = {
    week: "주간 공부 시간",
    month: "월간 공부 시간",
    semester: "학기별 공부 시간",
  }[analyticsPeriod];
  const chartDescription = {
    week: "요일별 누적 시간",
    month: "주차별 누적 시간",
    semester: "월별 누적 시간",
  }[analyticsPeriod];
  document.querySelector("#analytics-period-chart-title").textContent = chartTitle;
  document.querySelector("#analytics-period-chart-description").textContent = chartDescription;
  document.querySelector("#analytics-hour-chart-description").textContent =
    `${selectedPeriodLabel} · 06시부터 표시`;

  const bins = analyticsChartBins(analyticsPeriod, range).map((bin) => ({
    ...bin,
    value: sumStudySeconds(intervals, bin.start, Math.min(bin.end, range.end)),
  }));
  renderAnalyticsBarChart(
    document.querySelector("#analytics-period-chart"),
    bins,
  );

  const secondsByHour = studySecondsByHour(intervals, range);
  const hourOrder = Array.from({ length: 24 }, (_, index) => (index + 6) % 24);
  const hourlyBars = hourOrder.map((hour) => ({
    label: hour % 3 === 0 ? `${String(hour || 24).padStart(2, "0")}시` : "",
    accessibleLabel: `${String(hour).padStart(2, "0")}시`,
    value: secondsByHour[hour],
  }));
  renderAnalyticsBarChart(
    document.querySelector("#analytics-hour-chart"),
    hourlyBars,
  );
  renderAnalyticsInsight(analyticsPeriodRange("month", now), intervals);
}

function studySecondsByWeekday(intervals, range) {
  const secondsByWeekday = Array(7).fill(0);
  intervals.forEach((interval) => {
    let cursor = Math.max(interval.start, range.start);
    const end = Math.min(interval.end, range.end);
    const span = interval.end - interval.start;
    if (cursor >= end || span <= 0) return;
    while (cursor < end) {
      const parts = seoulDateParts(cursor);
      const nextDay = seoulMidnight(parts.year, parts.month, parts.day + 1);
      const segmentEnd = Math.min(end, nextDay);
      secondsByWeekday[(parts.weekday + 6) % 7] += interval.duration * ((segmentEnd - cursor) / span);
      cursor = segmentEnd;
    }
  });
  return secondsByWeekday;
}

function createAnalyticsInsightCard(label, value, description) {
  const card = document.createElement("article");
  card.className = "analytics-insight-card";
  const title = document.createElement("span");
  title.textContent = label;
  const metric = document.createElement("strong");
  metric.textContent = value;
  const detail = document.createElement("p");
  detail.textContent = description;
  card.append(title, metric, detail);
  return card;
}

function createAnalyticsInsightMessage(text) {
  const message = document.createElement("p");
  message.className = "analytics-insight-message";
  message.textContent = text;
  return message;
}

function renderAnalyticsInsight(range, intervals) {
  document.querySelectorAll("[data-analytics-insight]").forEach((tab) => {
    const active = tab.dataset.analyticsInsight === analyticsInsight;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  const detail = document.querySelector("#analytics-insight-detail");
  detail.setAttribute("aria-labelledby", `analytics-${analyticsInsight}-tab`);
  detail.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "analytics-insight-heading";
  const title = document.createElement("h3");
  const period = document.createElement("span");
  period.textContent = analyticsInsight === "advice" ? "월간 학습 기록 기반" : "이번 달 기준";
  title.textContent = {
    pattern: "월간 학습 패턴",
    subjects: "과목별 학습 분석",
    advice: "별이의 한 마디",
  }[analyticsInsight];
  heading.append(title, period);
  detail.append(heading);

  if (analyticsInsight === "pattern") {
    renderLearningPatternInsight(detail, intervals, range);
  } else if (analyticsInsight === "subjects") {
    renderSubjectInsight(detail, intervals, range);
  } else {
    renderGeminiAdvice(detail, intervals, range);
  }
}

function renderLearningPatternInsight(detail, intervals, range) {
  const bands = studySecondsByThreeHourBand(intervals, range);
  const bestBand = bands.reduce(
    (best, band) => !best || band.seconds > best.seconds ? band : best,
    null,
  );
  const weekdayNames = ["월", "화", "수", "목", "금", "토", "일"];
  const secondsByWeekday = studySecondsByWeekday(intervals, range);
  const rankedDays = secondsByWeekday
    .map((seconds, index) => ({ seconds, index }))
    .filter((day) => day.seconds > 0)
    .sort((left, right) => right.seconds - left.seconds);
  const bestDay = rankedDays[0] || null;
  const hasStudyData = Boolean(bestBand?.seconds);
  const cards = document.createElement("div");
  cards.className = "analytics-insight-cards";
  cards.append(
    createAnalyticsInsightCard(
      "추천 시간대",
      hasStudyData
        ? `${String(bestBand.startHour).padStart(2, "0")}:00 – ${String(bestBand.endHour).padStart(2, "0")}:00`
        : "기록 없음",
      hasStudyData
        ? `이 시간대에 ${formatAnalyticsDuration(bestBand.seconds)} 공부했어요.`
        : "학습 기록이 쌓이면 집중 시간대를 알려드려요.",
    ),
  );

  const dayCard = document.createElement("article");
  dayCard.className = "analytics-insight-card";
  const dayTitle = document.createElement("span");
  dayTitle.textContent = "추천 요일";
  const dayChips = document.createElement("div");
  dayChips.className = "analytics-day-chips";
  weekdayNames.forEach((day, index) => {
    const chip = document.createElement("span");
    chip.className = bestDay?.index === index ? "is-recommended" : "";
    chip.textContent = day;
    dayChips.append(chip);
  });
  const dayDescription = document.createElement("p");
  dayDescription.textContent = bestDay
    ? `${weekdayNames[bestDay.index]}요일에 공부 시간이 가장 많아요.`
    : "학습 기록이 쌓이면 공부하기 좋은 요일을 알려드려요.";
  dayCard.append(dayTitle, dayChips, dayDescription);
  cards.append(dayCard);
  detail.append(cards);

  const message = hasStudyData
    ? `이번 달에는 ${String(bestBand.startHour).padStart(2, "0")}시부터 ${String(bestBand.endHour).padStart(2, "0")}시 사이와 ${bestDay ? `${weekdayNames[bestDay.index]}요일` : "여러 요일"}에 공부를 가장 많이 했어요. 이 시간대를 중심으로 다음 달 학습 계획을 세워보세요.`
    : "학습 기록이 아직 부족해요. 타이머로 공부 시간을 기록하면 나에게 맞는 시간대와 요일을 분석해 드릴게요.";
  detail.append(createAnalyticsInsightMessage(message));
}

function studySecondsByThreeHourBand(intervals, range) {
  const secondsByHour = studySecondsByHour(intervals, range);
  return Array.from({ length: 8 }, (_, index) => {
    const startHour = index * 3;
    return {
      startHour,
      endHour: startHour + 3,
      seconds: secondsByHour
        .slice(startHour, startHour + 3)
        .reduce((total, seconds) => total + seconds, 0),
    };
  });
}

function monthlySubjectStudyTotals(intervals, range) {
  const totals = new Map();
  const monthParts = seoulDateParts(range.start);
  const monthTerm = monthParts.month >= 3 && monthParts.month <= 6
    ? 1
    : monthParts.month >= 7 && monthParts.month <= 8
      ? 2
      : monthParts.month >= 9
        ? 3
        : 4;
  (currentUser?.courses || []).forEach((course) => {
    const courseYear = Number(course.year || monthParts.year);
    const courseTerm = Number(course.term || monthTerm);
    if (
      courseYear === monthParts.year
      && courseTerm === monthTerm
      && typeof course.title === "string"
      && course.title.trim()
    ) {
      if (!totals.has(course.title.trim())) totals.set(course.title.trim(), 0);
    }
  });
  intervals.forEach((interval) => {
    const seconds = overlapStudySeconds(interval, range.start, range.end);
    if (seconds <= 0) return;
    const title = typeof interval.course === "string" && interval.course.trim()
      ? interval.course.trim()
      : "과목 미지정";
    totals.set(title, (totals.get(title) || 0) + seconds);
  });
  return [...totals.entries()]
    .map(([title, seconds]) => ({ title, seconds }))
    .sort((left, right) => right.seconds - left.seconds);
}

function renderSubjectInsight(detail, intervals, range) {
  const subjects = monthlySubjectStudyTotals(intervals, range);
  const studiedSubjects = subjects.filter((subject) => subject.seconds > 0);
  const mostStudied = studiedSubjects[0] || null;
  const leastStudied = subjects.length
    ? subjects.reduce((least, subject) => subject.seconds < least.seconds ? subject : least)
    : null;
  const cards = document.createElement("div");
  cards.className = "analytics-insight-cards";
  cards.append(
    createAnalyticsInsightCard(
      "이번 달 가장 많이 공부한 과목",
      mostStudied?.title || "기록 없음",
      mostStudied ? formatAnalyticsDuration(mostStudied.seconds) : "이번 달 학습 기록이 없어요.",
    ),
    createAnalyticsInsightCard(
      "이번 달 가장 적게 공부한 과목",
      studiedSubjects.length > 0 ? leastStudied?.title || "—" : "기록 없음",
      studiedSubjects.length > 0 && leastStudied
        ? formatAnalyticsDuration(leastStudied.seconds)
        : "과목별 학습 시간이 쌓이면 비교할 수 있어요.",
    ),
  );
  cards.querySelectorAll(".analytics-insight-card").forEach((card) => {
    card.classList.add("analytics-subject-stat");
  });
  detail.append(cards);

  const pieSection = document.createElement("div");
  pieSection.className = "analytics-subject-breakdown";
  if (studiedSubjects.length) {
    const pie = document.createElement("div");
    pie.className = "analytics-subject-pie";
    pie.setAttribute("role", "img");
    pie.setAttribute(
      "aria-label",
      `이번 달 과목별 공부 시간: ${studiedSubjects.map((subject) => `${subject.title} ${formatAnalyticsDuration(subject.seconds)}`).join(", ")}`,
    );
    const colors = ["#a45f00", "#ef9e69", "#5dbfad", "#df7ca2", "#cc8c1a", "#e7c55c", "#80b77f", "#d29047"];
    const totalSeconds = studiedSubjects.reduce((total, subject) => total + subject.seconds, 0);
    let accumulatedPercent = 0;
    const segments = studiedSubjects.map((subject, index) => {
      const startPercent = accumulatedPercent;
      accumulatedPercent += (subject.seconds / totalSeconds) * 100;
      return `${colors[index % colors.length]} ${startPercent}% ${accumulatedPercent}%`;
    });
    pie.style.background = `conic-gradient(${segments.join(", ")})`;

    const legend = document.createElement("div");
    legend.className = "analytics-subject-legend";
    studiedSubjects.forEach((subject, index) => {
      const item = document.createElement("div");
      item.className = "analytics-subject-legend-item";
      const swatch = document.createElement("i");
      swatch.style.backgroundColor = colors[index % colors.length];
      const name = document.createElement("strong");
      name.textContent = subject.title;
      const duration = document.createElement("span");
      duration.textContent = formatAnalyticsDuration(subject.seconds);
      item.append(swatch, name, duration);
      legend.append(item);
    });
    pieSection.append(pie, legend);
  } else {
    const empty = document.createElement("p");
    empty.className = "analytics-subject-empty";
    empty.textContent = "이번 달 과목별 학습 기록이 아직 없습니다.";
    pieSection.append(empty);
  }
  detail.append(pieSection);

  const note = mostStudied && leastStudied && subjects.length > 1
    ? `이번 달에는 ${leastStudied.title}의 공부 시간이 가장 적어요. 과제나 시험 일정을 고려해 학습 시간이 충분한지 점검해 보세요.`
    : studiedSubjects.length
      ? "다른 과목과 비교할 수 있도록 과목별 학습 기록을 계속 쌓아보세요."
      : "타이머로 과목별 학습 시간을 기록하면 공부량을 비교하고 계획을 점검할 수 있어요.";
  detail.append(createAnalyticsInsightMessage(note));
}

function buildMonthlyStudyAdviceSummary(intervals, range) {
  const parts = seoulDateParts(range.start);
  const weekdayNames = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];
  const secondsByWeekday = studySecondsByWeekday(intervals, range);
  const subjects = monthlySubjectStudyTotals(intervals, range)
    .slice(0, 30)
    .map((subject) => ({
      title: subject.title,
      study_seconds: Math.round(subject.seconds),
    }));
  return {
    month: `${parts.year}년 ${parts.month}월`,
    total_seconds: Math.round(sumStudySeconds(intervals, range.start, range.end)),
    time_bands: studySecondsByThreeHourBand(intervals, range).map((band) => ({
      label: `${String(band.startHour).padStart(2, "0")}-${String(band.endHour).padStart(2, "0")}시`,
      seconds: Math.round(band.seconds),
    })),
    weekdays: weekdayNames.map((label, index) => ({
      label,
      seconds: Math.round(secondsByWeekday[index]),
    })),
    subjects,
  };
}

function renderGeminiAdvice(detail, intervals, range) {
  const summary = buildMonthlyStudyAdviceSummary(intervals, range);
  if (monthlyAdviceState.key !== summary.month) {
    monthlyAdviceState = { key: summary.month, status: "idle", answer: "", error: "" };
  }

  const description = document.createElement("p");
  description.className = "analytics-advice-description";
  description.textContent =
    "별이가 이번 달 과목별 학습 시간과 입력한 성적, 공부 패턴을 종합해 실천 가능한 조언을 알려줘요.";
  detail.append(description);

  if (summary.total_seconds <= 0) {
    detail.append(createAnalyticsInsightMessage(
      "이번 달 학습 기록이 없어 조언을 만들 수 없어요. 타이머 기록이 생기면 월간 분석을 받을 수 있습니다.",
    ));
    return;
  }

  if (monthlyAdviceState.answer) {
    const mascot = document.createElement("img");
    mascot.className = "analytics-advice-mascot";
    mascot.src = "assets/star-advice-mascot.png";
    mascot.alt = "별이";
    const answer = document.createElement("p");
    answer.className = "analytics-advice-answer";
    answer.textContent = monthlyAdviceState.answer;
    detail.append(mascot, answer);
  } else if (monthlyAdviceState.error) {
    const error = createAnalyticsInsightMessage(monthlyAdviceState.error);
    error.classList.add("analytics-advice-error");
    detail.append(error);
  } else {
    detail.append(createAnalyticsInsightMessage(
      "한 달간의 학습 기록을 종합해 다음 달에 적용할 수 있는 조언을 받아보세요.",
    ));
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary-button analytics-advice-button";
  button.disabled = monthlyAdviceState.status === "loading";
  button.textContent = monthlyAdviceState.status === "loading"
    ? "별이가 분석 중..."
    : monthlyAdviceState.answer
      ? "다시 받아보기"
      : monthlyAdviceState.error
        ? "다시 요청하기"
        : "별이의 한 마디 듣기";
  button.addEventListener("click", () => requestMonthlyStudyAdvice(summary));
  detail.append(button);
}

async function requestMonthlyStudyAdvice(summary) {
  if (monthlyAdviceState.status === "loading") return;
  const requestingUser = currentUser;
  monthlyAdviceState = { key: summary.month, status: "loading", answer: "", error: "" };
  if (appScreen.dataset.page === "analytics" && analyticsInsight === "advice") {
    renderAnalyticsInsight(analyticsPeriodRange("month"), getStudyIntervals());
  }
  try {
    const result = await callBackend("generate_monthly_study_advice", currentUser.id, summary);
    if (!result.success) throw new Error(result.error || "Gemini 조언을 불러오지 못했습니다.");
    if (currentUser !== requestingUser) return;
    monthlyAdviceState = {
      key: summary.month,
      status: "ready",
      answer: result.answer,
      error: "",
    };
  } catch (error) {
    if (currentUser !== requestingUser) return;
    monthlyAdviceState = {
      key: summary.month,
      status: "error",
      answer: "",
      error: error instanceof Error ? error.message : "Gemini 조언을 불러오지 못했습니다.",
    };
  }
  if (appScreen.dataset.page === "analytics" && analyticsInsight === "advice") {
    renderAnalyticsInsight(analyticsPeriodRange("month"), getStudyIntervals());
  }
}

function refreshHomeTimetable() {
  if (!currentUser) return;
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date().getDay()];
  currentUser.todayCourses = (currentUser.courses || []).filter((course) =>
    Number(course.year || currentYear) === currentYear
    && Number(course.term || currentTerm) === currentTerm
    && Array.isArray(course.times)
    && course.times.some((time) => typeof time === "string" && time.startsWith(weekday)),
  );
  renderTodayCourses(currentUser.todayCourses);
}

function renderTodayCourses(courses) {
  const panel = document.querySelector("#today-courses");
  panel.replaceChildren();
  if (courses.length === 0) {
    const icon = document.createElement("span");
    icon.className = "empty-state-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "◷";
    const title = document.createElement("strong");
    title.textContent = "오늘 예정된 수업이 없어요";
    panel.append(icon, title);
    return;
  }
  courses.forEach((course) => {
    const item = document.createElement("div");
    item.className = "timetable-item";
    const time = document.createElement("span");
    time.className = "timetable-time";
    time.textContent = Array.isArray(course.times) ? course.times.join(", ") : "";
    const details = document.createElement("span");
    details.className = "timetable-details";
    const title = document.createElement("strong");
    title.textContent = course.title || "과목명 없음";
    const professor = document.createElement("small");
    professor.textContent = course.prof || "";
    details.append(title, professor);
    item.append(time, details);
    panel.append(item);
  });
}

function seoulDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function navigateTo(page) {
  if (!Object.hasOwn(pages, page)) return;
  const isHome = page === "home";
  appScreen.dataset.page = page;
  // pageTitle.textContent = pages[page].title;
  // const breadcrumb = document.querySelector(".breadcrumb");
  // const separator = document.createElement("span");
  // separator.textContent = "/";
  // breadcrumb.replaceChildren(document.createTextNode("ST mate "), separator, ` ${pages[page].section}`);
  homeDashboard.classList.toggle("is-hidden", !isHome);
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.classList.toggle("is-hidden", view.dataset.view !== page);
  });
  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  renderStudyStats();
}

function showLogin() {
  appScreen.classList.add("is-hidden");
  loginScreen.classList.remove("is-hidden");
  loginMessage.textContent = "";
  renderUserData(null);
  renderCalendars();
  document.querySelector("#profile-menu").classList.add("is-hidden");
  document.querySelector("#profile-menu-toggle").setAttribute("aria-expanded", "false");
}

function callBackend(method, ...args) {
  return new Promise((resolve, reject) => {
    const backendMethod = window.eel?.[method];
    console.log(1);
    if (typeof backendMethod !== "function") {
      console.log(2);
      reject(new Error("Eel 백엔드에 연결할 수 없습니다. 앱을 다시 실행해 주세요."));
      console.log(3);
      return;
    }

    try {
      console.log(4);
      backendMethod(...args)(resolve);
    } catch (error) {
      console.log(5);
      reject(error);
    }
  });
}

function appendChatMessage(role, text, { pending = false } = {}) {
  const message = document.createElement("div");
  message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;
  if (pending) message.classList.add("is-pending");
  message.textContent = text;
  document.querySelector("#chat-messages").append(message);
  message.scrollIntoView({ block: "nearest" });
  return message;
}

function openChatDialog() {
  document.querySelector("#chat-dialog").showModal();
  document.querySelector("#chat-input").focus();
}

async function submitChatMessage(event) {
  event.preventDefault();
  if (chatBusy) return;
  const input = document.querySelector("#chat-input");
  const message = input.value.trim();
  if (!message) return;
  chatBusy = true;
  document.querySelector("#chat-send").disabled = true;
  document.querySelector("#chat-disclaimer").textContent = "답변을 생성하고 있습니다...";
  input.value = "";
  chatHistory.push({ role: "user", content: message });
  appendChatMessage("user", message);
  const pendingMessage = appendChatMessage("assistant", "답변을 작성하고 있어요...", { pending: true });

  try {
    const result = await callBackend("ask_study_assistant", chatHistory.slice(-10));
    if (!result.success) throw new Error(result.error || "AI 응답을 가져오지 못했습니다.");
    chatHistory.push({ role: "assistant", content: result.answer });
    pendingMessage.textContent = result.answer;
    pendingMessage.classList.remove("is-pending");
  } catch (error) {
    pendingMessage.remove();
    appendChatMessage(
      "assistant",
      error instanceof Error ? error.message : "AI 응답을 가져오지 못했습니다.",
    );
  } finally {
    chatBusy = false;
    document.querySelector("#chat-send").disabled = false;
    document.querySelector("#chat-disclaimer").textContent =
      "AI 답변은 참고용이며 중요한 정보는 확인이 필요합니다.";
    input.focus();
  }
}

const starChatHistory = [];
let starChatBusy = false;

function appendStarMessage(role, text, pending = false) {
  const message = document.createElement("div");
  message.className = `star-chat-message ${role === "user" ? "user-message" : "star-message"}`;
  if (pending) message.classList.add("is-pending");
  message.textContent = text;
  document.querySelector("#star-chat-messages").append(message);
  message.scrollIntoView({ block: "nearest" });
  return message;
}

async function submitStarChat(event, presetText) {
  event.preventDefault();
  if (starChatBusy) return;
  const input = document.querySelector("#star-chat-input");
  const text = (presetText ?? input.value).trim();
  if (!text) return;
  starChatBusy = true;
  document.querySelector("#star-chat-send").disabled = true;
  input.value = "";
  starChatHistory.push({ role: "user", content: text });
  appendStarMessage("user", text);
  const pending = appendStarMessage("star", "별이가 생각하고 있어요...", true);
  try {
    const result = await callBackend("chat_with_star", currentUser.id, starChatHistory.slice(-20));
    if (!result.success) throw new Error(result.error || "별이가 대답하지 못했어요.");
    starChatHistory.push({ role: "assistant", content: result.answer });
    pending.textContent = result.answer;
    pending.classList.remove("is-pending");
  } catch (error) {
    starChatHistory.pop();
    pending.textContent = error instanceof Error ? error.message : "별이가 대답하지 못했어요.";
    pending.classList.remove("is-pending");
  } finally {
    starChatBusy = false;
    document.querySelector("#star-chat-send").disabled = false;
    input.focus();
  }
}

function getUserInitials(name) {
  const text = String(name || "").trim();
  const koreanSyllables = Array.from(text).filter((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint >= 0xac00 && codePoint <= 0xd7a3;
  });
  if (koreanSyllables.length > 0) {
    const leadingInitials = [
      "G", "K", "N", "D", "T", "R", "M", "B", "P", "S",
      "S", "", "J", "J", "C", "K", "T", "P", "H",
    ];
    const vowelInitials = [
      "A", "A", "Y", "Y", "E", "E", "Y", "Y", "O", "W", "W",
      "W", "Y", "U", "W", "W", "W", "Y", "E", "U", "I",
    ];
    return koreanSyllables.slice(-2).map((syllable) => {
      const offset = syllable.charCodeAt(0) - 0xac00;
      const leadingIndex = Math.floor(offset / 588);
      if (leadingInitials[leadingIndex]) return leadingInitials[leadingIndex];
      const vowelIndex = Math.floor((offset % 588) / 28);
      return vowelInitials[vowelIndex] || "";
    }).join("") || "P";
  }

  const words = text.split(/\s+/).filter(Boolean);
  const initials = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0])
    : Array.from(text).slice(0, 2);
  return initials.join("").toUpperCase() || "P";
}

function openProfileDialog() {
  if (!currentUser) {
    showToast("로그인 후 내 정보를 확인할 수 있어요.");
    return;
  }

  const grade = String(currentUser.grade || "").trim();
  document.querySelector("#profile-dialog-avatar").textContent =
    getUserInitials(currentUser.name);
  document.querySelector("#profile-info-name").textContent =
    currentUser.name || "정보 없음";
  document.querySelector("#profile-info-id").textContent =
    currentUser.id ? `학번 ${currentUser.id}` : "정보 없음";
  document.querySelector("#profile-info-major").textContent =
    currentUser.major || "정보 없음";
  document.querySelector("#profile-info-grade").textContent =
    grade ? (grade.endsWith("학년") ? grade : `${grade}학년`) : "정보 없음";
  document.querySelector("#profile-info-phone").textContent =
    currentUser.phone || "정보 없음";
  document.querySelector("#profile-info-email").textContent =
    currentUser.email || "정보 없음";

  document.querySelector("#profile-menu").classList.add("is-hidden");
  document.querySelector("#profile-menu-toggle").setAttribute("aria-expanded", "false");
  document.querySelector("#profile-dialog").showModal();
}

function renderUserData(user) {
  monthlyAdviceState = { key: "", status: "idle", answer: "", error: "" };
  const profileAvatar = document.querySelector("#profile-avatar");
  const profileName = document.querySelector("#profile-name");
  const profileDetail = document.querySelector("#profile-detail");
  const courseRows = document.querySelector("#course-rows");
  const courseCount = document.querySelector("#course-count");
  const todayCoursesPanel = document.querySelector("#today-courses");

  if (!user) {
    profileAvatar.textContent = "S";
    profileName.textContent = "ST mate 사용자";
    profileDetail.textContent = "eClass 로그인 전";
    courseRows.replaceChildren();
    courseCount.textContent = "0개 과목";
    todayCoursesPanel.innerHTML =
      '<span class="empty-state-icon" aria-hidden="true">◷</span><strong>아직 등록된 수업이 없어요</strong><span>eClass에 로그인하면 시간표를 불러올 수 있어요.</span>';
    selectedCourseYear = currentYear;
    selectedCourseTerm = currentTerm;
    syncTermControls();
    document.querySelector("#course-credit-total").innerHTML = '0<span> 학점</span>';
    renderStudyStats();
    renderTimerCourseList();
    renderCourseViews();
    return;
  }

  profileName.textContent = user.name || user.id;
  profileAvatar.textContent = getUserInitials(user.name);
  user.studySessions = Array.isArray(user.studySessions) ? user.studySessions : [];
  user.todos = Array.isArray(user.todos) ? user.todos : [];
  user.courses = Array.isArray(user.courses) ? user.courses : [];
  user.hiddenTimerCourseIds = Array.isArray(user.hiddenTimerCourseIds)
    ? user.hiddenTimerCourseIds
    : [];
  user.customTimerCourses = Array.isArray(user.customTimerCourses)
    ? user.customTimerCourses
    : [];
  profileDetail.textContent = [user.major, user.grade ? `${user.grade}학년` : ""]
    .filter(Boolean)
    .join(" · ") || user.id;
  selectedCourseYear = currentYear;
  selectedCourseTerm = currentTerm;
  syncTermControls();

  renderCourseViews();
  renderTimerCourseList();

  renderTodayCourses(Array.isArray(user.todayCourses) ? user.todayCourses : []);
}

function getAllowedApps() {
  return [...document.querySelectorAll("[data-focus-app]:checked")].map((input) => input.value);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const studentId = document.querySelector("#student-id").value.trim();
  const passwordInput = document.querySelector("#password");
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "로그인 중...";
  loginMessage.textContent = "eClass에 로그인하고 학사 정보를 불러오는 중입니다.";

  try {
    const result = await callBackend("login_eclass", studentId, passwordInput.value);
    if (!result.success) {
      loginMessage.textContent = result.error || "로그인에 실패했습니다.";
      return;
    }

    currentUser = result.user;
    renderUserData(currentUser);
    passwordInput.value = "";
    loginMessage.textContent = "";
    loginScreen.classList.add("is-hidden");
    appScreen.classList.remove("is-hidden");
    renderCalendars();
    navigateTo("home");
  } catch (error) {
    loginMessage.textContent =
      error instanceof Error ? error.message : "백엔드와 통신하지 못했습니다.";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = '로그인 <span aria-hidden="true">→</span>';
  }
});

document.querySelector("#profile-menu-toggle").addEventListener("click", () => {
  const menu = document.querySelector("#profile-menu");
  const isExpanded = document.querySelector("#profile-menu-toggle").getAttribute("aria-expanded") === "true";
  menu.classList.toggle("is-hidden", isExpanded);
  document.querySelector("#profile-menu-toggle").setAttribute("aria-expanded", String(!isExpanded));
});

document.querySelector("#profile-info-button").addEventListener("click", openProfileDialog);

document.addEventListener("click", (event) => {
  const menuContainer = document.querySelector(".profile-menu-container");
  if (menuContainer.contains(event.target)) return;
  document.querySelector("#profile-menu").classList.add("is-hidden");
  document.querySelector("#profile-menu-toggle").setAttribute("aria-expanded", "false");
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  if (timerState.course || timerState.running) {
    timerActionInFlight = true;
    timerStateVersion += 1;
    try {
      const result = await callBackend("stop_study_timer");
      if (!result.success) throw new Error(result.error || "학습 기록을 저장하지 못했습니다.");
      if (result.elapsed_seconds > 0) showToast(result.message);
      timerState.running = false;
      stopTimerDisplay();
      timerState.course = null;
      timerState.elapsedSeconds = result.elapsed_seconds;
      timerState.reason = null;
      timerState.autoPaused = false;
      timerState.savePending = false;
      if (result.record && currentUser) {
        currentUser.studySessions = [...(currentUser.studySessions || []), result.record];
      }
      renderTimerState();
      renderStudyStats();
    } catch (error) {
      timerState.running = false;
      stopTimerDisplay();
      timerState.savePending = true;
      timerState.autoPaused = false;
      timerState.reason =
        error instanceof Error ? error.message : "학습 기록을 저장하지 못했습니다.";
      renderTimerState();
      showToast(error instanceof Error ? error.message : "학습 기록을 저장하지 못해 로그아웃을 중단했습니다.");
      return;
    } finally {
      timerActionInFlight = false;
    }
  }
  if (currentUser) {
    try {
      const result = await callBackend("logout_eclass", currentUser.id);
      if (!result.success) throw new Error(result.error || "로그아웃 세션 정리에 실패했습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "로그아웃 세션 정리에 실패했습니다.");
      return;
    }
  }
  currentUser = null;
  if (timerPollHandle !== null) {
    window.clearInterval(timerPollHandle);
    timerPollHandle = null;
  }
  stopTimerDisplay();
  showLogin();
});

document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
  item.addEventListener("click", () => navigateTo(item.dataset.page));
});

document.querySelectorAll("[data-navigate]").forEach((button) => {
  button.addEventListener("click", () => navigateTo(button.dataset.navigate));
});

document.querySelectorAll("[data-analytics-period]").forEach((tab) => {
  tab.addEventListener("click", () => {
    analyticsPeriod = tab.dataset.analyticsPeriod;
    renderAnalyticsStats();
  });
});

document.querySelectorAll("[data-analytics-insight]").forEach((tab) => {
  tab.addEventListener("click", () => {
    analyticsInsight = tab.dataset.analyticsInsight;
    renderAnalyticsInsight(analyticsPeriodRange("month"), getStudyIntervals());
  });
});

document.querySelectorAll(".sidebar-brand").forEach((brand) => {
  brand.addEventListener("click", (event) => {
    event.preventDefault();
    navigateTo("home");
  });
});

document.querySelectorAll("[data-month-shift]").forEach((button) => {
  button.addEventListener("click", () => {
    visibleMonth.setMonth(visibleMonth.getMonth() + Number(button.dataset.monthShift));
    renderCalendars();
  });
});

document.querySelectorAll("[data-month-today]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedDate = new Date(today);
    visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    renderCalendars();
  });
});

document.querySelectorAll("[data-notice]").forEach((button) => {
  button.addEventListener("click", () => showToast(button.dataset.notice));
});

const sidebarToggle = document.querySelector("#sidebar-toggle");
sidebarToggle.addEventListener("click", () => {
  const collapsed = appScreen.classList.toggle("sidebar-collapsed");
  sidebarToggle.setAttribute("aria-pressed", String(collapsed));
  const label = collapsed ? "사이드바 표시" : "사이드바 숨기기";
  sidebarToggle.setAttribute("aria-label", label);
  sidebarToggle.title = label;
});

function changeSelectedTerm(year, term) {
  selectedCourseYear = year;
  selectedCourseTerm = term;
  syncTermControls();
  loadCoursesForSelectedTerm();
}

document.querySelector("#course-year").addEventListener("change", (event) => {
  changeSelectedTerm(Number(event.target.value), selectedCourseTerm);
});
document.querySelector("#course-term").addEventListener("change", (event) => {
  changeSelectedTerm(selectedCourseYear, Number(event.target.value));
});
document.querySelector("#grade-term-select").addEventListener("change", (event) => {
  const [year, term] = event.target.value.split(":").map(Number);
  changeSelectedTerm(year, term);
});
document.querySelector("[data-open-course]").addEventListener("click", () => {
  openCourseDialog();
});
document.querySelector("[data-add-course-time]").addEventListener("click", () => addCourseTimeRow());
document.querySelector("#course-form").addEventListener("submit", submitCourse);

document.querySelectorAll("[data-focus-app]").forEach((input) => {
  input.addEventListener("change", () => {
    if (timerState.running) pollTimerStatus();
  });
});

document.querySelector("[data-open-timer-course-editor]").addEventListener("click", openTimerCourseEditor);
document.querySelector("#timer-course-add-form").addEventListener("submit", addTimerCourse);

document.querySelectorAll("[data-open-todo]").forEach((button) => {
  button.addEventListener("click", () => openTodoDialog());
});
document.querySelector("#home-add-todo").addEventListener("click", () => {
  selectedDate = new Date();
  selectedDate.setHours(0, 0, 0, 0);
  openTodoDialog();
});
document.querySelector("#todo-form").addEventListener("submit", submitTodo);
document.querySelector("#todo-date-start").addEventListener("change", (event) => {
  const endDate = document.querySelector("#todo-date-end");
  endDate.min = event.target.value;
  if (endDate.value && endDate.value < event.target.value) endDate.value = event.target.value;
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`).close());
});
document.querySelector("#chat-form").addEventListener("submit", submitChatMessage);
document.querySelector("#star-chat-form").addEventListener("submit", (event) => submitStarChat(event));
document.querySelectorAll("[data-star-prompt]").forEach((button) => {
  button.addEventListener("click", (event) => submitStarChat(event, button.dataset.starPrompt));
});

initializeTermControls();
renderCalendars();
renderTimerState();
