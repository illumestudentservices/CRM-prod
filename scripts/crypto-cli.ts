/** Ops/test utility: encrypt or decrypt a field value with the current env's
 *  FIELD_ENCRYPTION_KEY (+ FIELD_ENCRYPTION_KEY_OLD fallback on decrypt).
 *  Usage: FIELD_ENCRYPTION_KEY=... npx tsx scripts/crypto-cli.ts enc|dec <value> */
import { encryptField, decryptField } from "@/lib/field-crypto";
const [, , mode, value] = process.argv;
try {
  if (mode === "enc") process.stdout.write(encryptField(value));
  else if (mode === "dec") process.stdout.write(decryptField(value));
  else { process.stderr.write("usage: enc|dec <value>"); process.exit(2); }
} catch (e) { process.stdout.write("ERR:" + (e as Error).message.slice(0, 40)); }
