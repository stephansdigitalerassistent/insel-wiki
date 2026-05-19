# 🔍 Findings Guide (User Manual)

This document explains how you can directly report and have bugs or findings fixed in the Insel-Wiki.

## Report a bug

1. **Create a subpage** directly inside the **Findings** folder.
2. **Describe the problem:**
   - The **title** is the bug (e.g. *"Login button is invisible in Dark Mode"*).
   - In the **content**, write more details or paste an error message.
3. **Save.** A few seconds later the bot adds a checkbox:
   ```
   - [ ] Start Analysis
   ```

## Have the bug fixed

The bot is driven by **checkboxes**, not by editing status text. Only check a box when you want the bot to act.

1. **Start the analysis:** open the page, tick **"Start Analysis"**, save.
   The bot creates an `Analysis:` subpage with a proposed fix.
2. **Approve the fix:** open the `Analysis:` subpage. At the bottom:
   ```
   - [ ] Approval: Start implementation now
   - [ ] Restart analysis
   ```
   Tick **"Approval: Start implementation now"** and save.
3. **Watch it run:** the bot creates an `Implementation:` subpage, applies the fix on the server, and streams the log live. When it shows `Status: completed`, the bug is resolved.

> 🔒 Only administrators can trigger the implementation step. For everyone else the approval checkbox is a no-op.

---
*💡 Tip: After completion, check briefly on insel-wiki.web.app to confirm the bug is gone.*
