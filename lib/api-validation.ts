import { NextRequest, NextResponse } from "next/server";

/**
 * Small guards for the hand-rolled (non-Zod) API routes.
 *
 * Background: about a third of the POST handlers destructure `await req.json()`
 * straight into a Prisma `create`. Two failure modes fall out of that, and a
 * QA sweep on 2026-08-11 found both live on nine endpoints:
 *
 *   1. Malformed JSON  → `req.json()` throws → unhandled → 500.
 *   2. Bad enum value  → Prisma throws PrismaClientValidationError → 500.
 *
 * Both are *client* errors and must answer 400/422. A 500 also means the
 * request is logged as a server fault, which buries real incidents.
 *
 * These helpers are deliberately tiny so they can be dropped into an existing
 * handler without restructuring it into a Zod schema.
 */

/** Thrown by the guards; caught by `handleApiError`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number = 422,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Loose value type for destructured request bodies.
 *
 * Deliberately `any`-valued rather than `unknown`: these routes destructure
 * a dozen fields and hand them to Prisma, and every call site would otherwise
 * need a cast. The safety comes from the assert* guards below, which narrow
 * the fields that actually matter — not from the index signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonBody = Record<string, any>;

/**
 * `await req.json()` that answers 400 instead of throwing on malformed input.
 * Also rejects non-object bodies (arrays, bare strings) since every caller
 * destructures fields off the result.
 */
export async function readJsonBody(req: NextRequest): Promise<JsonBody> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("Request body must be a JSON object", 400);
  }
  assertNoNulBytes(parsed);
  return parsed as JsonBody;
}

/**
 * Reject NUL (U+0000) anywhere in a request body.
 *
 * PostgreSQL cannot store NUL in a text column and raises
 * "unsupported Unicode escape sequence". Nothing upstream strips it: Zod's
 * `.string()` accepts it, so it travels intact from JSON to Prisma and surfaces
 * as a 500 — a client error logged as a server fault, with a stack trace.
 *
 * Only NUL is rejected. Emoji, U+FFFD, combining marks, lone surrogates and
 * bidi overrides were all confirmed to round-trip fine and are legitimate in
 * names, so a broader "strip control characters" rule would corrupt real data
 * to fix a problem only this one character causes.
 *
 * Recurses through nested objects and arrays because the offending string is
 * rarely at the top level.
 */
/**
 * U+0000, built from its code point rather than written as a literal or an
 * escape. A literal would make this source file binary; an escape invites the
 * next person editing it to "tidy" it into one.
 */
const NUL = String.fromCharCode(0);

export function assertNoNulBytes(value: unknown, path = "body"): void {
  if (typeof value === "string") {
    if (value.includes(NUL)) {
      throw new ApiError(
        `${path} contains a NUL character, which cannot be stored.`,
        422
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNulBytes(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertNoNulBytes(v, path === "body" ? k : `${path}.${k}`);
    }
  }
}

/**
 * Validate a value against a Prisma enum object (which is a plain
 * `{ VALUE: "VALUE" }` map at runtime).
 *
 * Pass `required: false` for optional columns — undefined/null/"" then
 * resolve to undefined rather than erroring.
 */
export function assertEnum<T extends Record<string, string>>(
  value: unknown,
  enumObj: T,
  field: string,
  { required = true }: { required?: boolean } = {}
): T[keyof T] | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(`${field} is required`, 422);
    return undefined;
  }
  const allowed = Object.values(enumObj);
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ApiError(
      `Invalid value for ${field}`,
      422,
      { field, received: value, allowed }
    );
  }
  return value as T[keyof T];
}

/** Finite number or a 422. Accepts numeric strings from form posts. */
export function assertNumber(
  value: unknown,
  field: string,
  { required = true, min, max, integer = false }:
    { required?: boolean; min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(`${field} is required`, 422);
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ApiError(`${field} must be a number`, 422, { field, received: value });
  if (integer && !Number.isInteger(n)) throw new ApiError(`${field} must be a whole number`, 422);
  if (min !== undefined && n < min) throw new ApiError(`${field} must be at least ${min}`, 422);
  if (max !== undefined && n > max) throw new ApiError(`${field} must be at most ${max}`, 422);
  return n;
}

/**
 * String with a length ceiling. The ceiling matters: without it a client can
 * post a multi-megabyte name straight into a TEXT column, which then has to be
 * rendered in every list view that shows that field.
 */
export function assertString(
  value: unknown,
  field: string,
  { required = true, max = 2000, min = 1 }:
    { required?: boolean; max?: number; min?: number } = {}
): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(`${field} is required`, 422);
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ApiError(`${field} must be a string`, 422, { field, received: typeof value });
  }
  const trimmed = value.trim();
  if (required && trimmed.length < min) throw new ApiError(`${field} is required`, 422);
  if (value.length > max) {
    throw new ApiError(`${field} must be ${max} characters or fewer`, 422, { field, length: value.length, max });
  }
  return trimmed;
}

/** Parseable date or a 422. */
export function assertDate(
  value: unknown,
  field: string,
  { required = true }: { required?: boolean } = {}
): Date | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(`${field} is required`, 422);
    return undefined;
  }
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    throw new ApiError(`${field} must be a date`, 422);
  }
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(`${field} must be a valid date`, 422, { field, received: value });
  }
  return d;
}

/**
 * Wrap a handler's catch block. Turns ApiError into its intended status and
 * anything else into a generic 500 — the message is deliberately opaque so
 * internals never reach the client (pentest finding M-5).
 */
export function handleApiError(err: unknown, tag: string): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, ...(err.details ? { details: err.details } : {}) },
      { status: err.status }
    );
  }
  console.error(tag, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
