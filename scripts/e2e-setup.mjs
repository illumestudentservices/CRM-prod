// Creates 4 disposable test accounts + baseline test data for adversarial testing.
import dotenv from "dotenv";
dotenv.config({ path: "/var/www/illume-crm/.env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { createRequire } from "node:module";
import crypto from "crypto";
const otplib = createRequire(import.meta.url)("otplib");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

// Pick a region — create one if none exist
let region = await db.region.findFirst();
if (!region) {
  region = await db.region.create({ data: { name: "E2E-Region", code: "E2E" } });
}
console.log("Using region:", region.id, region.name);

const now = Date.now();

async function mkUser(role, tag, regionId = null) {
  const email = `e2e-${tag}-${now}@illumestudentservices.cloud`;
  const password = crypto.randomBytes(20).toString("base64url") + "Aa1!";
  const totpSecret = otplib.generateSecret();
  const user = await db.user.create({
    data: {
      email, name: `E2E ${role}`, firstName: "E2E", lastName: role,
      password: await bcrypt.hash(password, 10),
      role,
      isActive: true,
      twoFactorEnabled: true,
      twoFactorSecret: totpSecret,
      twoFactorBackupCodes: [],
      passwordChangedAt: new Date(),
      regionId,
    },
  });
  await db.employee.create({
    data: {
      employeeId: `E2E-${role}-${user.id.slice(0, 6)}`,
      userId: user.id,
      jobTitle: `E2E ${role}`,
      startDate: new Date(),
    },
  });
  return { role, tag, email, password, totpSecret, userId: user.id };
}

const users = {
  ICR_A: await mkUser("ICR", "icr-a", region.id),
  ICR_B: await mkUser("ICR", "icr-b", region.id),
  RM: await mkUser("REGIONAL_MANAGER", "rm", region.id),
  ADMIN: await mkUser("SUPER_ADMIN", "admin"),
};

// Create 2 test leads dedicated for these tests, assigned to ICR_A
const leadA = await db.lead.create({
  data: {
    firstName: "E2E-Test-Lead-A",
    lastName: "One",
    email: `e2e-lead-a-${now}@example.invalid`,
    phone: "+15555550100",
    nationality: "Testland",
    countryOfResidence: "Testland",
    interestedProgram: "Computer Science",
    studyLevel: "POSTGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
    stage: "NEW_LEAD",
    createdById: users.ICR_A.userId,
    regionId: region.id,
    assignedICRId: users.ICR_A.userId,
  },
});

const leadB = await db.lead.create({
  data: {
    firstName: "E2E-Test-Lead-B",
    lastName: "Two",
    email: `e2e-lead-b-${now}@example.invalid`,
    phone: "+15555550101",
    nationality: "Testland",
    countryOfResidence: "Testland",
    interestedProgram: "Data Science",
    studyLevel: "POSTGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
    stage: "NEW_LEAD",
    createdById: users.ICR_A.userId,
    regionId: region.id,
    assignedICRId: users.ICR_A.userId,
  },
});

// Duplicate of leadA for merge-testing (same email spelling variation)
const leadADupe = await db.lead.create({
  data: {
    firstName: "E2E-Test-Lead-A",
    lastName: "One",
    email: `e2e-lead-a-dupe-${now}@example.invalid`,
    phone: "+15555550100", // same phone!
    nationality: "Testland",
    countryOfResidence: "Testland",
    interestedProgram: "CS Duplicate",
    studyLevel: "POSTGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
    stage: "NEW_LEAD",
    createdById: users.ICR_A.userId,
    regionId: region.id,
    assignedICRId: users.ICR_A.userId,
    isDuplicate: true,
    duplicateOfId: leadA.id,
  },
});

// A test market for market-intelligence flow
let mkt = await db.market.findFirst({ where: { code: "E2E" } });
if (!mkt) {
  mkt = await db.market.create({
    data: {
      name: "E2E-Market",
      code: "E2E",
      countryCode: "XZ",
      isActive: true,
      createdById: users.ADMIN.userId,
      regionalManagerId: users.RM.userId,
    },
  });
} else {
  await db.market.update({ where: { id: mkt.id }, data: { regionalManagerId: users.RM.userId } });
}

console.log(JSON.stringify({
  regionId: region.id,
  users,
  leadAId: leadA.id,
  leadBId: leadB.id,
  leadADupeId: leadADupe.id,
  marketId: mkt.id,
}, null, 2));

await db.$disconnect();
