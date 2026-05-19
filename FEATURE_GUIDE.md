# ✨ New Feature Guide (User Manual)

This document explains how you can request new features for the Insel-Wiki. Our **DevOps-Bot** handles the analysis and preparation for you.

## How to request a feature

1. **Create a subpage** directly inside the **New Features** folder.
2. **Title & description:**
   - The **title** of the page is your request (e.g. *"Color-coded task lists"*).
   - In the **content**, briefly describe what the feature should do.
3. **Save.** A few seconds later the bot adds a welcome block and a checkbox:
   ```
   - [ ] Start Analysis
   ```

## Approval & implementation

The bot drives the workflow through **checkboxes**, not by editing status text. Only check a box when you want the bot to act.

1. **Start the analysis:** open the page, tick the **"Start Analysis"** checkbox, save.
   The bot creates an `Analysis:` subpage and writes a technical plan there.
2. **Approve the plan:** open the `Analysis:` subpage. At the bottom you'll see:
   ```
   - [ ] Approval: Start implementation now
   - [ ] Restart analysis
   ```
   Tick **"Approval: Start implementation now"** and save.
3. **Watch it run:** the bot creates an `Implementation:` subpage, executes the plan on the server, and streams the log live onto the page. When it shows `Status: completed`, you're done.

> 🔒 Only administrators can trigger the implementation step. For everyone else the approval checkbox is a no-op.

---
*💡 Tip: You can follow the progress live in the wiki while the bot is working.*
