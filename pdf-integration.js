/* Parent-page integration with the existing PDF.js full viewer. */
class StudyDocumentViewer {
  constructor(frameId) {
    this.frame=document.getElementById(frameId);this.ready=false;this.loaded=false;
    this.version=0;this.name="";this.token=newId();this.pending=new Map();this.counter=0;
    this.whenReady=new Promise((resolve)=>this.resolveReady=resolve);
    window.addEventListener("message",(event)=>{
      if(event.source!==this.frame.contentWindow || event.data?.channel!=="study-seeker-pdf")return;
      if(event.data.type==='ready'){this.ready=true;this.resolveReady();return;}
      if(event.data.token!==this.token)return;
      const pending=this.pending.get(event.data.id);if(!pending)return;
      clearTimeout(pending.timeout);this.pending.delete(event.data.id);
      if(event.data.error)pending.reject(new Error(event.data.error));else pending.resolve(event.data.result);
    });
    this.frame.src="vendor/pdfjs/web/viewer.html?file=";
  }
  async request(type,extra={},transfer=[]) {
    if(!this.ready) {
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error("The PDF viewer did not load. Open Study Seeker on localhost, or use the original-file link.")),20000);
        this.whenReady.then(()=>{clearTimeout(timeout);resolve();});
      });
    }
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error("PDF action timed out. Unlock password-protected files in the viewer, then try again."));},45000);
      this.pending.set(id,{resolve,reject,timeout});
      this.frame.contentWindow.postMessage({channel:"study-seeker-pdf",token:this.token,id,type,...extra},"*",transfer);
    });
  }
  async open(blob,name) {
    const version=++this.version;this.loaded=false;this.name=name;
    const bytes=await blob.arrayBuffer();
    if(version!==this.version)return;
    await this.request('open',{bytes,filename:name},[bytes]);
    if(version===this.version)this.loaded=true;
  }
  async snapshot() {
    if(!this.loaded)throw new Error("Wait for the PDF to finish loading.");
    const version=this.version,result=await this.request('snapshot');
    if(version!==this.version)throw new Error("The document changed. Ask again about the current PDF.");
    return {title:`${this.name} · page ${result.page}`,text:result.text,image:result.image};
  }
  async save() {
    if(!this.loaded)throw new Error("Wait for the PDF to finish loading.");
    const version=this.version,result=await this.request('save');
    if(version!==this.version)throw new Error("The document changed. Try saving the current PDF again.");
    return new Blob([result.bytes],{type:'application/pdf'});
  }
}
let paperDocumentViewer;
let noteDocumentViewer;
let paperDocumentRecord=null;
function initializeDocumentViewers() {
  paperDocumentViewer=new StudyDocumentViewer('pdf-viewer');
  noteDocumentViewer=new StudyDocumentViewer('note-fallback');
  document.getElementById('paper-save-edits').addEventListener('click',async(event)=>{
    const button=event.currentTarget;button.disabled=true;
    try {
      const record=paperDocumentRecord;
      const blob=await paperDocumentViewer.save();
      if(record!==paperDocumentRecord)throw new Error('The paper changed. Save again.');
      const updated={...record,blob};await pdfStore('put',updated);paperDocumentRecord=updated;
      practiceClock.key=`${updated.name}:${blob.size}`;persistPracticeClock();
      if(practiceUrl)URL.revokeObjectURL(practiceUrl);practiceUrl=URL.createObjectURL(blob);document.getElementById('pdf-open').href=practiceUrl;
      showToast('PDF annotations saved in this browser.');
    }catch(error){showToast(error.message);}finally{button.disabled=false;}
  });
  document.getElementById('note-save-edits').addEventListener('click',async(event)=>{
    const button=event.currentTarget;button.disabled=true;
    try {
      const id=currentNote?.id;
      const blob=await noteDocumentViewer.save();
      if(currentNote?.id!==id)throw new Error('The note changed. Save again.');
      const updated={...currentNote,blob};await notesStore('put',updated);currentNote=updated;
      notesLibrary=await notesStore('all');renderNotes();
      if(noteUrl)URL.revokeObjectURL(noteUrl);noteUrl=URL.createObjectURL(blob);document.getElementById('note-open').href=noteUrl;
      showToast('Note annotations saved in this browser.');
    }catch(error){showToast(error.message);}finally{button.disabled=false;}
  });
}
