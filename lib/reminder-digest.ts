import { db } from "@/lib/db";

/**
 * One email per person per run, instead of one per item.
 *
 * ★ WHY THIS EXISTS RATHER THAN AN EMAIL AT EACH CALL SITE.
 *
 * Six automations run every morning and, between them, write fourteen kinds of
 * in-app notification. Sending mail from each site would have been the smaller
 * diff and the wrong answer: an ICR with twenty stale students would get twenty
 * separate emails at 07:00, and the first run after this ships would deliver the
 * entire accumulated backlog one message at a time. That is not a notification
 * system, it is an incident — and the people it lands on learn to filter the
 * sender, which costs you every future email too.
 *
 * So each automation collects into a digest and flushes once at the end. The
 * in-app notification is still written per item, because a list in the bell menu
 * is useful and a list in an inbox is not.
 *
 * Nothing here throws. A digest that fails must not fail the automation that
 * produced it — the pipeline work has already been done and recorded.
 */

export type DigestItem = {
  userId: string;
  /** Short, specific: "Offer expires in 3 days". */
  title: string;
  /** The subject of the item: the student, the client, the task. */
  message: string;
  /** Notification type, also used to group the email. */
  type: string;
  /** App-relative, e.g. `/students/<id>`. */
  link: string;
  /** Sorts to the top and colours the row. */
  urgent?: boolean;
};

export class ReminderDigest {
  private readonly items = new Map<string, DigestItem[]>();
  private readonly dryRun: boolean;

  constructor({ dryRun = false }: { dryRun?: boolean } = {}) {
    this.dryRun = dryRun;
  }

  /**
   * Records one item: writes the in-app notification now, queues the email line
   * for the flush.
   *
   * Call this instead of `db.notification.create` so a site cannot accidentally
   * get one channel and not the other.
   */
  async add(item: DigestItem): Promise<void> {
    if (!item.userId) return;
    const bucket = this.items.get(item.userId);
    if (bucket) bucket.push(item);
    else this.items.set(item.userId, [item]);

    if (this.dryRun) return;
    try {
      await db.notification.create({
        data: {
          userId: item.userId,
          title: item.title,
          message: item.message,
          type: item.type,
          link: item.link,
        },
      });
    } catch (err) {
      console.error("[reminder-digest] notification failed:", err);
    }
  }

  /** How many people would be emailed. Useful for a dry run. */
  get recipientCount(): number {
    return this.items.size;
  }

  /** Total queued lines across everyone. */
  get itemCount(): number {
    let n = 0;
    for (const v of this.items.values()) n += v.length;
    return n;
  }

  /**
   * Sends one email per person.
   *
   * `heading` names the area ("Student pipeline"), and the subject is built
   * from the count so an inbox list reads usefully without opening anything.
   */
  async flush(opts: { heading: string; intro: string }): Promise<number> {
    if (this.dryRun || this.items.size === 0) return 0;

    const userIds = [...this.items.keys()];
    const users = await db.user.findMany({
      where: { id: { in: userIds }, isActive: true, deletedAt: null },
      select: { id: true, email: true, name: true },
    });

    const { sendReminderDigestEmail } = await import("@/lib/email");
    let sent = 0;

    for (const user of users) {
      if (!user.email) continue;
      const rows = this.items.get(user.id) ?? [];
      if (rows.length === 0) continue;

      // Urgent first, then stable by type so the same run reads the same way
      // twice. Not sorted by time: these are all "as of this morning".
      const ordered = [...rows].sort((a, b) => {
        if (!!b.urgent !== !!a.urgent) return b.urgent ? 1 : -1;
        return a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
      });

      try {
        await sendReminderDigestEmail({
          to: user.email,
          recipientName: user.name ?? "there",
          heading: opts.heading,
          intro: opts.intro,
          items: ordered.map((i) => ({
            title: i.title,
            detail: i.message,
            url: i.link,
            urgent: !!i.urgent,
          })),
        });
        sent++;
      } catch (err) {
        console.error(`[reminder-digest] email failed for ${user.id}:`, err);
      }
    }

    // A user who was queued but is now inactive or deleted is dropped silently
    // by the findMany above; report it so a shrinking send is explainable.
    const missing = userIds.length - users.length;
    if (missing > 0) {
      console.warn(
        `[reminder-digest] ${missing} queued recipient(s) are inactive or deleted — not emailed`
      );
    }
    return sent;
  }
}
