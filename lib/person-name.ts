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

/** Ordering by name, family name first, as a directory would list it. */
export const NAME_ORDER = [{ lastName: "asc" as const }, { firstName: "asc" as const }];
