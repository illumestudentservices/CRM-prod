# Handoff: split person names into first + last

Written 2026-07-30. The work is **incomplete and does not build**. It is preserved
on the branch `wip/split-person-names`; `main` is clean, builds, and matches
production.

---

## The request

> Wherever there is a name it should always be first name and last name
> separately — no full name.

Two decisions the user made when asked:

| Question | Their answer |
|---|---|
| Existing names that don't split cleanly | **Split everything on the first space.** No review queue. |
| Scope | **Students and users only** — `Lead` and `User`. Nothing else. |

**Respect the scope.** `AccountRequest.fullName`, `Institution.primaryContact`,
`Source.contactPerson`, `Employee.emergencyContact`, `InstitutionContact.name`,
`Counsellor.name` and `ActivityAttendee.name` all keep their single fields. A
blanket find-and-replace rewrote the AccountRequest ones twice and both times it
had to be undone — the regex cannot tell scope from shape.

---

## What the user was told, and should not be surprised by

31% of the 52 lead names are **not two words**, and a first-space split records
several of them wrongly:

```
"Chen Xiao Ming"              Chinese — Chen is the FAMILY name (comes first)
"Tran Thi Mai"                Vietnamese — Tran is the family name (comes first)
"Nur Aisyah Binti Zulkifli"   Malay — "Binti" = daughter of; no Western surname
"Omar Bin Rashid"             Arabic patronymic
"Dr. Mei Ling"                carries a title
```

They were shown this and chose the simple split anyway. That is their call. The
mitigation agreed was: **the migration must write the original 52 names into an
audit row before splitting**, so wrong ones can be corrected from a source of
truth rather than memory. That has not been done yet.

---

## State of play

### Done and believed correct

- **`prisma/schema.prisma`**
  - `Lead.firstName String` + `Lead.lastName String`, replacing `fullName`
  - `User.firstName String?` + `User.lastName String?`
  - `User.name` **kept deliberately**. NextAuth's `session.user.name` is part of
    the adapter contract and is read in ~70 places; removing it means reworking
    authentication to change a display string. It must become a **derived value
    written on every user create/update** — that wiring does not exist yet.

- **`lib/person-name.ts`** (new)
  - `displayName(p)` — for UI, exports, emails, PDFs
  - `initials(p)` — one letter per part, so a three-word given name still yields
    two initials
  - `splitLegacyName(full)` — first-space split, used by the migration
  - `nameSearchFilter(term)` — a Prisma `where` fragment matching a term across
    both parts, so searching "Nkechi Obi" still works with no concatenated column
  - `NAME_ORDER` — `[{ lastName: asc }, { firstName: asc }]`

- **`lib/lead-gate.ts`** — Stage 1 required a `fullName` field that no longer
  exists. Left alone it would have blocked **every lead permanently**. Now
  requires `firstName` and `lastName` separately. `stage-audit.mjs` passes.

- **`app/(dashboard)/students/_components/lead-form.tsx`** — First Name and Last
  Name inputs replace the single field; zod schema updated.

- **`app/api/leads/route.ts`** — create schema takes `firstName`/`lastName`;
  `sortBy` enum uses `lastName` instead of `fullName`.

- ~24 further files mechanically converted to `displayName(x)`.

### Not done

- **25 TypeScript errors.** Run `npx tsc --noEmit` on the branch to list them.
  They cluster in:
  - `app/(dashboard)/reports/[id]/**` and `app/api/reports/**` — local row types
    declaring `fullName: string`, plus two `as` casts that now mismatch
  - `app/api/reports/[id]/pdf/route.ts`, `app/api/email/send-report/route.ts`
  - `app/(dashboard)/whatsapp/**` — `Conversation`/`Lead` local types
  - `app/(dashboard)/search/page.tsx` — a `where` clause still using `fullName`
  - `prisma/seed.ts` — lead literals still passing `fullName`
- **~71 remaining `fullName` references** (excluding the correctly-scoped-out files).
- **`User.name` derivation** — nothing yet keeps it in step with first/last.
- **The data migration — not written, not run.**

---

## Nothing is at risk

- Production runs `4c48305`, which predates all of this.
- **No migration was executed.** The 52 leads still hold their original
  `fullName` values; `firstName`/`lastName` columns do not exist in the database.
- `main` is clean and builds with 0 errors.

---

## Suggested order for the next session

1. `git checkout wip/split-person-names`
2. `npx tsc --noEmit` and work the list **file by file, by hand**. The scripted
   approach stalled — the final pass changed nothing and left the error count
   flat. Each remaining site needs a judgement about whether it wants a display
   string, two columns, or a search filter.
3. Wire `User.name` as derived: set it from `firstName`/`lastName` in every place
   a user is created or updated (`app/api/hr/employees/route.ts`,
   `app/api/settings/users/**`, `app/api/hr/unlinked-users/route.ts`).
4. Write `prisma/manual/009-split-person-names.sql`:
   - add `firstName`/`lastName` to `leads` and `users`
   - **write the 52 original names into an `audit_logs` row first**
   - backfill with a first-space split
   - drop `leads.fullName` only after the backfill is verified
5. `npm run build` — it caught a Suspense-boundary problem earlier that `tsc`
   did not.
6. Re-run `node stage-audit.mjs` — it verifies every gate requirement still has a
   UI input, and it already caught the missing first/last fields once.
7. Verify search, sort, dedup, exports, PDFs and emails. Lead **dedup** compares
   names and must now compare both parts.

---

## Things that will bite

- **`getInitials(name)` in `lib/utils.ts`** takes a single string and has ~38
  callers. `initials()` in `person-name.ts` supersedes it for people, but the
  old one is still used for institutions and other entities — do not delete it.
- **Sorting** — `orderBy: { fullName: "asc" }` becomes `NAME_ORDER`. The leads
  list exposes `sortBy` as a query parameter; `fullName` is no longer valid.
- **Lead dedup** in `app/api/leads/route.ts` matched on `fullName`. It now needs
  `AND` across both parts, which is stricter — worth a deliberate look.
- **`prisma/seed.ts`** must never run against production. It contains
  `password123` accounts; that already reached production once.
