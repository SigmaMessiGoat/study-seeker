# Native PDF reader and screenshot AI

Past Papers and PDF Notes now use embedded browser PDF viewers rather than the custom PDF.js canvas reader. Available reading, highlighting, drawing, and saving tools depend on the browser and its embedded-viewer support. The original-file links remain available. Annotations made in a native viewer are not automatically written back into Study Seeker's stored file; download the annotated copy and upload it again if needed.

Ask AI about this question (or the PDF note's explanation/flashcard action) requests a tab/window/screen capture through the browser. Choose the surface containing the visible question. The app captures one image, stops all capture tracks, then opens the attachment preview. Nothing goes to the AI until Send is pressed. If several questions are visible, identify the intended question in your message. Cropping is not included in this version.

Flashcard and text-note context continue using their existing text snapshots. PDF context no longer automatically extracts a page or selected text from the native viewer. Screen capture may require HTTPS or localhost and is not supported by every browser/device; manual image attachment is the fallback.

The large vendor PDF.js bundle is no longer loaded by index.html. Its files remain on disk; they were not deleted. Notes and practice PDFs remain in the same browser database.

Verification: JavaScript syntax and control references passed. Mocked capture checks verified image creation, stopping sharing, cleanup, and rejected permission. The actual browser sharing prompt and native PDF annotation tools still need checking in your browser.
