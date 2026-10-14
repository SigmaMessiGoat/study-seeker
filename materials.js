/* Local document library and explicit study-context snapshots for the AI. */
let notesLibrary = [];
let currentNote = null;
let noteUrl = null;
let pendingNoteFile = null;
let notesBusy = false;
let notesLoading = null;
let noteSelectionVersion = 0;
let currentPaperName = "Past paper";
let preparingStudyContext = false;
const materialElement = (id) => document.getElementById(id);

async function notesStore(operation, value) {
  const db = await pdfDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("notes", operation === "all" ? "readonly" : "readwrite");
      const store = transaction.objectStore("notes");
      const request = operation === "all" ? store.getAll() : operation === "put" ? store.put(value) : store.delete(value);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Saving notes was interrupted."));
    });
  } finally { db.close(); }
}

async function openNotes() {
  selectStudyTab("notes");
  if (notesLoading) return notesLoading;
  notesLoading = (async () => {
    try { notesLibrary = await notesStore("all"); renderNotes(); }
    catch { materialElement("notes-error").textContent = "Your notes library could not be loaded. Check browser storage permissions."; }
    finally { notesLoading = null; }
  })();
  return notesLoading;
}

function renderNotes() {
  const filter = materialElement("notes-filter"), selected = filter.value;
  const subjects = [...new Set(notesLibrary.map((note) => note.subject))].sort();
  const option = (value, text) => { const node = document.createElement("option"); node.value = value; node.textContent = text; return node; };
  filter.replaceChildren(option("", "All subjects"), ...subjects.map((subject) => option(subject, subject)));
  filter.value = subjects.includes(selected) ? selected : "";
  const visible = notesLibrary.filter((note) => !filter.value || note.subject === filter.value);
  const rows = visible.map((note) => {
    const row = document.createElement("article"); row.className = "note-card";
    const title = document.createElement("h3"); title.textContent = note.title;
    const detail = document.createElement("p"); detail.className = "hint"; detail.textContent = `${note.subject} · ${note.filename}`;
    const actions = document.createElement("div"); actions.className = "actions";
    const open = document.createElement("button"); open.type = "button"; open.textContent = "Open notes";
    open.addEventListener("click", () => showNote(note));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "ghost"; remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete notes: ${note.title}`);
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await notesStore("delete", note.id);
        notesLibrary = notesLibrary.filter((item) => item.id !== note.id);
        if (currentNote?.id === note.id) {
          noteSelectionVersion++; currentNote = null;
          if (noteUrl) URL.revokeObjectURL(noteUrl); noteUrl = null;
          materialElement("note-workspace").hidden = true;
        }
        renderNotes();
      } catch { remove.disabled = false; materialElement("notes-error").textContent = "This note could not be deleted."; }
    });
    actions.append(open, remove); row.append(title, detail, actions); return row;
  });
  if (!rows.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "No notes here yet. Upload a PDF or text file above."; rows.push(empty); }
  materialElement("notes-library").replaceChildren(...rows);
  materialElement("notes-status").textContent = `${notesLibrary.length} saved ${notesLibrary.length === 1 ? "note" : "notes"}`;
}

function selectNoteFile(file) {
  if (!file) return;
  pendingNoteFile = file;
  materialElement("notes-file-status").textContent = file.name;
  if (!materialElement("notes-title").value.trim()) materialElement("notes-title").value = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
}

async function saveNote(event) {
  event.preventDefault();
  if (notesBusy) return;
  const file = pendingNoteFile;
  const title = materialElement("notes-title").value.trim(), subject = materialElement("notes-subject").value.trim();
  materialElement("notes-error").textContent = "";
  if (!file || !title || !subject) { materialElement("notes-error").textContent = "Choose a file and enter its title and subject."; return; }
  notesBusy = true; materialElement("notes-save").disabled = true;
  try {
    if (!/\.(pdf|txt|md)$/i.test(file.name)) throw new Error("Choose PDF, TXT or MD notes.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose a file smaller than 20 MB.");
    const pdf = /\.pdf$/i.test(file.name);
    if (pdf && !(await file.slice(0, 1024).text()).includes("%PDF-")) throw new Error("This file does not have a valid PDF header.");
    if (!pdf && file.size > 300000) throw new Error("Text notes must be smaller than 300 KB.");
    const record = { id: newId(), title, subject, filename: file.name, type: pdf ? "pdf" : "text", blob: new Blob([file], {type:pdf ? "application/pdf" : "text/plain"}), created:Date.now() };
    await notesStore("put", record);
    notesLibrary = await notesStore("all");
    materialElement("notes-upload-form").reset(); pendingNoteFile = null;
    materialElement("notes-file-status").textContent = "";
    renderNotes(); await showNote(record); showToast("Notes saved");
  } catch (error) { materialElement("notes-error").textContent = error.message; }
  finally { notesBusy = false; materialElement("notes-save").disabled = false; }
}

async function showNote(note) {
  const version = ++noteSelectionVersion;
  currentNote = note;
  materialElement("note-workspace").hidden = false;
  materialElement("note-ai").disabled = true; materialElement("note-flashcards").disabled = true;
  materialElement("note-save-edits").disabled = true;
  materialElement("notes-error").textContent = "";
  materialElement("note-edit-title").value = note.title;
  materialElement("note-edit-subject").value = note.subject;
  if (noteUrl) URL.revokeObjectURL(noteUrl);
  noteUrl = URL.createObjectURL(note.blob);
  materialElement("note-open").href = noteUrl;
  materialElement("note-text-label").hidden = note.type !== "text";
  materialElement("note-fallback").hidden = true;
  materialElement("note-save-edits").hidden = note.type !== "pdf";
  try {
    if (note.type === "pdf") {
      materialElement("note-fallback").hidden = false;
      await noteDocumentViewer.open(note.blob, note.filename);
    }
    else {
      const text = await note.blob.text();
      if (version !== noteSelectionVersion) return;
      materialElement("note-text").textContent = text;
    }
    if (version === noteSelectionVersion) {
      materialElement("note-ai").disabled = false; materialElement("note-flashcards").disabled = false;
      materialElement("note-save-edits").disabled = note.type !== "pdf";
    }
  } catch {
    if (version !== noteSelectionVersion) return;
    materialElement("notes-error").textContent = "This PDF could not be read. Open the original file or attach a screenshot in the chat.";
    materialElement("note-fallback").hidden = true;
  }
}

async function loadPaperReader(record) {
  currentPaperName=record.name;paperDocumentRecord=record;
  materialElement("paper-ai").disabled=true;materialElement("paper-save-edits").disabled=true;
  materialElement("pdf-viewer").hidden=false;
  try {
    await paperDocumentViewer.open(record.blob,record.name);
    if(record!==paperDocumentRecord)return;
    materialElement("paper-ai").disabled=false;materialElement("paper-save-edits").disabled=false;
  }catch(error){materialElement("pdf-error").textContent=error.message;}
}

function getActiveStudyContext() {
  if (activeStudyTab === "flashcards") {
    if (!reviewSession) throw new Error("Start a flashcard review to attach its current question.");
    const card = state.cards.find((item) => item.id === reviewSession.ids[reviewSession.index]);
    // Don't reveal a hidden answer to the AI during hint mode.
    return { title: "Current flashcard", text: `Question: ${card.front}${reviewSession.revealed ? `\nRevealed answer: ${card.back}` : ""}`, image: null };
  }
  if (activeStudyTab === "papers") throw new Error("Use Ask AI to capture the visible PDF question.");
  if (activeStudyTab === "notes") {
    if (!currentNote) throw new Error("Open a note first.");
    if (currentNote.type === "pdf") throw new Error("Use Ask AI to capture the visible notes page.");
    return { title: `${currentNote.title} (${currentNote.subject})`, text: materialElement("note-text").textContent.slice(0,16000), image:null };
  }
  return { title:"Study dashboard", text:`Level: ${levelFromXp(state.xp)}. XP: ${state.xp}. Weekly target: ${state.habit.target} days.\nActive quests:\n${state.quests.filter((q)=>q.status==='active').slice(0,20).map((q)=>`${q.title}: ${q.stages.map((s)=>`${s.done?'Done':'Pending'} ${s.name}`).join('; ')}`).join('\n')}`.slice(0,16000), image:null };
}

async function attachStudyContext(prompt = "", mode = "help") {
  if(preparingStudyContext)return;
  preparingStudyContext=true;
  try {
    if(typeof globalThis.setStudyAIContext!=="function")throw new Error("The AI chat has not loaded yet.");
    const isPaper=activeStudyTab==='papers';
    const isNotePdf=activeStudyTab==='notes' && currentNote?.type==='pdf';
    const context=isPaper?await paperDocumentViewer.snapshot():isNotePdf?await noteDocumentViewer.snapshot():getActiveStudyContext();
    setStudyAIContext(context,prompt,mode);
  }catch(error){showToast(error.message);}finally{preparingStudyContext=false;}
}

function initMaterials() {
  initializeDocumentViewers();
  materialElement("notes-file").addEventListener("change", (event) => selectNoteFile(event.target.files[0]));
  dropTarget("notes-drop", selectNoteFile);
  materialElement("notes-upload-form").addEventListener("submit", saveNote);
  materialElement("notes-filter").addEventListener("change", renderNotes);
  materialElement("note-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentNote) return;
    const title=materialElement("note-edit-title").value.trim(),subject=materialElement("note-edit-subject").value.trim();
    if (!title || !subject) return;
    const updated={...currentNote,title,subject};
    try { await notesStore("put",updated); currentNote=updated; notesLibrary=await notesStore("all");renderNotes();showToast("Note details saved"); }
    catch { materialElement("notes-error").textContent="Changes could not be saved."; }
  });
  materialElement("flashcard-ai").addEventListener("click", () => attachStudyContext("Give me a hint for this flashcard without revealing the final answer."));
  materialElement("paper-ai").addEventListener("click", () => attachStudyContext("Help me understand this question. Start with a hint and explain the method."));
  materialElement("note-ai").addEventListener("click", () => attachStudyContext("Explain this passage or page clearly. Define unfamiliar terms and adapt the explanation to the material."));
  materialElement("note-flashcards").addEventListener("click", () => attachStudyContext("Create 5 useful question-and-answer flashcards from this material.","flashcards"));
}
