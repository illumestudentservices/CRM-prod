import { PERMISSION_MATRIX, type Role, type Resource } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { FEATURE_CATALOGUE, type CatalogueEntry } from "@/lib/assistant-catalog";
import { detectIntent, runStat, type StatAnswer } from "@/lib/assistant-stats";

/**
 * Deterministic answers for the in-app help widget.
 *
 * There is no language model here, deliberately. Every question this widget
 * handles — "where is X", "can I use X", "why can't I see X" — is already
 * decided by data the application owns: the feature catalogue and
 * PERMISSION_MATRIX. Asking a model to phrase an answer that has already been
 * computed adds latency, cost, an API key, and the possibility of describing a
 * screen that does not exist. A lookup cannot hallucinate.
 *
 * The cost of this choice is vocabulary: the user has to use a word the
 * catalogue knows. That is why aliases are generous and matching is fuzzy, and
 * why a miss returns the full list the user CAN reach rather than an empty
 * result.
 */

export type AnswerKind = "found" | "restricted" | "not_found" | "stats";

export interface Answer {
  kind: AnswerKind;
  /** Plain-English response for the widget. */
  message: string;
  /** Features the user can open, best match first. */
  matches: Array<{
    key: string; name: string; route: string; summary: string;
    /** Actions beyond read, e.g. ["write", "approve"]. */
    can: string[];
  }>;
  /** For "restricted": who to ask. Empty when nothing is disclosed. */
  askRoles?: string[];
  /** For "stats": real figures, scoped to the caller. */
  stats?: StatAnswer;
}

/**
 * The one externally-held role.
 *
 * An INSTITUTION_CLIENT is a partner university, not staff. For every other
 * role, telling someone "Reports exists but you don't have access" is helpful.
 * For this one it discloses the shape of Illume's internal systems to an
 * outside party, so restricted features are reported as not found instead.
 */
const EXTERNAL_ROLES: readonly Role[] = ["INSTITUTION_CLIENT"];

/** Human labels, so the widget never prints REGIONAL_MANAGER at a user. */
const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "a System Administrator",
  HQ_EXECUTIVE: "an HQ Executive",
  HQ_ANALYTICS: "HQ Analytics",
  REGIONAL_MANAGER: "your Regional Manager",
  ICR: "an ICR",
  INSTITUTION_CLIENT: "a client contact",
  HR_MANAGER: "an HR Manager",
  EMPLOYEE: "an employee",
  ACCOUNT_MANAGER: "an Account Manager",
  ADMISSIONS_SUPPORT: "Admissions Support",
  VP_GLOBAL_SALES: "the VP of Global Sales",
};

const ACTION_LABELS: Record<string, string> = {
  write: "add and edit",
  delete: "delete",
  approve: "approve",
  export: "export",
};

/** Strip punctuation and filler so "Where's the students page?" matches. */
const STOPWORDS = new Set([
  "where", "is", "the", "a", "an", "how", "do", "i", "can", "my", "me", "to",
  "in", "on", "at", "of", "for", "find", "see", "get", "page", "screen", "it",
  "what", "which", "does", "did", "am", "are", "you", "we", "us", "and", "or",
  "why", "cant", "cannot", "not", "have", "access", "there", "put", "go",
]);

function tokenise(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Score one entry against the query tokens.
 *
 * Weighted so an alias hit beats a summary hit: someone typing "handover" means
 * the module called that, not every module whose description mentions handing
 * over. Prefix matching covers plurals and truncation ("student" → "students")
 * without a stemmer.
 */
function score(entry: CatalogueEntry, tokens: string[], phrase: string): number {
  // Phrase match first. "my to do list" tokenises to ["list"] because "my",
  // "to" and "do" are all stopwords — the meaning lives in the whole string,
  // not the words that survive. Checked against the normalised query so an
  // alias like "to do" is still reachable.
  if (phrase) {
    const lower = entry.aliases.map((a) => a.toLowerCase());
    if (lower.includes(phrase) || entry.name.toLowerCase() === phrase) return 14;
    // Only MULTI-WORD aliases may match as a substring of the query. The
    // reverse direction (alias contains query) is deliberately absent: it made
    // "students" match WhatsApp, whose alias is "messaging students", because
    // a long alias swallows any short word inside it.
    if (lower.some((a) => a.includes(" ") && phrase.includes(a))) return 13;
  }
  if (!tokens.length) return 0;
  const name = entry.name.toLowerCase();
  const aliases = entry.aliases.map((a) => a.toLowerCase());
  const summary = entry.summary.toLowerCase();
  const key = entry.key.toLowerCase();

  let total = 0;
  for (const t of tokens) {
    if (name === t || key === t) { total += 12; continue; }
    if (aliases.includes(t)) { total += 10; continue; }
    if (name.includes(t)) { total += 6; continue; }
    if (aliases.some((a) => a.includes(t) || t.includes(a))) { total += 5; continue; }
    // Prefix match catches plurals and partial words. Words shorter than three
    // characters are skipped: "Closing a Student" contains "a", and without
    // this guard `t.startsWith(w)` made EVERY query beginning with "a" score
    // against it — "analitics" resolved to Closing a Student.
    const MIN_PREFIX = 3;
    if (name.split(/\s+/).some(
      (w) => w.length >= MIN_PREFIX && (w.startsWith(t) || t.startsWith(w))
    )) { total += 4; continue; }
    if (aliases.some((a) => a.split(/\s+/).some(
      (w) => w.length >= MIN_PREFIX && w.startsWith(t)
    ))) { total += 3; continue; }
    if (summary.includes(t)) { total += 1; continue; }

    // Typo tier, last and cheapest-scoring: only reached when nothing above
    // matched, so a correctly-spelled hit always outranks a near-miss.
    const slack = slackFor(t);
    if (slack > 0) {
      const near = (v: string) =>
        v.split(/\s+/).some((w) => w.length > 3 && editDistance(t, w, slack) <= slack);
      // A near-miss on the module's own NAME outranks one on an alias. Without
      // this, "analitics" scored equal against Analytics and an unrelated entry
      // whose alias happened to be within two edits, and the tie was settled by
      // catalogue order — which is not a reason.
      if (near(name) || near(key)) total += 3;
      else if (aliases.some(near)) total += 2;
    }
  }
  return total;
}

/**
 * Edit distance, capped.
 *
 * Bails as soon as the best possible result exceeds `max`, so a long word is
 * not compared character-by-character against every alias in the catalogue.
 * Two is the right ceiling: it catches "studnets" and "trasnition" without
 * letting "tasks" match "marks".
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowBest) rowBest = curr[j];
    }
    if (rowBest > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * How much slack a word of this length gets.
 *
 * Short words get none — at four characters a single edit turns one real word
 * into another ("task" / "tasks" / "marks"), and a wrong confident answer is
 * worse than a miss.
 */
function slackFor(token: string): number {
  if (token.length <= 4) return 0;
  if (token.length <= 7) return 1;
  return 2;
}

/** Which roles hold read on a resource — the "who do I ask" answer. */
function rolesWithAccess(resource: Resource): string[] {
  return (Object.keys(PERMISSION_MATRIX) as Role[])
    .filter((r) => (PERMISSION_MATRIX[r]?.[resource] ?? []).includes("read"))
    // A user is told to ask someone who can grant or perform it, not every
    // holder — listing eleven roles is not an answer.
    .filter((r) => r === "SUPER_ADMIN" || r === "REGIONAL_MANAGER" || r === "HQ_EXECUTIVE")
    .map((r) => ROLE_LABELS[r]);
}

async function actionsFor(role: Role, resource: Resource | null): Promise<string[]> {
  if (!resource) return [];
  const out: string[] = [];
  for (const a of ["write", "delete", "approve", "export"] as const) {
    if (await effectiveHasPermission(role, resource, a)) out.push(a);
  }
  return out;
}

function describeCan(can: string[]): string {
  const labels = can.map((c) => ACTION_LABELS[c]).filter(Boolean);
  if (!labels.length) return "You can view it.";
  if (labels.length === 1) return `You can view and ${labels[0]} records here.`;
  return `You can view, ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} records here.`;
}

/**
 * Answer a question about the system.
 *
 * Order matters: accessible matches win outright. Only when nothing the user
 * can reach matches do we consider restricted features, so a user is never told
 * "you can't access X" when the thing they meant was sitting in front of them.
 */
export async function answer(
  query: string,
  role: Role,
  userId?: string
): Promise<Answer> {
  // A question asking for a NUMBER is answered with the number. Checked first
  // because "how many students do I have" would otherwise resolve to the
  // Students screen — correct, but not what was asked. Requires a userId, so
  // callers that cannot supply one simply get the catalogue behaviour.
  if (userId) {
    const intent = detectIntent(query);
    if (intent) {
      const stats = await runStat(intent, role, userId);
      if (stats) {
        return {
          kind: "stats",
          message: `${stats.title}. The same figures are on ${stats.routeLabel}.`,
          matches: [],
          stats,
        };
      }
      // Not entitled to those figures — fall through to the normal answer,
      // which will say the module is out of reach rather than report zero.
    }
  }

  const tokens = tokenise(query);
  const phrase = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  // Resolve access once per entry rather than per comparison.
  const scored = await Promise.all(
    FEATURE_CATALOGUE.map(async (entry) => ({
      entry,
      points: score(entry, tokens, phrase),
      accessible:
        entry.resource === null ||
        (await effectiveHasPermission(role, entry.resource, "read")),
    }))
  );

  const accessible = scored
    .filter((s) => s.accessible && s.points > 0)
    .sort((a, b) => b.points - a.points);

  if (accessible.length) {
    const top = accessible.slice(0, 3);
    const matches = await Promise.all(
      top.map(async (s) => ({
        key: s.entry.key,
        name: s.entry.name,
        route: s.entry.route,
        summary: s.entry.summary,
        can: await actionsFor(role, s.entry.resource),
      }))
    );
    const best = matches[0];
    return {
      kind: "found",
      message: `${best.name} is at ${best.route}. ${best.summary} ${describeCan(best.can)}`,
      matches,
    };
  }

  // Nothing they can reach matched. Does it exist but sit behind a permission?
  const restricted = scored
    .filter((s) => !s.accessible && s.points > 0)
    .sort((a, b) => b.points - a.points);

  if (restricted.length && !EXTERNAL_ROLES.includes(role)) {
    const e = restricted[0].entry;
    const ask = e.resource ? rolesWithAccess(e.resource) : [];
    return {
      kind: "restricted",
      message:
        `${e.name} exists, but your role does not have access to it. ` +
        (ask.length
          ? `Ask ${ask[0]} if you need it.`
          : `Ask a System Administrator if you need it.`),
      matches: [],
      askRoles: ask,
    };
  }

  // Genuine miss — or a restricted feature we will not disclose to an external
  // role. Both return the same shape, so an outside party cannot tell the
  // difference between "does not exist" and "you are not allowed to know".
  const available = await Promise.all(
    scored
      .filter((s) => s.accessible)
      .map(async (s) => ({
        key: s.entry.key,
        name: s.entry.name,
        route: s.entry.route,
        summary: s.entry.summary,
        can: await actionsFor(role, s.entry.resource),
      }))
  );

  return {
    kind: "not_found",
    message:
      "I could not find that. Here is everything you have access to — or send it to IT and someone will get back to you.",
    matches: available,
  };
}
