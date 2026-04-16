# ✨ New Feature Guide (Benutzerhandbuch)

Dieses Dokument erklärt dir, wie du neue Funktionen für das Insel-Wiki anfordern kannst. Unser **DevOps-Bot** übernimmt die Analyse und Vorbereitung für dich.

## So forderst du ein Feature an:

1. **Unterseite erstellen:**
   Erstelle eine neue Unterseite direkt in diesem Ordner (**New Features**).
   
2. **Titel & Beschreibung:**
   - Der **Titel** der Seite ist dein Wunsch (z.B. *"Farbig markierte Aufgabenlisten"*).
   - Im **Inhalt** beschreibst du kurz, was das Feature können soll.

3. **Analyse abwarten:**
   Sobald du die Seite speicherst, erscheint nach wenigen Sekunden ein Text vom Bot. Er setzt den Status auf `analyzing` und dann auf `proposed`.

## Freigabe & Umsetzung:

Der Bot schreibt dir einen technischen Plan in die Seite. Wenn du damit einverstanden bist:

1. Klicke auf **Bearbeiten**.
2. Suche die Zeile `Status: proposed`.
3. Ändere das Wort `proposed` manuell zu **`approved`**.
   *(Wichtig: Das Wort muss fettgedruckt bleiben, damit der Bot es erkennt!)*
4. **Speichern.**

## Was passiert dann?
Der Bot erkennt deine Freigabe sofort. Er wechselt auf `executing`, führt die notwendigen Befehle auf dem Server aus (Tests, Build, Git-Commit) und schreibt das Ergebnis in ein Log direkt auf deine Seite. Am Ende steht dort `Status: completed`.

---
*💡 Tipp: Du kannst den Fortschritt live im Wiki verfolgen, während der Bot arbeitet.*
