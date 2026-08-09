/**
 * Auto-task generation for activities.
 *
 * When an Activity is created, call `generateFollowUpTasks()` to get a list of
 * suggested follow-up tasks based on the activity type. These can then be
 * bulk-created via the Task model with `sourceActivityId` set.
 *
 * Usage in the Activity POST API (app/api/activities/route.ts):
 *
 * ```ts
 * import { generateFollowUpTasks } from "@/lib/auto-tasks";
 * import { db } from "@/lib/db";
 *
 * // After creating the activity:
 * const suggestions = generateFollowUpTasks(activity.type, activity.title, activity.id);
 *
 * if (suggestions.length > 0) {
 *   await db.task.createMany({
 *     data: suggestions.map((s) => ({
 *       title: s.title,
 *       description: s.description,
 *       priority: s.priority,
 *       status: "TODO",
 *       sourceActivityId: activity.id,
 *       createdById: employeeId, // the employee who created the activity
 *     })),
 *   });
 * }
 * ```
 */

interface FollowUpTask {
  title: string;
  description: string;
  priority: string;
}

// Spec §12 / §16 (Field Operations) — templates keyed by activity type.
// Extended in Phase 6/7 to cover the new spec-required activity types.
const TASK_TEMPLATES: Record<string, FollowUpTask[]> = {
  AGENT_TRAINING: [
    {
      title: "Send training materials",
      description:
        "Distribute presentation decks, brochures and reference materials to trained agent staff.",
      priority: "HIGH",
    },
    {
      title: "Schedule refresher check-in",
      description:
        "Book a follow-up call in 4–6 weeks to reinforce training and answer field questions.",
      priority: "MEDIUM",
    },
  ],
  SCHOOL_PRESENTATION: [
    {
      title: "Send counsellor thank-you note",
      description:
        "Thank the school counsellors and share the presentation deck + programme brochures.",
      priority: "HIGH",
    },
    {
      title: "Follow up with prospective students",
      description:
        "Contact students who signed up at the presentation with next-step information.",
      priority: "URGENT",
    },
  ],
  CLIENT_MEETING: [
    {
      title: "Send meeting minutes",
      description:
        "Circulate agreed action items and next steps to the client and internal stakeholders.",
      priority: "HIGH",
    },
    {
      title: "Update account notes",
      description:
        "Record decisions and open items in the client's account record so they surface in the next review.",
      priority: "MEDIUM",
    },
  ],
  EVENT_PREPARATION: [
    {
      title: "Confirm attendee registrations",
      description:
        "Verify all registered attendees, confirm timings, and prepare name badges/materials.",
      priority: "URGENT",
    },
    {
      title: "Brief the team",
      description:
        "Pre-event briefing on booth logistics, targets, and lead-capture process.",
      priority: "HIGH",
    },
  ],
  EVENT_FOLLOW_UP: [
    {
      title: "Contact captured leads within 48h",
      description:
        "Reach every lead collected at the event within 48 hours with personalised communications.",
      priority: "URGENT",
    },
    {
      title: "Upload event outcome",
      description:
        "File the post-event summary with attendance, lead counts, and observations.",
      priority: "HIGH",
    },
  ],
  STUDENT_FOLLOW_UP_SESSION: [
    {
      title: "Log outcome on student profile",
      description:
        "Record the outcome of the follow-up session on the student's institution interest.",
      priority: "HIGH",
    },
  ],
  MARKET_RESEARCH: [
    {
      title: "Submit market intelligence update",
      description:
        "Convert research findings into a Market Intelligence suggestion for RM review.",
      priority: "MEDIUM",
    },
  ],
  REPORT_SUBMISSION: [
    {
      title: "Confirm receipt",
      description:
        "Verify the report was accepted by the reviewing party and file the confirmation.",
      priority: "LOW",
    },
  ],
  SCHOOL_VISIT: [
    {
      title: "Send follow-up materials",
      description:
        "Send brochures, programme guides, and relevant materials to the school contacts met during the visit.",
      priority: "HIGH",
    },
    {
      title: "Schedule counsellor webinar",
      description:
        "Arrange a webinar session for school counsellors to learn more about available programmes and admission processes.",
      priority: "MEDIUM",
    },
    {
      title: "Connect with admissions team",
      description:
        "Share visit outcomes with the admissions team and coordinate on any prospective student leads generated.",
      priority: "MEDIUM",
    },
  ],
  AGENT_MEETING: [
    {
      title: "Send meeting notes",
      description:
        "Compile and share meeting notes and key takeaways with the agent and internal stakeholders.",
      priority: "HIGH",
    },
    {
      title: "Follow up on action items",
      description:
        "Review and action all items discussed during the agent meeting; ensure deadlines are tracked.",
      priority: "HIGH",
    },
    {
      title: "Update agent profile",
      description:
        "Update the agent's profile in the CRM with any new information gathered during the meeting.",
      priority: "LOW",
    },
  ],
  STUDENT_EVENT: [
    {
      title: "Follow up with attendees",
      description:
        "Reach out to event attendees with personalised follow-up emails and next-step information.",
      priority: "HIGH",
    },
    {
      title: "Update lead pipeline",
      description:
        "Add new contacts from the event into the student lead pipeline and assign appropriate stages.",
      priority: "MEDIUM",
    },
    {
      title: "Send event summary",
      description:
        "Prepare and distribute an event summary report to the management team.",
      priority: "LOW",
    },
  ],
  FAIR: [
    {
      title: "Calculate ROI",
      description:
        "Analyse the costs versus leads generated and applications received to calculate the fair's return on investment.",
      priority: "HIGH",
    },
    {
      title: "Follow up with leads",
      description:
        "Contact all leads collected at the fair within 48 hours with personalised communications.",
      priority: "URGENT",
    },
    {
      title: "Prepare post-event report",
      description:
        "Create a comprehensive post-event report including attendance, engagement metrics, and recommendations.",
      priority: "MEDIUM",
    },
  ],
  PARTNER_MEETING: [
    {
      title: "Send meeting summary",
      description:
        "Draft and send a meeting summary to the partner and all internal attendees.",
      priority: "HIGH",
    },
    {
      title: "Schedule follow-up",
      description:
        "Book the next meeting or check-in call based on the agreed timeline.",
      priority: "MEDIUM",
    },
    {
      title: "Update partnership records",
      description:
        "Update the partnership records in the CRM with any new agreements, terms, or contact details discussed.",
      priority: "MEDIUM",
    },
  ],
};

export function generateFollowUpTasks(
  activityType: string,
  activityTitle: string,
  _activityId: string
): FollowUpTask[] {
  const templates = TASK_TEMPLATES[activityType];

  if (!templates) {
    return [];
  }

  // Prepend the activity title context to each task description
  return templates.map((t) => ({
    ...t,
    description: `[${activityTitle}] ${t.description}`,
  }));
}
