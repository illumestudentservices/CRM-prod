"use client";

import { cn } from "@/lib/utils";
import { ALL_ROLES } from "@/lib/permissions";
import { roleMeta } from "./permission-meta";
import { PermissionMatrixPanel } from "./permission-matrix-panel";
import { GranularPermissionsPanel } from "./granular-permissions-panel";
import { PasswordResetSection } from "./password-reset-section";
import { MfaStatusCard } from "./mfa-status-card";
import { RecycleBinCard } from "./recycle-bin-card";
import { WorkloadReassignmentCard } from "./workload-reassignment-card";

/**
 * Settings → Security.
 *
 * The role/resource matrix used to live inline here as an 11-column table of
 * 1,375 custom toggle buttons, driven by hardcoded arrays of 8 roles and 12
 * resources. It now lives in PermissionMatrixPanel, which derives everything
 * from PERMISSION_MATRIX. The role reference below iterates ALL_ROLES for the
 * same reason — a role added to the matrix must never be invisible here.
 */
export function SecurityTab() {
  return (
    <div className="space-y-5">
      {/* ── Role permissions ── */}
      <div className="border rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Role permissions
          </h3>
          <p className="text-sm text-muted-foreground">
            Which modules each role can reach, and what it may do there. Choose a
            role, then tick the actions it should hold.
          </p>
        </div>
        <PermissionMatrixPanel />
      </div>

      {/* ── Granular permissions (functions + columns) ── */}
      <div className="border rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Function &amp; field permissions
          </h3>
          <p className="text-sm text-muted-foreground">
            Finer control than the role permissions above — grant or withhold
            individual operations and individual columns per role.
          </p>
        </div>
        <GranularPermissionsPanel />
      </div>

      {/* ── Two-Factor Authentication ── */}
      <MfaStatusCard />

      {/* ── Recycle Bin ──
          Lives at /recycle-bin in the sidebar, but its breadcrumb claims
          Settings → Recycle Bin and this is where people look for it. */}
      <RecycleBinCard />

      {/* ── Workload Reassignment ──
          Lives on the HR → Offboarding tab, where a departure can pre-select
          the leaver. Mirrored here because that is where people look, and
          because the blocked count is a security number. */}
      <WorkloadReassignmentCard />

      {/* ── Password Reset ── */}
      <div className="border rounded-xl p-5">
        <PasswordResetSection />
      </div>

      {/* ── Role reference ── */}
      <div className="border rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Roles
          </h3>
          <p className="text-sm text-muted-foreground">
            Every role the permission matrix defines ({ALL_ROLES.length} in total).
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {ALL_ROLES.map((role) => {
            const meta = roleMeta(role);
            return (
              <div key={role} className="border rounded-lg p-3 space-y-1.5">
                <span className={cn("text-sm font-semibold px-2 py-0.5 rounded inline-block", meta.badge)}>
                  {meta.label}
                </span>
                <p className="text-xs text-muted-foreground">{meta.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
