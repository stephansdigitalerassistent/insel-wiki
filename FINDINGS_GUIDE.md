# 🔍 Findings Guide (User Manual)

This document explains how you can directly report and have bugs or findings fixed in the Insel-Wiki.

## Report a bug:

1. **Create a subpage:**
   Create a new subpage directly in this folder (**Findings**).
   
2. **Describe the problem:**
   - The **Title** of the page is the bug (e.g. *"Login button is invisible in Dark Mode"*).
   - In the **Content** you can write more details or insert an error message.

3. **Bot Analysis:**
   After saving, the bot changes to `investigating`. It scans the code and writes a proposed solution (`proposal`) directly onto the page.

## Have the bug fixed:

1. **Give approval:**
   The bot has set the status to `proposed`.
2. **Open Editor:**
   Click on **Edit**.
3. **Change status:**
   Manually change the word `proposed` in the text to **`approved`**.
   *(Make sure to leave the word in bold!)*
4. **Save.**

## What happens after approval?
The bot switches to `fixing`. It writes the corrected code directly to the corresponding files on the server. As soon as it says `Status: fixed` there, the bug has been successfully resolved.

---
*💡 Tip: Check briefly afterwards on insel-wiki.web.app to see if the error is gone.*
