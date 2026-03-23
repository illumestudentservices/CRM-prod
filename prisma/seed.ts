import { PrismaClient, Role, LeadStage, StudyLevel, SourceType, AccountStatus, EventType, EventStatus, ReportStatus, ConfidenceLevel, EmploymentType, LeaveType, InteractionType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaPg(pool as any);
const db = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding Illume CRM...");

  // ─── REGIONS ───────────────────────────────────────────────────────────
  const regions = await Promise.all([
    db.region.upsert({ where: { code: "SA" }, update: {}, create: { name: "South Asia", code: "SA", description: "India, Pakistan, Bangladesh, Sri Lanka, Nepal" } }),
    db.region.upsert({ where: { code: "SEA" }, update: {}, create: { name: "Southeast Asia", code: "SEA", description: "Malaysia, Indonesia, Vietnam, Philippines, Thailand" } }),
    db.region.upsert({ where: { code: "ME" }, update: {}, create: { name: "Middle East", code: "ME", description: "UAE, Saudi Arabia, Kuwait, Qatar, Bahrain" } }),
    db.region.upsert({ where: { code: "AFR" }, update: {}, create: { name: "Africa", code: "AFR", description: "Nigeria, Kenya, Ghana, South Africa, Tanzania" } }),
    db.region.upsert({ where: { code: "EUR" }, update: {}, create: { name: "Europe", code: "EUR", description: "UK, Ireland, France, Germany, Netherlands" } }),
  ]);
  const [regionSA, regionSEA, regionME, regionAFR, regionEUR] = regions;
  console.log("✅ Regions created");

  // ─── DEPARTMENTS ───────────────────────────────────────────────────────
  const deptHQ = await db.department.upsert({ where: { name: "Headquarters" }, update: {}, create: { name: "Headquarters", description: "Global HQ team" } });
  const deptSales = await db.department.upsert({ where: { name: "Student Recruitment" }, update: {}, create: { name: "Student Recruitment", description: "ICRs and regional managers", parentId: deptHQ.id } });
  const deptOps = await db.department.upsert({ where: { name: "Operations" }, update: {}, create: { name: "Operations", description: "Operations and HR", parentId: deptHQ.id } });
  const deptMarketing = await db.department.upsert({ where: { name: "Marketing" }, update: {}, create: { name: "Marketing", description: "Campaigns and digital marketing", parentId: deptHQ.id } });
  console.log("✅ Departments created");

  // ─── USERS ─────────────────────────────────────────────────────────────
  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const password = hash("password123");

  const adminUser = await db.user.upsert({
    where: { email: "admin@illume.edu" }, update: {},
    create: { email: "admin@illume.edu", name: "System Admin", password, role: Role.SUPER_ADMIN, isActive: true },
  });
  const hqUser = await db.user.upsert({
    where: { email: "hq@illume.edu" }, update: {},
    create: { email: "hq@illume.edu", name: "James Whitfield", password, role: Role.HQ_EXECUTIVE, isActive: true },
  });
  const analyticsUser = await db.user.upsert({
    where: { email: "analytics@illume.edu" }, update: {},
    create: { email: "analytics@illume.edu", name: "Priya Nair", password, role: Role.HQ_ANALYTICS, isActive: true },
  });
  const managerUser = await db.user.upsert({
    where: { email: "manager@illume.edu" }, update: {},
    create: { email: "manager@illume.edu", name: "Sarah Chen", password, role: Role.REGIONAL_MANAGER, regionId: regionSEA.id, isActive: true },
  });
  const manager2User = await db.user.upsert({
    where: { email: "manager2@illume.edu" }, update: {},
    create: { email: "manager2@illume.edu", name: "Omar Al-Rashidi", password, role: Role.REGIONAL_MANAGER, regionId: regionME.id, isActive: true },
  });
  const icrUser = await db.user.upsert({
    where: { email: "icr@illume.edu" }, update: {},
    create: { email: "icr@illume.edu", name: "Aisha Rahman", password, role: Role.ICR, regionId: regionSEA.id, isActive: true },
  });
  const icr2User = await db.user.upsert({
    where: { email: "icr2@illume.edu" }, update: {},
    create: { email: "icr2@illume.edu", name: "Deepak Sharma", password, role: Role.ICR, regionId: regionSA.id, isActive: true },
  });
  const icr3User = await db.user.upsert({
    where: { email: "icr3@illume.edu" }, update: {},
    create: { email: "icr3@illume.edu", name: "Fatima Hassan", password, role: Role.ICR, regionId: regionME.id, isActive: true },
  });
  const hrUser = await db.user.upsert({
    where: { email: "hr@illume.edu" }, update: {},
    create: { email: "hr@illume.edu", name: "Linda Park", password, role: Role.HR_MANAGER, isActive: true },
  });
  const emp1User = await db.user.upsert({
    where: { email: "emp1@illume.edu" }, update: {},
    create: { email: "emp1@illume.edu", name: "Marcus Thompson", password, role: Role.EMPLOYEE, isActive: true },
  });
  const emp2User = await db.user.upsert({
    where: { email: "emp2@illume.edu" }, update: {},
    create: { email: "emp2@illume.edu", name: "Yuki Tanaka", password, role: Role.EMPLOYEE, regionId: regionSEA.id, isActive: true },
  });
  console.log("✅ Users created");

  // ─── EMPLOYEES ─────────────────────────────────────────────────────────
  const empAdmin = await db.employee.upsert({
    where: { userId: adminUser.id }, update: {},
    create: { employeeId: "ILL-001", userId: adminUser.id, jobTitle: "System Administrator", departmentId: deptHQ.id, employmentType: EmploymentType.FULL_TIME, startDate: new Date("2020-01-15") },
  });
  const empHQ = await db.employee.upsert({
    where: { userId: hqUser.id }, update: {},
    create: { employeeId: "ILL-002", userId: hqUser.id, jobTitle: "CEO", departmentId: deptHQ.id, employmentType: EmploymentType.FULL_TIME, startDate: new Date("2019-06-01") },
  });
  const empManager = await db.employee.upsert({
    where: { userId: managerUser.id }, update: {},
    create: { employeeId: "ILL-003", userId: managerUser.id, jobTitle: "Regional Manager – SEA", departmentId: deptSales.id, employmentType: EmploymentType.FULL_TIME, managerId: empHQ.id, startDate: new Date("2020-09-01") },
  });
  const empICR = await db.employee.upsert({
    where: { userId: icrUser.id }, update: {},
    create: { employeeId: "ILL-004", userId: icrUser.id, jobTitle: "In-Country Representative", departmentId: deptSales.id, employmentType: EmploymentType.FULL_TIME, managerId: empManager.id, startDate: new Date("2021-03-15"), phone: "+60-12-3456789" },
  });
  const empICR2 = await db.employee.upsert({
    where: { userId: icr2User.id }, update: {},
    create: { employeeId: "ILL-005", userId: icr2User.id, jobTitle: "In-Country Representative", departmentId: deptSales.id, employmentType: EmploymentType.FULL_TIME, startDate: new Date("2021-07-01"), phone: "+91-98765-43210" },
  });
  const empHR = await db.employee.upsert({
    where: { userId: hrUser.id }, update: {},
    create: { employeeId: "ILL-006", userId: hrUser.id, jobTitle: "HR Manager", departmentId: deptOps.id, employmentType: EmploymentType.FULL_TIME, managerId: empHQ.id, startDate: new Date("2020-03-01") },
  });
  const empEmp1 = await db.employee.upsert({
    where: { userId: emp1User.id }, update: {},
    create: { employeeId: "ILL-007", userId: emp1User.id, jobTitle: "Marketing Coordinator", departmentId: deptMarketing.id, employmentType: EmploymentType.FULL_TIME, startDate: new Date("2022-01-10") },
  });
  const empICR3 = await db.employee.upsert({
    where: { userId: icr3User.id }, update: {},
    create: { employeeId: "ILL-008", userId: icr3User.id, jobTitle: "In-Country Representative", departmentId: deptSales.id, employmentType: EmploymentType.FULL_TIME, startDate: new Date("2022-05-01"), phone: "+971-50-1234567" },
  });
  console.log("✅ Employees created");

  // Leave balances
  const currentYear = new Date().getFullYear();
  for (const emp of [empICR, empICR2, empICR3, empManager, empHR, empEmp1]) {
    await db.leaveBalance.upsert({
      where: { employeeId_leaveType_year: { employeeId: emp.id, leaveType: LeaveType.ANNUAL, year: currentYear } },
      update: {},
      create: { employeeId: emp.id, leaveType: LeaveType.ANNUAL, year: currentYear, totalDays: 18, usedDays: 5, pendingDays: 0 },
    });
    await db.leaveBalance.upsert({
      where: { employeeId_leaveType_year: { employeeId: emp.id, leaveType: LeaveType.SICK, year: currentYear } },
      update: {},
      create: { employeeId: emp.id, leaveType: LeaveType.SICK, year: currentYear, totalDays: 10, usedDays: 2, pendingDays: 0 },
    });
  }
  console.log("✅ Leave balances created");

  // ─── INSTITUTIONS ──────────────────────────────────────────────────────
  const institutions = await Promise.all([
    db.institution.upsert({ where: { id: "inst-ucl" }, update: {}, create: { id: "inst-ucl", name: "University College London", country: "United Kingdom", type: "University", website: "https://ucl.ac.uk", accountStatus: AccountStatus.ACTIVE, regionId: regionEUR.id, createdById: adminUser.id } }),
    db.institution.upsert({ where: { id: "inst-uom" }, update: {}, create: { id: "inst-uom", name: "University of Manchester", country: "United Kingdom", type: "University", website: "https://manchester.ac.uk", accountStatus: AccountStatus.ACTIVE, regionId: regionEUR.id, createdById: adminUser.id } }),
    db.institution.upsert({ where: { id: "inst-ucd" }, update: {}, create: { id: "inst-ucd", name: "University College Dublin", country: "Ireland", type: "University", website: "https://ucd.ie", accountStatus: AccountStatus.RENEWAL_DUE, regionId: regionEUR.id, createdById: adminUser.id } }),
    db.institution.upsert({ where: { id: "inst-ubc" }, update: {}, create: { id: "inst-ubc", name: "University of British Columbia", country: "Canada", type: "University", website: "https://ubc.ca", accountStatus: AccountStatus.ACTIVE, regionId: regionSEA.id, createdById: adminUser.id } }),
    db.institution.upsert({ where: { id: "inst-melb" }, update: {}, create: { id: "inst-melb", name: "University of Melbourne", country: "Australia", type: "University", website: "https://unimelb.edu.au", accountStatus: AccountStatus.ACTIVE, regionId: regionSEA.id, createdById: adminUser.id } }),
    db.institution.upsert({ where: { id: "inst-rmit" }, update: {}, create: { id: "inst-rmit", name: "RMIT University", country: "Australia", type: "University", website: "https://rmit.edu.au", accountStatus: AccountStatus.ACTIVE, regionId: regionSEA.id, createdById: adminUser.id } }),
    db.institution.upsert({ where: { id: "inst-queens" }, update: {}, create: { id: "inst-queens", name: "Queen's University Belfast", country: "United Kingdom", type: "University", website: "https://qub.ac.uk", accountStatus: AccountStatus.PROSPECT, regionId: regionEUR.id, createdById: adminUser.id } }),
    db.institution.upsert({ where: { id: "inst-toronto" }, update: {}, create: { id: "inst-toronto", name: "University of Toronto", country: "Canada", type: "University", website: "https://utoronto.ca", accountStatus: AccountStatus.ACTIVE, regionId: regionSA.id, createdById: adminUser.id } }),
  ]);
  const [instUCL, instUOM, instUCD, instUBC, instMelb, instRMIT, instQueens, instToronto] = institutions;

  // Assign ICRs to institutions
  await db.institutionUser.createMany({
    data: [
      { institutionId: instUCL.id, userId: icrUser.id },
      { institutionId: instUOM.id, userId: icrUser.id },
      { institutionId: instUBC.id, userId: icrUser.id },
      { institutionId: instMelb.id, userId: icr2User.id },
      { institutionId: instRMIT.id, userId: icr2User.id },
      { institutionId: instToronto.id, userId: icr2User.id },
      { institutionId: instUCD.id, userId: icr3User.id },
      { institutionId: instQueens.id, userId: icr3User.id },
    ],
    skipDuplicates: true,
  });

  // Enrollment targets
  for (const inst of [instUCL, instUOM, instMelb, instUBC]) {
    await db.enrollmentTarget.upsert({
      where: { id: `et-${inst.id}-2025` },
      update: {},
      create: { id: `et-${inst.id}-2025`, institutionId: inst.id, year: 2025, target: 50, actual: 28 },
    });
    await db.enrollmentTarget.upsert({
      where: { id: `et-${inst.id}-2024` },
      update: {},
      create: { id: `et-${inst.id}-2024`, institutionId: inst.id, year: 2024, target: 45, actual: 41 },
    });
  }

  // Contracts
  await db.contract.createMany({
    data: [
      { institutionId: instUCL.id, title: "Recruitment Partnership 2024–2026", value: 15000, startDate: new Date("2024-01-01"), endDate: new Date("2026-12-31"), status: "ACTIVE", createdById: adminUser.id },
      { institutionId: instUOM.id, title: "Preferred Partner Agreement", value: 12000, startDate: new Date("2023-06-01"), endDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), status: "ACTIVE", createdById: adminUser.id },
      { institutionId: instMelb.id, title: "Recruitment Service Contract", value: 18000, startDate: new Date("2024-03-01"), endDate: new Date("2026-02-28"), status: "ACTIVE", createdById: adminUser.id },
    ],
    skipDuplicates: true,
  });

  // Engagement logs
  await db.engagementLog.createMany({
    data: [
      { institutionId: instUCL.id, userId: icrUser.id, type: InteractionType.MEETING, date: new Date("2025-01-15"), notes: "Quarterly review meeting. Discussed intake targets for 2025.", outcome: "Agreed to increase target to 50 students" },
      { institutionId: instUOM.id, userId: icrUser.id, type: InteractionType.CALL, date: new Date("2025-02-10"), notes: "Phone call to discuss new program offerings", outcome: "Will send updated program brochures" },
      { institutionId: instMelb.id, userId: icr2User.id, type: InteractionType.EMAIL, date: new Date("2025-01-20"), notes: "Sent updated agent commission structure", outcome: "Awaiting confirmation" },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Institutions, contracts, engagements created");

  // ─── SOURCES ───────────────────────────────────────────────────────────
  const sources = await Promise.all([
    db.source.upsert({ where: { id: "src-001" }, update: {}, create: { id: "src-001", name: "EduBridge Malaysia", type: SourceType.AGENT, country: "Malaysia", city: "Kuala Lumpur", contactPerson: "Ahmad Razali", email: "ahmad@edubridge.my", phone: "+60-12-9876543", rating: 5, agreementStatus: "Signed", regionId: regionSEA.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-002" }, update: {}, create: { id: "src-002", name: "Global Path India", type: SourceType.AGENT, country: "India", city: "Mumbai", contactPerson: "Ravi Patel", email: "ravi@globalpath.in", phone: "+91-98765-12345", rating: 4, agreementStatus: "Signed", regionId: regionSA.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-003" }, update: {}, create: { id: "src-003", name: "StudyAbroad UAE", type: SourceType.AGENT, country: "UAE", city: "Dubai", contactPerson: "Khalid Al-Mansouri", email: "khalid@studyabroad.ae", rating: 4, agreementStatus: "Signed", regionId: regionME.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-004" }, update: {}, create: { id: "src-004", name: "Future Scholars Nigeria", type: SourceType.AGENT, country: "Nigeria", city: "Lagos", contactPerson: "Chukwuemeka Obi", email: "chuks@futurescholars.ng", rating: 3, agreementStatus: "Pending", regionId: regionAFR.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-005" }, update: {}, create: { id: "src-005", name: "INTI International College", type: SourceType.SCHOOL, country: "Malaysia", city: "Kuala Lumpur", contactPerson: "Dr. Mei Ling", email: "partnerships@inti.edu.my", rating: 5, agreementStatus: "Signed", regionId: regionSEA.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-006" }, update: {}, create: { id: "src-006", name: "Delhi Public School Network", type: SourceType.SCHOOL, country: "India", city: "New Delhi", contactPerson: "Principal Sharma", email: "intl@dps.edu.in", rating: 4, agreementStatus: "Signed", regionId: regionSA.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-007" }, update: {}, create: { id: "src-007", name: "GEMS Education Dubai", type: SourceType.SCHOOL, country: "UAE", city: "Dubai", contactPerson: "Maria Fernandez", email: "counsellor@gems.ae", rating: 5, agreementStatus: "Signed", regionId: regionME.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-008" }, update: {}, create: { id: "src-008", name: "Campus Walk-in KL", type: SourceType.WALK_IN, country: "Malaysia", city: "Kuala Lumpur", rating: 3, regionId: regionSEA.id, createdById: adminUser.id } }),
    db.source.upsert({ where: { id: "src-009" }, update: {}, create: { id: "src-009", name: "Google Ads – UK Programs", type: SourceType.DIGITAL, country: "Malaysia", rating: 3, regionId: regionSEA.id, createdById: adminUser.id } }),
    db.source.upsert({ where: { id: "src-010" }, update: {}, create: { id: "src-010", name: "Meta/Instagram Campaign", type: SourceType.CAMPAIGN, country: "India", rating: 3, regionId: regionSA.id, createdById: adminUser.id } }),
    db.source.upsert({ where: { id: "src-011" }, update: {}, create: { id: "src-011", name: "Arab Education Partners", type: SourceType.PARTNER, country: "Saudi Arabia", city: "Riyadh", contactPerson: "Abdullah Al-Saud", email: "aep@arabedpartners.com", rating: 4, agreementStatus: "Signed", regionId: regionME.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-012" }, update: {}, create: { id: "src-012", name: "Kenya Education Consultants", type: SourceType.AGENT, country: "Kenya", city: "Nairobi", contactPerson: "Wanjiku Kamau", email: "wanjiku@kenedu.co.ke", rating: 3, agreementStatus: "Pending", regionId: regionAFR.id, createdById: adminUser.id } }),
    db.source.upsert({ where: { id: "src-013" }, update: {}, create: { id: "src-013", name: "Vietnam Study Abroad", type: SourceType.AGENT, country: "Vietnam", city: "Ho Chi Minh City", contactPerson: "Nguyen Thi Lan", email: "lan@studyabroad.vn", rating: 4, agreementStatus: "Signed", regionId: regionSEA.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-014" }, update: {}, create: { id: "src-014", name: "Indonesia Global Education", type: SourceType.AGENT, country: "Indonesia", city: "Jakarta", contactPerson: "Budi Santoso", email: "budi@indoedu.co.id", rating: 4, agreementStatus: "Signed", regionId: regionSEA.id, createdById: adminUser.id, lastActiveAt: new Date() } }),
    db.source.upsert({ where: { id: "src-015" }, update: {}, create: { id: "src-015", name: "YouTube Study Abroad Channel", type: SourceType.DIGITAL, country: "Global", rating: 2, regionId: regionSEA.id, createdById: adminUser.id } }),
  ]);
  const [srcEduBridge, srcGlobalPath, srcStudyUAE, srcNigeria, srcINTI, srcDPS, srcGEMS, srcWalkin, srcGoogle, srcMeta, srcArab, srcKenya, srcVietnam, srcIndonesia, srcYoutube] = sources;
  console.log("✅ Sources created");

  // ─── LEADS ─────────────────────────────────────────────────────────────
  const leadData = [
    { fullName: "Muhammad Arif Hassan", email: "arif.hassan@gmail.com", phone: "+60-11-2345678", nationality: "Malaysian", countryOfResidence: "Malaysia", interestedProgram: "MSc Computer Science", faculty: "Engineering & Computing", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcEduBridge.id, institutionId: instUCL.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Priya Krishnaswamy", email: "priya.k@outlook.com", phone: "+60-12-8765432", nationality: "Indian", countryOfResidence: "Malaysia", interestedProgram: "MBA", faculty: "Business", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcEduBridge.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Nur Aisyah Binti Zulkifli", email: "nuraisyah@yahoo.com", phone: "+60-11-9876543", nationality: "Malaysian", countryOfResidence: "Malaysia", interestedProgram: "BEng Civil Engineering", faculty: "Engineering", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.DOCUMENTS_RECEIVED, sourceId: srcINTI.id, institutionId: instUCL.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Tanvir Ahmed", email: "tanvir.a@gmail.com", phone: "+60-16-3456789", nationality: "Bangladeshi", countryOfResidence: "Malaysia", interestedProgram: "Foundation in Science", studyLevel: StudyLevel.FOUNDATION, intakeYear: 2025, intakeMonth: 1, stage: LeadStage.APPLICATION_SENT, sourceId: srcEduBridge.id, institutionId: instUBC.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Li Wei Zhang", email: "liwei.z@hotmail.com", phone: "+60-17-2345678", nationality: "Chinese", countryOfResidence: "Malaysia", interestedProgram: "BSc Data Science", faculty: "Computing", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcGoogle.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Rahul Mehta", email: "rahul.mehta@gmail.com", phone: "+91-98765-43210", nationality: "Indian", countryOfResidence: "India", interestedProgram: "MSc Finance", faculty: "Economics", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcGlobalPath.id, institutionId: instUOM.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Sneha Verma", email: "sneha.v@yahoo.in", phone: "+91-87654-32109", nationality: "Indian", countryOfResidence: "India", interestedProgram: "BEng Mechanical Engineering", faculty: "Engineering", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcDPS.id, institutionId: instMelb.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Arjun Kumar Singh", email: "arjun.singh@rediffmail.com", phone: "+91-76543-21098", nationality: "Indian", countryOfResidence: "India", interestedProgram: "MSc Artificial Intelligence", faculty: "Engineering & Computing", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.DOCUMENTS_RECEIVED, sourceId: srcGlobalPath.id, institutionId: instUCL.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Pooja Agarwal", email: "pooja.a@gmail.com", phone: "+91-65432-10987", nationality: "Indian", countryOfResidence: "India", interestedProgram: "MBA International Business", faculty: "Business", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 1, stage: LeadStage.NEW, sourceId: srcMeta.id, institutionId: instToronto.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Khalid Al-Mansouri", email: "khalid.am@gmail.com", phone: "+971-50-1234567", nationality: "UAE National", countryOfResidence: "UAE", interestedProgram: "BSc Business Management", faculty: "Business", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcGEMS.id, institutionId: instUOM.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Fatima Al-Zahra", email: "fatima.az@hotmail.com", phone: "+971-55-9876543", nationality: "Saudi Arabian", countryOfResidence: "UAE", interestedProgram: "MSc International Law", faculty: "Law", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcStudyUAE.id, institutionId: instUCL.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Omar Bin Rashid", email: "omar.rashid@gmail.com", phone: "+971-52-3456789", nationality: "UAE National", countryOfResidence: "UAE", interestedProgram: "Foundation in Business", studyLevel: StudyLevel.FOUNDATION, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.APPLICATION_SENT, sourceId: srcArab.id, institutionId: instUCD.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Amina Hassan Mohammed", email: "amina.hassan@gmail.com", phone: "+234-80-12345678", nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "BSc Computer Science", faculty: "Computing", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcNigeria.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionAFR.id },
    { fullName: "Chidi Okonkwo", email: "chidi.o@yahoo.com", phone: "+234-81-98765432", nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "MSc Public Health", faculty: "Medicine", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.NEW, sourceId: srcNigeria.id, institutionId: instUCL.id, assignedICRId: icrUser.id, regionId: regionAFR.id },
    { fullName: "Nguyen Van An", email: "vanan.nguyen@gmail.com", phone: "+84-90-1234567", nationality: "Vietnamese", countryOfResidence: "Vietnam", interestedProgram: "BEng Electronics", faculty: "Engineering", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcVietnam.id, institutionId: instRMIT.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Siti Nurhaliza Binti Ahmad", email: "siti.n@gmail.com", phone: "+60-13-4567890", nationality: "Malaysian", countryOfResidence: "Malaysia", interestedProgram: "BSc Pharmacy", faculty: "Medicine & Life Sciences", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2026, intakeMonth: 1, stage: LeadStage.NEW, sourceId: srcEduBridge.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Aditya Kumar Joshi", email: "aditya.j@gmail.com", phone: "+91-99876-54321", nationality: "Indian", countryOfResidence: "India", interestedProgram: "MSc Data Analytics", faculty: "Computing", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.DEFERRED, sourceId: srcDPS.id, institutionId: instMelb.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Wanjiru Kamau", email: "wanjiru.k@gmail.com", phone: "+254-72-1234567", nationality: "Kenyan", countryOfResidence: "Kenya", interestedProgram: "BSc International Business", faculty: "Business", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcKenya.id, institutionId: instUCD.id, assignedICRId: icr3User.id, regionId: regionAFR.id },
    { fullName: "Budi Raharjo", email: "budi.r@yahoo.co.id", phone: "+62-81-23456789", nationality: "Indonesian", countryOfResidence: "Indonesia", interestedProgram: "MSc Marine Engineering", faculty: "Engineering", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.REJECTED, sourceId: srcIndonesia.id, institutionId: instMelb.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Sana Al-Farsi", email: "sana.alfarsi@gmail.com", phone: "+968-91-234567", nationality: "Omani", countryOfResidence: "Oman", interestedProgram: "BEng Architecture", faculty: "Architecture & Design", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcArab.id, institutionId: instUOM.id, assignedICRId: icr3User.id, regionId: regionME.id },
    // Additional leads for volume
    { fullName: "James Okafor", email: "james.okafor@gmail.com", phone: "+234-70-9876543", nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "BSc Nursing", faculty: "Health Sciences", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.APPLICATION_SENT, sourceId: srcNigeria.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionAFR.id },
    { fullName: "Yemi Adeyemi", email: "yemi.a@yahoo.com", phone: "+234-80-87654321", nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "MSc Management", faculty: "Business", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.LOST, sourceId: srcNigeria.id, institutionId: instUCL.id, assignedICRId: icrUser.id, regionId: regionAFR.id },
    { fullName: "Park Ji-Woo", email: "jiwoo.park@naver.com", phone: "+82-10-1234-5678", nationality: "Korean", countryOfResidence: "South Korea", interestedProgram: "MA International Relations", faculty: "Social Sciences", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcGoogle.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Tran Thi Mai", email: "mai.tran@gmail.com", phone: "+84-91-9876543", nationality: "Vietnamese", countryOfResidence: "Vietnam", interestedProgram: "BSc Accounting", faculty: "Business", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.DOCUMENTS_RECEIVED, sourceId: srcVietnam.id, institutionId: instRMIT.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Ahmad Al-Qasim", email: "ahmad.q@gmail.com", phone: "+966-55-1234567", nationality: "Saudi Arabian", countryOfResidence: "Saudi Arabia", interestedProgram: "MSc Finance & Investment", faculty: "Economics", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcStudyUAE.id, institutionId: instToronto.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Grace Onyeka", email: "grace.onyeka@gmail.com", phone: "+234-81-11122233", nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "Foundation in Arts", studyLevel: StudyLevel.FOUNDATION, intakeYear: 2025, intakeMonth: 1, stage: LeadStage.NEW, sourceId: srcNigeria.id, institutionId: instQueens.id, assignedICRId: icr3User.id, regionId: regionAFR.id },
    { fullName: "Chen Xiao Ming", email: "xiaoming.chen@163.com", phone: "+86-138-1234-5678", nationality: "Chinese", countryOfResidence: "China", interestedProgram: "BSc Computer Science", faculty: "Computing", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.APPLICATION_SENT, sourceId: srcGoogle.id, institutionId: instUCL.id, assignedICRId: icr2User.id, regionId: regionSEA.id },
    { fullName: "Nadia El-Sayed", email: "nadia.elsayed@gmail.com", phone: "+20-10-1234-5678", nationality: "Egyptian", countryOfResidence: "Egypt", interestedProgram: "MSc Environmental Science", faculty: "Science", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcStudyUAE.id, institutionId: instUOM.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Rizky Pratama", email: "rizky.p@gmail.com", phone: "+62-82-34567890", nationality: "Indonesian", countryOfResidence: "Indonesia", interestedProgram: "MSc Urban Planning", faculty: "Architecture", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2026, intakeMonth: 1, stage: LeadStage.NEW, sourceId: srcIndonesia.id, institutionId: instUCL.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Kavitha Nair", email: "kavitha.nair@gmail.com", phone: "+91-94567-89012", nationality: "Indian", countryOfResidence: "India", interestedProgram: "MSc Nursing", faculty: "Health Sciences", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.DOCUMENTS_RECEIVED, sourceId: srcGlobalPath.id, institutionId: instUOM.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Mohammed Al-Balushi", email: "mohammed.b@gmail.com", phone: "+968-92-345678", nationality: "Omani", countryOfResidence: "Oman", interestedProgram: "BEng Electrical Engineering", faculty: "Engineering", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcArab.id, institutionId: instMelb.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Aisha Diallo", email: "aisha.diallo@gmail.com", phone: "+221-77-1234567", nationality: "Senegalese", countryOfResidence: "Senegal", interestedProgram: "MSc Public Administration", faculty: "Social Sciences", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcNigeria.id, institutionId: instUCD.id, assignedICRId: icr3User.id, regionId: regionAFR.id },
    { fullName: "Pham Quoc Hung", email: "quochung@gmail.com", phone: "+84-93-4567890", nationality: "Vietnamese", countryOfResidence: "Vietnam", interestedProgram: "Pathway to Engineering", studyLevel: StudyLevel.PATHWAY, intakeYear: 2025, intakeMonth: 1, stage: LeadStage.NEW, sourceId: srcVietnam.id, institutionId: instRMIT.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Deepa Menon", email: "deepa.menon@gmail.com", phone: "+91-88765-43210", nationality: "Indian", countryOfResidence: "India", interestedProgram: "BSc Psychology", faculty: "Social Sciences", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcDPS.id, institutionId: instToronto.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Salim Al-Habsi", email: "salim.h@gmail.com", phone: "+968-93-456789", nationality: "Omani", countryOfResidence: "Oman", interestedProgram: "MBA Healthcare", faculty: "Business", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.APPLICATION_SENT, sourceId: srcArab.id, institutionId: instUBC.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Siti Rahayu Binti Hussin", email: "siti.rahayu@yahoo.com", phone: "+60-14-5678901", nationality: "Malaysian", countryOfResidence: "Malaysia", interestedProgram: "Foundation in Business", studyLevel: StudyLevel.FOUNDATION, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcINTI.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Emeka Nwosu", email: "emeka.nwosu@gmail.com", phone: "+234-82-3456789", nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "MSc Petroleum Engineering", faculty: "Engineering", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcNigeria.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionAFR.id },
    { fullName: "Tsega Haile", email: "tsega.h@gmail.com", phone: "+251-91-1234567", nationality: "Ethiopian", countryOfResidence: "Ethiopia", interestedProgram: "BSc Civil Engineering", faculty: "Engineering", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.NEW, sourceId: srcKenya.id, institutionId: instUOM.id, assignedICRId: icr3User.id, regionId: regionAFR.id },
    { fullName: "Min Jun Kim", email: "minjun.k@gmail.com", phone: "+82-10-9876-5432", nationality: "Korean", countryOfResidence: "South Korea", interestedProgram: "MSc Biotechnology", faculty: "Science", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.DOCUMENTS_RECEIVED, sourceId: srcGoogle.id, institutionId: instUCL.id, assignedICRId: icr2User.id, regionId: regionSEA.id },
    { fullName: "Yasmin Othman", email: "yasmin.o@gmail.com", phone: "+60-15-6789012", nationality: "Malaysian", countryOfResidence: "Malaysia", interestedProgram: "BSc Biomedical Science", faculty: "Medicine", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcEduBridge.id, institutionId: instMelb.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Sameer Qureshi", email: "sameer.q@gmail.com", phone: "+92-300-1234567", nationality: "Pakistani", countryOfResidence: "Pakistan", interestedProgram: "MSc Software Engineering", faculty: "Computing", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcGlobalPath.id, institutionId: instUOM.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Nasrin Hosseini", email: "nasrin.h@gmail.com", phone: "+98-912-1234567", nationality: "Iranian", countryOfResidence: "Iran", interestedProgram: "MA Linguistics", faculty: "Arts", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcStudyUAE.id, institutionId: instUOM.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Juan Carlos Martinez", email: "jc.martinez@gmail.com", phone: "+34-612-345-678", nationality: "Spanish", countryOfResidence: "Spain", interestedProgram: "MSc Finance", faculty: "Business", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.APPLICATION_SENT, sourceId: srcGoogle.id, institutionId: instUCL.id, assignedICRId: icr2User.id, regionId: regionEUR.id },
    { fullName: "Emma Nakamura", email: "emma.n@outlook.com", phone: "+81-90-1234-5678", nationality: "Japanese", countryOfResidence: "Japan", interestedProgram: "BSc International Business", faculty: "Business", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.NEW, sourceId: srcGoogle.id, institutionId: instUCL.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Kwame Asante", email: "kwame.a@gmail.com", phone: "+233-24-1234567", nationality: "Ghanaian", countryOfResidence: "Ghana", interestedProgram: "LLB Law", faculty: "Law", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.DOCUMENTS_RECEIVED, sourceId: srcNigeria.id, institutionId: instUCL.id, assignedICRId: icr3User.id, regionId: regionAFR.id },
    { fullName: "Zeynep Kaya", email: "zeynep.k@gmail.com", phone: "+90-532-1234567", nationality: "Turkish", countryOfResidence: "Turkey", interestedProgram: "MSc Architecture", faculty: "Architecture", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcStudyUAE.id, institutionId: instMelb.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Rohit Agarwal", email: "rohit.ag@gmail.com", phone: "+91-77654-32109", nationality: "Indian", countryOfResidence: "India", interestedProgram: "Foundation in Engineering", studyLevel: StudyLevel.FOUNDATION, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcGlobalPath.id, institutionId: instUOM.id, assignedICRId: icr2User.id, regionId: regionSA.id },
    { fullName: "Amirah Zainudin", email: "amirah.z@gmail.com", phone: "+60-18-9012345", nationality: "Malaysian", countryOfResidence: "Malaysia", interestedProgram: "BSc Nursing", faculty: "Health Sciences", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.NEW, sourceId: srcEduBridge.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Joseph Mensah", email: "joseph.m@gmail.com", phone: "+233-27-9876543", nationality: "Ghanaian", countryOfResidence: "Ghana", interestedProgram: "MSc Engineering Management", faculty: "Engineering", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2026, intakeMonth: 1, stage: LeadStage.APPLICATION_SENT, sourceId: srcNigeria.id, institutionId: instUOM.id, assignedICRId: icr3User.id, regionId: regionAFR.id },
    { fullName: "Thu Ha Nguyen", email: "thuha.n@gmail.com", phone: "+84-94-5678901", nationality: "Vietnamese", countryOfResidence: "Vietnam", interestedProgram: "MSc Tourism Management", faculty: "Business", studyLevel: StudyLevel.POSTGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.CONTACTED, sourceId: srcVietnam.id, institutionId: instRMIT.id, assignedICRId: icrUser.id, regionId: regionSEA.id },
    { fullName: "Ibrahim Al-Mahmoud", email: "ibrahim.am@gmail.com", phone: "+974-66-1234567", nationality: "Qatari", countryOfResidence: "Qatar", interestedProgram: "BEng Petroleum Engineering", faculty: "Engineering", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.OFFER_ISSUED, sourceId: srcArab.id, institutionId: instUCL.id, assignedICRId: icr3User.id, regionId: regionME.id },
    { fullName: "Nkechi Obi", email: "nkechi.obi@gmail.com", phone: "+234-83-4567890", nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "BSc Public Health", faculty: "Health Sciences", studyLevel: StudyLevel.UNDERGRADUATE, intakeYear: 2025, intakeMonth: 9, stage: LeadStage.ENROLLED, sourceId: srcNigeria.id, institutionId: instUOM.id, assignedICRId: icrUser.id, regionId: regionAFR.id },
  ];

  const now = new Date();
  for (const ld of leadData) {
    await db.lead.upsert({
      where: { id: `lead-${ld.email.replace(/[@.]/g, "-")}` },
      update: {},
      create: {
        id: `lead-${ld.email.replace(/[@.]/g, "-")}`,
        ...ld,
        createdById: adminUser.id,
        lastContactedAt: ld.stage !== LeadStage.NEW ? now : null,
        lastProgressedAt: ![LeadStage.NEW as string, LeadStage.CONTACTED as string].includes(ld.stage) ? now : null,
      },
    });
  }
  console.log(`✅ ${leadData.length} leads created`);

  // Lead activities for first few leads
  const firstLead = await db.lead.findFirst({ where: { email: "arif.hassan@gmail.com" } });
  if (firstLead) {
    await db.leadActivity.createMany({
      data: [
        { leadId: firstLead.id, userId: icrUser.id, type: "CREATED", description: "Lead created and assigned", createdAt: new Date("2025-01-10") },
        { leadId: firstLead.id, userId: icrUser.id, type: "STAGE_CHANGE", description: "Stage changed from NEW to CONTACTED", createdAt: new Date("2025-01-12") },
        { leadId: firstLead.id, userId: icrUser.id, type: "STAGE_CHANGE", description: "Stage changed from CONTACTED to APPLICATION_SENT", createdAt: new Date("2025-01-20") },
        { leadId: firstLead.id, userId: icrUser.id, type: "NOTE_ADDED", description: "Student confirmed IELTS score of 7.0", createdAt: new Date("2025-01-25") },
        { leadId: firstLead.id, userId: icrUser.id, type: "STAGE_CHANGE", description: "Stage changed from APPLICATION_SENT to DOCUMENTS_RECEIVED", createdAt: new Date("2025-02-01") },
        { leadId: firstLead.id, userId: icrUser.id, type: "STAGE_CHANGE", description: "Stage changed from DOCUMENTS_RECEIVED to OFFER_ISSUED", createdAt: new Date("2025-02-15") },
        { leadId: firstLead.id, userId: icrUser.id, type: "STAGE_CHANGE", description: "Stage changed from OFFER_ISSUED to ENROLLED — CAS issued by UCL", createdAt: new Date("2025-03-01") },
      ],
      skipDuplicates: true,
    });
    await db.leadNote.create({
      data: { leadId: firstLead.id, authorId: icrUser.id, content: "Student has confirmed accommodation booking at UCL student housing. Visa appointment booked for March 20th." },
    });
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────
  const events = await Promise.all([
    db.event.upsert({ where: { id: "evt-001" }, update: {}, create: { id: "evt-001", name: "Malaysia International Education Fair 2025", type: EventType.EDUCATION_FAIR, date: new Date("2025-03-15"), city: "Kuala Lumpur", country: "Malaysia", status: EventStatus.COMPLETED, budget: 5000, totalCost: 4750, regionId: regionSEA.id, assignedICRId: icrUser.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-002" }, update: {}, create: { id: "evt-002", name: "Dubai Study Abroad Expo", type: EventType.EXHIBITION, date: new Date("2025-02-20"), city: "Dubai", country: "UAE", status: EventStatus.COMPLETED, budget: 8000, totalCost: 7800, regionId: regionME.id, assignedICRId: icr3User.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-003" }, update: {}, create: { id: "evt-003", name: "UCL Virtual Open Day – SEA Students", type: EventType.WEBINAR, date: new Date("2025-04-10"), city: "Online", country: "Global", status: EventStatus.CONFIRMED, budget: 500, totalCost: 200, regionId: regionSEA.id, assignedICRId: icrUser.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-004" }, update: {}, create: { id: "evt-004", name: "India Higher Education Forum", type: EventType.EDUCATION_FAIR, date: new Date("2025-05-22"), city: "Mumbai", country: "India", status: EventStatus.PLANNED, budget: 6000, totalCost: 0, regionId: regionSA.id, assignedICRId: icr2User.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-005" }, update: {}, create: { id: "evt-005", name: "Agent Training Day – KL", type: EventType.AGENT_TRAINING, date: new Date("2025-01-25"), city: "Kuala Lumpur", country: "Malaysia", status: EventStatus.COMPLETED, budget: 2000, totalCost: 1850, regionId: regionSEA.id, assignedICRId: icrUser.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-006" }, update: {}, create: { id: "evt-006", name: "Nigeria Campus Information Session", type: EventType.SCHOOL_PRESENTATION, date: new Date("2025-04-05"), city: "Lagos", country: "Nigeria", status: EventStatus.CONFIRMED, budget: 3000, totalCost: 0, regionId: regionAFR.id, assignedICRId: icrUser.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-007" }, update: {}, create: { id: "evt-007", name: "University of Melbourne Campus Visit", type: EventType.CAMPUS_VISIT, date: new Date("2025-06-15"), city: "Melbourne", country: "Australia", status: EventStatus.PLANNED, budget: 12000, totalCost: 0, regionId: regionSEA.id, assignedICRId: icrUser.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-008" }, update: {}, create: { id: "evt-008", name: "INTI College School Presentation", type: EventType.SCHOOL_PRESENTATION, date: new Date("2025-01-10"), city: "Kuala Lumpur", country: "Malaysia", status: EventStatus.COMPLETED, budget: 500, totalCost: 450, regionId: regionSEA.id, assignedICRId: icrUser.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-009" }, update: {}, create: { id: "evt-009", name: "Middle East Education Summit", type: EventType.EDUCATION_FAIR, date: new Date("2025-03-08"), city: "Abu Dhabi", country: "UAE", status: EventStatus.COMPLETED, budget: 9000, totalCost: 8600, regionId: regionME.id, assignedICRId: icr3User.id, createdById: adminUser.id } }),
    db.event.upsert({ where: { id: "evt-010" }, update: {}, create: { id: "evt-010", name: "Africa Future Leaders Conference", type: EventType.EDUCATION_FAIR, date: new Date("2025-07-20"), city: "Nairobi", country: "Kenya", status: EventStatus.PLANNED, budget: 7000, totalCost: 0, regionId: regionAFR.id, assignedICRId: icr3User.id, createdById: adminUser.id } }),
  ]);

  // Event institutions
  await db.eventInstitution.createMany({
    data: [
      { eventId: "evt-001", institutionId: instUCL.id },
      { eventId: "evt-001", institutionId: instUOM.id },
      { eventId: "evt-001", institutionId: instMelb.id },
      { eventId: "evt-002", institutionId: instUCL.id },
      { eventId: "evt-002", institutionId: instUOM.id },
      { eventId: "evt-002", institutionId: instUCD.id },
      { eventId: "evt-003", institutionId: instUCL.id },
      { eventId: "evt-005", institutionId: instUCL.id },
      { eventId: "evt-005", institutionId: instUOM.id },
      { eventId: "evt-009", institutionId: instUCL.id },
      { eventId: "evt-009", institutionId: instUOM.id },
      { eventId: "evt-009", institutionId: instUCD.id },
    ],
    skipDuplicates: true,
  });

  // Event expenses
  await db.eventExpense.createMany({
    data: [
      { eventId: "evt-001", description: "Exhibition booth rental", amount: 2000, category: "Venue" },
      { eventId: "evt-001", description: "Printed materials & brochures", amount: 800, category: "Marketing" },
      { eventId: "evt-001", description: "Staff travel & accommodation", amount: 1200, category: "Travel" },
      { eventId: "evt-001", description: "Banners and display", amount: 750, category: "Materials" },
      { eventId: "evt-002", description: "Booth at World Education Fair Dubai", amount: 3500, category: "Venue" },
      { eventId: "evt-002", description: "Flights KL–Dubai return", amount: 2200, category: "Travel" },
      { eventId: "evt-002", description: "Hotel (3 nights)", amount: 1500, category: "Travel" },
      { eventId: "evt-002", description: "Branded merchandise", amount: 600, category: "Materials" },
      { eventId: "evt-005", description: "Venue rental – INTI College", amount: 500, category: "Venue" },
      { eventId: "evt-005", description: "Lunch for 25 agents", amount: 625, category: "Staff" },
      { eventId: "evt-005", description: "Training materials", amount: 350, category: "Materials" },
      { eventId: "evt-005", description: "Gifts & appreciation tokens", amount: 375, category: "Materials" },
      { eventId: "evt-008", description: "Travel to INTI", amount: 150, category: "Travel" },
      { eventId: "evt-008", description: "Presentation materials", amount: 300, category: "Marketing" },
      { eventId: "evt-009", description: "Exhibition booth", amount: 4000, category: "Venue" },
      { eventId: "evt-009", description: "Flights & hotel", amount: 3200, category: "Travel" },
      { eventId: "evt-009", description: "Promotional items", amount: 1400, category: "Marketing" },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Events, expenses created");

  // ─── MONTHLY REPORTS ───────────────────────────────────────────────────
  await db.monthlyReport.upsert({
    where: { icrId_institutionId_reportingMonth_reportingYear: { icrId: icrUser.id, institutionId: instUCL.id, reportingMonth: 1, reportingYear: 2025 } },
    update: {},
    create: {
      icrId: icrUser.id, institutionId: instUCL.id, regionId: regionSEA.id,
      reportingMonth: 1, reportingYear: 2025,
      status: ReportStatus.FINAL_APPROVED,
      leadsData: { total: 8, enrolled: 2, stages: { NEW: 1, CONTACTED: 2, ENROLLED: 2, OFFER_ISSUED: 2, LOST: 1 } },
      programBreakdown: [{ program: "MSc Computer Science", level: "POSTGRADUATE", count: 3 }, { program: "BEng Civil Engineering", level: "UNDERGRADUATE", count: 2 }],
      sourcePerformance: [{ source: "EduBridge Malaysia", leads: 5, enrolled: 2 }],
      kpiSummary: { conversionRate: 25, avgTimeToOffer: 21, totalLeads: 8 },
      engagementNotes: "Attended KL Education Fair. Met with 3 school counsellors. UCL ranked #8 in QS — strong selling point.",
      challengesOpportunities: "High competition from Australian universities. Need more scholarship information.",
      nextMonthPlan: "Follow up with 5 pending applications. Attend INTI school visit on Feb 12.",
      submittedAt: new Date("2025-02-03"),
      finalApprovedAt: new Date("2025-02-08"),
    },
  });

  await db.monthlyReport.upsert({
    where: { icrId_institutionId_reportingMonth_reportingYear: { icrId: icrUser.id, institutionId: instUOM.id, reportingMonth: 2, reportingYear: 2025 } },
    update: {},
    create: {
      icrId: icrUser.id, institutionId: instUOM.id, regionId: regionSEA.id,
      reportingMonth: 2, reportingYear: 2025,
      status: ReportStatus.PENDING_REVIEW,
      leadsData: { total: 6, enrolled: 1, stages: { NEW: 2, CONTACTED: 2, OFFER_ISSUED: 1, ENROLLED: 1 } },
      submittedAt: new Date("2025-03-02"),
    },
  });

  await db.monthlyReport.upsert({
    where: { icrId_institutionId_reportingMonth_reportingYear: { icrId: icr2User.id, institutionId: instMelb.id, reportingMonth: 2, reportingYear: 2025 } },
    update: {},
    create: {
      icrId: icr2User.id, institutionId: instMelb.id, regionId: regionSA.id,
      reportingMonth: 2, reportingYear: 2025,
      status: ReportStatus.DRAFT,
      leadsData: { total: 5, enrolled: 1, stages: { NEW: 1, CONTACTED: 2, DOCUMENTS_RECEIVED: 1, ENROLLED: 1 } },
    },
  });
  console.log("✅ Monthly reports created");

  // ─── KBA ARTICLES ──────────────────────────────────────────────────────
  await db.knowledgeBase.createMany({
    data: [
      { title: "How to Process a UK Student Visa Application", content: "Step-by-step guide for processing UK Tier 4 student visas...", category: "Visa Processes", tags: ["visa", "UK", "Tier 4"], authorId: adminUser.id },
      { title: "Agent Commission Structure 2025", content: "Updated commission rates for all partner agents...", category: "Agent Management", tags: ["commission", "agents", "2025"], authorId: adminUser.id },
      { title: "IELTS Score Requirements by Institution", content: "Minimum IELTS requirements for each partner institution...", category: "Admission Requirements", tags: ["IELTS", "requirements", "English"], authorId: adminUser.id },
      { title: "Monthly Report Submission Guidelines", content: "How to prepare and submit your monthly activity report...", category: "Operations", tags: ["reports", "monthly", "guidelines"], authorId: adminUser.id },
      { title: "Onboarding Checklist for New ICRs", content: "Complete checklist for new In-Country Representatives...", category: "HR & Onboarding", tags: ["onboarding", "ICR", "checklist"], authorId: hrUser.id },
    ],
    skipDuplicates: true,
  });

  // ─── IT ASSETS ─────────────────────────────────────────────────────────
  await db.iTAsset.createMany({
    data: [
      { name: "MacBook Pro 14\"", type: "Laptop", serialNumber: "C02Z1234ABC", brand: "Apple", model: "MacBook Pro M3", purchasedAt: new Date("2024-01-15"), status: "ASSIGNED" },
      { name: "MacBook Air 13\"", type: "Laptop", serialNumber: "C02Z5678DEF", brand: "Apple", model: "MacBook Air M2", purchasedAt: new Date("2023-06-01"), status: "ASSIGNED" },
      { name: "Dell Monitor 27\"", type: "Monitor", serialNumber: "DELL-MON-001", brand: "Dell", model: "UltraSharp U2722D", status: "AVAILABLE" },
      { name: "iPhone 15 Pro", type: "Phone", serialNumber: "APL-IPH-001", brand: "Apple", model: "iPhone 15 Pro", purchasedAt: new Date("2024-01-20"), status: "ASSIGNED" },
      { name: "Logitech MX Keys", type: "Keyboard", serialNumber: "LOG-KEY-001", brand: "Logitech", status: "AVAILABLE" },
    ],
    skipDuplicates: true,
  });

  // ─── ANNOUNCEMENTS ─────────────────────────────────────────────────────
  await db.announcement.createMany({
    data: [
      { title: "Q1 2025 ICR Performance Review", content: "All ICRs will undergo their Q1 performance review from April 1–5. Please ensure your KPIs are updated and worklogs are submitted.", authorId: hrUser.id, isGlobal: true },
      { title: "New Partner: University of Edinburgh", content: "We are excited to announce a new partnership with the University of Edinburgh starting September 2025 intake.", authorId: hqUser.id, isGlobal: true },
      { title: "System Maintenance Notice", content: "The Illume CRM will undergo scheduled maintenance on March 30 from 2:00 AM – 4:00 AM UTC. Please save your work beforehand.", authorId: adminUser.id, isGlobal: true },
      { title: "Updated Agent Commission Rates 2025", content: "Please review the updated commission structure for partner agents effective April 1, 2025. Details in the Knowledge Base.", authorId: hrUser.id, isGlobal: true },
      { title: "Ramadan Working Hours 2025", content: "During Ramadan (March 1 – March 30), office hours for Middle East staff will be 9 AM – 3 PM local time.", authorId: hrUser.id, regionId: regionME.id, isGlobal: false },
    ],
    skipDuplicates: true,
  });

  // ─── FORECAST ENTRIES ──────────────────────────────────────────────────
  const report = await db.monthlyReport.findFirst({ where: { status: ReportStatus.FINAL_APPROVED } });
  if (report) {
    await db.forecastEntry.createMany({
      data: [
        { reportId: report.id, studentName: "Muhammad Arif Hassan", institutionId: instUCL.id, program: "MSc Computer Science", stage: LeadStage.ENROLLED, expectedMonth: 9, expectedYear: 2025, confidence: ConfidenceLevel.HIGH, weightedProb: 0.8, actualEnrolled: true },
        { reportId: report.id, studentName: "Priya Krishnaswamy", institutionId: instUOM.id, program: "MBA", stage: LeadStage.OFFER_ISSUED, expectedMonth: 9, expectedYear: 2025, confidence: ConfidenceLevel.HIGH, weightedProb: 0.8 },
        { reportId: report.id, studentName: "Nur Aisyah Binti Zulkifli", institutionId: instUCL.id, program: "BEng Civil Engineering", stage: LeadStage.DOCUMENTS_RECEIVED, expectedMonth: 9, expectedYear: 2025, confidence: ConfidenceLevel.MEDIUM, weightedProb: 0.5 },
        { reportId: report.id, studentName: "Li Wei Zhang", institutionId: instUOM.id, program: "BSc Data Science", stage: LeadStage.CONTACTED, expectedMonth: 1, expectedYear: 2026, confidence: ConfidenceLevel.LOW, weightedProb: 0.25 },
      ],
      skipDuplicates: true,
    });
  }
  console.log("✅ Knowledge base, assets, announcements, forecast entries created");

  // ─── NOTIFICATIONS ─────────────────────────────────────────────────────
  await db.notification.createMany({
    data: [
      { userId: icrUser.id, title: "Lead needs attention", message: "Tanvir Ahmed has been in APPLICATION_SENT for 7 days with no progress.", type: "REMINDER", link: "/students" },
      { userId: icrUser.id, title: "Report submitted", message: "Your February 2025 report for University of Manchester has been submitted for review.", type: "INFO", link: "/reports", isRead: true },
      { userId: managerUser.id, title: "Report pending review", message: "Aisha Rahman's February 2025 report for UOM is waiting for your approval.", type: "APPROVAL", link: "/reports" },
      { userId: icrUser.id, title: "Contract renewal alert", message: "University of Manchester contract expires in 45 days. Review and renew soon.", type: "ALERT", link: "/institutions/inst-uom" },
    ],
    skipDuplicates: true,
  });

  console.log("\n🎉 Seed complete!\n");
  console.log("Login credentials:");
  console.log("  admin@illume.edu    / password123  (SUPER_ADMIN)");
  console.log("  hq@illume.edu       / password123  (HQ_EXECUTIVE)");
  console.log("  analytics@illume.edu/ password123  (HQ_ANALYTICS)");
  console.log("  manager@illume.edu  / password123  (REGIONAL_MANAGER – SEA)");
  console.log("  icr@illume.edu      / password123  (ICR – SEA)");
  console.log("  hr@illume.edu       / password123  (HR_MANAGER)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
