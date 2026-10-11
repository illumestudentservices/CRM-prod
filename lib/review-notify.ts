import { db } from "@/lib/db";

/**
 * Tell somebody their performance review is ready to read.
 *
 * ★ COMPLETING A REVIEW USED TO NOTIFY NOBODY.
 *
 * It was written, marked COMPLETED, and sat there. The person it was about
 * could not see it anyway (erp_hr), so nothing was lost by the silence — but
 * now that they can, the silence is the whole problem: an appraisal nobody is
 * told about is one nobody reads.
 *
 * In-app and by email, both. This is one message to one person about their own
 * record, not a broadcast, so there is no volume argument for making the email
 * optional the way there is for an announcement.
 *
 * ★ THE SCORE AND THE WORDING ARE NOT IN THE EMAIL.
 *
 * Only that it is ready, and where to read it. A performance score sitting in
 * an inbox — forwarded, synced to a phone, read over a shoulder — is the kind
 * of disclosure the system is supposed to control, and an email is the one
 * place its permissions do not reach.
 */
export async function notifyReviewCompleted(reviewId: string): Promise<boolean> {
  const review = await db.performanceReview.findUnique({
    where: { id: reviewId },
    select: {
      period: true,
      status: true,
      employee: {
        select: {
          user: { select: { id: true, email: true, name: true, firstName: true } },
        },
      },
      reviewer: { select: { user: { select: { name: true } } } },
    },
  });
  if (!review || review.status !== "COMPLETED") return false;

  const subject = review.employee.user;
  const reviewerName = review.reviewer?.user.name ?? "your manager";

  await db.notification
    .create({
      data: {
        userId: subject.id,
        title: `Your ${review.period} review is ready`,
        message:
          `${reviewerName} has completed your performance review for ${review.period}. ` +
          `You can read it on your profile.`,
        type: "PERFORMANCE_REVIEW",
        link: "/hr?tab=performance-reviews",
      },
    })
    .catch((err) => console.error("[review-notify] notification failed:", err));

  try {
    const { sendReviewReadyEmail } = await import("@/lib/email");
    return await sendReviewReadyEmail({
      to: subject.email,
      name: subject.name || subject.firstName || subject.email,
      period: review.period,
      reviewerName,
    });
  } catch (err) {
    console.error("[review-notify] email failed:", err);
    return false;
  }
}
