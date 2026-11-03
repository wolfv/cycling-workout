# Plan: Benutzerkonten, 2FA und Trainingsverlauf für „Cadence“

Stand: 02.11.2026 · Repo `wolfv/cycling-workout` (Eigentümer Wolf Vollprecht)

## 1. Ist-Zustand

- **Frontend:** reines Vanilla-JS + Alpine.js, kein Build-Schritt. Rund 7.800 Zeilen in `app.js`, `ftms.js` (Web Bluetooth/FTMS), `workout-designer.js`, `workout-recorder.js`, `session-p2p.js` und weiteren Dateien.
- **Hosting:** GitHub Pages über `.github/workflows/deploy.yml`. Der Workflow führt die Tests aus (`node --test tests/*.test.cjs`), hängt Cache-Busting an und veröffentlicht.
- **Cloudflare:** nur der Signaling-Worker `zwift-signaling` (Durable Object `SignalingRoom`) unter `w-vollprecht.workers.dev` für die WebRTC-Gruppenfahrten. Er liegt in Wolfs Cloudflare-Konto.
- **Daten:** alles liegt nur im Browser (`localStorage`): gespeicherte Workouts (`zwift_workouts`), FTP-Skala, Fahrername, letztes Gerät. Eine Fahrt zeichnet `WorkoutRecorder` als Datenpunkte (Watt, HF, Kadenz, ungefähr 1 Hz) auf. Nach dem Stopp (`handleWorkoutStop` in `app.js:368`) sieht man eine Zusammenfassung und kann TCX/JSON herunterladen. Danach ist die Fahrt weg.
- **Es gibt keine Konten, keine Datenbank und keine Historie.**

## 2. Ziel

1. Registrierung und Anmeldung mit **Zwei-Faktor-Authentifizierung**.
2. Jede beendete Fahrt wird automatisch im Konto gespeichert.
3. Ein Tab **„Verlauf“** zeigt alle Trainings: Liste, Kennzahlen, Detailkurve, TCX-Download und Löschen.
4. Alles läuft auf **Cloudflare**: Frontend, API und Datenbank.
5. Die App bleibt **ohne Login nutzbar** (Gastmodus wie heute). Der Login ist ein Zusatz.

## 3. Zielarchitektur

```
Browser (bestehendes Frontend + Login-Dialog + Verlauf-Tab)
   │  gleiche Origin, HttpOnly-Session-Cookie
   ▼
Cloudflare Worker „cadence“
   ├─ Static Assets   → index.html, *.js, style.css (ersetzt GitHub Pages)
   ├─ /api/auth/*     → Better Auth (E-Mail+Passwort, 2. Faktor per E-Mail-Code)
   ├─ /api/rides/*    → Fahrten speichern, auflisten, abrufen, löschen
   └─ /api/me         → Profil (Name, FTP), Konto exportieren/löschen
         │
         ├─ D1 (SQLite, EU-Jurisdiktion): users, sessions, two_factor, rides …
         └─ (optional später) R2 für Rohdaten sehr langer Fahrten
Signaling-Worker „zwift-signaling“ bleibt vorerst unverändert.
```

**Warum so:**
- **Ein Worker mit Static Assets** statt GitHub Pages plus separater API: Frontend und API teilen sich eine Origin. Session-Cookies können dann `HttpOnly; Secure; SameSite=Lax` sein, ohne CORS-Freigaben und ohne Token in `localStorage`. Das ist der wichtigste Sicherheitsgewinn.
- **D1** ist die native Cloudflare-Datenbank. Eine Stunde Fahrt hat rund 3.600 Punkte, gzip-komprimiert etwa 20–40 KB. Das passt problemlos als BLOB in eine Zeile (D1-Limit 2 MB). R2 braucht man erst bei Bedarf.
- **Better Auth** (Open Source, läuft auf Workers mit D1) statt Eigenbau: Passwort-Hashing, Sessions, Zwei-Faktor per E-Mail-Code (Plugin `twoFactor` mit `otpOptions.sendOTP`), Rate-Limiting und E-Mail-Verifizierung sind fertig und geprüft. Kryptografie schreiben wir nicht selbst.
- **Das Frontend bleibt ohne Build-Schritt.** Nur der Worker wird von `wrangler` gebündelt. Wolfs Arbeitsweise bleibt dadurch erhalten.

## 4. Sicherheit

| Thema | Maßnahme |
|---|---|
| 2FA | Nach richtigem Passwort kommt ein 6-stelliger Code per E-Mail. Er gilt 10 Minuten, ist nur einmal verwendbar und erlaubt höchstens 5 Fehlversuche. Auf Wunsch „diesem Gerät 30 Tage vertrauen“, damit man den Code nicht bei jeder Fahrt braucht. Ist die E-Mail-Adresse verifiziert, gilt der Code als 2. Faktor. Keine Authenticator-App nötig. |
| Grenze dieser Variante | Wer das E-Mail-Postfach übernimmt, kommt auch ins Konto (Passwort-Reset und Code laufen über dieselbe Adresse). Für Trainingsdaten halte ich das für angemessen. Passkeys können später als Option dazukommen. |
| Sessions | HttpOnly-Cookie, `Secure`, `SameSite=Lax`, serverseitig in D1, Ablauf 30 Tage mit gleitender Verlängerung, „überall abmelden“. |
| Brute Force | Rate-Limiting für Login, 2FA und Registrierung (Better Auth plus Cloudflare Rate-Limiting-Binding), **Turnstile** bei Registrierung und Login. |
| CSRF | Same-Origin, SameSite-Cookie, Origin-Prüfung bei schreibenden Requests. |
| Header | CSP (nur die bestehenden CDNs unpkg/jsdelivr), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (Bluetooth erlauben). |
| Zugriff | Jede Rides-Abfrage filtert serverseitig auf `user_id` der Session (keine IDs aus dem Client vertrauen). |
| Datenschutz | Herzfrequenz zählt als Gesundheitsdatum (Art. 9 DSGVO). Darum: ausdrückliche Einwilligung beim ersten Speichern, D1 mit EU-Jurisdiktion, Konto-Export (JSON/TCX) und vollständiges Löschen. Impressum und Datenschutzerklärung klärt Wolf als Betreiber. |
| Secrets | `BETTER_AUTH_SECRET`, Turnstile- und Mail-Keys nur als `wrangler secret`, nie im Repo. |

## 5. Datenmodell (D1)

Better-Auth-Tabellen (`user`, `session`, `account`, `verification`, `twoFactor`) werden per Migration erzeugt. Dazu kommen eigene Tabellen:

```sql
CREATE TABLE profile (
  user_id     TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  rider_name  TEXT,
  ftp         INTEGER,
  hr_consent_at TEXT              -- Zeitpunkt der Einwilligung Gesundheitsdaten
);

CREATE TABLE ride (
  id            TEXT PRIMARY KEY,       -- UUID, im Client erzeugt (idempotenter Upload)
  user_id       TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  started_at    TEXT NOT NULL,
  duration_s    INTEGER NOT NULL,
  workout_name  TEXT,
  ftp           INTEGER,
  avg_power     INTEGER, max_power INTEGER,
  avg_hr        INTEGER, max_hr    INTEGER,
  avg_cadence   INTEGER,
  work_kj       INTEGER,
  np            INTEGER, tss REAL,     -- Normalized Power / Training Stress Score (serverseitig berechnet)
  group_session INTEGER DEFAULT 0,
  samples_gz    BLOB NOT NULL,          -- gzip(JSON [[t,power,hr,cad],…])
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ride_user_started ON ride(user_id, started_at DESC);

-- Phase 2: gespeicherte Workouts geräteübergreifend
CREATE TABLE saved_workout (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL, definition TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

## 6. API

| Methode | Pfad | Zweck |
|---|---|---|
| * | `/api/auth/*` | Better Auth: sign-up, E-Mail verifizieren, sign-in, two-factor (send-otp/verify-otp), Passwort-Reset, sign-out, session |
| GET/PUT | `/api/me` | Profil lesen und ändern (Name, FTP, Einwilligung) |
| DELETE | `/api/me` | Konto mit allen Daten löschen |
| GET | `/api/me/export` | Alle Daten als ZIP/JSON |
| POST | `/api/rides` | Fahrt hochladen (idempotent über Client-UUID, Größenlimit, Validierung) |
| GET | `/api/rides?cursor=` | Liste mit Kennzahlen, paginiert |
| GET | `/api/rides/:id` | Detail inkl. Samples |
| GET | `/api/rides/:id/tcx` | TCX-Export |
| DELETE | `/api/rides/:id` | Fahrt löschen |
| GET | `/api/stats?range=` | Wochen-/Monatssummen für den Verlauf-Kopf |

## 7. Frontend-Änderungen

- **Konto-Button** in der Kopfzeile: Dialog für Registrieren und Anmelden. Nach dem Passwort folgt ein Feld für den Code aus der E-Mail (mit „Code erneut senden“ und „Diesem Gerät vertrauen“). Im Konto-Menü: Abmelden, überall abmelden, Export, Konto löschen.
- **Neuer Modul `account.js`** (API-Client und Auth-Zustand im Alpine-Store), **`history.js`** (Verlauf-Tab).
- **Automatisches Speichern:** In `handleWorkoutStop` wird die Fahrt nach `getStats()` hochgeladen, wenn jemand angemeldet ist. Schlägt das fehl (offline), landet sie in einer Warteschlange in IndexedDB und wird beim nächsten Start nachgereicht. Gäste sehen den Hinweis „Anmelden, um diese Fahrt zu speichern“. Die Fahrt kann man nach dem Login nachträglich übernehmen.
- **Verlauf-Tab:** Kopf mit Wochen- und Monatssummen (Fahrten, Zeit, kJ, TSS), Liste der Fahrten, Detailansicht mit Leistungs- und HF-Kurve (bestehendes `chart.js` wiederverwenden), TCX-Download und Löschen.
- FTP und Fahrername werden mit dem Profil synchronisiert (`localStorage` bleibt Fallback für Gäste).
- Design im bestehenden Basecoat/Lucide-Stil. Mobile ab 320 px wie im bestehenden Smoke-Test.

## 8. Umsetzung in Etappen (Opus plant und prüft, Sonnet-Agenten bauen)

Gearbeitet wird auf dem Branch `feature/accounts`, nicht direkt auf `main`. Ein Push auf `main` deployt sofort auf GitHub Pages.

| # | Etappe | Wer | Abhängig von | Prüfung |
|---|---|---|---|---|
| 0 | API-Vertrag + Schema festschreiben (`docs/api.md`, Migrationen) | Opus | – | – |
| 1 | Worker-Gerüst: `wrangler.jsonc` mit Static Assets, D1-Binding, Better Auth (Passwort + E-Mail-Code als 2. Faktor, E-Mail-Versand angebunden), Security-Header, Rate-Limit, Turnstile | Sonnet A | 0 | `wrangler dev` lokal, Auth-Flow per Test |
| 2 | Rides-API + Profil/Export/Löschen + NP/TSS-Berechnung + Tests (Vitest mit `@cloudflare/vitest-pool-workers`) | Sonnet B | 1 | Tests grün, Opus-Review auf Zugriffskontrolle |
| 3 | Frontend Konto: Login-/Registrier-Dialog, 2FA-Einrichtung, Konto-Menü | Sonnet C | 0 (gegen API-Vertrag) | Browser-Check lokal |
| 4 | Frontend Verlauf-Tab + Auto-Upload + Offline-Warteschlange | Sonnet D | 0 (gegen API-Vertrag) | Browser-Check lokal, Smoke-Test erweitert |
| 5 | Deploy-Pipeline: GitHub Action `wrangler deploy` (Tests → Migrationen → Deploy), Preview-Umgebung pro Branch | Sonnet A | 1 | Deploy auf Staging |
| 6 | Gesamtprüfung: Security-Review, End-to-End mit echtem Trainer (Nico/Wolf), Lighthouse/Accessibility | Opus | 1–5 | Bericht, Fixliste |
| 7 | Umstellung: Domain auf den Worker, GitHub Pages leitet um oder wird abgeschaltet | Wolf/Nico | 6 | – |

Etappen 1, 3 und 4 laufen nach Etappe 0 parallel, weil sie nur den API-Vertrag teilen und verschiedene Dateien anfassen. Jede Etappe endet mit einem Opus-Review, bevor sie gemergt wird.

**Phase 2 (später):** gespeicherte Workouts geräteübergreifend, Passkeys, Signaling-Worker in denselben Worker holen und Gruppenräume nur für angemeldete Nutzer öffnen, Strava-Upload, TURN-Server (Cloudflare Calls) für restriktive Netze.

## 9. Kosten

- Workers Paid: 5 USD pro Monat. Empfehlenswert, weil Passwort-Hashing (scrypt) das CPU-Limit des Free-Plans (10 ms) überschreiten kann.
- D1 und Static Assets: im Paid-Plan bei dieser Nutzung praktisch kostenlos.
- E-Mail-Versand (Login-Codes, Verifizierung, Passwort-Reset): z. B. Resend oder Cloudflare Email Service. Bei kleiner Nutzerzahl kostenlos (Resend: 3.000 Mails/Monat). Pro Login fällt höchstens eine Mail an, bei „Gerät vertrauen“ deutlich weniger.

## 10. Offene Punkte und Voraussetzungen

1. **Push-Rechte fehlen noch.** Unser GitHub-Konto `Aiconsult2026` hat auf `wolfv/cycling-workout` derzeit nur Leserechte. Wolf muss uns als Collaborator (Write) einladen. Alternative: Fork und Pull Request.
2. **Cloudflare-Konto:** Der Signaling-Worker liegt in Wolfs Konto. Entweder lädt Wolf uns als Mitglied ein und legt einen API-Token für GitHub Actions an, oder alles läuft in einem eigenen Konto.
3. **Domain:** eigene Domain (z. B. `cadence.<domain>`) oder vorerst `*.workers.dev`?
4. **2FA-Variante:** entschieden am 02.11.2026: Passwort + Code per E-Mail, keine Authenticator-App.
5. **E-Mail-Anbieter und Absenderadresse:** Jetzt Pflicht, weil der Login davon abhängt. Die Absender-Domain braucht SPF/DKIM, sonst landen die Codes im Spam.
6. **Betreiber und Datenschutz:** Wer ist Verantwortlicher im Sinne der DSGVO (Wolf privat?), Impressum und Datenschutzerklärung.
