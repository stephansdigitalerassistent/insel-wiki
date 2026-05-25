# Dependency Security & Version Audit Report

**Date:** May 25, 2026  
**Scope:** Core Collaborative Editor Dependencies & Project Security Vulnerabilities

---

## 1. Executive Summary & Recommendations

Based on the security audit and version analysis conducted on the project dependencies, **an immediate upgrade of the core collaborative editor dependencies is NOT recommended.**

* **Collaborative Editor (Tiptap & Yjs):** The Yjs-related packages are already fully up to date. While `@tiptap` packages have a new major version available (`v3.23.6` vs current `v2.27.2`), the current `v2` version does not contain any security vulnerabilities. Upgrading from v2 to v3 is a major version bump that requires migration planning and regression testing.
* **Security Status:** The production application has zero known vulnerabilities. There are 3 moderate security vulnerabilities detected, but they are confined to a development dependency (`firebase-tools` via `uuid`) and do not pose a risk to the client application in production.

---

## 2. Security Audit Findings (`npm audit`)

The `npm audit` check returned **3 moderate severity vulnerabilities**:

| Severity | Package | Vulnerability Description | Dependency Path | Remediation |
| :--- | :--- | :--- | :--- | :--- |
| Moderate | `uuid` (<11.1.1) | Missing buffer bounds check in v3/v5/v6 | `firebase-tools` -> `gaxios` -> `uuid` | Run `npm audit fix --force` (updates `firebase-tools` to v1.2.0, which is a breaking change for dev tools) |

### Impact Analysis
These vulnerabilities only affect `firebase-tools` (a `devDependency` used for deployments and local emulation). Because this code is not bundled into the production client application (`dist`), **there is zero security impact on the live Insel-Wiki application.**

---

## 3. Package Version Analysis (`npm outdated`)

The audit of the collaborative editor ecosystem and other dependencies revealed the following status:

### Collaborative Editor (Tiptap & Yjs) Ecosystem

| Package | Current Version | Wanted Version | Latest Version | Status / Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| `@tiptap/core` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. Upgrade is not critical; no security issues. |
| `@tiptap/extension-character-count` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-code-block` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-collaboration` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-collaboration-cursor` | `2.27.2` | `2.27.2` | `2.26.2` | **Outdated (Major)**. Latest npm tag is behind current. |
| `@tiptap/extension-image` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-link` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-mention` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-placeholder` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-table` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-table-cell` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-table-header` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-table-row` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-task-item` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/extension-task-list` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/pm` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/starter-kit` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `@tiptap/suggestion` | `2.27.2` | `2.27.2` | `3.23.6` | **Outdated (Major)**. |
| `yjs` | `13.6.30` | `13.6.30` | `13.6.30` | **Up to Date**. No upgrade available. |
| `y-indexeddb` | `9.0.12` | `9.0.12` | `9.0.12` | **Up to Date**. No upgrade available. |
| `y-prosemirror` | `1.3.7` | `1.3.7` | `1.3.7` | **Up to Date**. No upgrade available. |
| `y-protocols` | `1.0.7` | `1.0.7` | `1.0.7` | **Up to Date**. No upgrade available. |

### Other Dependencies of Note

* **`marked`:** Current `17.0.6` | Wanted `17.0.6` | Latest `18.0.4` (Major upgrade available).

---

## 4. Upgrade Strategy & Next Steps

1. **Keep Collaborative Editor on v2 for now:**
   - The Tiptap v3 release is a major version bump. Upgrading all 18 `@tiptap/*` packages to v3 introduces risk of breaking API changes or compatibility issues in editor extensions.
   - Because the editor is currently functioning correctly and there are no security warnings for Tiptap v2, we recommend keeping these versions locked.
   - **Recommended Action:** Schedule a future task specifically for migrating to Tiptap v3, incorporating thorough end-to-end (E2E) testing.
2. **Address DevDependency Vulnerabilities:**
   - The vulnerability in `firebase-tools` should be monitored. Since it is a development dependency, it can be updated by testing the deployment flow with newer versions of `firebase-tools` or running `npm audit fix --force` in a controlled branch.
