# ✨ Insel-Wiki New Feature Guide

Dieses Dokument erklärt, wie neue Features für das Insel-Wiki angefordert und automatisch entwickelt werden können.

## Funktionsweise
Die Entwicklung neuer Features wird direkt durch das Erstellen von Unterseiten in diesem Guide gesteuert.

## Ein New Feature erstellen
1. Erstelle eine **neue Unterseite** direkt unter diesem New Feature Guide.
2. Der **Titel** der Seite beschreibt das Feature (z.B. "Dunkler Modus für die Suche").
3. Der **Inhalt** der Seite kann Anforderungen oder Designs enthalten.
4. Sobald du die Seite speicherst, erkennt der Bot die neue Anfrage.

## Freigabe-Prozess
Der Bot analysiert die Anfrage und schreibt einen Implementierungsplan direkt in den Text deiner neuen Seite.
- **Wichtig:** Der Bot wartet auf deine Freigabe.
- Suche im Text nach `Status: proposed`.
- Ändere diesen Text manuell im Editor zu `Status: approved`, um die Entwicklung und Tests zu starten.

## Ergebnisse
Die Logs der Ausführung (Tests, Build, etc.) erscheinen in Echtzeit direkt unter deinem Plan. Nach Abschluss wird der Status automatisch auf `completed` gesetzt.

## Sicherheits-Shield
Der Bot blockiert automatisch gefährliche Befehle oder Zugriffe auf `.env` Dateien und Secrets.
