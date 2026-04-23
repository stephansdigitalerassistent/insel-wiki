# ✨ New Feature Guide (User Manual)

This document explains how you can request new features for the Insel-Wiki. Our **DevOps-Bot** handles the analysis and preparation for you.

## How to request a feature:

1. **Create a subpage:**
   Create a new subpage directly in this folder (**New Features**).
   
2. **Title & Description:**
   - The **Title** of the page is your request (e.g. *"Color-coded task lists"*).
   - In the **Content** briefly describe what the feature should do.

3. **Wait for analysis:**
   As soon as you save the page, text from the bot will appear after a few seconds. It sets the status to `analyzing` and then to `proposed`.

## Approval & Implementation:

The bot writes a technical plan for you on the page. If you agree with it:

1. Click on **Edit**.
2. Find the line `Status: proposed`.
3. Manually change the word `proposed` to **`approved`**.
   *(Important: The word must remain bolded so the bot recognizes it!)*
4. **Save.**

## What happens then?
The bot immediately recognizes your approval. It switches to `executing`, executes the necessary commands on the server (tests, build, Git commit), and writes the result to a log directly on your page. At the end, it will say `Status: completed`.

---
*💡 Tip: You can follow the progress live in the wiki while the bot is working.*