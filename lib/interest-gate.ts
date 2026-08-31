import type { LeadStage, StudyLevel } from "@prisma/client";
import {
  evaluateStageGate,
  type GateActivity,
  type GateApplication,
  type GateChecklistItem,
  type GateLead,
  type GateResult,
} from "./lead-gate";

/**
 * The stage gate, applied to one Institution Interest.
 *
 * Spec page 3 is explicit that "the eight-stage pipeline applies to the
 * Institution Interest, not directly to the master Student Profile". The rules
 * themselves live in `lead-gate.ts` and are shared — duplicating them here is
 * how the two paths would drift apart, which is the bug this module exists to
 * close in the first place.
 *
 * What differs is the *subject*. The fields the spec asks for are split across
 * two records:
 *
 *   - identity, contact details, source, channel, counselling and budget
 *     belong to the person and are shared by every journey;
 *   - institution, programme, intake, study level, eligibility and enrolment
 *     belong to the journey.
 *
 * So the subject is a merge in which the journey wins wherever it holds the
 * same field. Reading the person's `interestedProgram` for a second journey
 * would gate the Manchester application on the programme typed for Toronto.
 */

/** The journey-side fields the gate needs. */
export interface GateInterest {
  stage: LeadStage;
  stageEnteredAt: Date | string;
  institutionId: string;
  program?: string | null;
  intakeYear?: number | null;
  intakeMonth?: number | null;
  studyLevel?: StudyLevel | null;
  assignedICRId?: string | null;
  academicQualification?: string | null;
  englishStatus?: string | null;
  eligibilityOutcome?: string | null;
  enrolmentDate?: Date | string | null;
  enrolmentStatus?: string | null;
}

/** The person-side fields the gate needs. Deliberately not the full Lead. */
export type GateInterestLead = Omit<GateLead, "stage" | "stageEnteredAt">;

/**
 * Anything carrying an optional interest id. Used to decide which of a
 * student's activities and checklist items count towards one journey.
 */
interface InterestScoped {
  institutionInterestId?: string | null;
}

/**
 * Activities and checklist items that count towards this journey.
 *
 * Rows explicitly attributed to another interest are excluded. Unattributed
 * rows (`null`) are INCLUDED, and that is a deliberate judgement rather than an
 * oversight: the activity endpoint has never written `institutionInterestId`,
 * so every counselling call, every offer review and every document checklist
 * generated to date is unattributed. Excluding them would mean no journey could
 * satisfy any activity requirement, which would block the whole pipeline the
 * moment this gate was switched on.
 *
 * When activity capture learns to attribute work to a journey, this should
 * tighten to an exact match — but not before, or the gate blocks real work.
 */
export function scopedToInterest<T extends InterestScoped>(rows: T[], interestId: string): T[] {
  return rows.filter(
    (r) => r.institutionInterestId === interestId || r.institutionInterestId == null
  );
}

/**
 * Builds the merged gate subject for one journey.
 *
 * Journey values win, falling back to the person record only where the journey
 * has nothing recorded — which is what lets an interest created before this
 * split still evaluate against the data that does exist.
 */
export function buildInterestGateSubject(
  lead: GateInterestLead,
  interest: GateInterest
): GateLead {
  return {
    ...lead,
    stage: interest.stage,
    stageEnteredAt: interest.stageEnteredAt,
    // Journey-owned, with the person record as the fallback.
    institutionId: interest.institutionId,
    interestedProgram: interest.program ?? lead.interestedProgram,
    intakeYear: interest.intakeYear ?? lead.intakeYear,
    intakeMonth: interest.intakeMonth ?? lead.intakeMonth,
    academicQualification: interest.academicQualification ?? lead.academicQualification,
    englishStatus: interest.englishStatus ?? lead.englishStatus,
    studyLevel: interest.studyLevel ?? lead.studyLevel,
    enrolmentDate: interest.enrolmentDate ?? lead.enrolmentDate,
    // Spec §6 — assessed per journey, so read it straight off this one rather
    // than deriving a student-level answer as the Profile path has to.
    eligibilityOutcome: interest.eligibilityOutcome,
    // Spec §5 — trivially satisfied here: this journey IS the interest.
    hasInstitutionInterest: true,
  };
}

/**
 * Evaluates whether one Institution Interest may move to `targetStage`.
 *
 * Signature mirrors `evaluateStageGate` so the two paths stay comparable.
 */
export function evaluateInterestStageGate(
  lead: GateInterestLead,
  interest: GateInterest,
  targetStage: LeadStage,
  activities: (GateActivity & InterestScoped)[],
  options: {
    interestId: string;
    application?: GateApplication | null;
    checklist?: (GateChecklistItem & InterestScoped)[];
    now?: Date;
  }
): GateResult {
  const { interestId, application = null, checklist = [], now } = options;

  return evaluateStageGate(
    buildInterestGateSubject(lead, interest),
    targetStage,
    scopedToInterest(activities, interestId),
    {
      application,
      checklist: scopedToInterest(checklist, interestId),
      now,
    }
  );
}
