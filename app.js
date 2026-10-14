const STORAGE_KEY = "simple-quest-log";
const XP_PER_STAGE = 10;
const XP_PER_LEVEL = 50;
let resettingStudySeeker = false;
const XP_PER_ACTION = 10;
const GRACE_PER_MONTH = 2;
let storageWarning = "";

function emptyState() {
  return { cards: [], preferences: { focus: 25 }, timer: null, xp: 0, quests: [], habit: { target: 5, days: {}, grace: {} } };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.quests)) return emptyState();
    const habit = data.habit || {};
    return {
      cards: Array.isArray(data.cards) ? data.cards.filter(validCard) : [],
      preferences: { focus: boundedNumber(data.preferences?.focus, 1, 240) || 25 },
      timer: validTimer(data.timer) ? data.timer : null,
      xp: Number.isFinite(data.xp) && data.xp >= 0 ? data.xp : 0,
      quests: data.quests.filter((q) => q && typeof q.id === "string" && typeof q.title === "string" &&
        ["active", "done"].includes(q.status) && Array.isArray(q.stages) && q.stages.length > 0 &&
        q.stages.every((s) => s && ["string", "number"].includes(typeof s.id) && typeof s.name === "string" && typeof s.done === "boolean")),
      habit: {
        target: boundedNumber(habit.target, 1, 7) || 5,
        days: habit.days && typeof habit.days === "object" && !Array.isArray(habit.days) ? habit.days : {},
        grace: habit.grace && typeof habit.grace === "object" && !Array.isArray(habit.grace) ? habit.grace : {},
      },
    };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageWarning = "";
  } catch {
    storageWarning = "Changes could not be saved beyond this visit.";
    showToast("Browser storage unavailable or full.");
  }
}

function levelFromXp(xp) {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

function questReward(quest) {
  if (quest.status === "done") return Number.isFinite(quest.awardedXp) ? quest.awardedXp : 30;
  return quest.stages.length * XP_PER_STAGE;
}
function levelProgress(xp) {
  return { current: xp % XP_PER_LEVEL, needed: XP_PER_LEVEL };
}

/* ---------- date helpers (local time) ---------- */

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKeyOf(d) {
  return dayKey(d).slice(0, 7);
}

function startOfWeek(d) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const weekday = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

function addDays(d, n) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + n);
  return copy;
}

/* ---------- habit store ---------- */

function getDay(key) {
  return state.habit.days[key] || null;
}

function ensureDay(key) {
  if (!state.habit.days[key]) {
    state.habit.days[key] = { minutes: 0, focus: false, review: false, practice: false, grace: false };
  }
  return state.habit.days[key];
}

function dayIsActive(rec) {
  if (!rec) return false;
  return rec.grace || rec.focus || rec.review || rec.practice || rec.minutes > 0;
}

function graceUsedInMonth(key) {
  return state.habit.grace[key] || 0;
}

/**
 * Log study activity for a day. habitFlag is the auto-completed habit name
 * ("focus" | "review" | "practice"); the first time it lands on a day the
 * daily habit counts as complete — never a manual checkbox.
 */
function logActivity(date, minutes, habitFlag) {
  const key = dayKey(date);
  const rec = ensureDay(key);
  rec.minutes += minutes;
  let firstTime = false;
  if (habitFlag && !rec[habitFlag]) {
    rec[habitFlag] = true;
    firstTime = true;
  }
  state.xp += XP_PER_ACTION;
  saveState(state);
  render();
  globalThis.playStudySound?.(habitFlag === "focus" ? "timer" : "complete");
  if (firstTime) {
    const label = { focus: "Daily Focus", review: "Daily Review", practice: "Daily Practice" }[habitFlag];
    showToast(`${label} complete · +${XP_PER_ACTION} XP`);
  } else {
    showToast(`+${XP_PER_ACTION} XP · ${minutes} min logged`);
  }
  return firstTime;
}

function useGraceDay(key) {
  const d = new Date(`${key}T00:00:00`);
  const today = new Date();
  if (Number.isNaN(d.getTime()) || key >= dayKey(today)) return; // no covering the future
  if (dayIsActive(getDay(key))) return; // nothing missed
  const mk = key.slice(0, 7);
  if (graceUsedInMonth(mk) >= GRACE_PER_MONTH) {
    showToast("No grace days left this month");
    return;
  }
  state.habit.grace[mk] = graceUsedInMonth(mk) + 1;
  ensureDay(key).grace = true;
  saveState(state);
  render();
  showToast("Grace day applied ❄ · counts toward your goal");
}

/* ---------- pre-set action templates ---------- */

let timerEnd = 0;
let timerTick = null;
let timerMinutes = 25;
let focusNotification = null;
let focusNotificationRegistration = null;
let focusNotificationTag = null;
let requestingFocusPermission = false;
let focusNotificationUnavailable = false;
const originalPageTitle = document.title;

function supportsFocusNotifications() {
  return typeof Notification === "function" && globalThis.isSecureContext !== false;
}

function updateFocusNotificationStatus() {
  const button = document.getElementById("focus-notifications");
  const status = document.getElementById("focus-notification-status");
  const test = document.getElementById("focus-notification-test");
  test.disabled = !supportsFocusNotifications() || Notification.permission !== "granted";
  if (!supportsFocusNotifications()) {
    button.hidden = true;
    status.textContent = "A completion alert will appear here. Desktop notifications are unavailable on this page.";
    return;
  }
  button.hidden = Notification.permission === "granted";
  button.disabled = requestingFocusPermission || Notification.permission !== "default";
  button.textContent = requestingFocusPermission ? "Waiting for permission…" :
    Notification.permission === "granted" ? "Notifications enabled" :
    Notification.permission === "denied" ? "Notifications blocked" : "Enable notifications";
  status.textContent = focusNotificationUnavailable ? "Desktop alert unavailable. Your completion alert will still appear here." :
    Notification.permission === "granted" ? "You'll get a desktop alert when focus ends. Keep this page open." :
    Notification.permission === "denied" ? "Allow notifications in your browser's site settings, or use the completion alert here." :
    "Enable desktop alerts to know when focus ends, even in another tab.";
}

// Browsers require notification permission requests to follow a user click.
async function requestFocusNotifications() {
  if (!supportsFocusNotifications() || requestingFocusPermission || Notification.permission !== "default") return;
  requestingFocusPermission = true;
  focusNotificationUnavailable = false;
  updateFocusNotificationStatus();
  try {
    await Notification.requestPermission();
  } catch {
    focusNotificationUnavailable = true;
  } finally {
    requestingFocusPermission = false;
    updateFocusNotificationStatus();
  }
}

function dismissFocusCompletion() {
  document.getElementById("focus-completion").hidden = true;
  document.title = originalPageTitle;
  if (focusNotificationRegistration && focusNotificationTag) {
    focusNotificationRegistration.getNotifications({tag:focusNotificationTag}).then((items)=>items.forEach((item)=>item.close())).catch(()=>{});
  }
  if (focusNotification) {
    try { focusNotification.close(); } catch { /* The on-page alert still works. */ }
    focusNotification = null;
  }
}

function announceFocusCompletion(minutes, finishedAt) {
  const message = `${minutes} ${minutes === 1 ? "minute" : "minutes"} of focus logged · +${XP_PER_ACTION} XP. Time for a break!`;
  document.getElementById("focus-completion-message").textContent = message;
  document.getElementById("focus-completion").hidden = false;
  document.title = `Focus complete — ${originalPageTitle}`;
  void sendFocusDesktopNotification(message, finishedAt);
}

async function sendFocusDesktopNotification(message, finishedAt, isTest = false) {
  if (!supportsFocusNotifications() || Notification.permission !== "granted") return;
  const title = isTest ? "Study Seeker · Test alert" : "Study Seeker · Focus session complete";
  const tag = isTest ? "study-seeker-test" : `study-seeker-focus-${finishedAt.getTime()}`;
  if (!isTest) focusNotificationTag = tag;
  const options = {body:message,tag,requireInteraction:true,data:{url:globalThis.location?.href}};
  if (focusNotificationRegistration) {
    try { await focusNotificationRegistration.showNotification(title, options); return; }
    catch { /* Fall back to page notifications when persistent notifications fail. */ }
  }
  try {
    const notification = new Notification(title, options);
    focusNotification = notification;
    notification.onclick = () => {
      globalThis.focus();
      document.getElementById("focus-completion").scrollIntoView({ block: "center" });
      try { notification.close(); } catch { /* Keep the completion message visible. */ }
    };
    notification.onerror = () => {
      focusNotificationUnavailable = true;
      updateFocusNotificationStatus();
    };
  } catch {
    focusNotificationUnavailable = true;
    updateFocusNotificationStatus();
  }
}

function isRunning() {
  return timerEnd > 0;
}

function startTimer() {
  if (isRunning()) return;
  const input = document.getElementById("focus-minutes");
  if (!input.reportValidity()) return;
  dismissFocusCompletion();
  if (supportsFocusNotifications() && Notification.permission === "default") void requestFocusNotifications();
  timerMinutes = Number(input.value);
  state.preferences.focus = timerMinutes;
  timerEnd = Date.now() + timerMinutes * 60 * 1000;
  state.timer = { end: timerEnd, minutes: timerMinutes };
  saveState(state);
  updateTimerUI();
  timerTick = setInterval(updateTimerUI, 250);
}

function cancelTimer() {
  clearInterval(timerTick);
  timerTick = null;
  timerEnd = 0;
  state.timer = null;
  saveState(state);
  render();
}

/** Session finished: auto-marks "Daily Focus" — no checklist involved. */
function finishTimer() {
  if (!isRunning()) return;
  clearInterval(timerTick);
  timerTick = null;
  const finishedAt = new Date(timerEnd);
  timerEnd = 0;
  state.timer = null;
  logActivity(finishedAt, timerMinutes, "focus");
  announceFocusCompletion(timerMinutes, finishedAt);
}

function updateTimerUI() {
  if (resettingStudySeeker) return;
  const remaining = timerEnd - Date.now();
  if (remaining <= 0) {
    finishTimer();
    return;
  }
  const totalSec = Math.ceil(remaining / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const btn = document.getElementById("timer-btn");
  const count = document.getElementById("timer-count");
  const cancel = document.getElementById("timer-cancel");
  btn.hidden = true;
  count.hidden = false;
  cancel.hidden = false;
  count.textContent = `${mm}:${ss}`;
}

function completeReview() {
  openFlashcards();
}

function completePractice() {
  openPractice();
}

/* ---------- weekly goal ---------- */

function weekDays() {
  const start = startOfWeek(new Date());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function goalStats() {
  const today = new Date();
  let done = 0;
  for (const d of weekDays()) {
    if (d > today) break;
    if (dayIsActive(getDay(dayKey(d)))) done++;
  }
  return done;
}

/* ---------- rendering ---------- */

const titleInput = document.getElementById("title");
const addForm = document.getElementById("add-form");
const activeList = document.getElementById("active-list");
const doneList = document.getElementById("done-list");
const activeEmpty = document.getElementById("active-empty");
const doneEmpty = document.getElementById("done-empty");
const levelEl = document.getElementById("level");
const xpEl = document.getElementById("xp");
const goalDoneEl = document.getElementById("goal-done");
const goalTotalEl = document.getElementById("goal-total");
const goalBarEl = document.getElementById("goal-bar");
const goalBadgeEl = document.getElementById("goal-badge");
const weekChipsEl = document.getElementById("week-chips");
const graceLeftEl = document.getElementById("grace-left");
const targetSelect = document.getElementById("target-days");
const heatmapEl = document.getElementById("heatmap");
const monthSummaryEl = document.getElementById("month-summary");
const toastEl = document.getElementById("toast");

let toastTimer = null;

function showToast(message) {
  toastEl.textContent = storageWarning ? `${message} ${storageWarning}` : message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2600);
}

function renderGoal() {
  const target = state.habit.target;
  goalTotalEl.textContent = String(target);
  targetSelect.value = String(target);

  const done = goalStats();
  goalDoneEl.textContent = String(done);
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  goalBarEl.style.width = `${pct}%`;
  goalBadgeEl.hidden = done < target;

  const today = new Date();
  const letters = ["M", "T", "W", "T", "F", "S", "S"];
  const chips = weekDays().map((d, i) => {
    const key = dayKey(d);
    const rec = getDay(key);
    const chip = document.createElement(d > today ? "span" : "button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = letters[i];

    const mark = document.createElement("i");
    if (rec && rec.grace && !dayIsActive({ ...rec, grace: false })) {
      chip.classList.add("grace");
      mark.textContent = "❄";
    } else if (dayIsActive(rec)) {
      chip.classList.add("done");
      mark.textContent = "✓";
    } else if (key < dayKey(today)) {
      const mk = key.slice(0, 7);
      const canFreeze = graceUsedInMonth(mk) < GRACE_PER_MONTH;
      chip.classList.add("missed");
      mark.textContent = canFreeze ? "❄" : "–";
      chip.title = canFreeze ? "Missed — click to cover with a grace day" : "Missed";
      chip.addEventListener("click", () => useGraceDay(key));
    } else if (key === dayKey(today)) {
      chip.classList.add("today");
      mark.textContent = "•";
      chip.title = "Today — study to check this off";
    } else {
      chip.classList.add("future");
      mark.textContent = "·";
    }
    if (key === dayKey(today)) chip.classList.add("today");

    chip.appendChild(mark);
    return chip;
  });
  weekChipsEl.replaceChildren(...chips);

  const mk = monthKeyOf(today);
  graceLeftEl.textContent = String(Math.max(0, GRACE_PER_MONTH - graceUsedInMonth(mk)));
}

function intensityLevel(minutes) {
  if (minutes <= 0) return 0;
  if (minutes < 25) return 1;
  if (minutes < 50) return 2;
  if (minutes < 75) return 3;
  return 4;
}

function renderHeatmap() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  heatmapEl.setAttribute("aria-label", `${monthNames[month]} ${year} activity grid`);

  const cells = [];
  let minutesTotal = 0;
  let activeDays = 0;

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - offset + 1;
    const cell = document.createElement("i");
    cell.className = "cell";
    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.classList.add("blank");
      cells.push(cell);
      continue;
    }
    const d = new Date(year, month, dayNum);
    const rec = getDay(dayKey(d));
    const minutes = rec ? rec.minutes : 0;
    if (dayIsActive(rec)) activeDays++;
    minutesTotal += minutes;

    if (rec && rec.grace && minutes === 0) {
      cell.classList.add("grace");
    } else if (d > now) {
      cell.classList.add("future");
    } else {
      cell.classList.add(`l${intensityLevel(minutes)}`);
    }
    cell.title = `${monthNames[month].slice(0, 3)} ${dayNum}${minutes ? ` · ${minutes} min` : " · no study"}`;
    cells.push(cell);
  }

  heatmapEl.replaceChildren(...cells);
  const hours = Math.floor(minutesTotal / 60);
  const mins = minutesTotal % 60;
  const duration = hours ? `${hours}h ${mins}m` : `${mins}m`;
  monthSummaryEl.textContent = minutesTotal
    ? `${duration} studied · ${activeDays} active ${activeDays === 1 ? "day" : "days"}`
    : "No sessions logged yet this month";
}

function renderActions() {
  const rec = getDay(dayKey(new Date()));
  const set = (id, done) => {
    const card = document.getElementById(id);
    card.classList.toggle("is-done", done);
    card.querySelector(".action-done").hidden = !done;
  };
  set("action-focus", !!(rec && rec.focus));
  document.getElementById("action-review").classList.remove("is-done");
  document.getElementById("action-practice").classList.remove("is-done");

  document.getElementById("flashcard-btn").disabled = false;
  document.getElementById("practice-btn").disabled = false;

  const running = isRunning();
  const btn = document.getElementById("timer-btn");
  const count = document.getElementById("timer-count");
  const cancel = document.getElementById("timer-cancel");
  document.getElementById("focus-minutes").disabled = running;
  if (!running) {
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = rec && rec.focus ? "Start another session" : "Start focus timer";
    count.hidden = true;
    cancel.hidden = true;
  }
}

/* ---------- quests (existing tracker) ---------- */

function makeStages(title) {
  const t = title.toLowerCase();
  let names;
  if (t.includes("study") || t.includes("homework") || t.includes("math")) {
    names = ["Gather notes", "Do the work", "Recap what you learned"];
  } else if (t.includes("clean") || t.includes("tidy") || t.includes("room")) {
    names = ["Get supplies", "Clean", "Put things back"];
  } else if (t.includes("gym") || t.includes("run") || t.includes("exercise")) {
    names = ["Warm up", "Main exercise", "Cool down"];
  } else {
    names = ["Prepare", "Do it", "Finish"];
  }
  return names.map((name, i) => ({ id: i, name, done: false }));
}

function createQuest(title) {
  return {
    id: newId(),
    title: title.trim(),
    stages: makeStages(title),
    status: "active",
  };
}

function allStagesDone(quest) {
  return quest.stages.length > 0 && quest.stages.every((s) => s.done);
}

let state = loadState();

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  state.quests.unshift(createQuest(title));
  selectQuestTab("active");
  titleInput.value = "";
  saveState(state);
  render();
});

targetSelect.addEventListener("change", () => {
  state.habit.target = Number(targetSelect.value) || 5;
  saveState(state);
  render();
});

document.getElementById("timer-btn").addEventListener("click", startTimer);
document.getElementById("timer-cancel").addEventListener("click", cancelTimer);
document.getElementById("focus-notifications").addEventListener("click", requestFocusNotifications);
document.getElementById("dismiss-focus-completion").addEventListener("click", dismissFocusCompletion);
globalThis.addEventListener("focus", updateFocusNotificationStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    updateFocusNotificationStatus();
    if (isRunning()) updateTimerUI();
  }
});
document.getElementById("flashcard-btn").addEventListener("click", completeReview);
document.getElementById("practice-btn").addEventListener("click", completePractice);

function toggleStage(questId, stageId) {
  const quest = state.quests.find((q) => q.id === questId);
  if (!quest || quest.status !== "active") return;
  const stage = quest.stages.find((s) => s.id === stageId);
  if (!stage) return;
  stage.done = !stage.done;
  saveState(state);
  render();
}

function completeQuest(questId) {
  const quest = state.quests.find((q) => q.id === questId);
  if (!quest || quest.status !== "active") return;
  if (!allStagesDone(quest)) return;
  quest.awardedXp = questReward(quest);
  quest.status = "done";
  globalThis.playStudySound?.("complete");
  state.xp += quest.awardedXp;
  saveState(state);
  render();
}

function deleteQuest(questId) {
  state.quests = state.quests.filter((q) => q.id !== questId);
  saveState(state);
  render();
}

function renderQuest(quest) {
  const article = document.createElement("article");
  article.className = "quest";

  const heading = document.createElement("h3");
  heading.textContent = quest.title;
  if (quest.status === "done") {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `+${questReward(quest)} XP`;
    heading.appendChild(badge);
  }
  article.appendChild(heading);

  quest.stages.forEach((stage) => {
    const row = document.createElement("label");
    row.className = "stage";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = stage.done;
    box.setAttribute("aria-label", "Complete stage: " + stage.name);
    box.disabled = quest.status === "done";
    box.addEventListener("change", () => toggleStage(quest.id, stage.id));

    const text = document.createElement("span");
    text.textContent = stage.name;

    row.appendChild(box);
    row.appendChild(text);
    const stageLine = document.createElement("div");
    stageLine.className = "stage-line";
    stageLine.appendChild(row);
    if (quest.status === "active") {
      const edit = document.createElement("input");
      edit.type = "text";
      edit.value = stage.name;
      edit.maxLength = 80;
      edit.setAttribute("aria-label", "Edit stage: " + stage.name);
      edit.addEventListener("change", () => {
        const name = edit.value.trim();
        if (!name) { edit.value = stage.name; showToast("A stage needs a name"); return; }
        stage.name = name;
        text.textContent = name;
        box.setAttribute("aria-label", "Complete stage: " + name);
        saveState(state);
      });
      text.hidden = true;
      stageLine.appendChild(edit);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ghost small";
      remove.textContent = "Delete stage";
      remove.disabled = quest.stages.length <= 1;
      remove.addEventListener("click", () => {
        quest.stages = quest.stages.filter((s) => s.id !== stage.id);
        saveState(state); render();
      });
      stageLine.appendChild(remove);
    }
    article.appendChild(stageLine);
  });

  if (quest.status === "active") {
    const stageForm = document.createElement("form");
    stageForm.className = "row stage-add";
    const stageInput = document.createElement("input");
    stageInput.type = "text"; stageInput.required = true; stageInput.maxLength = 80;
    stageInput.placeholder = "New stage";
    stageInput.setAttribute("aria-label", "New stage for " + quest.title);
    const add = document.createElement("button");
    add.type = "submit"; add.className = "ghost small"; add.textContent = "Add stage";
    stageForm.append(stageInput, add);
    stageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = stageInput.value.trim();
      if (!name) return;
      quest.stages.push({ id: newId(), name, done: false });
      saveState(state); render();
    });
    article.appendChild(stageForm);
    const actions = document.createElement("div");
    actions.className = "actions";

    const completeBtn = document.createElement("button");
    completeBtn.type = "button";
    completeBtn.textContent = `Complete (+${questReward(quest)} XP)`;
    completeBtn.disabled = !allStagesDone(quest);
    completeBtn.addEventListener("click", () => completeQuest(quest.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteQuest(quest.id));

    actions.appendChild(completeBtn);
    actions.appendChild(deleteBtn);
    article.appendChild(actions);
  }

  return article;
}

function render() {
  levelEl.textContent = String(levelFromXp(state.xp));
  xpEl.textContent = String(state.xp);
  const progress = levelProgress(state.xp);
  document.getElementById("level-progress-text").textContent = `${progress.current}/${progress.needed} XP to level ${levelFromXp(state.xp) + 1}`;
  const bar = document.getElementById("level-progress");
  bar.value = progress.current; bar.max = progress.needed;

  renderGoal();
  renderActions();
  renderHeatmap();

  const active = state.quests.filter((q) => q.status === "active");
  const done = state.quests.filter((q) => q.status === "done");

  activeList.replaceChildren(...active.map(renderQuest));
  doneList.replaceChildren(...done.map(renderQuest));

  activeEmpty.hidden = active.length > 0;
  doneEmpty.hidden = done.length > 0;
}

document.getElementById("focus-minutes").value = state.preferences.focus;
initStudyTools();
updateFocusNotificationStatus();
render();
if (state.timer) {
  timerEnd = state.timer.end;
  timerMinutes = state.timer.minutes;
  updateTimerUI();
  if (isRunning()) timerTick = setInterval(updateTimerUI, 250);
}
let renderedDay = dayKey(new Date());
setInterval(() => {
  const current = dayKey(new Date());
  if (current !== renderedDay) { renderedDay = current; render(); }
}, 10000);

/* ---------- theme (light / dark) ---------- */

const THEME_KEY = "quest-log-theme";
const themeToggle = document.getElementById("theme-toggle");

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  const next = theme === "dark" ? "light" : "dark";
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", `Switch to ${next} theme`);
    themeToggle.setAttribute("title", `Switch to ${next} theme`);
  }
  const icon = document.getElementById("theme-icon");
  if (icon) icon.textContent = next === "dark" ? "dark_mode" : "light_mode";
  const label = document.getElementById("theme-label");
  if (label) label.textContent = next === "dark" ? "Dark" : "Light";
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* theme stays for this visit */ }
  }
}

if (themeToggle) {
  applyTheme(currentTheme(), false);
  themeToggle.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark", true);
  });
  // Only follow OS changes while the visitor has not picked a theme themselves.
  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch { savedTheme = null; }
  if (savedTheme !== "light" && savedTheme !== "dark") {
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", (event) => {
      applyTheme(event.matches ? "dark" : "light", false);
    });
  }
}


async function resetStudySeeker() {
  if (resettingStudySeeker || !globalThis.confirm("Reset Study Seeker? This permanently removes this browser's quests, flashcards, notes, PDFs, XP, timers, and preferences.")) return;
  resettingStudySeeker = true;
  const button = document.getElementById("reset-app");
  button.disabled = true; button.textContent = "Resetting…";
  document.querySelector("main").inert = true;
  let db;
  try {
    db = await pdfDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["files", "notes"], "readwrite");
      transaction.objectStore("files").clear(); transaction.objectStore("notes").clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    [STORAGE_KEY, "quest-log-theme", "study-seeker-sound", "study-seeker-practice-timer"].forEach((key) => localStorage.removeItem(key));
    clearInterval(timerTick);
    dismissFocusCompletion();
    globalThis.location.reload();
  } catch {
    showToast("Reset could not finish. Check browser storage permissions and try again.");
  } finally {
    db?.close();
    resettingStudySeeker = false; button.disabled = false; button.textContent = "Reset data";
    document.querySelector("main").inert = false;
  }
}
document.getElementById("reset-app").addEventListener("click", resetStudySeeker);


// Persistent notifications work on HTTPS/localhost; direct file opening uses the constructor fallback.
if (globalThis.navigator?.serviceWorker && globalThis.location?.protocol !== "file:" && globalThis.isSecureContext) {
  navigator.serviceWorker.register("./notification-worker.js").then(() => navigator.serviceWorker.ready).then((registration) => {
    focusNotificationRegistration = registration;
  }).catch(() => {});
}
document.getElementById("focus-notification-test").addEventListener("click", () => {
  void sendFocusDesktopNotification("Desktop alerts are enabled. You'll be notified when your focus session ends.", new Date(), true);
  showToast("Test alert requested. If nothing appears, check browser and system notification settings.");
});
