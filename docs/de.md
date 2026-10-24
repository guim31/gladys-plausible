# Plausible Analytics

[Plausible Analytics](https://plausible.io/) ist ein einfaches,
datenschutzfreundliches Webanalyse-Werkzeug, Open Source (AGPL), auf
plausible.io oder selbst gehostet (Community Edition). Diese Integration bringt
die Zahlen deiner Plausible-Websites in Gladys: Jede Website wird ein Gerät mit
ihren Besuchern gerade jetzt und ihren Besuchern, Besuchen, Seitenaufrufen,
ihrer Absprungrate, Besuchsdauer und meistbesuchten Seite des Tages. Szenen
können auf einen Besucheransturm reagieren, auf den ersten Besucher des Tages
oder auf eine Website, die keinen Besuch mehr erhält (kaputtes
Tracking-Skript), ein Dashboard-Widget zeigt den Tag auf einen Blick, und eine
Szenen-Aktion schreibt die Zahlen einer Website in eine Nachricht.

Getestet mit einer echten, selbst gehosteten Plausible Community Edition 3.2.1
(Docker, PostgreSQL und ClickHouse); noch nicht mit plausible.io: Rückmeldungen
sind in [den Issues](https://github.com/guim31/gladys-plausible/issues)
willkommen.

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Ein Plausible: auf [plausible.io](https://plausible.io/), oder dein eigener
  Server (Community Edition 2.1 oder neuer, die erste mit der Stats-API v2),
  vom Gladys-Rechner aus erreichbar.
- Einen **„Stats API“-Schlüssel** deines Plausible-Kontos.
- Die **Domains** der zu verfolgenden Websites, wie in Plausible geschrieben
  (zum Beispiel `blog.example.org`): Ein Stats-API-Schlüssel kann seine
  Websites nicht auflisten.

Bei jedem Lesen schickt die Integration eine Anfrage pro Website (die Besucher
gerade jetzt). Alle 15 Minuten liest sie außerdem die Zahlen des Tages und die
meistbesuchte Seite (zwei Anfragen pro Website) und, wenn niemand auf einer
Website ist, die Besuche der letzten Stunden. plausible.io nimmt 600 Anfragen
pro Stunde und Schlüssel an: Dort verlängert die Integration das Intervall
selbst, um unter 540 zu bleiben (mit 20 Websites ein Lesen alle 4 Minuten). Die
Community Edition hat diese Grenze nicht.

## Erste Schritte

### 1. Einen Stats-API-Schlüssel erstellen

Öffne in Plausible **Settings → API keys** (die Einstellungen deines Kontos),
klicke auf **New API key**, wähle den Typ **Stats API** und kopiere den
Schlüssel (er wird nur einmal angezeigt).

### 2. Die Integration konfigurieren

Öffne in Gladys **Integrationen → Plausible Analytics → Konfiguration**:

- **Plausible-Adresse**: leer für plausible.io, oder die Adresse deines
  Servers (zum Beispiel `http://192.168.1.10:8000`). Eine aus dem Browser
  kopierte Adresse wird verstanden.
- **API-Schlüssel**: der Stats-API-Schlüssel.
- **Domains der Websites**: durch Kommas getrennt, höchstens 25.
- **Besucher gerade jetzt: Intervall**: 1, 2 oder 5 Minuten (standardmäßig 1
  Minute).
- **Besucheransturm ab**: die gleichzeitigen Besucher, die „Besucheransturm“
  auslösen (standardmäßig 10).
- **Kein Besuch seit (Stunden)**: die Stunden ohne Besuch, die „Länger kein
  Besuch“ auslösen (standardmäßig 24).
- **Sprache der Namen**: Sprache der Funktionsnamen und der Szenen-Ergebnisse
  (standardmäßig Französisch).

Speichere und klicke dann auf **Verbindung testen**: Das Ergebnis nennt die
Zahl der Websites, die Besucher des Tages und die von gerade jetzt, und die
Domains, die Plausible dem Schlüssel verweigert, falls es welche gibt.

### 3. Die Websites anlegen

Öffne den Tab **Entdecken**: Jede Website wird unter ihrer Domain
vorgeschlagen. Lege die an, die du in Gladys sehen willst. Die
Szenen-Auslöser und das Widget funktionieren für alle Websites, angelegt oder
nicht.

## Die Geräte

Jede Website wird ein Gerät mit:

- **Besucher gerade jetzt**: die Besucher der letzten 5 Minuten, wie die
  „current visitors“ von Plausible.
- **Besucher heute**: eindeutige Besucher seit Mitternacht.
- **Besuche heute**: Besuche (Sitzungen) seit Mitternacht.
- **Seitenaufrufe heute**: Seitenaufrufe seit Mitternacht.
- **Absprungrate heute**: der Anteil der Besuche mit nur einer Seite, in
  Prozent.
- **Besuchsdauer heute**: die durchschnittliche Dauer eines Besuchs, in
  Sekunden.
- **Meistbesuchte Seite heute**: ihr Pfad, zum Beispiel `/posts/hello`; „-“
  vor dem ersten Seitenaufruf des Tages.

„Heute“ ist der Tag der Website in Plausible, in der Zeitzone ihrer
Einstellungen: Die Tageszahlen beginnen um ihre Mitternacht wieder bei 0. Die
Besucher gerade jetzt folgen dem Intervall der Konfiguration, die Zahlen des
Tages werden alle 15 Minuten gelesen, und sofort beim ersten Besucher. Ein
unveränderter Wert wird alle 12 Stunden erneut gesendet, damit Gladys ihn als
aktuell behält.

## Dashboard

Das Widget **Plausible heute** zeigt vier Kacheln (Besucher gerade jetzt,
Besucher, Besuche und Seitenaufrufe des Tages), über die gezeigten Websites
addiert, dann eine Zeile pro Website mit ihren Besuchern des Tages und von
gerade jetzt, die meistbesuchte zuerst. Bei einer einzigen Website wird
stattdessen ihre meistbesuchte Seite des Tages gezeigt. Wähle in den
Widget-Einstellungen einige Websites, um nur sie zu zeigen (in Gladys
angelegte Geräte). Die Schaltfläche **Aktualisieren** liest Plausible neu.

## Szenen

### Auslöser

- **Besucheransturm**: Die Besucher einer Website erreichen gerade die
  Schwelle der Konfiguration. Einmal pro Ansturm, und mindestens 30 Minuten
  zwischen zwei Meldungen für eine Website: Ein Ansturm, der am Ende der Pause
  noch läuft, wird dann gemeldet. Variablen: Domain, Besucher gerade jetzt,
  Schwelle.
- **Erster Besucher des Tages**: Eine Website empfängt ihren ersten Besucher
  seit ihrer Mitternacht. Variablen: Domain, Besucher heute. War die
  Integration gestoppt, wird der erste Besucher beim ersten Lesen nach dem
  Neustart gemeldet.
- **Länger kein Besuch**: Eine Website mit Besuchen erhält für die Stunden der
  Konfiguration keine mehr: Vielleicht ist das Tracking-Skript kaputt oder die
  Website ausgefallen. Einmal, bis wieder ein Besuch kommt. Variablen: Domain,
  Stunden ohne Besuch.

Jeder Auslöser lässt sich auf einige Websites beschränken (leer: alle). Was
sich die Auslöser merken, liegt im Volume `/data`: Ein Neustart von Gladys oder
der Integration meldet keinen Ansturm und keinen ersten Besucher doppelt. Beim
ersten Lesen einer Website wird nichts gemeldet: Ein schon laufender Ansturm
oder eine schon laufende Stille wird nur vermerkt.

### Aktionen

- **Zahlen einer Website lesen**: liefert die Domain (`name`), die Besucher
  gerade jetzt (`active`), die `visitors`, `visits`, `pageviews`,
  `bounce_rate` und `visit_duration` des Tages, die `top_page` und einen
  fertigen Satz (`sentence`), zum Beispiel „blog.example.org: 132 Besucher und
  410 Seitenaufrufe heute, 4 gerade jetzt, meistbesuchte Seite /posts/hello.“.

### Szenen-Ideen

- Wenn **Besucheransturm** für deinen Shop auslöst, eine Telegram-Nachricht
  „Ansturm auf {{domain}}: {{visitors}} Besucher gerade jetzt“ senden.
- Wenn **Länger kein Besuch** auslöst, eine Benachrichtigung „Kein Besuch auf
  {{domain}} seit {{hours}} h: Tracking-Skript prüfen“ senden.
- Jeden Abend um 21 Uhr **Zahlen einer Website lesen** und den Satz
  (`sentence`) als Nachricht senden.
- Mit der Gerätefunktion **Besucher gerade jetzt** als Szenen-Bedingung eine
  Lampe grün leuchten lassen, solange jemand auf der Website ist.

## Fehlerbehebung

- **„Füge einen „Stats API“-Schlüssel ein“**: Der Schlüssel ist leer.
- **„Gib die Domains deiner Websites an“**: Keine Domain war lesbar; schreib
  sie wie in Plausible, durch Kommas getrennt.
- **„API-Schlüssel abgelehnt, oder keine Domain ist Plausible bekannt“**:
  Plausible antwortet gleich auf einen falschen Schlüssel und auf eine Website,
  die der Schlüssel nicht sieht. Kopiere den Schlüssel erneut (Typ Stats API)
  und prüfe die Domains. Werden nur einige Domains verweigert, werden die
  anderen gelesen, und **Verbindung testen** nennt die verweigerten.
- **„keine Plausible-Stats-API unter dieser Adresse“**: Prüfe Adresse und Port
  (standardmäßig 8000) und die Version (Community Edition 2.1 oder neuer).
- **„die Adresse leitet um“**: Gib direkt die `https://`-Adresse ein.
- **„zu viele Anfragen“**: Wähle ein längeres Intervall oder verfolge weniger
  Websites.
- Die Protokolle der Integration (**Integrationen → Plausible Analytics**)
  sagen mehr; bei einem normalen Lesezyklus wird dort nichts geschrieben.

## Grenzen

- Nur Lesen: Die Integration ändert nichts in Plausible.
- Die Domains werden von Hand eingegeben: Ein Stats-API-Schlüssel kann die
  Websites nicht auflisten (die Sites-API gibt es in der Community Edition
  nicht, und auf plausible.io ist sie dem Enterprise-Angebot vorbehalten). Eine
  in Plausible umbenannte Website muss auch in der Konfiguration umbenannt
  werden und wird ein neues Gerät.
- „Besucher gerade jetzt“ ist das 5-Minuten-Fenster von Plausible; die Zahlen
  des Tages sind höchstens 15 Minuten alt, außer beim ersten Besucher.
- Ein Plausible-Konto (plausible.io oder ein Server) pro Integration,
  höchstens 25 Websites.
- Die Schwellen von „Besucheransturm“ und „Länger kein Besuch“ gelten für alle
  Websites gleich.
- Noch nicht mit plausible.io getestet, und nicht mit Plausible Insights OÜ
  verbunden.
