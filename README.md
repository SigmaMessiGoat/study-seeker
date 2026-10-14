# Study Seeker

A vanilla HTML, CSS and JavaScript study application with quests and XP, scheduled flashcards, focus and past-paper timers, uploaded notes, an annotated PDF reader and AI study help.

## Run locally

From this folder, run:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000/index.html. The PDF reader needs HTTP hosting rather than opening index.html directly. Study data is stored in your browser using localStorage and IndexedDB.

## AI setup

This private repository includes the locally configured AI credential. AI chat requires internet access. Keep the repository private. Before public hosting or sharing the source, remove the frontend credential and use a server-side proxy.

## PDF viewer

The bundled viewer uses Mozilla PDF.js. Its license is included in vendor/pdfjs/LICENSE.
