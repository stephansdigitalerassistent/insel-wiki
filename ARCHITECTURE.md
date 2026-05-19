# 🏗 Architecture — Insel-Wiki

The Insel-Wiki follows a modular, event-driven architectural approach without heavy frameworks to ensure maximum performance and maintainability.

## 1. Core Infrastructure

### **Collaboration & Synchronization (Yjs)**
The heart of the application is **Yjs**.
- We use a **Custom Firestore Yjs Provider** (`src/editor/FirestoreYjsProvider.js`), which stores binary Yjs state updates in Firestore documents.
- This enables conflict-free editing (CRDTs) without a central Node.js backend server.

### **Data Model (Firestore)**
- **`pages/`**: Main collection for document contents and metadata (title, hierarchy).
- **`pages/{id}/history/`**: Snapshot-based historization for versioning.
- **`pages/{id}/comments/`**: Sub-collection for the discrete comment threads of a page.
- **`users/`**: Mirroring of authentication data for @Mentions and author attributions.

## 2. Component Structure (`src/components/`)

The UI is divided into independent modules that communicate via the global state in `main.js` or via custom events:

- **`sidebar.js`**: Manages the hierarchical tree, drag-and-drop logic, and the **Deep-Search Engine**.
- **`comments.js`**: Isolated module for the comment panel and Firestore discussion sync.
- **`history.js`**: Difference view (using `diff-match-patch`) and snapshot restoration.
- **`modal.js`**: Generic modal infrastructure for profiles, page creation, and confirmations.

## 3. Editor Layer (`src/editor/`)

Based on **Tiptap**, extended with medically relevant functions:
- **Custom Extensions**: `Comment.js` (mark infrastructure) and `Mention.js` (suggestion logic).
- **Suggestions**: `suggestions.js` integrates `tippy.js` for user-friendly @User search.

## 4. Design System (`src/styles/`)

- **Utility-First CSS Variables**: The entire color scheme (Burnham Green) and the glassmorphism effects are centrally controlled via CSS variables in `index.css`.
- **Print Optimization**: Special media queries ensure that protocols can be printed cleanly on A4 in everyday hospital life.

## 5. Security & Automation

- **WikiBot (`wiki-registration-bot.js`)**: An autonomous Node.js service that validates email-based registration tokens, creates accounts, and initializes the employee directory in Firestore.
- **Test Isolation**: All automated Playwright tests are strictly isolated. 
  - The `createPage` logic in `src/firebase/firestore.js` automatically redirects test-prefixed pages to the `page-tests` parent.
  - A comprehensive cleanup utility (`tests/helpers/firestore-cleanup.js`) handles the recursive deletion of test-generated documents and sub-collections (History, Comments, Presence) to maintain a clean production environment.
- **Firestore Rules**: Granular access control ensuring that only verified `@insel.ch` users have write access.

## 6. Repository & Maintenance

### **Branching Strategy**
- **`main`**: The primary and default branch on GitHub. Contains the current production-ready code, including architectural fixes and the latest Tiptap integration parity.
- **`master`**: Retired. This branch has been removed from the primary `origin` repository. A legacy version remains only on older forks for historical reference.