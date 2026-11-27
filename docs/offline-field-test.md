# Offline app: field test and team APK

For Stage 2 (Android app that works without a signal, technicians only). Use this to test on real phones and to give
the app to the team.

## 1. Put the new version on the server

The app calls endpoints that older server versions do not have (`/api/v1/sync`, `/field/location/batch`, the
`Idempotency-Key` header). Deploy first:

```bash
git pull origin main
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d --force-recreate
docker compose -f docker-compose.prod.yml logs --tail=100 web
```

The container runs `pnpm db:deploy` on start, which creates the `IdempotencyKey` table (migration
`20261126120000_idempotency_keys`). The log should end with the server listening, with no migration error.

## 2. Build the APK (on the PC)

`mobile/.env` must contain the live address (it is baked into the app at build time):

```
VITE_API_BASE_URL=https://fsm.core9ventures.com
```

```bash
cd mobile
node scripts/build-apk.mjs
```

The file is `mobile/apk/fieldserve-debug.apk`. Check its time stamp is new. Send it by WhatsApp, e-mail or a shared
folder. On each phone: open the file, allow "Install unknown apps" for the app you opened it from, install.
Uninstall an older FieldServe first if the phone says the app conflicts.

First start needs a signal: sign in, wait until the bar under the header says **Last synced just now**. The phone has
then copied the next 7 days of jobs, jobs in progress or on hold, the technician's installations and the companies.

## 3. How to read the screens

| What you see | Meaning |
|---|---|
| Dark bar "You are offline…" | The server cannot be reached. Everything is saved on the phone. |
| Amber bar "N changes saved on this phone…" | Changes (and photos) waiting for a signal. Tap to see them. |
| Red bar "N changes could not be sent" | The server refused them (job cancelled, reassigned, …). Tap for the reason. |
| "Last synced 5 min ago" and **Sync** | Time of the last copy from the server. |
| Account → Offline data | Server reachable, last sync, waiting changes, refused changes, GPS points waiting. |

The app notices by itself when the signal is back (checks every 20 seconds while offline) and sends the queue, then
syncs. **Sync** and **Send changes and sync everything** do the same on demand.

## 4. Field test days (two or more phones)

Use one technician account per phone. Write down the date, phone model and Android version. Between steps, look at
Account → Offline data. After each day the queue must be empty and the web portal must show everything once.

**A. Full day without signal**
1. Sign in with a signal and wait for the first sync. Turn on airplane mode. Close and reopen the app: it opens and
   shows the saved jobs and installations.
2. On a job: on my way, start, tick checklist items, add a note, take before and after photos (labeled and other),
   complete it.
3. New installation with photos and the video, save it. Start another, fill half, put it on hold. Open a held record,
   change it, finish it.
4. Walk or drive a few minutes (GPS points waiting should grow, one a minute while the app is open).
5. Turn airplane mode off. Within about a minute the dark bar goes, the queue empties, "Last synced just now".
6. On the web: every status change, note, photo, installation and the GPS trail appears **once**, in the right order.

**B. Very weak signal** (one bar, or walk away from the router; or limit the phone's network speed)
1. Open the app: it opens within about 6 seconds with the saved data, it does not hang.
2. Change a job status: it is saved at once (queued if the server is slow) and appears on the web later, once.

**C. Signal lost during upload**
1. With a signal take 5 photos in a row, switch airplane mode on after the second.
2. The rest wait. Switch it off: the queue finishes. No photo twice, none missing on the web.

**D. Low battery and low storage**
1. Battery saver on and under 15 %: the full flow above still works.
2. Fill the phone's storage almost completely, then take a photo offline: the app says the phone is almost out of
   storage and does **not** pretend it was saved. Free space and take it again.

**E. The office changes things while the technician is offline**
1. Technician offline: starts a job, adds a note and a photo. Office cancels it. Reconnect: red bar, reason "The
   office cancelled this job", note text and photo name still listed. **Copy my note** works. Nothing is lost
   until the technician deletes the change.
2. Same with the office giving the job to another technician: reason "…another technician".
3. Held installation: technician offline changes the notes, office changes the location. Reconnect and finish: both
   changes are on the record, and the app says the office's change was kept.

**F. Sign out and another person**
1. Sign out with changes waiting: the app warns that they stay on the phone.
2. Sign in as a different technician: none of the first person's jobs, installations or photos are visible.
3. Sign back in as the first one with a signal: their waiting changes are sent.

**G. Online behaviour** (repeat the Stage 1 QA lists on this APK): sign-in, my jobs, job actions, photos, the
installation form, office screens for Admin and Dispatcher. Office users still need a signal.

## 5. What to report

Phone model and Android version, what you did, what you expected, what happened, and a screenshot of
Account → Offline data. For the server side: `docker compose -f docker-compose.prod.yml logs --tail=200 web`.

## 6. Known limits

- Only technicians work offline. Office users (Admin, Dispatcher) need a signal.
- Photos and videos already on the server can be opened only with a signal. Photos taken offline show at once.
- GPS is recorded while the app is open and on screen (also offline). Not with the app closed or the screen off.
- If the same field of a held installation is changed by the technician and by the office, the technician's value wins.
- The sign-in token is kept in the app's private storage (not in a hardware vault). A lost phone should have its
  screen lock on; sign out remotely by disabling the user on the web.
