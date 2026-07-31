# Person names: split into first + last

Code complete on `wip/split-person-names` as of 2026-07-31. Builds clean, 0 tsc
errors, `stage-audit.mjs` passes. **The migration has not been run.**

---

## The request

> Wherever there is a name it should always be first name and last name
> separately — no full name.

Two decisions the user made:

| Question | Their answer |
|---|---|
| Existing names that don't split cleanly | **Split everything on the first space.** No review queue. |
| Scope | **Students and users only** — `Lead` and `User`. Nothing else. |

**Scope was respected.** `AccountRequest.fullName`, `Institution.primaryContact`,
`Source.contactPerson`, `Employee.emergencyContact`, `InstitutionContact.name`,
`Counsellor.name` and `ActivityAttendee.name` all keep their single fields.

---

## The one thing left to do

Run `prisma/manual/009-split-person-names.sql` against the target database.

**Run the SQL file — do not `prisma db push` this change.** Push would see
`fullName` gone from the schema and drop the column before anything had been
read out of it, taking all 52 names with it. The SQL does it in the safe order:

1. writes every original `fullName` into an `audit_logs` row, before anything
   is overwritten
2. adds the columns nullable
3. backfills with the first-space split
4. verifies no row came out nameless — raises and rolls the whole thing back if
   any did
5. only then drops `leads.fullName`

The split expressions were checked against `splitLegacyName()` in
`lib/person-name.ts` on all nine awkward cases (surname-first, patronymic,
titled, single-word, messy whitespace); they agree exactly.

After running it: `npx prisma generate`, then redeploy.

---

## The split is knowingly wrong in places

31% of the 52 lead names are not two words, and a first-space split misfiles
several:

```
"Chen Xiao Ming"              Chinese — Chen is the FAMILY name (comes first)
"Tran Thi Mai"                Vietnamese — Tran is the family name (comes first)
"Nur Aisyah Binti Zulkifli"   Malay — "Binti" = daughter of; no Western surname
"Omar Bin Rashid"             Arabic patronymic
"Dr. Mei Ling"                carries a title
```

The user was shown this and chose the simple split. What makes it recoverable
is step 1 above: the originals survive in an audit row
(`action = 'LEAD_NAMES_PRE_SPLIT_SNAPSHOT'`), so a name corrected later is
corrected against the record rather than someone's memory.

---

## How it fits together

**`lib/person-name.ts`** is the whole vocabulary:

| Function | For |
|---|---|
| `displayName(p)` | UI, exports, emails, PDFs |
| `displayNameOr(p, fallback)` | same, falling back to an email or phone |
| `initials(p)` | avatars — one letter per part, so a three-word given name still gives two initials |
| `userNameFields(p)` | **write** path for users: returns firstName, lastName *and* the derived `name` |
| `snapshotName(p)` | reading names out of stored report JSON, in either shape |
| `splitLegacyName(full)` | the first-space guess, for the migration and single-field imports |
| `nameSearchFilter(term)` | Prisma `where` matching a term across both parts |
| `nameOrder(direction)` | Prisma `orderBy`, family name then given name |

**`User.name` is derived, never authored.** It stays because NextAuth's adapter
contract puts it in `session.user.name`, read in ~70 places. Every write goes
through `userNameFields()` so the three cannot drift. The sites that write it:
`app/api/hr/employees/route.ts` (create), `app/api/hr/employees/[id]/route.ts`
(update — recombines with the stored half when only one part is sent), and
`lib/user-lifecycle.ts` (purge, which now clears both parts as well as `name`;
clearing only `name` would have left the real name in the columns it came from).

`app/api/settings/users/*` does not touch the name — it only changes role,
active state and region — so it needs no derivation.

---

## Things worth knowing

- **`getInitials(name)` in `lib/utils.ts` is still used** for institutions and
  for users whose Prisma select carries only `name`. Do not delete it.
  `initials()` supersedes it only where both parts are actually in hand.
- **Report `leadsData` is an immutable JSON snapshot.** Reports generated before
  the split still hold `fullName`, so all four readers go through
  `snapshotName()`, which accepts either shape. This mirrors the tolerance
  `stageLabel()` already applies to old stage names in the same blob.
- **Lead dedup** matches `firstName AND lastName AND phone` — the same test the
  single `fullName` equality made. Matching one part alone would flag everyone
  sharing a surname as a duplicate.
- **The leads list `sortBy` query parameter takes `lastName`, not `fullName`.**
  It orders by both parts via `nameOrder()`.
- **The students table filters on an `accessorFn`, not an `accessorKey`** — no
  stored column holds the whole name, so keying the search box to one part would
  match only half of what the row visibly says.
- **The CSV export has two columns**, First Name and Last Name. The export feeds
  university application forms, which ask for them separately.
- **`prisma/seed.ts` must never run against production.** It contains
  `password123` accounts; that already reached production once.
