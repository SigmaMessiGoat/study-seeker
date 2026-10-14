/* Study Seeker integration. PDF rendering and annotation tools belong to PDF.js. */
const studyViewerApp = window.PDFViewerApplication;
const studyViewerOptions = window.PDFViewerApplicationOptions;
studyViewerOptions.set("defaultUrl", "");
studyViewerOptions.set("disablePreferences", true);
studyViewerOptions.set("enableScripting", false);
studyViewerOptions.set("isEvalSupported", false);
studyViewerOptions.set("useSystemFonts", true);
studyViewerOptions.set("workerSrc", pdfjsLib.GlobalWorkerOptions.workerSrc);
studyViewerOptions.set("externalLinkTarget", 2);
let studyViewerToken = null;
let studyViewerBusy = false;
function sendStudyViewer(message, transfer = []) { parent.postMessage(message, "*", transfer); }
async function editedPdfBytes() {
  await studyViewerApp.pdfViewer._layerProperties.annotationEditorUIManager?.endCurrentEditing();
  if (!studyViewerApp.pdfDocument) throw new Error("Open a PDF first.");
  return studyViewerApp.pdfDocument.saveDocument();
}
window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.data?.channel !== "study-seeker-pdf") return;
  const request = event.data;
  if (request.type === "open" && !studyViewerToken) studyViewerToken = request.token;
  if (!studyViewerToken || request.token !== studyViewerToken) return;
  if (studyViewerBusy) {
    sendStudyViewer({channel:"study-seeker-pdf",token:studyViewerToken,id:request.id,error:"The PDF is busy. Try again in a moment."}); return;
  }
  studyViewerBusy = true;
  try {
    await studyViewerApp.initializedPromise;
    let result;
    if (request.type === "open") {
      await studyViewerApp.open({data:new Uint8Array(request.bytes),filename:request.filename});
      await studyViewerApp.pdfViewer.firstPagePromise;
      result = {pages:studyViewerApp.pdfDocument.numPages};
    } else if (request.type === "save") {
      const bytes = await editedPdfBytes();
      const buffer = bytes.slice().buffer;
      sendStudyViewer({channel:"study-seeker-pdf",token:studyViewerToken,id:request.id,result:{bytes:buffer}},[buffer]);
      return;
    } else if (request.type === "snapshot") {
      const pageNumber = studyViewerApp.page;
      const rotation = studyViewerApp.pdfViewer.pagesRotation;
      const bytes = await editedPdfBytes();
      const task = pdfjsLib.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({scale:1,rotation});
        const viewport = page.getViewport({scale:Math.min(1.7,1500/base.width,1800/base.height),rotation});
        const canvas = document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext("2d"),viewport,annotationMode:pdfjsLib.AnnotationMode.ENABLE}).promise;
        const text = await page.getTextContent();
        result={page:pageNumber,image:canvas.toDataURL("image/jpeg",0.85),text:text.items.map((item)=>item.str+(item.hasEOL?'\n':' ')).join('').trim().slice(0,16000)};
      } finally { await task.destroy(); }
    } else throw new Error("Unknown PDF action.");
    sendStudyViewer({channel:"study-seeker-pdf",token:studyViewerToken,id:request.id,result});
  } catch (error) {
    sendStudyViewer({channel:"study-seeker-pdf",token:studyViewerToken,id:request.id,error:error.message || "This PDF action failed."});
  } finally { studyViewerBusy=false; }
});
studyViewerApp.initializedPromise.then(() => {
  sendStudyViewer({channel:"study-seeker-pdf",type:"ready"});
});
