import { db } from "./qa-lib.mjs";

let okFlag = false;
try {
  const creator = await db.user.findFirst({ select: { id: true } });
  const l = await db.lead.create({
    data: {
      firstName: "QA", lastName: "DirectCh", channel: "DIRECT_LEAD",
      studyLevel: "UNDERGRADUATE", nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "Computer Science", createdById: creator.id, intakeYear: 2026, intakeMonth: 9,
    },
    select: { id: true, channel: true },
  });
  const back = await db.lead.findUnique({ where: { id: l.id }, select: { channel: true } });
  console.log("created:", l.channel, "| read-back:", back?.channel);
  okFlag = back?.channel === "DIRECT_LEAD";
  await db.lead.delete({ where: { id: l.id } });
} catch (e) {
  console.error("CREATE_ERR:", e?.message?.split("\n").slice(-4).join(" "));
}
console.log(okFlag ? "ROUNDTRIP_OK" : "ROUNDTRIP_FAIL");
await db.$disconnect();
process.exit(okFlag ? 0 : 1);
