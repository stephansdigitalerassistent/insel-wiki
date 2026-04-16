# 🔍 Insel-Wiki Findings & Error Guide

Dieses Dokument beschreibt, wie Fehler oder Entdeckungen im Insel-Wiki direkt durch das Erstellen von Unterseiten gemeldet und automatisch behoben werden können.

## Einen Fehler melden
1. Erstelle eine **neue Unterseite** direkt unter diesem Findings Guide.
2. Beschreibe das Problem im **Titel** der Seite (z.B. "Der Login-Button ist im Dark Mode schwer zu sehen").
3. Füge im **Inhalt** der Seite weitere Details oder Screenshots hinzu.

## Automatische Analyse & Fix
1. Der Bot erkennt die neue Seite und beginnt die Analyse.
2. Er sucht in der Codebase nach den betroffenen Dateien und schreibt einen Reparaturvorschlag (`proposal`) direkt in deine neue Seite.
3. Der Bot wartet auf deine Freigabe. Suche nach `Status: proposed` im Text.
4. Ändere diesen manuell im Editor zu `Status: approved`.

## Korrektur anwenden
Nach der Freigabe schreibt der Bot den korrigierten Code direkt in die entsprechenden Dateien auf dem Server und markiert den Status als `fixed`.

## Überprüfung
Prüfe die Änderungen auf `insel-wiki.web.app` und lösche oder archiviere deine Finding-Seite, wenn du zufrieden bist.
