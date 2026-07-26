import type { Role } from "@/lib/permissions";

/**
 * Weekly Activity Planner — shared definitions.
 *
 * The 6 mandatory ICR activities, their default weekly targets and descriptions,
 * taken directly from the "Illume KPIs — Weekly Activity Planner".
 *
 * Tracked & viewed only (no approval workflow). Rolls up into the monthly report.
 */

export const WEEKLY_ACTIVITY_TYPES = [
  "AGENT_TRAINING_VISIT",
  "HIGH_SCHOOL_ENGAGEMENT",
  "ENQUIRIES",
  "MONTHLY_WEBINAR",
  "PIPELINE_CALLS",
  "LIVE_SESSION",
] as const;

export type WeeklyActivityType = (typeof WEEKLY_ACTIVITY_TYPES)[number];

export interface WeeklyActivityDef {
  type: WeeklyActivityType;
  label: string;
  short: string;
  /** Default target count per week. Monthly activities target the whole month. */
  defaultTarget: number;
  /** Cadence the target applies to. */
  cadence: "WEEKLY" | "MONTHLY";
  description: string;
  /** Example entries (Weeks 1-4) shown as faded placeholders — straight from the planner sheet. */
  examples: [string, string, string, string];
}

export const WEEKLY_ACTIVITY_DEFS: Record<WeeklyActivityType, WeeklyActivityDef> = {
  AGENT_TRAINING_VISIT: {
    type: "AGENT_TRAINING_VISIT",
    label: "Agent training or visits",
    short: "Agent visits",
    defaultTarget: 3,
    cadence: "WEEKLY",
    description:
      "Training can be virtual or in person. The goal is to have counsellors fully capable of selling your institution and identifying opportunities — proficient on website navigation and the application process.",
    examples: [
      "Uniserv, Studylink Uganda, Logic Junction Rwanda",
      "Haverstfield Nigeria, Cupa Ghana, Nubi Nigeria",
      "Uniabroad Kenya, Overseas Univ Link, Global Study Ltd",
      "Elgold Nigeria, Kegles Nigeria, 3M Kenya",
    ],
  },
  HIGH_SCHOOL_ENGAGEMENT: {
    type: "HIGH_SCHOOL_ENGAGEMENT",
    label: "Engagement with high schools",
    short: "High-school engagement",
    defaultTarget: 2,
    cadence: "WEEKLY",
    description:
      "Any interaction counts: drop off flyers, talk with career counsellors, plan future activities for students or parents, gather study-abroad preferences. Any excuse to interact counts.",
    examples: [
      "Aga Khan, Hill Crest",
      "Premier Academy",
      "Gems, Nairobi Academy",
      "West Nairobi School, St Austins",
    ],
  },
  ENQUIRIES: {
    type: "ENQUIRIES",
    label: "Gather enquiries",
    short: "Enquiries",
    defaultTarget: 5,
    cadence: "WEEKLY",
    description:
      "Reach out to agencies and see what kind of enquiries they have been working on that could be a fit for your institution.",
    examples: [
      "3 Uniserv, 1 Studylink Uganda, 3 Imperial, 5 direct",
      "2 IDP, 1 3M, 2 Educare",
      "",
      "",
    ],
  },
  MONTHLY_WEBINAR: {
    type: "MONTHLY_WEBINAR",
    label: "Monthly webinar",
    short: "Webinar",
    defaultTarget: 1,
    cadence: "MONTHLY",
    description:
      "Invite all your agency-network counsellors to a 20–30 min webinar on your institution to share relevant updates.",
    examples: ["35 attendees", "", "", ""],
  },
  PIPELINE_CALLS: {
    type: "PIPELINE_CALLS",
    label: "Pipeline conversion calls",
    short: "Conversion calls",
    defaultTarget: 10,
    cadence: "WEEKLY",
    description:
      "Conversion calls targeting key leads from your student funnel. Identify highest-potential leads and set a sequence of interactions towards deposit payment.",
    examples: [
      "10 calls: 3 deposits expected, 5 undecided, 2 changed their mind",
      "",
      "",
      "",
    ],
  },
  LIVE_SESSION: {
    type: "LIVE_SESSION",
    label: "Application day / live session",
    short: "Live session",
    defaultTarget: 1,
    cadence: "MONTHLY",
    description:
      "Choose an agency and have them host a ~15 min live session where you showcase your institution to their social-media audience. Should be free of charge.",
    examples: ["Live with Educare — 250 attendees", "", "", ""],
  },
};

/** Ordered list for rendering rows in the planner. */
export const WEEKLY_ACTIVITY_LIST: WeeklyActivityDef[] =
  WEEKLY_ACTIVITY_TYPES.map((t) => WEEKLY_ACTIVITY_DEFS[t]);

/** Weeks of the month shown in the planner grid. */
export const WEEKS_OF_MONTH = [1, 2, 3, 4] as const;
export type WeekOfMonth = (typeof WEEKS_OF_MONTH)[number];

/**
 * Roles allowed to see the Weekly Activities tab.
 * Per product decision: ICR (own) + Regional Manager (region) + Super Admin (all).
 * HQ / Analytics are intentionally excluded for now.
 */
export const WEEKLY_ACTIVITY_ROLES: Role[] = ["ICR", "REGIONAL_MANAGER", "SUPER_ADMIN"];

export function canViewWeeklyActivities(role: Role): boolean {
  return WEEKLY_ACTIVITY_ROLES.includes(role);
}

export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
