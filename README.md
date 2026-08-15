# 🏥 Insel-Wiki

**Insel-Wiki** is a high-performance, real-time collaborative wiki designed specifically for the requirements of the Inselspital Bern. It combines modern healthcare design (Burnham Green Glassmorphism) with state-of-the-art web technology for seamless teamwork.

## 🚀 Key Features

- **Real-time Collaboration:** Collaborative editing of documents (Tiptap + Yjs) with live cursor display.
- **Full-text Search:** Lightning-fast search across titles and content with context snippets and highlighting.
- **Interactive Collaboration:**
  - **Inline Comments:** Conduct discussions directly at text locations.
  - **@Mentions:** Targeted mentions of colleagues from the hospital directory.
- **Transparency:** "Last edited by" badges with avatar and timestamp for every page.
- **Rich Table Editing:** Interactive table creation with custom dimensions, contextual row/column operations, header toggling, column resizing, and GFM markdown compatibility.
- **Hierarchical Structure:** Organized page navigation with drag-and-drop sorting.
- **Healthcare Design:** Optimized for high readability and focus, including dark mode and responsive mobile layout.
- **Automated Quality Assurance:** Integrated E2E test suite with Playwright (Desktop & Mobile).

## 🛠 Tech Stack

- **Frontend:** Vite, Vanilla JS (ESM), CSS Variables (Glassmorphism).
- **Editor:** Tiptap (ProseMirror-based).
- **Synchronization:** Yjs (CRDTs) for conflict-free editing.
- **Backend:** Firebase (Firestore, Auth, Storage, Hosting).
- **Testing:** Playwright (Chromium, Mobile Chrome, Mobile Safari).

## 📥 Installation & Setup

```bash
# Clone repository
git clone https://github.com/stephansdigitalerassistent/insel-wiki.git
cd insel-wiki

# Install dependencies
npm install

# Start development server
npm run dev
```

## 🧪 Testing

The E2E test suite uses Playwright and follows a strict isolation policy:
- **Isolation:** All automated tests create their temporary pages under the designated `page-tests` root to keep the main wiki tidy.
- **Cleanup:** Tests are designed to delete their pages via the UI in the `afterEach` hook. Additionally, a `globalTeardown` runs a `firestore-cleanup.js` script to purge any orphaned test data (matched by standard test prefixes or 13-digit timestamps).

```bash
# Run all E2E tests (Headless)
npm run test:e2e

# Start tests with UI mode
npx playwright test --ui
```

## 🌐 Deployment

The project is optimized for Firebase Hosting:
```bash
npm run deploy
```