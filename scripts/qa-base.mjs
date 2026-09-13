/**
 * Which server the QA scripts talk to, and the guard that stops it being
 * production by accident.
 *
 * This lived inside `qa-lib.mjs`, which was the right place for everything that
 * imports it — but five standalone scripts do not, and each carried its own
 *
 *     const BASE = process.env.BASE_URL ?? "https://illumestudentservices.cloud";
 *
 * so forgetting BASE_URL pointed them at the live system. These scripts create
 * users, upload files and delete rows. `qa-crud.mjs` had the same line inline on
 * a single fetch, which is how an attachment upload ended up being POSTed to
 * production with an id that only exists on the mirror — it returned 404 and
 * looked for months like a broken endpoint.
 *
 * Pulled out here so there is ONE definition. A second copy is how the first one
 * drifted.
 */
const PROD_HOST_RE = /illumestudentservices\.(cloud|ca)|187\.124\.112\.151/i;

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";

/**
 * Localhost unless asked otherwise, and production only on purpose.
 *
 * Throws rather than warns: a warning scrolls past and the writes happen
 * anyway.
 */
export function assertNotProdUnlessAllowed(base = BASE) {
  if (PROD_HOST_RE.test(base) && process.env.ALLOW_PROD_QA !== "yes-i-mean-it") {
    throw new Error(
      `Refusing to run against production (${base}).\n` +
      `These scripts create users and fixture data. Point BASE_URL at a dev server,\n` +
      `or set ALLOW_PROD_QA=yes-i-mean-it if you genuinely intend to write to prod.`
    );
  }
  return base;
}

assertNotProdUnlessAllowed();
