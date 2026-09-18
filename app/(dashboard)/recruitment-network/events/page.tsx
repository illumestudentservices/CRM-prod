import { redirect } from "next/navigation";

/**
 * Moved to Recruitment Planning on 2026-09-18.
 *
 * Kept as a redirect rather than deleted: these URLs are in bookmarks, in
 * links from other modules, and in anything anyone has shared. A 404 here
 * would look like the feature was removed rather than relocated.
 *
 * The query string is carried across so a saved filter or status tab still
 * lands on the same view.
 */
export default async function MovedToEvents({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
  }
  const q = qs.toString();
  redirect(`/recruitment-planning/events${q ? `?${q}` : ""}`);
}
