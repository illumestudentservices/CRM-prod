/**
 * Ensures the pinned "Direct Lead Source (No agent)" recruitment partner exists,
 * so the lead form can offer it at the top of the Source dropdown for leads that
 * came in directly rather than via an agent. Idempotent — matches by name.
 *
 *   node --env-file=.env.local scripts/ensure-direct-lead-source.mjs   (test)
 *   node --env-file=.env scripts/ensure-direct-lead-source.mjs         (prod)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const NAME = "Direct Lead Source (No agent)";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

try {
  const [{ d }] = await db.$queryRawUnsafe("SELECT current_database() AS d");
  const existing = await db.recruitmentPartner.findFirst({ where: { name: NAME, deletedAt: null }, select: { id: true, isActive: true } });
  if (existing) {
    if (!existing.isActive) await db.recruitmentPartner.update({ where: { id: existing.id }, data: { isActive: true } });
    console.log(`[${d}] already exists: ${existing.id}${existing.isActive ? "" : " (re-activated)"}`);
  } else {
    const author = await db.user.findFirst({ where: { role: "SUPER_ADMIN", deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const created = await db.recruitmentPartner.create({
      data: {
        name: NAME,
        type: "WALK_IN",
        country: "Global",
        isActive: true,
        notes: "System source for leads that came in directly, with no agent involved. Pinned to the top of the lead Source dropdown.",
        createdById: author.id,
      },
      select: { id: true },
    });
    console.log(`[${d}] created: ${created.id}`);
  }
} finally {
  await db.$disconnect();
  await pool.end();
}
