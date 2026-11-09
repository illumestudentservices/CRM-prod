/**
 * HQ owners who answer for SEVERAL regions even though their own account is not
 * a single-region Regional Manager. Keyed by region NAME (resolved to ids at
 * use time) so it stays correct across the test and production databases.
 *
 * Annie Li (Director – Client Relations) owns Latin America and China.
 * Duarte Dias owns Middle East (his own account sits in the Europe region, and
 * there is no single-region Regional Manager for Middle East).
 *
 * Single source of truth, shared by the weekly activity report (who receives a
 * region's report) and client team membership (who is auto-added as the region
 * manager on a client's team).
 */
export interface RegionOwner {
  email: string;
  label: string;
  regionNames: string[];
}

export const OWNER_REGION_RECIPIENTS: RegionOwner[] = [
  {
    email: "annie@illumestudentservices.ca",
    label: "Latin America & China",
    regionNames: ["Latin America", "China"],
  },
  {
    email: "duarte@illumestudentservices.ca",
    label: "Middle East",
    regionNames: ["Middle East"],
  },
];
