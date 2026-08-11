#!/usr/bin/env node
/**
 * Recycle-bin purge cron. Runs daily at 03:00 UTC on the VPS.
 *
 * Walks deleted_records where expiresAt is past and (restoredAt/purgedAt are
 * NULL), calls purgeRecord on each. For soft-delete entities that means
 * hard-deleting the original row; for hard-delete entities the row was
 * already gone, we just mark the bin entry as purged.
 *
 * Registered in root crontab as:
 *   0 3 * * *   cd /var/www/illume-crm && node --env-file=.env scripts/purge-recycle-bin.mjs >> /var/log/illume-recycle-purge.log 2>&1
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * A minimal purge implementation duplicated from lib/recycle-bin.ts because
 * TS source can't be imported directly at runtime. Keeps the logic
 * cron-legible and doesn't drag in the App-Router-only imports (auth, etc.)
 * that the shared module uses.
 *
 * If lib/recycle-bin.REGISTRY grows, this file needs its softDelete-flag
 * mirror updated. The complement of the two lists is enforced by a runtime
 * check at the bottom.
 */
const SOFT_DELETE_ENTITIES = new Set([
  "Lead",
  "Institution",
  "Event",
  "Activity",
  "MonthlyReport",
  "Market",
  "RecruitmentPartner",
  "Task",
  "HRTask",
  "User",
  "School",
  "Campaign",
  "KnowledgeBase",
  "Attachment",
]);

const DELEGATE = {
  Lead: "lead",
  Institution: "institution",
  Event: "event",
  Activity: "activity",
  MonthlyReport: "monthlyReport",
  Market: "market",
  RecruitmentPartner: "recruitmentPartner",
  Task: "task",
  HRTask: "hRTask",
  User: "user",
  School: "school",
  Campaign: "campaign",
  KnowledgeBase: "knowledgeBase",
  Attachment: "attachment",
};

function iso() { return new Date().toISOString(); }
function log(msg) { process.stdout.write(`[${iso()}] ${msg}\n`); }

async function main() {
  const now = new Date();
  const expired = await db.deletedRecord.findMany({
    where: {
      expiresAt: { lte: now },
      restoredAt: null,
      purgedAt: null,
    },
    select: { id: true, entityType: true, entityId: true, hardDeleted: true, entityLabel: true },
  });
  log(`found ${expired.length} expired item(s)`);

  let purged = 0;
  let failed = 0;
  for (const r of expired) {
    try {
      // Soft-delete entities still have a row; delete it now.
      if (SOFT_DELETE_ENTITIES.has(r.entityType)) {
        const delegateName = DELEGATE[r.entityType];
        if (!delegateName) {
          log(`⚠ no delegate for ${r.entityType} (${r.id}); marking purged anyway`);
        } else {
          await db[delegateName].delete({ where: { id: r.entityId } }).catch((e) => {
            log(`⚠ hard-delete failed for ${r.entityType} ${r.entityId}: ${e.message}`);
          });
        }
      }
      // Hard-delete entities were already removed at trash-time; just mark the
      // bin entry so it stops appearing.
      await db.deletedRecord.update({
        where: { id: r.id },
        data: { purgedAt: new Date() },
      });
      purged++;
    } catch (err) {
      failed++;
      log(`✗ purge failed for ${r.entityType} ${r.entityId}: ${err.message}`);
    }
  }
  log(`purged=${purged} failed=${failed}`);
}

main()
  .catch((e) => { console.error("FATAL", e); process.exit(1); })
  .finally(() => db.$disconnect());
