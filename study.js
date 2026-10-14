/* Study tools: import, scheduling, review sessions, and browser-local PDF storage. */
function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function boundedNumber(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function validTimer(timer) {
  return timer && Number.isFinite(timer.end) && boundedNumber(timer.minutes, 1, 240);
}
function validCard(card) {
  return card && typeof card.id === "string" && typeof card.front === "string" &&
    typeof card.back === "string" && card.front.trim() && card.back.trim() &&
    card.front.length <= 2000 && card.back.length <= 5000 &&
    /^\d{4}-\d{2}-\d{2}$/.test(card.due) && boundedNumber(card.interval, 0, 365) !== null;
}

// Import plain text only: imported markup is displayed literally, never executed.
function parseFlashcards(text, filename) {
  let pairs;
  if (filename.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("JSON must be an array of front/back objects.");
    pairs = data.map((card) => [card?.front, card?.back]);
  } else {
    let separator = "\t";
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const directive = lines.find((line) => /^#separator:/i.test(line));
    if (directive) {
      const name = directive.slice(directive.indexOf(":") + 1).trim().toLowerCase();
      if (name === "semicolon") separator = ";";
      else if (name !== "tab") throw new Error("Export using Tab or Semicolon separators.");
    }
    pairs = lines.filter((line) => line.trim() && !line.startsWith("#")).map((line, i) => {
      const fields = line.split(separator);
      if (fields.length < 2) throw new Error(`Card ${i + 1} needs a question and answer separated by a tab.`);
      // A third Anki tags column is permitted and intentionally ignored.
      return fields.slice(0, 2);
    });
  }
  if (!pairs.length) throw new Error("This file contains no flashcards.");
  if (pairs.length > 2000) throw new Error("Import at most 2,000 cards at a time.");
  return pairs.map(([front, back], i) => {
    if (typeof front !== "string" || typeof back !== "string" || !front.trim() || !back.trim()) {
      throw new Error(`Card ${i + 1} needs non-empty question and answer text.`);
    }
    if (front.length > 2000 || back.length > 5000) throw new Error(`Card ${i + 1} is too long.`);
    return { front: front.trim(), back: back.trim() };
  });
}

// A transparent interval rule: Again = 1 day, Good = double, Easy = triple.
function scheduledReview(card, rating, now = new Date()) {
  if (!["again", "good", "easy"].includes(rating)) throw new Error("Unknown rating");
  const current = card.interval || 0;
  const interval = rating === "again" ? 1 : rating === "good" ? Math.max(1, current * 2) : Math.max(3, current * 3);
  const capped = Math.min(365, interval);
  return { interval: capped, due: dayKey(addDays(now, capped)) };
}

let reviewSession = null;
let practiceUrl = null;
let practiceReady = false;
let practiceUploading = false;
let practiceCredited = false;
let practiceLoading = null;
const el = (id) => document.getElementById(id);

function showToolError(id, message) { el(id).textContent = message; }

function cardDeckName(card) { return typeof card.deck === "string" && card.deck.trim() ? card.deck.trim().slice(0, 60) : "General"; }
function newCardDeck() { return el("card-deck-name").value.trim().slice(0, 60) || "General"; }
function selectedDeckCards() { return state.cards.filter((card) => !el("review-deck").value || cardDeckName(card) === el("review-deck").value); }
function compareDeckCards(a, b) {
  return el("card-sort").value === "question" ? a.front.localeCompare(b.front) : a.due.localeCompare(b.due) || a.front.localeCompare(b.front);
}
function renderDeck() {
  const selected = el("review-deck").value;
  const names = [...new Set(state.cards.map(cardDeckName))].sort((a,b)=>a.localeCompare(b));
  const option = (value, label) => { const node=document.createElement("option");node.value=value;node.textContent=label;return node; };
  el("review-deck").replaceChildren(option("", "All decks"), ...names.map((name)=>option(name,name)));
  el("review-deck").value = names.includes(selected) ? selected : "";
  el("card-deck-names").replaceChildren(...names.map((name)=>option(name,name)));
  const cards=selectedDeckCards();
  const due=cards.filter((card)=>card.due<=dayKey(new Date())).length;
  el("deck-summary").textContent=`${cards.length} cards · ${due} due today · ${names.length} decks`;
  el("start-review").disabled=cards.length===0;
  const groups=names.filter((name)=>cards.some((card)=>cardDeckName(card)===name)).map((name)=>{
    const group=document.createElement("section");group.className="flashcard-deck";
    const members=cards.filter((card)=>cardDeckName(card)===name).sort(compareDeckCards);
    const heading=document.createElement("h3");heading.textContent=`${name} (${members.length})`;group.appendChild(heading);
    members.forEach((card)=>{
      const row=document.createElement("div");row.className="library-card";
      const text=document.createElement("p");text.textContent=`${card.front} — next review ${card.due}`;
      const move=document.createElement("input");move.type="text";move.value=cardDeckName(card);move.maxLength=60;
      move.setAttribute("list","card-deck-names");move.setAttribute("aria-label",`Deck for: ${card.front}`);
      move.addEventListener("change",()=>{
        if(!move.value.trim()){move.value=cardDeckName(card);return;}
        card.deck=move.value.trim();saveState(state);renderDeck();
      });
      const remove=document.createElement("button");remove.type="button";remove.className="ghost small";remove.textContent="Delete";
      remove.setAttribute("aria-label",`Delete card: ${card.front}`);
      remove.addEventListener("click",()=>{state.cards=state.cards.filter((item)=>item.id!==card.id);saveState(state);renderDeck();});
      row.append(text,move,remove);group.appendChild(row);
    });return group;
  });
  el("card-library").replaceChildren(...groups);
}

function openFlashcards() {
  el("deck-setup").hidden = !!reviewSession;
  el("review-session").hidden = !reviewSession;
  renderDeck();
  selectStudyTab("flashcards");
}

async function importCards(file) {
  if (!file) return;
  showToolError("card-error", "");
  try {
    if (!/\.(tsv|txt|json)$/i.test(file.name)) throw new Error("Choose a .tsv, .txt or .json file.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose a flashcard file smaller than 5 MB.");
    const pairs = parseFlashcards(await file.text(), file.name);
    const deck = newCardDeck();
    const existing = new Set(state.cards.map((card) => JSON.stringify([cardDeckName(card), card.front, card.back])));
    let added = 0;
    for (const pair of pairs) {
      const key = JSON.stringify([deck, pair.front, pair.back]);
      if (existing.has(key)) continue;
      existing.add(key);
      state.cards.push({ id: newId(), ...pair, deck, interval: 0, due: dayKey(new Date()) });
      added++;
    }
    saveState(state); renderDeck();
    showToast(`${added} cards imported · ${pairs.length - added} duplicates skipped`);
  } catch (error) { showToolError("card-error", error.message); }
  el("card-file").value = "";
}

function startReview() {
  const input = el("review-amount");
  if (!input.reportValidity()) return;
  const today = dayKey(new Date());
  const candidates = selectedDeckCards().filter((card) => el("review-mode").value === "all" || card.due <= today)
    .sort(compareDeckCards);
  if (!candidates.length) { showToolError("card-error", "No cards are due. Choose All cards for extra practice."); return; }
  const count = Math.min(Number(input.value), candidates.length);
  reviewSession = { ids: candidates.slice(0, count).map((card) => card.id), index: 0, started: Date.now(), revealed: false };
  showToolError("card-error", "");
  el("deck-setup").hidden = true;
  el("review-session").hidden = false;
  showReviewCard();
}

function showReviewCard() {
  const card = state.cards.find((item) => item.id === reviewSession.ids[reviewSession.index]);
  reviewSession.revealed = false;
  el("review-progress").textContent = `Card ${reviewSession.index + 1} of ${reviewSession.ids.length}`;
  el("review-front").textContent = card.front;
  el("review-back").textContent = card.back;
  el("review-back").hidden = true;
  el("review-ratings").hidden = true;
  el("reveal-answer").hidden = false;
  el("reveal-answer").focus();
}

function rateCard(rating) {
  if (!reviewSession || !reviewSession.revealed) return;
  const card = state.cards.find((item) => item.id === reviewSession.ids[reviewSession.index]);
  Object.assign(card, scheduledReview(card, rating));
  saveState(state);
  reviewSession.index++;
  if (reviewSession.index < reviewSession.ids.length) { showReviewCard(); return; }
  const count = reviewSession.ids.length;
  const minutes = Math.max(1, Math.round((Date.now() - reviewSession.started) / 60000));
  reviewSession = null;
  el("review-session").hidden = true;
  el("deck-setup").hidden = false;
  renderDeck();
  logActivity(new Date(), minutes, null);
  el("deck-summary").textContent += ` · Finished ${count} cards!`;
  el("start-review").focus();
}

// PDFs are binary files: IndexedDB stores the Blob instead of squeezing it into localStorage.
function pdfDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("quest-log-files", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
      if (!request.result.objectStoreNames.contains("notes")) request.result.createObjectStore("notes", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function pdfStore(operation, value) {
  const db = await pdfDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("files", operation === "get" ? "readonly" : "readwrite");
      const store = transaction.objectStore("files");
      const request = operation === "get" ? store.get("practice") : store.put(value, "practice");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Storage transaction aborted"));
    });
  } finally { db.close(); }
}

function displayPdf(record, restoreTimer = false) {
  if (practiceUrl) URL.revokeObjectURL(practiceUrl);
  practiceUrl = URL.createObjectURL(record.blob);
  el("pdf-open").href = practiceUrl;
  el("pdf-status").textContent = `Ready: ${record.name}`;
  el("pdf-workspace").hidden = false;
  practiceReady = true;
  restorePracticeClock(record, restoreTimer);
  updatePracticeButton();
  loadPaperReader(record);
}
function updatePracticeButton() {
  el("practice-completed").disabled = !practiceReady || practiceUploading || practiceCredited;
  el("practice-completed").textContent = practiceCredited ? "Completed ✓" : "Completed";
}

async function openPractice() {
  selectStudyTab("papers");
  if (practiceReady || practiceUploading) return;
  if (practiceLoading) return practiceLoading;
  el("pdf-status").textContent = "Checking for your saved PDF…";
  practiceLoading = (async () => {
    try {
      const saved = await pdfStore("get");
      if (practiceReady || practiceUploading) return;
      if (saved) displayPdf(saved, true);
      else el("pdf-status").textContent = "Choose a PDF to begin.";
    } catch { showToolError("pdf-error", "PDF storage is unavailable. You can still select a PDF for this visit."); }
    finally { practiceLoading = null; }
  })();
  return practiceLoading;
}

async function uploadPdf(file) {
  if (!file || practiceUploading) return;
  practiceUploading = true;
  updatePracticeButton();
  showToolError("pdf-error", "");
  try {
    if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("Choose a PDF file.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose a PDF smaller than 20 MB.");
    const signature = await file.slice(0, 1024).text();
    if (!signature.includes("%PDF-")) throw new Error("This file does not appear to be a valid PDF.");
    const record = { name: file.name, blob: new Blob([file], { type: "application/pdf" }) };
    try { await pdfStore("put", record); }
    catch { showToolError("pdf-error", "This PDF is open for this visit but could not be saved. Select it again after reloading."); }
    displayPdf(record);
  } catch (error) { showToolError("pdf-error", error.message); }
  finally {
    practiceUploading = false;
    updatePracticeButton();
    el("practice-file").value = "";
  }
}

function dropTarget(id, handler) {
  const target = el(id);
  target.addEventListener("dragover", (event) => { event.preventDefault(); target.classList.add("dragging"); });
  target.addEventListener("dragleave", () => target.classList.remove("dragging"));
  target.addEventListener("drop", (event) => {
    event.preventDefault(); target.classList.remove("dragging");
    handler(event.dataTransfer.files[0]);
  });
}

function initStudyTools() {
  initMaterials();
  initPracticeClock();
  el("review-deck").addEventListener("change", renderDeck);
  el("card-sort").addEventListener("change", renderDeck);
  el("close-flashcards").addEventListener("click", () => selectStudyTab("dashboard"));
  el("close-practice").addEventListener("click", () => selectStudyTab("dashboard"));
  el("card-file").addEventListener("change", (event) => importCards(event.target.files[0]));
  el("practice-file").addEventListener("change", (event) => uploadPdf(event.target.files[0]));
  dropTarget("card-drop", importCards);
  dropTarget("pdf-drop", uploadPdf);
  el("card-add-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const front = el("card-front").value.trim(), back = el("card-back").value.trim();
    if (!front || !back) { showToolError("card-error", "Enter both a question and an answer."); return; }
    state.cards.push({ id: newId(), front, back, deck: newCardDeck(), interval: 0, due: dayKey(new Date()) });
    saveState(state); event.target.reset(); renderDeck(); showToolError("card-error", "");
  });
  el("start-review").addEventListener("click", startReview);
  el("reveal-answer").addEventListener("click", () => {
    if (!reviewSession) return;
    reviewSession.revealed = true;
    el("review-back").hidden = false;
    el("review-ratings").hidden = false;
    el("reveal-answer").hidden = true;
    el("review-ratings").querySelector("button").focus();
  });
  document.querySelectorAll("[data-rating]").forEach((button) => button.addEventListener("click", () => rateCard(button.dataset.rating)));
  el("practice-completed").addEventListener("click", () => {
    if (!practiceReady || practiceUploading || practiceCredited) return;
    if (practiceElapsed() <= 0) { showToast("Start the past paper timer before completing your practice."); return; }
    pausePracticeClock();
    const studiedMinutes = Math.max(1, Math.round(practiceClock.elapsed / 60000));
    practiceCredited = true;
    practiceClock.completed = true;
    persistPracticeClock();
    renderPracticeClock();
    logActivity(new Date(), studiedMinutes, null);
    updatePracticeButton();
    el("pdf-status").textContent = "Practice completed. Your study time has been logged.";
  });
}


/* Past-paper stopwatch: timestamps measure time, callbacks only refresh the display. */
let practiceClock = { key: "", elapsed: 0, startedAt: 0, completed: false };
const PRACTICE_CLOCK_KEY = "study-seeker-practice-timer";
function practiceElapsed() {
  return practiceClock.elapsed + (practiceClock.startedAt ? Math.max(0, Date.now() - practiceClock.startedAt) : 0);
}
function persistPracticeClock() {
  try { localStorage.setItem(PRACTICE_CLOCK_KEY, JSON.stringify(practiceClock)); }
  catch { showToast("The practice timer could not be saved for reloads."); }
}
function restorePracticeClock(record, restore) {
  const key = `${record.name}:${record.blob.size}`;
  practiceClock = { key, elapsed: 0, startedAt: 0, completed: false };
  if (restore) {
    try {
      const saved = JSON.parse(localStorage.getItem(PRACTICE_CLOCK_KEY));
      if (saved?.key === key && Number.isFinite(saved.elapsed) && saved.elapsed >= 0 &&
          Number.isFinite(saved.startedAt) && saved.startedAt >= 0 && typeof saved.completed === "boolean") practiceClock = saved;
    } catch { /* Start a clean stopwatch if saved data is invalid. */ }
  }
  practiceCredited = practiceClock.completed;
  persistPracticeClock(); renderPracticeClock();
}
function pausePracticeClock() {
  practiceClock.elapsed = practiceElapsed(); practiceClock.startedAt = 0;
  persistPracticeClock(); renderPracticeClock();
}
function renderPracticeClock() {
  const seconds = Math.floor(practiceElapsed() / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  el("practice-clock").textContent = hours ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
  el("practice-clock-start").textContent = practiceClock.startedAt ? "Pause" : practiceClock.elapsed ? "Resume" : "Start timer";
  el("practice-clock-start").disabled = !practiceReady || practiceUploading || practiceCredited;
  el("practice-clock-reset").disabled = !practiceReady || practiceUploading || practiceCredited;
}
function initPracticeClock() {
  el("practice-clock-start").addEventListener("click", () => {
    if (!practiceReady || practiceUploading || practiceCredited) return;
    if (practiceClock.startedAt) pausePracticeClock();
    else { practiceClock.startedAt = Date.now(); persistPracticeClock(); renderPracticeClock(); }
  });
  el("practice-clock-reset").addEventListener("click", () => {
    if (!practiceReady || practiceUploading || practiceCredited) return;
    practiceClock.elapsed = 0; practiceClock.startedAt = 0;
    persistPracticeClock(); renderPracticeClock();
  });
  setInterval(renderPracticeClock, 500);
}
