# 🔍 Insel-Wiki Findings & Error Guide

Dieses Dokument beschreibt, wie Fehler oder Entdeckungen im Insel-Wiki gemeldet und automatisch behoben werden können.

## Was ist ein "Finding"?
Ein Finding ist ein Fehler, ein UI-Bug oder eine fehlende Funktion, die ein Nutzer direkt im Wiki melden kann.

## Einen Fehler melden
1. Erstelle einen Eintrag in der Firestore-Collection `devops_findings`.
2. Beschreibe das Problem im Feld `description` (z.B. "Der Login-Button ist im Dark Mode schwer zu sehen").
3. Setze `status` auf `new`.

## Automatische Analyse & Fix
1. Der Bot erkennt die neue Meldung und wechselt auf `investigating`.
2. Er sucht in der Codebase nach den betroffenen Dateien und erstellt einen Reparaturvorschlag (`proposal`).
3. Der Bot wartet auf Freigabe. Ändere den `status` von `proposed` auf `approved`.

## Korrektur anwenden
Nach der Freigabe schreibt der Bot den korrigierten Code direkt in die entsprechenden Dateien auf dem Server und setzt den `status` auf `fixed`.

## Überprüfung
Prüfe die Änderungen auf `insel-wiki.web.app` und schließe das Finding ab.
