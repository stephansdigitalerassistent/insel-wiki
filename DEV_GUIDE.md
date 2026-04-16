# 🛠️ Insel-Wiki DevOps Guide

Dieses Dokument erklärt, wie die DevOps-Automatisierung für das Insel-Wiki funktioniert.

## Funktionsweise
Die DevOps-Automatisierung wird direkt durch das Erstellen von Unterseiten in diesem Guide gesteuert.

## Einen Task erstellen
1. Erstelle eine **neue Unterseite** direkt unter diesem DevOps Guide.
2. Der **Titel** der Seite ist die Kurzbeschreibung (z.B. "E2E Tests ausführen").
3. Der **Inhalt** der Seite kann zusätzliche Details enthalten.
4. Sobald du die Seite speicherst, erkennt der Bot die neue Anfrage.

## Freigabe-Prozess
Der Bot analysiert die Anfrage und schreibt einen Plan direkt in den Text deiner neuen Seite.
- **Wichtig:** Der Bot wartet auf deine Freigabe.
- Suche im Text nach `Status: proposed`.
- Ändere diesen Text manuell im Editor zu `Status: approved`, um die Ausführung zu starten.

## Ergebnisse
Die Logs der Ausführung erscheinen in Echtzeit direkt unter deinem Plan auf der Wiki-Seite. Nach Abschluss wird der Status automatisch auf `completed` gesetzt.

## Sicherheits-Shield
Der Bot blockiert automatisch gefährliche Befehle oder Zugriffe auf `.env` Dateien und Secrets.
