# 🛠️ Insel-Wiki DevOps Guide

Dieses Dokument erklärt, wie die DevOps-Automatisierung für das Insel-Wiki funktioniert.

## Funktionsweise
Die DevOps-Automatisierung wird durch Einträge in der Firestore-Collection `devops_tasks` gesteuert. Ein Daemon auf dem Server hört auf diese Einträge und führt die gewünschten Aktionen aus.

## Einen Task erstellen
1. Erstelle einen neuen Eintrag in `devops_tasks`.
2. Setze das Feld `prompt` auf deine Anfrage (z.B. "Führe E2E-Tests aus").
3. Setze `status` auf `new`.

## Freigabe-Prozess
Der Bot analysiert die Anfrage und erstellt einen Plan im Feld `proposal`.
- **Wichtig:** Der Bot wartet auf deine Freigabe.
- Ändere den `status` von `proposed` auf `approved`, um die Ausführung zu starten.

## Ergebnisse
Die Logs der Ausführung erscheinen in Echtzeit im Feld `execution_log`. Nach Abschluss wird der `status` auf `completed` gesetzt.

## Sicherheits-Shield
Der Bot blockiert automatisch gefährliche Befehle oder Zugriffe auf `.env` Dateien und Secrets.
