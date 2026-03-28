# 🏥 Insel-Wiki

**Insel-Wiki** ist ein hochperformantes, kollaboratives Echtzeit-Wiki, das speziell für die Anforderungen des Inselspitals Bern entwickelt wurde. Es kombiniert modernes Healthcare-Design (Burnham Green Glassmorphism) mit modernster Web-Technologie für nahtlose Teamarbeit.

## 🚀 Key Features

- **Echtzeit-Kollaboration:** Gemeinsames Bearbeiten von Dokumenten (Tiptap + Yjs) mit Live-Cursor-Anzeige.
- **Volltextsuche:** Blitzschnelle Suche über Titel und Inhalte hinweg mit Kontext-Snippets und Highlighting.
- **Interaktive Kollaboration:**
  - **Inline-Kommentare:** Diskussionen direkt an Textstellen führen.
  - **@Mentions:** Gezieltes Erwähnen von Kollegen aus dem Spital-Verzeichnis.
- **Transparenz:** "Zuletzt bearbeitet von"-Badges mit Avatar und Zeitstempel für jede Seite.
- **Hierarchische Struktur:** Organisierte Seiten-Navigation mit Drag-and-Drop-Sortierung.
- **Healthcare Design:** Optimiert für hohe Lesbarkeit und Fokus, inklusive Dark-Mode und responsivem Mobile-Layout.
- **Automatisierte Qualitätssicherung:** Integrierte E2E-Testsuite mit Playwright (Desktop & Mobile).

## 🛠 Tech Stack

- **Frontend:** Vite, Vanilla JS (ESM), CSS Variables (Glassmorphism).
- **Editor:** Tiptap (ProseMirror-basiert).
- **Synchronisation:** Yjs (CRDTs) für konfliktfreies Editing.
- **Backend:** Firebase (Firestore, Auth, Storage, Hosting).
- **Testing:** Playwright (Chromium, Mobile Chrome, Mobile Safari).

## 📥 Installation & Setup

```bash
# Repository klonen
git clone https://github.com/stephansdigitalerassistent/insel-wiki.git
cd insel-wiki

# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev
```

## 🧪 Testing

```bash
# Alle E2E-Tests ausführen (Headless)
npm run test:e2e

# Tests mit UI-Mode starten
npx playwright test --ui
```

## 🌐 Deployment

Das Projekt ist für Firebase Hosting optimiert:
```bash
npm run deploy
```
