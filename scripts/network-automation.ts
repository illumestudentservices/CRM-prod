/**
 * Nightly Recruitment Network + Client automation.
 *
 *   node --import tsx scripts/network-automation.ts [--dry-run]
 *
 * Runs three passes in sequence:
 *   1. Agent Tier recalculation (rolling 12mo enrolments)
 *   2. School relationship-health classification (days since last visit)
 *   3. Contract renewal reminders at 180/120/90/60/30-day windows
 */
import "dotenv/config";
import {
  recalcAgentTiers,
  recomputeRelationshipHealth,
  sendRenewalReminders,
} from "@/lib/network-automation";

const dryRun = process.argv.includes("--dry-run");

(async () => {
  try {
    const tiers = await recalcAgentTiers({ dryRun });
    console.log(
      `[network-automation] agent-tiers ${tiers.ranAt}${tiers.dryRun ? " (dry run)" : ""} — ` +
        `processed=${tiers.agentsProcessed} changes=${tiers.tierChanges}`,
    );

    const health = await recomputeRelationshipHealth({ dryRun });
    console.log(
      `[network-automation] relationship-health ${health.ranAt}${health.dryRun ? " (dry run)" : ""} — ` +
        `processed=${health.schoolsRecomputed} changes=${health.statusChanges}`,
    );

    const renewals = await sendRenewalReminders({ dryRun });
    console.log(
      `[network-automation] contract-renewals ${renewals.ranAt}${renewals.dryRun ? " (dry run)" : ""} — ` +
        `expiringSoon=${renewals.contractsExpiringSoon} sent=${renewals.remindersSent}`,
    );
    process.exit(0);
  } catch (err) {
    console.error("[network-automation] failed", err);
    process.exit(1);
  }
})();
