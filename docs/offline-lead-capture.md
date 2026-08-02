# Offline Lead Capture

Collect student leads at an event with no internet, then upload them all with
one button when you're back online.

Live at **Students & Pipeline → Offline Capture** (`/students/offline`).

Screenshots below are of the real system, captured against production.

---

## For ICRs: using it at an event

### Setting a PIN

The first time you open Offline Capture, you'll be asked to set a PIN of at
least six digits. Leads held on the device are encrypted with it, so a lost
phone doesn't mean lost student data.

> **Nobody can recover this PIN — not IT, not us.** If you forget it, leads
> still waiting on the device can't be read and have to be erased. Upload at the
> end of each day and there's nothing to lose.

You'll be asked for it each time you open the page.

### Before you travel — do this on wifi

Open **Students & Pipeline**, then **Offline Capture**.

![Leads page](images/03-leads-banner.png)

The first time you open it, it will tell you it isn't ready:

![Not prepared](images/04-capture-empty.png)

Tap **Prepare for offline**. This downloads the Lead Source, Event and
Institution lists onto your device, and installs the page so it opens without a
signal.

![Prepared](images/05-prepared.png)

You'll see when the lists were last downloaded. **Do this the day you travel** —
if the lists are weeks old, an event created since then won't be in the list.

> **This step is not optional.** Without it, Lead Source is empty at the booth —
> and Lead Source is one of the fields required before a lead can move past
> "New Lead". You'd capture students who then can't progress.

### At the booth

Fill in the form and tap **Save to device**. You need **both an email and a
phone number** — ask for both while the student is still with you.

If the event issues scannable badges, tap **Scan badge** and hold it in the
frame. Whatever it can read is shown for you to confirm before it fills the
form, and you can still change anything. Badges differ between organisers, so
check what came through — some carry a full contact card, others only an
attendee number.

> **Scan badge only appears on Android and Chrome.** iPhones can't do this yet;
> type the details in as normal.

![Form filled in](images/06-form-filled.png)

Note the question at the bottom: **"May we email them?"** Canadian anti-spam law
requires permission before sending marketing email. There are three answers, and
they mean different things:

| Answer | Meaning |
|---|---|
| **Yes, they agreed** | You may email them |
| **No, they declined** | You must not email them |
| **Didn't ask** | Nobody asked — you can still ask later |

"Didn't ask" is not the same as "declined". Leave it honest.

Each lead is saved onto the phone:

![Saved](images/07-saved.png)

### With no signal

Everything works the same. The badge at the top changes to **No connection**,
and **Upload** is disabled until you're back online.

![Offline](images/08-offline.png)

Keep capturing. The counter next to Upload shows how many are waiting.

![Two held](images/09-offline-queue.png)

### Back on wifi

The badge returns to **Connected** and Upload becomes available.

![Back online](images/10-back-online.png)

Tap **Upload**. The device clears and the leads are in the CRM.

![Uploaded](images/11-uploaded.png)

---

## Things to know

**Up to 100 leads per session.** At 100 the form stops accepting new ones until
you upload. Not a technical limit — a limit on how much unsent work sits in one
place, because a lost phone loses all of it.

**Upload before the end of each day** if you can. Leads only exist on that one
device until they're uploaded.

**If the upload is interrupted, just press it again.** Every lead carries a
hidden ticket number, so leads that already arrived are recognised and skipped
rather than created twice.

**One bad record won't block the rest.** Each lead is sent separately. Failures
stay on the device with a note explaining what's wrong. Tap the pencil next to a
rejected lead to load it back into the form, fix it, and save — it goes up with
the next upload. Everything else uploads normally.

**Nothing is deleted from the device until the server confirms it.** If the
upload fails, nothing is removed and you'll be told so.

**If you're signed out mid-upload**, sign in and press Upload again. Nothing is
lost — sessions expire after 48 hours and an event can outlast that.

**Don't use a private/incognito window.** Offline storage is blocked there. The
page refuses to run rather than appearing to work and losing everything on
close.

---

## For developers

### Where things live

| Path | Purpose |
|---|---|
| `app/(dashboard)/students/offline/page.tsx` | Route |
| `.../offline/_components/offline-capture-client.tsx` | The capture screen |
| `.../offline/_components/register-offline-worker.tsx` | Installs the service worker |
| `.../offline/_components/pin-gate.tsx` | PIN lock in front of the screen |
| `.../offline/_components/badge-scanner.tsx` | Camera scanning |
| `lib/offline-queue.ts` | IndexedDB queue, encrypted |
| `lib/offline-crypto.ts` | AES-GCM + PBKDF2 |
| `lib/badge-scan.ts` | Badge payload parsing |
| `lib/offline-capture.ts` | The 100 limit and its warning text |
| `lib/lead-options.ts` | Dropdown options, shared with the online form |
| `app/api/leads/offline-sync/route.ts` | Batch upload |
| `app/api/leads/offline-reference/route.ts` | Dropdown data download |
| `public/sw.js` | Service worker |
| `prisma/manual/010-offline-capture.sql` | `Lead.captureId` |
| `prisma/manual/011-marketing-consent.sql` | Consent columns |

### Design decisions worth not undoing

**`Lead.captureId` is a unique idempotency key**, generated on the device at
capture. The upload endpoint checks it before inserting, and the unique index
backs that up against a race. The existing duplicate detection only *flags*
`isDuplicate` after the fact — it does not prevent the row. Without `captureId`,
a retried upload creates every already-delivered lead a second time.

**The upload endpoint is deliberately not one transaction.** A batch is a
hundred independent students; wrapping them together means one malformed row
discards ninety-nine good ones. Each is attempted alone and reported
individually as `created` / `already_synced` / `failed`.

**The device deletes only what the server confirms.** Anything not mentioned in
the response stays put. The device is the only copy.

**Validation on the device mirrors the server exactly**, both email and phone
included. A looser check would queue leads that can only fail on upload hours
later, with the student long gone.

**`marketingConsent` is `Boolean?`, three-valued.** `NULL` means nobody asked;
`false` means asked and declined. A boolean defaulting to `false` collapses
those, and under CASL that distinction is the entire point. Migration 011 does
not back-fill for the same reason.

**The service worker is deliberately narrow.** It touches the capture page
document and `/_next/static/*` and nothing else — never `/api/`, never other
navigations, never non-GET. It caches only 200 responses, so it cannot pin the
`/login` redirect in place of the page. It is registered from the capture page
alone, not the root layout, so it installs only for people who attend events.

> **Kill switch.** A service worker lives on the device and keeps misbehaving
> after you revert the deploy that caused it. To disable, replace the body of
> `public/sw.js` with:
> ```js
> self.addEventListener("install", () => self.registration.unregister());
> ```
> and deploy. Devices pick it up on their next visit.

**`proxy.ts` must keep excluding `sw.js`** from its matcher. The service worker
spec rejects a registration whose script request redirects, and every other path
through the proxy redirects a signed-out visitor to `/login`. Left in, the worker
silently fails to install with nothing in any server log — the request returns an
ordinary 307. Re-check with:

```
curl -sI https://illumestudentservices.cloud/sw.js | head -1   # must be 200
```

**Don't join template literals with `+` in `lib/offline-capture.ts`.** The limit
is a module-local constant, so the minifier folds `${OFFLINE_CAPTURE_LIMIT}` to
`100` — and while folding two `+`-joined literals it drops the static text
between the interpolation and the closing backtick. The banner shipped reading
*"holds up to 100Upload them before collecting more"*. TypeScript, eslint and the
build all passed. Keep it as one literal.

### Encryption at rest

Held leads are encrypted with AES-GCM under a key derived from the device PIN
(PBKDF2-HMAC-SHA256, 310,000 iterations — OWASP's floor, and roughly 100ms on a
mid-range phone). `captureId`, timestamps and status stay in the clear so the
queue can be counted, sorted and reconciled without a key; none of them says
anything about a student.

The threat is narrow and worth stating: a phone left on a stand or taken from a
bag. It does not defend against malware running as the user, and cannot — the
key is derived in the browser that would be compromised. A six-digit PIN is weak,
which is why the derivation is deliberately expensive: brute-forcing the space
costs hours of work on the device rather than seconds, and the queue is meant to
be emptied daily.

**There is no PIN recovery.** The key exists only in the PIN. A forgotten PIN
means the held leads cannot be read, and the only way forward is to erase them.
That is offered explicitly, with a warning, because the alternative is a device
that can never capture again. Anything that could recover the key would defeat
the one threat this exists for.

Records written before encryption existed are discarded rather than carried over
— they cannot be encrypted retroactively with a key that did not exist when they
were written, and leaving readable copies beside encrypted ones would make the
encryption decorative. The gate warns before that happens.

### Badge scanning

`lib/badge-scan.ts` reads what organisers actually put on badges: vCard, MECARD,
JSON, a URL with query parameters, `Key: value` lines, or unstructured text.
There is no standard, so it fills only the fields it is confident about and
leaves the rest to the ICR. A wrong email captured at a booth is worse than a
blank one, because nobody goes back to check — so **no name is ever guessed from
loose text**, only from a recognised structure.

Scanning uses the browser's native `BarcodeDetector`. Chrome and Android have
it; Safari and iOS do not. The button is hidden where it is unsupported rather
than failing when pressed. Everything read is shown for confirmation before it
touches the form.

### Correcting a rejected lead

A failed capture keeps its reason and can be loaded back into the form, fixed
and resaved. **The `captureId` is preserved through a correction** — a corrected
lead is the same lead, and issuing a fresh one would let the original attempt
and the retry both land. The 100-lead ceiling does not block a correction, since
it replaces a record already counted.

### Known gaps

- **iPhone cannot scan badges.** Safari has no `BarcodeDetector`. A JS decoder
  library would close this at the cost of a dependency and a slower scan.
- **The PIN is not rate-limited.** Attempts are unlimited; the cost of the key
  derivation is the only brake.
- **Reference lists do not expire.** The screen shows when they were downloaded
  but will not stop you using month-old data.
