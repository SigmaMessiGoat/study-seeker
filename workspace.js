/* Workspace navigation and lightweight synthesized sounds; no audio downloads. */
const studyTabs = [...document.querySelectorAll("[data-study-tab]")];
const studyPanels = { dashboard: "dashboard-panel", flashcards: "flashcard-dialog", papers: "practice-dialog", notes: "notes-panel", quests: "quests-panel" };
let activeStudyTab = "dashboard";
let studyAudio = null;
let studyMasterVolume = null;
let lastCompletionSound = -Infinity;
let studySoundsEnabled = true;
try { studySoundsEnabled = localStorage.getItem("study-seeker-sound") !== "off"; } catch { /* Use the visit's preference. */ }

function prepareStudyAudio() {
  if (!studySoundsEnabled) return;
  try {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    if (!studyAudio) {
      studyAudio = new Audio();
      studyMasterVolume = studyAudio.createGain();
      studyMasterVolume.connect(studyAudio.destination);
    }
    if (studyAudio.state === "suspended") studyAudio.resume().catch(() => {});
  } catch { /* Audio is optional; study actions must still work. */ }
}

function playStudySound(kind = "tap") {
  if (!studySoundsEnabled) return;
  prepareStudyAudio();
  if (!studyAudio || studyAudio.state !== "running") return;
  if (kind === "complete") {
    if (studyAudio.currentTime - lastCompletionSound < 0.1) return;
    lastCompletionSound = studyAudio.currentTime;
  }
  const notes = {
    tap: [440], reveal: [523, 659], start: [392, 523],
    complete: [523, 659, 784], timer: [659, 784, 1047, 784, 1047],
  }[kind] || [440];
  try {
    const start = studyAudio.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = studyAudio.createOscillator();
      const volume = studyAudio.createGain();
      const at = start + index * 0.14;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0, at);
      volume.gain.linearRampToValueAtTime(0.09, at + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
      oscillator.connect(volume); volume.connect(studyMasterVolume);
      oscillator.start(at); oscillator.stop(at + 0.14);
      oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
    });
  } catch { /* Muted or unsupported audio never interrupts the app. */ }
}

function updateSoundButton() {
  const button = document.getElementById("sound-toggle");
  button.textContent = studySoundsEnabled ? "Sound on" : "Sound off";
  button.setAttribute("aria-pressed", String(studySoundsEnabled));
  button.setAttribute("aria-label", studySoundsEnabled ? "Mute sound effects" : "Enable sound effects");
}

function selectStudyTab(name) {
  if (!studyPanels[name]) return;
  activeStudyTab = name;
  for (const [key, id] of Object.entries(studyPanels)) document.getElementById(id).hidden = key !== name;
  for (const button of studyTabs) {
    const selected = button.dataset.studyTab === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function activateStudyTab(name) {
  if (name === "flashcards") openFlashcards();
  else if (name === "papers") openPractice();
  else if (name === "notes") openNotes();
  else selectStudyTab(name);
}

studyTabs.forEach((button, index) => {
  button.addEventListener("click", () => activateStudyTab(button.dataset.studyTab));
  button.addEventListener("keydown", (event) => {
    const next = event.key === "ArrowRight" ? (index + 1) % studyTabs.length :
      event.key === "ArrowLeft" ? (index - 1 + studyTabs.length) % studyTabs.length :
      event.key === "Home" ? 0 : event.key === "End" ? studyTabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    studyTabs[next].focus();
    activateStudyTab(studyTabs[next].dataset.studyTab);
  });
});
// Unlock audio from a user gesture so a later timer completion can play a chime.
document.addEventListener("pointerdown", prepareStudyAudio, { capture: true });
document.addEventListener("keydown", prepareStudyAudio, { capture: true });
document.getElementById("sound-toggle").addEventListener("click", () => {
  studySoundsEnabled = !studySoundsEnabled;
  if (studyMasterVolume) studyMasterVolume.gain.setValueAtTime(studySoundsEnabled ? 1 : 0, studyAudio.currentTime);
  try { localStorage.setItem("study-seeker-sound", studySoundsEnabled ? "on" : "off"); } catch { /* Keep the visit's setting. */ }
  updateSoundButton();
  if (studySoundsEnabled) playStudySound("tap");
});
updateSoundButton();
selectStudyTab("dashboard");


const questTabs = [...document.querySelectorAll("[data-quest-tab]")];
function selectQuestTab(name) {
  if (!["active", "completed"].includes(name)) return;
  document.getElementById("quest-active-panel").hidden = name !== "active";
  document.getElementById("quest-completed-panel").hidden = name !== "completed";
  questTabs.forEach((button) => {
    const selected = button.dataset.questTab === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}
questTabs.forEach((button, index) => {
  button.addEventListener("click", () => { selectQuestTab(button.dataset.questTab); });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    selectQuestTab(questTabs[next].dataset.questTab); questTabs[next].focus();
  });
});


// Delegation also covers buttons created later (quests, cards, notes, and emojis).
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("button");
  if (button && !button.disabled && button.id !== "sound-toggle") playStudySound("tap");
}, { capture: true });
