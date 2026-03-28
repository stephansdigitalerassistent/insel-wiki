# 🏗 Architektur — Insel-Wiki

Das Insel-Wiki folgt einem modularen, ereignisgesteuerten Architektur-Ansatz ohne schwerfällige Frameworks, um maximale Performance und Wartbarkeit zu gewährleisten.

## 1. Kern-Infrastruktur

### **Kollaboration & Synchronisation (Yjs)**
Das Herzstück der Anwendung ist **Yjs**. 
- Wir nutzen einen **Custom Firestore Yjs Provider** (`src/editor/FirestoreYjsProvider.js`), der binäre Yjs-State-Updates in Firestore-Dokumenten speichert.
- Dies ermöglicht konfliktfreies Editieren (CRDTs) ohne einen zentralen Node.js-Backend-Server.

### **Datenmodell (Firestore)**
- **`pages/`**: Hauptkollektion für Dokumentinhalte und Metadaten (Titel, Hierarchie).
- **`pages/{id}/history/`**: Snapshot-basierte Historisierung für Versionierung.
- **`pages/{id}/comments/`**: Sub-Kollektion für die diskreten Kommentar-Threads einer Seite.
- **`users/`**: Spiegelung der Authentifizierungsdaten für @Mentions und Autorennachweise.

## 2. Komponenten-Struktur (`src/components/`)

Die UI ist in unabhängige Module unterteilt, die über den globalen State in `main.js` oder via Custom Events kommunizieren:

- **`sidebar.js`**: Verwaltet den hierarchischen Baum, Drag-and-Drop Logik und die **Deep-Search Engine**.
- **`comments.js`**: Isoliertes Modul für das Kommentar-Panel und die Firestore-Diskussions-Sync.
- **`history.js`**: Differenz-Ansicht (using `diff-match-patch`) und Snapshot-Wiederherstellung.
- **`modal.js`**: Generische Modal-Infrastruktur für Profile, Seiten-Erstellung und Bestätigungen.

## 3. Editor-Schicht (`src/editor/`)

Basierend auf **Tiptap**, erweitert um medizinisch relevante Funktionen:
- **Custom Extensions**: `Comment.js` (Mark-Infrastruktur) und `Mention.js` (Vorschlagslogik).
- **Suggestions**: `suggestions.js` integriert `tippy.js` für die nutzerfreundliche @User-Suche.

## 4. Design-System (`src/styles/`)

- **Utility-First CSS Variables**: Das gesamte Farbschema (Burnham Green) und die Glassmorphism-Effekte werden zentral über CSS-Variablen in `index.css` gesteuert.
- **Print-Optimization**: Spezielle Media-Queries stellen sicher, dass Protokolle im Spitalalltag sauber auf A4 ausgedruckt werden können.

## 5. Security & Automation

- **WikiBot (`wiki-registration-bot.js`)**: Ein autonomer Node.js Dienst, der E-Mail-basierte Registrierungs-Token validiert, Accounts erstellt und das Mitarbeiterverzeichnis in Firestore initialisiert.
- **Firestore Rules**: Granulare Zugriffskontrolle, die sicherstellt, dass nur verifizierte `@insel.ch` Nutzer Schreibzugriff haben.
