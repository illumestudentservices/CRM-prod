/**
 * People's names, stored as given name and family name separately.
 *
 * University applications ask for the two parts separately, and a single field
 * cannot be divided reliably afterwards: about a third of this pipeline's names
 * are not two words, and several are surname-first — "Chen Xiao Ming" and
 * "Tran Thi Mai" both carry the family name in front. Capturing the parts at
 * entry avoids guessing later.
 */

export interface PersonName {
  firstName?: string | null;
  lastName?: string | null;
}

/** For display, exports, emails and PDFs. Never stored on Lead. */
export function displayName(p: PersonName | null | undefined): string {
  if (!p) return "";
  return [p.firstName?.trim(), p.lastName?.trim()].filter(Boolean).join(" ");
}

/** Falls back to another string — usually an email — when no name is set. */
export function displayNameOr(p: PersonName | null | undefined, fallback: string): string {
  const n = displayName(p);
  return n.length > 0 ? n : fallback;
}

/**
 * Initials for avatars.
 *
 * Takes one letter from each part rather than splitting a single string, so a
 * three-word given name still yields two initials rather than three.
 */
export function initials(p: PersonName | null | undefined, fallback = "?"): string {
  const f = p?.firstName?.trim()?.[0] ?? "";
  const l = p?.lastName?.trim()?.[0] ?? "";
  const out = (f + l).toUpperCase();
  return out || fallback;
}

/**
 * The three fields to write whenever a user's name changes.
 *
 * `User.name` is derived, never authored. It stays because NextAuth's adapter
 * contract puts it in `session.user.name`, which roughly seventy call sites
 * read; writing the two parts without it would leave every one of those
 * showing the previous name indefinitely. Always spread this rather than
 * setting the parts by hand, so the three cannot drift apart.
 */
export function userNameFields(p: PersonName): {
  firstName: string;
  lastName: string;
  name: string;
} {
  const firstName = (p.firstName ?? "").trim();
  const lastName = (p.lastName ?? "").trim();
  return { firstName, lastName, name: displayName({ firstName, lastName }) };
}

/**
 * A name read out of a stored JSON snapshot, in either shape.
 *
 * `MonthlyReport.leadsData` freezes the lead rows as they stood when the report
 * was generated, so reports written before the split still carry a single
 * `fullName`. That snapshot is deliberately immutable — it is the record of
 * what was reported — so it is read in both shapes rather than rewritten, the
 * same tolerance `stageLabel` already applies to old stage names in the same
 * blob.
 */
export interface SnapshotName extends PersonName {
  fullName?: string | null;
}

export function snapshotName(p: SnapshotName | null | undefined): string {
  return displayName(p) || (p?.fullName?.trim() ?? "");
}

/**
 * Splits a legacy single name on the first space.
 *
 * Used by the migration and when importing from a source that only supplies one
 * field. It is a guess, and a wrong one for surname-first and patronymic names,
 * so anything reaching this path should be reviewable afterwards rather than
 * treated as authoritative.
 */
export function splitLegacyName(full: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const t = (full ?? "").trim().replace(/\s+/g, " ");
  if (!t) return { firstName: "", lastName: "" };
  const i = t.indexOf(" ");
  if (i === -1) return { firstName: t, lastName: "" };
  return { firstName: t.slice(0, i), lastName: t.slice(i + 1) };
}

/**
 * A Prisma `where` fragment matching either part, or both across a space.
 *
 * Searching "Nkechi Obi" has to match a record whose parts are stored
 * separately; matching each token independently is what makes that work
 * without a concatenated column.
 */
export function nameSearchFilter(term: string) {
  const q = term.trim();
  if (!q) return undefined;
  const tokens = q.split(/\s+/).filter(Boolean);
  const contains = (field: "firstName" | "lastName", value: string) =>
    ({ [field]: { contains: value, mode: "insensitive" as const } });

  // Any single token may land in either part.
  const perToken = tokens.map((t) => ({
    OR: [contains("firstName", t), contains("lastName", t)],
  }));

  return {
    OR: [
      // Every token matches somewhere — handles "Obi Nkechi" as well as
      // "Nkechi Obi".
      { AND: perToken },
      contains("firstName", q),
      contains("lastName", q),
    ],
  };
}

/**
 * Ordering by name, family name first, as a directory would list it.
 *
 * Takes a direction because the leads list exposes sort order as a query
 * parameter; a fixed ascending constant could not serve it. Both parts are
 * always ordered together — sorting on `lastName` alone leaves leads who share
 * a surname in whatever order the planner happens to return.
 */
export function nameOrder(direction: "asc" | "desc" = "asc") {
  return [{ lastName: direction }, { firstName: direction }];
}
