# 🔍 Findings Guide (Benutzerhandbuch)

Dieses Dokument erklärt dir, wie du Fehler (Bugs) oder Entdeckungen im Insel-Wiki direkt meldest und beheben lässt.

## Einen Fehler melden:

1. **Unterseite erstellen:**
   Erstelle eine neue Unterseite direkt in diesem Ordner (**Findings**).
   
2. **Problem beschreiben:**
   - Der **Titel** der Seite ist der Fehler (z.B. *"Login-Button ist im Dark Mode unsichtbar"*).
   - Im **Inhalt** kannst du mehr Details schreiben oder eine Fehlermeldung einfügen.

3. **Bot-Analyse:**
   Nach dem Speichern wechselt der Bot auf `investigating`. Er scannt den Code und schreibt dir einen Lösungsvorschlag (`proposal`) direkt in die Seite.

## Den Bug fixen lassen:

1. **Freigabe geben:**
   Der Bot hat den Status auf `proposed` gesetzt.
2. **Editor öffnen:**
   Klicke auf **Bearbeiten**.
3. **Status ändern:**
   Ändere das Wort `proposed` im Text manuell zu **`approved`**.
   *(Lass das Wort unbedingt fettgedruckt!)*
4. **Speichern.**

## Was passiert nach der Freigabe?
Der Bot wechselt auf `fixing`. Er schreibt den korrigierten Code direkt in die entsprechenden Dateien auf dem Server. Sobald dort `Status: fixed` steht, wurde der Bug erfolgreich behoben.

---
*💡 Tipp: Prüfe danach kurz auf insel-wiki.web.app, ob der Fehler weg ist.*
