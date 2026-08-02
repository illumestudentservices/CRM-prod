/**
 * Turns whatever is encoded on an event badge into lead fields.
 *
 * There is no standard for this. Organisers encode vCard, MECARD, a URL with
 * query parameters, loose JSON, or plain `Key: value` lines — and some encode
 * nothing but an attendee number. So this reads what it recognises, returns
 * only the fields it is confident about, and leaves the rest to the ICR. It
 * never guesses a value into a field it is not sure of: a wrong email captured
 * at a booth is worse than a blank one, because nobody goes back to check.
 */

export interface ScannedBadge {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  countryOfResidence?: string;
  nationality?: string;
  interestedProgram?: string;
  /** What was scanned, kept so an unrecognised badge is not silently discarded. */
  raw: string;
  /** Which shape it was read as, for the "we read this" summary. */
  format: "vcard" | "mecard" | "json" | "url" | "keyvalue" | "unrecognised";
}

const EMAIL_RE = /[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[A-Za-z]{2,}/;
// Deliberately loose: booth badges carry every international format going.
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;

function splitName(full: string): { firstName?: string; lastName?: string } {
  const t = full.trim().replace(/\s+/g, " ");
  if (!t) return {};
  const i = t.indexOf(" ");
  if (i === -1) return { firstName: t };
  return { firstName: t.slice(0, i), lastName: t.slice(i + 1) };
}

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

function parseVCard(raw: string): ScannedBadge {
  const out: ScannedBadge = { raw, format: "vcard" };
  for (const line of raw.split(/\r?\n/)) {
    // Property parameters (TYPE=, CHARSET=) sit between the name and the colon.
    const m = line.match(/^([A-Za-z-]+)(?:;[^:]*)?:(.*)$/);
    if (!m) continue;
    const [, prop, value] = m;
    const key = prop.toUpperCase();
    if (key === "N") {
      // vCard N is Family;Given;Middle;Prefix;Suffix — already the right way round.
      const [family, given] = value.split(";");
      out.lastName ??= clean(family);
      out.firstName ??= clean(given);
    } else if (key === "FN") {
      const { firstName, lastName } = splitName(value);
      out.firstName ??= firstName;
      out.lastName ??= lastName;
    } else if (key === "EMAIL") {
      out.email ??= clean(value.match(EMAIL_RE)?.[0]);
    } else if (key === "TEL") {
      out.phone ??= clean(value);
    } else if (key === "ADR") {
      // ADR is pobox;ext;street;locality;region;postcode;country
      out.countryOfResidence ??= clean(value.split(";")[6]);
    }
  }
  return out;
}

function parseMeCard(raw: string): ScannedBadge {
  const out: ScannedBadge = { raw, format: "mecard" };
  const body = raw.replace(/^MECARD:/i, "");
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).toUpperCase();
    const value = part.slice(idx + 1);
    if (key === "N") {
      const [family, given] = value.split(",");
      out.lastName ??= clean(family);
      out.firstName ??= clean(given);
      if (!out.lastName && !out.firstName) Object.assign(out, splitName(value));
    } else if (key === "EMAIL") {
      out.email ??= clean(value);
    } else if (key === "TEL") {
      out.phone ??= clean(value);
    }
  }
  return out;
}

function fromRecord(rec: Record<string, unknown>, raw: string, format: ScannedBadge["format"]): ScannedBadge {
  const get = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const hit = Object.entries(rec).find(([rk]) => rk.toLowerCase().replace(/[_\s-]/g, "") === k);
      if (hit && hit[1] != null && String(hit[1]).trim()) return String(hit[1]).trim();
    }
    return undefined;
  };

  const out: ScannedBadge = {
    raw,
    format,
    firstName: get("firstname", "givenname", "fname", "forename"),
    lastName: get("lastname", "surname", "familyname", "lname"),
    email: get("email", "emailaddress", "mail"),
    phone: get("phone", "mobile", "tel", "telephone", "phonenumber", "cell"),
    countryOfResidence: get("country", "countryofresidence", "residence"),
    nationality: get("nationality", "citizenship"),
    interestedProgram: get("program", "programme", "course", "courseofinterest", "subject"),
  };

  // Only fall back to a combined name field if neither part was given.
  if (!out.firstName && !out.lastName) {
    const full = get("name", "fullname", "attendeename");
    if (full) Object.assign(out, splitName(full));
  }
  return out;
}

function parseKeyValue(raw: string): ScannedBadge {
  const rec: Record<string, string> = {};
  for (const line of raw.split(/[\r\n|]+/)) {
    const m = line.match(/^\s*([A-Za-z][\w\s-]*?)\s*[:=]\s*(.+?)\s*$/);
    if (m) rec[m[1]] = m[2];
  }
  return fromRecord(rec, raw, "keyvalue");
}

/**
 * Last resort for a badge that is not structured at all: pull out anything
 * unambiguous. An email and a phone number have shapes that cannot be mistaken
 * for something else; a name does not, so no name is guessed here.
 */
function parseLoose(raw: string): ScannedBadge {
  return {
    raw,
    format: "unrecognised",
    email: clean(raw.match(EMAIL_RE)?.[0]),
    phone: clean(raw.match(PHONE_RE)?.[0]),
  };
}

export function parseBadge(raw: string): ScannedBadge {
  const text = raw.trim();
  if (!text) return { raw, format: "unrecognised" };

  if (/^BEGIN:VCARD/i.test(text)) return parseVCard(text);
  if (/^MECARD:/i.test(text)) return parseMeCard(text);

  if (/^[[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      const rec = Array.isArray(parsed) ? parsed[0] : parsed;
      if (rec && typeof rec === "object") return fromRecord(rec as Record<string, unknown>, text, "json");
    } catch {
      // Not JSON after all; fall through to the other shapes.
    }
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const params = new URL(text).searchParams;
      const rec: Record<string, string> = {};
      params.forEach((v, k) => (rec[k] = v));
      if (Object.keys(rec).length > 0) return fromRecord(rec, text, "url");
    } catch {
      // Malformed URL; treat as loose text.
    }
  }

  if (/[:=]/.test(text)) {
    const kv = parseKeyValue(text);
    if (kv.firstName || kv.lastName || kv.email || kv.phone) return kv;
  }

  return parseLoose(text);
}

/** True when there is anything worth putting in the form. */
export function hasUsableFields(b: ScannedBadge): boolean {
  return Boolean(b.firstName || b.lastName || b.email || b.phone);
}

/** Human summary of what was read, for confirming before it is applied. */
export function describeBadge(b: ScannedBadge): string {
  const bits: string[] = [];
  if (b.firstName || b.lastName) bits.push([b.firstName, b.lastName].filter(Boolean).join(" "));
  if (b.email) bits.push(b.email);
  if (b.phone) bits.push(b.phone);
  return bits.length ? bits.join(" · ") : "nothing recognisable";
}
