/**
 * Postgres text columns reject the NUL byte (0x00) with 'invalid byte sequence
 * for encoding UTF8'. Any user input reaching Prisma must be stripped of NULs
 * or Prisma throws a DriverAdapterError which surfaces as a 500 to the client.
 */
const NUL_RE = /\x00/g;

export function stripNullBytes<T>(value: T): T {
  if (typeof value === 'string') return value.replace(NUL_RE, '') as unknown as T;
  if (Array.isArray(value)) return value.map(stripNullBytes) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripNullBytes(v);
    return out as unknown as T;
  }
  return value;
}
