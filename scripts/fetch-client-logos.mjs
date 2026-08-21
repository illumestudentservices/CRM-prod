/**
 * Downloads each client's logo once and writes it into public/logos as a PNG.
 *
 *   node scripts/fetch-client-logos.mjs            # fetch anything missing
 *   node scripts/fetch-client-logos.mjs --force    # re-fetch everything
 *
 * WHY THE FILES LIVE IN THE REPO. The obvious shortcut is to point logoUrl at a
 * logo service and let the browser fetch it. That would mean every load of the
 * Clients page tells a third party, once per client, which universities Illume
 * works with — the client list is commercially sensitive and there is no reason
 * to broadcast it. Fetching once also means the page still renders if that
 * service disappears or rate-limits us, and it costs about 250 KB of repo.
 *
 * WHERE THE IMAGE COMES FROM. Every one of these is downloaded, then the
 * largest is kept:
 *
 *   - the institution's own apple-touch-icon, the square high-resolution mark
 *     they publish deliberately for this purpose;
 *   - each <link rel="icon"> the homepage declares;
 *   - /apple-touch-icon.png and /favicon.ico at the root;
 *   - Google's favicon cache at 256px, which is the only route that works for
 *     the sites whose edge answers 403 to a scripted request (Brock, StFX,
 *     Glasgow Caledonian) and which is sometimes higher-resolution than the
 *     site's own (Confederation ships a 48px .ico; the cache has 256px).
 *
 * Taking the largest rather than the first plausible hit matters: ranking by
 * how trustworthy the source looks picked a 48px .ico for seven clients when a
 * 256px PNG of the same crest was one request away.
 *
 * og:image is deliberately NOT a candidate: it is a 1200x630 marketing banner,
 * and in a 44px square avatar it renders as an unreadable smear of campus photo.
 *
 * Selection and conversion are done by scripts/logo-normalise.py — see the
 * note at the top of that file for why Pillow rather than Node.
 */
import { execFileSync } from "node:child_process";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "logos");
const CATALOGUE = join(HERE, "client-web.json");
const NORMALISE = join(HERE, "logo-normalise.py");

const FORCE = process.argv.includes("--force");
/**
 * `--only acadia-university,trent-university` re-fetches just those slugs.
 *
 * Needed because the Google fallback rate-limits: a full pass asks it 39 times
 * in a couple of minutes and it starts refusing partway through, which silently
 * costs resolution on whichever clients happened to come after the cut-off.
 * Being able to go back for only those, slowly, beats re-running everything and
 * hoping the cut-off lands somewhere else.
 */
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i === -1 ? null : new Set((process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Stable, filesystem-safe id for a client name. Must match enrich-clients.mjs. */
export function slugify(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function get(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*" },
    });
    if (!res.ok) return null;
    return { buf: Buffer.from(await res.arrayBuffer()), url: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Icon URLs declared by the page itself, best-guess first.
 *
 * Parsed with a regex rather than a DOM library on purpose: this reads three
 * attributes off <link> tags in a document we then throw away, and taking a
 * parser dependency for that is not a trade worth making. A <link> written in
 * some exotic way is missed, and the root-path fallbacks below cover it.
 */
function iconsFromHtml(html, baseUrl) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/\bicon\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)/i.exec(tag)?.[1];
    if (!href) continue;
    const sizes = /\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
    const rank = rel.includes("apple-touch-icon") ? 10000 : Number(sizes ?? 0);
    try {
      out.push({ url: new URL(href, baseUrl).toString(), rank });
    } catch {
      /* malformed href — skip */
    }
  }
  return out.sort((a, b) => b.rank - a.rank).map((x) => x.url);
}

async function candidateUrls(client) {
  const urls = [];
  const page = await get(client.website);
  if (page) urls.push(...iconsFromHtml(page.buf.toString("utf8"), page.url));
  urls.push(`https://${client.domain}/apple-touch-icon.png`);
  urls.push(`https://${client.domain}/favicon.ico`);
  // Deduped because a site that declares /favicon.ico in a <link> would
  // otherwise be downloaded twice.
  const own = [...new Set(urls)].slice(0, 7);
  return [
    ...own.map((url) => ({ url, retries: 0 })),
    // Retried, unlike the institution's own URLs: this one is a shared service
    // that answers with a redirect to a non-image when it decides we have asked
    // too often, and giving up on the first refusal is how seven clients ended
    // up with a 48px .ico when a 256px PNG was available.
    { url: `https://www.google.com/s2/favicons?domain=${client.domain}&sz=256`, retries: 2 },
  ];
}

async function fetchLogo(client, scratch, current) {
  // Whatever is already on disk competes as a candidate. Without this, a
  // re-fetch that happens to hit a rate limit would overwrite a good 256px
  // crest with a 32px one, so running the script again could only ever make
  // things worse — the opposite of what a retry is for.
  const files = current ? [{ path: current, url: "(already in public/logos)" }] : [];
  let i = 0;
  for (const { url, retries } of await candidateUrls(client)) {
    let hit = null;
    for (let attempt = 0; attempt <= retries && !hit; attempt++) {
      if (attempt) await sleep(2000 * attempt);
      hit = await get(url, { timeout: 15000 });
      // Under 100 bytes is a tracking pixel or an error stub, never a logo.
      // Anything that is not an image at all is rejected by Pillow below —
      // an HTML error page served with a 200 is the common failure here, and
      // it is also what a rate-limited response looks like, so treat a
      // too-small body as a miss worth retrying rather than a result.
      if (hit && hit.buf.length < 100) hit = null;
    }
    if (!hit) continue;
    const path = join(scratch, `cand-${i++}`);
    writeFileSync(path, hit.buf);
    files.push({ path, url });
  }
  if (!files.length) return null;

  const out = join(scratch, "out.png");
  const raw = execFileSync("python", [NORMALISE, out, ...files.map((f) => f.path)], {
    encoding: "utf8",
  });
  const verdict = JSON.parse(raw.trim().split("\n").pop());
  if (!verdict.ok) return null;

  return {
    buf: readFileSync(out),
    px: `${verdict.w}x${verdict.h}`,
    lowRes: verdict.lowRes,
    considered: verdict.considered,
    from: files.find((f) => f.path === verdict.from)?.url ?? verdict.from,
  };
}

async function main() {
  const { clients } = JSON.parse(readFileSync(CATALOGUE, "utf8"));
  mkdirSync(OUT_DIR, { recursive: true });

  const scratch = join(tmpdir(), `illume-logos-${process.pid}`);
  mkdirSync(scratch, { recursive: true });

  // Any logo written by an earlier version of this script under a different
  // extension has to go, or the app would keep serving the stale one.
  for (const f of readdirSync(OUT_DIR)) {
    if (!f.endsWith(".png")) rmSync(join(OUT_DIR, f));
  }

  const results = [];
  try {
    for (const client of clients) {
      const slug = slugify(client.name);
      const file = `${slug}.png`;
      if (ONLY && !ONLY.has(slug)) continue;
      if (existsSync(join(OUT_DIR, file)) && !FORCE && !ONLY) {
        results.push({ slug, ok: true });
        console.log(`  skip   ${slug.padEnd(46)} already present`);
        continue;
      }

      const currentPath = join(OUT_DIR, file);
      const got = await fetchLogo(client, scratch, existsSync(currentPath) ? currentPath : null);
      if (!got) {
        results.push({ slug, ok: false });
        console.log(`  MISS   ${slug.padEnd(46)} no usable image`);
        continue;
      }
      writeFileSync(join(OUT_DIR, file), got.buf);
      results.push({ slug, ok: true, lowRes: got.lowRes });
      console.log(
        `  ok     ${slug.padEnd(46)} ${got.px.padEnd(9)} ` +
        `${String(got.considered).padStart(2)} cands  ${got.lowRes ? "LOW-RES  " : "         "}` +
        `${got.from.slice(0, 60)}`
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const missing = results.filter((r) => !r.ok);
  const low = results.filter((r) => r.lowRes);
  console.log(`\n${results.length - missing.length}/${results.length} logos in public/logos`);
  if (low.length) {
    console.log(
      `under 96px, which is the best their site publishes: ${low.map((l) => l.slug).join(", ")}`
    );
  }
  if (missing.length) console.log(`no logo for: ${missing.map((m) => m.slug).join(", ")}`);
}

// Importable for the slug helper without running the fetch.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
