import { PrismaClient, Role, LeadStage, StudyLevel, SourceType, AccountStatus, EventType, EventStatus, ReportStatus, ConfidenceLevel, EmploymentType, LeaveType, InteractionType, ActivityType, SchoolType, AgentTier, RelationshipStatus, MarketRiskLevel, KPICategory, KPIPeriod, RiskType, RiskStatus, ComplianceType, TaskPriority, TaskStatus, TravelStatus, KnowledgeType, QBRStatus } from "@prisma/client";
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

  // ─── PHASE 1: MARKETS ─────────────────────────────────────────────────
  const markets = await Promise.all([
    db.market.upsert({ where: { code: "MY" }, update: {}, create: { name: "Malaysia", code: "MY", countryCode: "MY", studentMobilityNotes: "Malaysia is a key feeder market with strong demand for UK and Australian universities. English-medium instruction common in private schools.", competitorInstitutions: "Monash Malaysia, Nottingham Malaysia, Sunway, Taylor's University", visaTrends: "UK visa approval rate ~90% for Malaysian students. Australia slightly lower at 85%.", currencyTrends: "MYR stable against GBP. Favorable exchange for AUD programs.", politicalRiskLevel: MarketRiskLevel.LOW, recruitmentOpportunities: "Growing middle class. Government scholarship programs (MARA, JPA) still active.", healthScore: 85, isActive: true, createdById: adminUser.id, govtStakeholders: "Ministry of Education Malaysia, MARA, JPA", industryAssociations: "NAPEI (National Association of Private Educational Institutions)" } }),
    db.market.upsert({ where: { code: "IN" }, update: {}, create: { name: "India", code: "IN", countryCode: "IN", studentMobilityNotes: "Largest outbound student market globally. Strong demand for STEM and business programs. Price-sensitive market.", competitorInstitutions: "Manipal UK, BITS Pilani Dubai, Amity London", visaTrends: "UK visa refusal rate increased to 15% in 2024. Canada tightening post-study work.", currencyTrends: "INR weakening against GBP. Students increasingly looking at value propositions.", politicalRiskLevel: MarketRiskLevel.LOW, recruitmentOpportunities: "Tier 2 and Tier 3 cities underserved. Online pre-arrival programs attractive.", healthScore: 78, isActive: true, createdById: adminUser.id, govtStakeholders: "UGC, AICTE, Ministry of Education India", industryAssociations: "FICCI Higher Education Committee" } }),
    db.market.upsert({ where: { code: "AE" }, update: {}, create: { name: "UAE & Gulf", code: "AE", countryCode: "AE", studentMobilityNotes: "Wealthy market with high willingness to pay. Strong preference for ranked universities. Parents heavily involved in decision-making.", competitorInstitutions: "NYU Abu Dhabi, Heriot-Watt Dubai, Birmingham Dubai", visaTrends: "UAE students have high UK visa success rate (~95%). Minimal issues.", currencyTrends: "AED pegged to USD. Stable purchasing power.", politicalRiskLevel: MarketRiskLevel.LOW, recruitmentOpportunities: "School counsellor channel very effective. Agent relationships critical.", healthScore: 82, isActive: true, createdById: adminUser.id, govtStakeholders: "KHDA, ADEK, Ministry of Education UAE", industryAssociations: "ICEF Middle East" } }),
    db.market.upsert({ where: { code: "NG" }, update: {}, create: { name: "Nigeria", code: "NG", countryCode: "NG", studentMobilityNotes: "Growing outbound market, primarily for UK and Canada. Currency volatility is a major concern. Strong demand for scholarships.", competitorInstitutions: "Coventry, Hertfordshire, De Montfort, Sheffield Hallam", visaTrends: "UK visa refusal rate for Nigeria at 25-30%. Documentation quality key.", currencyTrends: "NGN extremely volatile. Significant devaluation in 2024. Affordability concerns.", politicalRiskLevel: MarketRiskLevel.HIGH_RISK, recruitmentOpportunities: "Lagos and Abuja are primary markets. Growing demand from Port Harcourt.", healthScore: 55, isActive: true, createdById: adminUser.id, govtStakeholders: "NUC (National Universities Commission)", industryAssociations: "NECA, ANIE" } }),
    db.market.upsert({ where: { code: "VN" }, update: {}, create: { name: "Vietnam", code: "VN", countryCode: "VN", studentMobilityNotes: "Fast-growing market. Strong interest in Australia and Canada. English proficiency improving.", competitorInstitutions: "RMIT Vietnam, Swinburne Vietnam, BUV (British University Vietnam)", visaTrends: "Australian visa success rate improving. UK still relatively new market.", currencyTrends: "VND stable. Government subsidies available for overseas study.", politicalRiskLevel: MarketRiskLevel.LOW, recruitmentOpportunities: "Ho Chi Minh City and Hanoi primary markets. Agent network well established.", healthScore: 72, isActive: true, createdById: adminUser.id, govtStakeholders: "MOET (Ministry of Education and Training)", industryAssociations: "VCCI Education Committee" } }),
  ]);
  const [mktMalaysia, mktIndia, mktUAE, mktNigeria, mktVietnam] = markets;
  console.log("✅ Markets created");

  // ─── PHASE 1: SCHOOLS ─────────────────────────────────────────────────
  const schools = await Promise.all([
    db.school.upsert({ where: { id: "sch-001" }, update: {}, create: { id: "sch-001", name: "INTI International School", country: "Malaysia", city: "Kuala Lumpur", type: SchoolType.PRIVATE, principalName: "Dr. Mei Ling Tan", principalEmail: "meiling@inti.edu.my", phone: "+60-3-78062000", relationshipStatus: RelationshipStatus.STRATEGIC, studentVolume: 1200, relationshipScore: 92, marketId: mktMalaysia.id, createdById: adminUser.id, lastVisitDate: new Date("2025-06-15") } }),
    db.school.upsert({ where: { id: "sch-002" }, update: {}, create: { id: "sch-002", name: "Taylor's International School", country: "Malaysia", city: "Kuala Lumpur", type: SchoolType.INTERNATIONAL, principalName: "Mr. James Wong", principalEmail: "jwong@taylors.edu.my", phone: "+60-3-56290000", relationshipStatus: RelationshipStatus.ESTABLISHED, studentVolume: 800, relationshipScore: 78, marketId: mktMalaysia.id, createdById: adminUser.id, lastVisitDate: new Date("2025-05-20") } }),
    db.school.upsert({ where: { id: "sch-003" }, update: {}, create: { id: "sch-003", name: "Delhi Public School R.K. Puram", country: "India", city: "New Delhi", type: SchoolType.PRIVATE, principalName: "Dr. Asha Sharma", principalEmail: "principal@dpsrkp.net", phone: "+91-11-26172637", relationshipStatus: RelationshipStatus.ESTABLISHED, studentVolume: 3000, relationshipScore: 70, marketId: mktIndia.id, createdById: adminUser.id, lastVisitDate: new Date("2025-04-10") } }),
    db.school.upsert({ where: { id: "sch-004" }, update: {}, create: { id: "sch-004", name: "GEMS Wellington International", country: "UAE", city: "Dubai", type: SchoolType.INTERNATIONAL, principalName: "Mrs. Sarah Mitchell", principalEmail: "smitchell@gemswis.com", phone: "+971-4-3480111", relationshipStatus: RelationshipStatus.STRATEGIC, studentVolume: 2500, relationshipScore: 88, marketId: mktUAE.id, createdById: adminUser.id, lastVisitDate: new Date("2025-06-01") } }),
    db.school.upsert({ where: { id: "sch-005" }, update: {}, create: { id: "sch-005", name: "Greensprings School", country: "Nigeria", city: "Lagos", type: SchoolType.PRIVATE, principalName: "Mr. Chukwu Eze", principalEmail: "ceze@greensprings.ng", phone: "+234-1-4700950", relationshipStatus: RelationshipStatus.DEVELOPING, studentVolume: 600, relationshipScore: 55, marketId: mktNigeria.id, createdById: adminUser.id } }),
    db.school.upsert({ where: { id: "sch-006" }, update: {}, create: { id: "sch-006", name: "Vinschool Central Park", country: "Vietnam", city: "Ho Chi Minh City", type: SchoolType.PRIVATE, principalName: "Ms. Nguyen Thi Ha", principalEmail: "ha.nguyen@vinschool.edu.vn", phone: "+84-28-39000000", relationshipStatus: RelationshipStatus.NEW, studentVolume: 1500, relationshipScore: 40, marketId: mktVietnam.id, createdById: adminUser.id } }),
    db.school.upsert({ where: { id: "sch-007" }, update: {}, create: { id: "sch-007", name: "The Indian High School", country: "UAE", city: "Dubai", type: SchoolType.PRIVATE, principalName: "Dr. Rajesh Nair", principalEmail: "rnair@theindianhs.com", phone: "+971-4-3371112", relationshipStatus: RelationshipStatus.ESTABLISHED, studentVolume: 4000, relationshipScore: 75, marketId: mktUAE.id, createdById: adminUser.id, lastVisitDate: new Date("2025-05-15") } }),
    db.school.upsert({ where: { id: "sch-008" }, update: {}, create: { id: "sch-008", name: "Sunway International School", country: "Malaysia", city: "Petaling Jaya", type: SchoolType.INTERNATIONAL, principalName: "Ms. Anita Kumar", principalEmail: "akumar@sunway.edu.my", phone: "+60-3-56315000", relationshipStatus: RelationshipStatus.DEVELOPING, studentVolume: 950, relationshipScore: 60, marketId: mktMalaysia.id, createdById: adminUser.id } }),
  ]);
  console.log("✅ Schools created");

  // ─── PHASE 1: COUNSELLORS ─────────────────────────────────────────────
  await db.counsellor.createMany({
    data: [
      { schoolId: "sch-001", name: "Sophia Lim", email: "sophia.lim@inti.edu.my", phone: "+60-12-3456789", position: "Head of University Guidance", influenceScore: 9, notes: "Very supportive of UK universities. Has sent 15+ students to UCL in past 3 years." },
      { schoolId: "sch-001", name: "David Tan", email: "david.tan@inti.edu.my", position: "Career Counsellor", influenceScore: 7 },
      { schoolId: "sch-002", name: "Rachel Goh", email: "rachel.goh@taylors.edu.my", position: "University Placement Officer", influenceScore: 8, notes: "Focuses on Russell Group universities. Responds well to campus visit invites." },
      { schoolId: "sch-003", name: "Preethi Rao", email: "preethi.rao@dpsrkp.net", position: "International Counsellor", influenceScore: 7, notes: "Strong UK focus. Organizes annual UK university fair." },
      { schoolId: "sch-004", name: "Emma Johnson", email: "ejohnson@gemswis.com", position: "Head of Sixth Form", influenceScore: 9, notes: "Key influencer. Parents trust her recommendations. Prefers Russell Group." },
      { schoolId: "sch-004", name: "Ahmed Khalil", email: "akhalil@gemswis.com", position: "University Counsellor", influenceScore: 6 },
      { schoolId: "sch-005", name: "Blessing Okafor", email: "bokafor@greensprings.ng", position: "Careers Advisor", influenceScore: 5, notes: "New to role. Interested in UK scholarship opportunities." },
      { schoolId: "sch-007", name: "Sunita Patel", email: "spatel@theindianhs.com", position: "Career Guidance Head", influenceScore: 8, notes: "Extensive network in Dubai's Indian school community." },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Counsellors created");

  // ─── PHASE 1: AGENT PROFILES ──────────────────────────────────────────
  await db.agentProfile.createMany({
    data: [
      { sourceId: srcEduBridge.id, certificationStatus: "ICEF Certified", icefMembership: true, countryCoverage: ["Malaysia", "Singapore", "Brunei"], tier: AgentTier.PLATINUM, contractExpiryDate: new Date("2026-12-31"), offers: 45, deposits: 32, enrolments: 28, visaApprovals: 26, yieldRate: 62.2 },
      { sourceId: srcGlobalPath.id, certificationStatus: "British Council Certified", icefMembership: true, countryCoverage: ["India", "Nepal", "Bangladesh"], tier: AgentTier.GOLD, contractExpiryDate: new Date("2026-06-30"), offers: 35, deposits: 22, enrolments: 18, visaApprovals: 16, yieldRate: 51.4 },
      { sourceId: srcStudyUAE.id, certificationStatus: "ICEF Certified", icefMembership: true, countryCoverage: ["UAE", "Saudi Arabia", "Oman", "Bahrain", "Kuwait"], tier: AgentTier.GOLD, contractExpiryDate: new Date("2026-03-31"), offers: 28, deposits: 20, enrolments: 17, visaApprovals: 17, yieldRate: 60.7 },
      { sourceId: srcNigeria.id, certificationStatus: "Pending", icefMembership: false, countryCoverage: ["Nigeria", "Ghana"], tier: AgentTier.SILVER, contractExpiryDate: new Date("2025-12-31"), offers: 12, deposits: 6, enrolments: 4, visaApprovals: 3, yieldRate: 33.3 },
      { sourceId: srcVietnam.id, certificationStatus: "ICEF Certified", icefMembership: true, countryCoverage: ["Vietnam", "Cambodia", "Laos"], tier: AgentTier.SILVER, contractExpiryDate: new Date("2026-09-30"), offers: 18, deposits: 12, enrolments: 10, visaApprovals: 9, yieldRate: 55.6 },
      { sourceId: srcIndonesia.id, certificationStatus: "British Council Certified", icefMembership: false, countryCoverage: ["Indonesia"], tier: AgentTier.EMERGING, contractExpiryDate: new Date("2026-01-31"), offers: 8, deposits: 4, enrolments: 3, visaApprovals: 2, yieldRate: 37.5 },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Agent profiles created");

  // ─── PHASE 1: ACTIVITIES ──────────────────────────────────────────────
  const activities = await Promise.all([
    db.activity.upsert({ where: { id: "act-001" }, update: {}, create: { id: "act-001", type: ActivityType.SCHOOL_VISIT, title: "INTI School Presentation – UCL Programs", description: "Presented UCL undergraduate programs to Year 12 and Year 13 students at INTI International School. Covered entry requirements, scholarship opportunities, and campus life.", date: new Date("2025-06-15"), location: "INTI International School KL", city: "Kuala Lumpur", country: "Malaysia", studentsEngaged: 45, counsellorsEngaged: 3, leadsGenerated: 8, applicationsGenerated: 3, cost: 150, outcomes: "Strong interest in Engineering and Computer Science programs. 3 students started applications on the spot.", followUp: "Send program brochures to counsellor Sophia Lim. Follow up with 8 leads within 48 hours.", actionItems: [{ task: "Send brochures", due: "2025-06-17" }, { task: "Follow up leads", due: "2025-06-17" }], topics: "UCL undergraduate programs, scholarships, student visa", userId: icrUser.id, institutionId: instUCL.id, marketId: mktMalaysia.id, schoolId: "sch-001" } }),
    db.activity.upsert({ where: { id: "act-002" }, update: {}, create: { id: "act-002", type: ActivityType.AGENT_MEETING, title: "EduBridge Quarterly Review", description: "Quarterly performance review with EduBridge Malaysia. Reviewed conversion rates, discussed 2025 targets, and addressed pending applications.", date: new Date("2025-06-10"), location: "EduBridge Office, Bangsar South", city: "Kuala Lumpur", country: "Malaysia", studentsEngaged: 0, counsellorsEngaged: 0, leadsGenerated: 0, cost: 50, roi: 320, outcomes: "EduBridge committed to 15 more referrals by Q3. Agreed on enhanced commission for STEM programs.", followUp: "Send updated commission structure. Share new program catalog.", topics: "Agent performance, commission structure, STEM programs", userId: icrUser.id, sourceId: srcEduBridge.id, marketId: mktMalaysia.id } }),
    db.activity.upsert({ where: { id: "act-003" }, update: {}, create: { id: "act-003", type: ActivityType.STUDENT_EVENT, title: "UCL Virtual Open Day – SEA Students", description: "Online open day for Southeast Asian prospective students. Featured live campus tour, Q&A with current students, and application workshop.", date: new Date("2025-05-20"), location: "Online (Zoom)", studentsEngaged: 120, counsellorsEngaged: 8, leadsGenerated: 25, applicationsGenerated: 10, cost: 200, roi: 1250, outcomes: "120 attendees from 5 countries. 25 new leads generated. Highest engagement from Malaysian and Vietnamese students.", followUp: "Send recording to registered attendees. Follow up with 25 new leads.", topics: "UCL open day, campus tour, application process", userId: icrUser.id, institutionId: instUCL.id, marketId: mktMalaysia.id } }),
    db.activity.upsert({ where: { id: "act-004" }, update: {}, create: { id: "act-004", type: ActivityType.FAIR, title: "India Higher Education Forum – Mumbai", description: "Major education fair in Mumbai. Represented UCL, UOM, and Melbourne. Spoke with 200+ students and parents.", date: new Date("2025-05-22"), location: "Jio Convention Centre, BKC", city: "Mumbai", country: "India", studentsEngaged: 220, counsellorsEngaged: 12, leadsGenerated: 45, applicationsGenerated: 15, cost: 6000, roi: 750, outcomes: "Strong interest in postgraduate STEM programs. 45 qualified leads collected. 15 applications started.", followUp: "Distribute leads to ICRs. Schedule follow-up calls within 1 week.", topics: "UK and Australian universities, STEM, business programs", userId: icr2User.id, institutionId: instUCL.id, marketId: mktIndia.id } }),
    db.activity.upsert({ where: { id: "act-005" }, update: {}, create: { id: "act-005", type: ActivityType.SCHOOL_VISIT, title: "GEMS Wellington School Visit", description: "Presented to IB Year 2 students at GEMS Wellington. Focused on UK university pathways and scholarship opportunities.", date: new Date("2025-06-01"), location: "GEMS Wellington International School", city: "Dubai", country: "UAE", studentsEngaged: 60, counsellorsEngaged: 4, leadsGenerated: 12, applicationsGenerated: 5, cost: 100, outcomes: "12 high-quality leads from affluent families. 5 students interested in Russell Group universities.", followUp: "Send detailed program information. Schedule parent information evening.", actionItems: [{ task: "Send info packs to parents", due: "2025-06-03" }, { task: "Organize parent evening", due: "2025-06-15" }], topics: "UK pathways, IB recognition, scholarships", userId: icr3User.id, institutionId: instUCL.id, marketId: mktUAE.id, schoolId: "sch-004" } }),
    db.activity.upsert({ where: { id: "act-006" }, update: {}, create: { id: "act-006", type: ActivityType.PARTNER_MEETING, title: "UOM Strategic Partnership Review", description: "Annual strategic review with University of Manchester partnership team. Discussed enrollment targets, new program launches, and marketing budget.", date: new Date("2025-04-15"), location: "UOM International Office (Virtual)", studentsEngaged: 0, counsellorsEngaged: 0, leadsGenerated: 0, cost: 0, outcomes: "UOM increasing scholarship budget by 20% for SEA students. New MSc AI program launching Sep 2026.", followUp: "Update marketing materials with new scholarship info. Brief all ICRs on new AI program.", topics: "Partnership review, scholarships, new programs, targets", userId: managerUser.id, institutionId: instUOM.id } }),
  ]);
  console.log("✅ Activities created");

  // ─── PHASE 1: TRAVEL REQUESTS ─────────────────────────────────────────
  const travelReqs = await Promise.all([
    db.travelRequest.upsert({ where: { id: "trv-001" }, update: {}, create: { id: "trv-001", employeeId: empICR.id, destination: "Kuala Lumpur → Mumbai → New Delhi", purpose: "India Higher Education Forum in Mumbai + school visits in Delhi. Meeting 3 agents and 4 schools over 5 days.", departDate: new Date("2025-05-20"), returnDate: new Date("2025-05-25"), estimatedCost: 3500, actualCost: 3200, status: TravelStatus.COMPLETED, approvedById: managerUser.id, approvedAt: new Date("2025-05-10"), notes: "Combined fair attendance with agent visits for efficiency." } }),
    db.travelRequest.upsert({ where: { id: "trv-002" }, update: {}, create: { id: "trv-002", employeeId: empICR3.id, destination: "Dubai → Abu Dhabi", purpose: "Middle East Education Summit in Abu Dhabi + agent training in Dubai. 3-day trip.", departDate: new Date("2025-03-06"), returnDate: new Date("2025-03-09"), estimatedCost: 2000, actualCost: 1850, status: TravelStatus.COMPLETED, approvedById: manager2User.id, approvedAt: new Date("2025-02-25") } }),
    db.travelRequest.upsert({ where: { id: "trv-003" }, update: {}, create: { id: "trv-003", employeeId: empICR.id, destination: "Kuala Lumpur → Melbourne", purpose: "University of Melbourne campus visit + agent meetings. Annual institutional review.", departDate: new Date("2025-06-15"), returnDate: new Date("2025-06-19"), estimatedCost: 4500, status: TravelStatus.APPROVED, approvedById: managerUser.id, approvedAt: new Date("2025-06-01") } }),
    db.travelRequest.upsert({ where: { id: "trv-004" }, update: {}, create: { id: "trv-004", employeeId: empICR2.id, destination: "New Delhi → London", purpose: "UCL partnership annual meeting + training at UCL campus. 4-day trip.", departDate: new Date("2025-07-10"), returnDate: new Date("2025-07-14"), estimatedCost: 5000, status: TravelStatus.PENDING } }),
  ]);
  console.log("✅ Travel requests created");

  // Travel itineraries
  await db.travelItinerary.createMany({
    data: [
      { travelRequestId: "trv-001", type: "FLIGHT", description: "KL → Mumbai", departureLocation: "Kuala Lumpur (KUL)", arrivalLocation: "Mumbai (BOM)", date: new Date("2025-05-20"), cost: 450, confirmationRef: "MH2045" },
      { travelRequestId: "trv-001", type: "HOTEL", description: "The Oberoi Mumbai (3 nights)", departureLocation: "Mumbai", date: new Date("2025-05-20"), cost: 600, confirmationRef: "OBR-78234" },
      { travelRequestId: "trv-001", type: "FLIGHT", description: "Mumbai → Delhi", departureLocation: "Mumbai (BOM)", arrivalLocation: "New Delhi (DEL)", date: new Date("2025-05-23"), cost: 120, confirmationRef: "AI506" },
      { travelRequestId: "trv-001", type: "HOTEL", description: "ITC Maurya Delhi (2 nights)", departureLocation: "New Delhi", date: new Date("2025-05-23"), cost: 400, confirmationRef: "ITC-44521" },
      { travelRequestId: "trv-001", type: "FLIGHT", description: "Delhi → KL", departureLocation: "New Delhi (DEL)", arrivalLocation: "Kuala Lumpur (KUL)", date: new Date("2025-05-25"), cost: 380, confirmationRef: "MH181" },
    ],
    skipDuplicates: true,
  });

  // Travel meetings
  await db.travelMeeting.createMany({
    data: [
      { travelRequestId: "trv-001", title: "India Higher Education Forum", location: "Jio Convention Centre, BKC, Mumbai", date: new Date("2025-05-22"), notes: "Main education fair. Booth #42." },
      { travelRequestId: "trv-001", title: "Global Path India – Agent Review", location: "Global Path Office, Andheri East", date: new Date("2025-05-21"), notes: "Q2 performance review with agent Ravi Patel." },
      { travelRequestId: "trv-001", title: "DPS R.K. Puram School Visit", location: "DPS R.K. Puram, New Delhi", date: new Date("2025-05-24"), notes: "School presentation to Year 12 students. Meeting with counsellor Preethi Rao." },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Travel itineraries and meetings created");

  // ─── PHASE 1: CLIENT KPIs ────────────────────────────────────────────
  await db.clientKPI.createMany({
    data: [
      { institutionId: instUCL.id, category: KPICategory.RECRUITMENT, name: "Total Applications", targetValue: 100, currentValue: 68, unit: "students", period: KPIPeriod.ANNUAL, year: 2025, description: "Total applications submitted for Sep 2025 intake" },
      { institutionId: instUCL.id, category: KPICategory.RECRUITMENT, name: "Enrollment Conversions", targetValue: 50, currentValue: 28, unit: "students", period: KPIPeriod.ANNUAL, year: 2025, description: "Students who accepted offers and enrolled" },
      { institutionId: instUCL.id, category: KPICategory.RECRUITMENT, name: "Conversion Rate", targetValue: 50, currentValue: 41.2, unit: "%", period: KPIPeriod.QUARTERLY, year: 2025, quarter: 2, description: "Application to enrollment conversion rate" },
      { institutionId: instUCL.id, category: KPICategory.ENGAGEMENT, name: "Counsellor Meetings", targetValue: 20, currentValue: 14, unit: "meetings", period: KPIPeriod.QUARTERLY, year: 2025, quarter: 2, description: "Meetings with school counsellors" },
      { institutionId: instUCL.id, category: KPICategory.MARKET_DEVELOPMENT, name: "New Agent Partners", targetValue: 5, currentValue: 3, unit: "agents", period: KPIPeriod.ANNUAL, year: 2025, description: "New agent partnerships established" },
      { institutionId: instUCL.id, category: KPICategory.RELATIONSHIP, name: "Client Satisfaction Score", targetValue: 90, currentValue: 87, unit: "%", period: KPIPeriod.QUARTERLY, year: 2025, quarter: 2, description: "Based on quarterly client feedback survey" },
      { institutionId: instUOM.id, category: KPICategory.RECRUITMENT, name: "Total Applications", targetValue: 80, currentValue: 52, unit: "students", period: KPIPeriod.ANNUAL, year: 2025 },
      { institutionId: instUOM.id, category: KPICategory.RECRUITMENT, name: "Enrollment Conversions", targetValue: 40, currentValue: 22, unit: "students", period: KPIPeriod.ANNUAL, year: 2025 },
      { institutionId: instUOM.id, category: KPICategory.ENGAGEMENT, name: "Events Attended", targetValue: 12, currentValue: 8, unit: "events", period: KPIPeriod.ANNUAL, year: 2025 },
      { institutionId: instMelb.id, category: KPICategory.RECRUITMENT, name: "Total Applications", targetValue: 60, currentValue: 35, unit: "students", period: KPIPeriod.ANNUAL, year: 2025 },
      { institutionId: instMelb.id, category: KPICategory.RECRUITMENT, name: "Enrollment Conversions", targetValue: 30, currentValue: 15, unit: "students", period: KPIPeriod.ANNUAL, year: 2025 },
      { institutionId: instMelb.id, category: KPICategory.MARKET_DEVELOPMENT, name: "Market Expansion Score", targetValue: 80, currentValue: 65, unit: "%", period: KPIPeriod.QUARTERLY, year: 2025, quarter: 2 },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Client KPIs created");

  // ─── PHASE 1: RISKS ──────────────────────────────────────────────────
  await db.riskRegister.createMany({
    data: [
      { type: RiskType.MARKET, title: "Nigeria Currency Volatility", description: "Naira devaluation making UK study unaffordable for many Nigerian families. Could reduce applications by 30-40% in 2025.", likelihood: 4, impact: 5, riskScore: 20, mitigationPlan: "1. Promote scholarship opportunities\n2. Offer payment plans\n3. Focus on families with USD/GBP income\n4. Partner with education loan providers", status: RiskStatus.OPEN, ownerId: icrUser.id, marketId: mktNigeria.id },
      { type: RiskType.CLIENT, title: "UOM Contract Renewal Risk", description: "University of Manchester contract expires in 45 days. Competitor agencies (IDP, SI-UK) actively courting UOM.", likelihood: 3, impact: 4, riskScore: 12, mitigationPlan: "1. Schedule urgent meeting with UOM partnership team\n2. Present 2024 performance data\n3. Propose enhanced service package\n4. Offer multi-year contract discount", status: RiskStatus.ESCALATED, ownerId: managerUser.id, institutionId: instUOM.id },
      { type: RiskType.STAFF, title: "ICR Capacity in Middle East", description: "Only 1 ICR (Fatima) covering entire Middle East region. Risk of burnout and underservicing key markets.", likelihood: 4, impact: 3, riskScore: 12, mitigationPlan: "1. Approve hiring for second ME ICR\n2. Interim support from SEA ICR for virtual events\n3. Increase agent self-service capabilities", status: RiskStatus.OPEN, ownerId: manager2User.id },
      { type: RiskType.OPERATIONAL, title: "UK Visa Policy Changes", description: "UK government signaling tighter student visa policies for 2026. Could impact recruitment from India and Nigeria.", likelihood: 3, impact: 4, riskScore: 12, mitigationPlan: "1. Monitor policy announcements closely\n2. Diversify to include more Canada/Australia programs\n3. Brief agents on documentation best practices\n4. Build stronger pre-departure support", status: RiskStatus.OPEN, ownerId: hqUser.id },
      { type: RiskType.MARKET, title: "Vietnam Agent Dispute", description: "Vietnam Study Abroad agent contract dispute over commission rates. Risk of losing key pipeline in HCMC market.", likelihood: 2, impact: 3, riskScore: 6, mitigationPlan: "Negotiate revised commission structure. Offer volume bonuses. Explore alternative agents as backup.", status: RiskStatus.MITIGATED, ownerId: icrUser.id, marketId: mktVietnam.id },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Risk register created");

  // ─── PHASE 1: COMPLIANCE ──────────────────────────────────────────────
  await db.complianceItem.createMany({
    data: [
      { complianceType: ComplianceType.GDPR, title: "Annual GDPR Data Audit", description: "Conduct annual audit of all student personal data storage and processing. Ensure consent forms are up to date.", status: "PENDING", dueDate: new Date("2025-09-30"), assignedToId: adminUser.id, institutionId: instUCL.id },
      { complianceType: ComplianceType.AGENT_COMPLIANCE, title: "Agent Agreement Renewal – EduBridge", description: "EduBridge Malaysia agent agreement expires Dec 2026. Start renewal process by Q3 2026.", status: "COMPLETED", dueDate: new Date("2025-06-30"), completedAt: new Date("2025-06-15"), assignedToId: managerUser.id },
      { complianceType: ComplianceType.CASL, title: "Canada Anti-Spam Compliance", description: "Review all email marketing campaigns targeting Canadian students for CASL compliance.", status: "PENDING", dueDate: new Date("2025-08-15"), assignedToId: emp1User.id },
      { complianceType: ComplianceType.TRAINING, title: "ICR Annual Compliance Training", description: "All ICRs must complete annual compliance training covering GDPR, FOIPOP, and agent management best practices.", status: "IN_PROGRESS", dueDate: new Date("2025-07-31"), assignedToId: hrUser.id },
      { complianceType: ComplianceType.FOIPOP, title: "Nova Scotia FOIPOP Compliance Review", description: "Review data handling practices for Nova Scotia institution partners under FOIPOP regulations.", status: "PENDING", dueDate: new Date("2025-10-31"), assignedToId: adminUser.id },
      { complianceType: ComplianceType.GDPR, title: "Student Data Retention Policy Update", description: "Update data retention policy to align with new GDPR guidance on educational data. Maximum 3-year retention for inactive leads.", status: "PENDING", dueDate: new Date("2025-08-31"), assignedToId: adminUser.id },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Compliance items created");

  // ─── PHASE 1: TASKS ───────────────────────────────────────────────────
  await db.task.createMany({
    data: [
      { title: "Send UCL brochures to INTI counsellor", description: "Email updated UCL undergraduate program brochures to Sophia Lim at INTI International School.", assigneeId: empICR.id, createdById: empICR.id, sourceActivityId: "act-001", priority: TaskPriority.HIGH, status: TaskStatus.DONE, dueDate: new Date("2025-06-17"), completedAt: new Date("2025-06-16") },
      { title: "Follow up 8 leads from INTI visit", description: "Call/email 8 new leads from the INTI school visit. Send application links and scholarship info.", assigneeId: empICR.id, createdById: empICR.id, sourceActivityId: "act-001", priority: TaskPriority.HIGH, status: TaskStatus.IN_PROGRESS, dueDate: new Date("2025-06-17") },
      { title: "Update EduBridge commission structure", description: "Send updated commission structure document to EduBridge following quarterly review.", assigneeId: empICR.id, createdById: empICR.id, sourceActivityId: "act-002", priority: TaskPriority.MEDIUM, status: TaskStatus.TODO, dueDate: new Date("2025-06-15") },
      { title: "Send virtual open day recording", description: "Distribute recorded UCL virtual open day video to all 120 registered attendees.", assigneeId: empICR.id, createdById: empICR.id, sourceActivityId: "act-003", priority: TaskPriority.MEDIUM, status: TaskStatus.DONE, dueDate: new Date("2025-05-22"), completedAt: new Date("2025-05-21") },
      { title: "Distribute India fair leads to ICRs", description: "Sort and distribute 45 leads from India Higher Education Forum to appropriate ICRs by region.", assigneeId: empICR2.id, createdById: empICR2.id, sourceActivityId: "act-004", priority: TaskPriority.URGENT, status: TaskStatus.DONE, dueDate: new Date("2025-05-23"), completedAt: new Date("2025-05-23") },
      { title: "Organize parent info evening at GEMS", description: "Coordinate with GEMS Wellington to schedule a parent information evening about UK university pathways.", assigneeId: empICR3.id, createdById: empICR3.id, sourceActivityId: "act-005", priority: TaskPriority.HIGH, status: TaskStatus.TODO, dueDate: new Date("2025-06-15") },
      { title: "Prepare UOM contract renewal proposal", description: "Draft contract renewal proposal for University of Manchester. Include 2024 performance data and 2026 projections.", assigneeId: empManager.id, createdById: empManager.id, priority: TaskPriority.URGENT, status: TaskStatus.IN_PROGRESS, dueDate: new Date("2025-07-01") },
      { title: "Complete compliance training module", description: "All ICRs to complete the online compliance training module covering GDPR, FOIPOP, and agent management.", assigneeId: empICR.id, createdById: empHR.id, priority: TaskPriority.MEDIUM, status: TaskStatus.TODO, dueDate: new Date("2025-07-31") },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Tasks created");

  // ─── PHASE 1: PERFORMANCE REVIEWS ─────────────────────────────────────
  await db.performanceReview.createMany({
    data: [
      { employeeId: empICR.id, reviewerId: managerUser.id, period: "Q1 2025", score: 4.2, strengths: "Excellent stakeholder relationships in Malaysia. Consistently exceeds lead generation targets. Strong event management skills.", improvements: "Needs to improve report submission timeliness. Should delegate more admin tasks to focus on high-value activities.", goals: "1. Achieve 50 enrollments for UCL by Dec 2025\n2. Develop 3 new agent partnerships\n3. Complete advanced CRM training", status: "COMPLETED", completedAt: new Date("2025-04-10") },
      { employeeId: empICR2.id, reviewerId: managerUser.id, period: "Q1 2025", score: 3.8, strengths: "Strong knowledge of Indian education market. Good relationship with DPS school network. Reliable and consistent.", improvements: "Needs to increase conversion rates from application to enrollment. Should attend more school visits in Tier 2 cities.", goals: "1. Increase conversion rate to 45%\n2. Expand to Pune and Bangalore markets\n3. Develop scholarship awareness campaigns", status: "COMPLETED", completedAt: new Date("2025-04-12") },
      { employeeId: empICR3.id, reviewerId: manager2User.id, period: "Q1 2025", score: 4.0, strengths: "Excellent Arabic and English communication. Strong relationships with GEMS school network. Good understanding of Gulf family dynamics.", improvements: "Coverage of Saudi market needs expansion. Should develop more agent partnerships in Oman and Bahrain.", goals: "1. Open 2 new school relationships in Saudi Arabia\n2. Increase agent referrals by 25%\n3. Organize 2 parent information evenings per quarter", status: "COMPLETED", completedAt: new Date("2025-04-15") },
      { employeeId: empEmp1.id, reviewerId: empHR.id, period: "Q1 2025", score: 3.5, strengths: "Creative campaign designs. Good social media engagement metrics. Team player.", improvements: "Content planning could be more strategic. Needs to align campaigns more closely with ICR field activities.", goals: "1. Launch 5 targeted campaigns per quarter\n2. Increase social media follower growth by 30%\n3. Develop video content series", status: "COMPLETED", completedAt: new Date("2025-04-08") },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Performance reviews created");

  // ─── PHASE 1: SUCCESSION PLANS ────────────────────────────────────────
  await db.successionPlan.createMany({
    data: [
      { employeeId: empICR.id, backupPersonnel: "Deepak Sharma (ICR – South Asia)", crossTraining: "Deepak has been cross-trained on Malaysia market dynamics, key agent relationships, and INTI school network.", emergencyCoverage: "Regional Manager Sarah Chen can cover urgent matters. EduBridge agent has self-service capability for basic queries.", readinessLevel: "READY", notes: "Aisha has built strong personal relationships with counsellors. Need to ensure Deepak meets key contacts before any transition." },
      { employeeId: empManager.id, backupPersonnel: "Omar Al-Rashidi (Regional Manager – ME)", crossTraining: "Omar familiar with SEA market from cross-regional projects. Needs deep-dive on Malaysia agent ecosystem.", emergencyCoverage: "James Whitfield (CEO) can provide strategic cover. Aisha Rahman can handle operational queries.", readinessLevel: "DEVELOPING", notes: "Sarah holds institutional knowledge about SEA market. Succession plan should include 3-month knowledge transfer period." },
      { employeeId: empHR.id, backupPersonnel: "James Whitfield (CEO) – interim only", crossTraining: "No dedicated backup. Marcus Thompson has basic HR operations training.", emergencyCoverage: "Outsource payroll to external provider. Employee queries routed to CEO.", readinessLevel: "DEVELOPING", notes: "High risk position. Should hire HR assistant in 2025 to build redundancy." },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Succession plans created");

  // ─── PHASE 1: KNOWLEDGE BASE (typed) ──────────────────────────────────
  await db.knowledgeBase.createMany({
    data: [
      { title: "UCL Application Process & Requirements", content: "Comprehensive guide to UCL's application process for international students. Covers UCAS deadlines, required documents (transcripts, IELTS scores, personal statement), and faculty-specific requirements.\n\nKey deadlines:\n- UCAS deadline: January 31\n- International deadline: June 30\n- IELTS minimum: 6.5 overall (6.0 in each component)\n\nRequired documents:\n1. Academic transcripts\n2. IELTS/TOEFL certificate\n3. Personal statement\n4. Two academic references\n5. Portfolio (for Architecture and Art programs)", category: "Application Guide", knowledgeType: KnowledgeType.INSTITUTION, tags: ["UCL", "applications", "requirements"], authorId: icrUser.id, institutionId: instUCL.id },
      { title: "University of Manchester Scholarship Guide 2025", content: "Complete list of scholarships available for international students at UOM for 2025-26 intake.\n\n1. President's Doctoral Scholar Award: Full fees + stipend\n2. Global Futures Scholarship: 25% tuition discount\n3. Faculty of Engineering Excellence Award: £5,000\n4. Developing Solutions Scholarship: 50-100% tuition\n5. SEA Excellence Award: £3,000 (new for 2025)", category: "Scholarships", knowledgeType: KnowledgeType.INSTITUTION, tags: ["UOM", "scholarships", "2025"], authorId: icrUser.id, institutionId: instUOM.id },
      { title: "Malaysia Market Intelligence Report Q2 2025", content: "Quarterly market intelligence update for Malaysia.\n\nStudent mobility trends:\n- 15% increase in UK-bound students vs Q2 2024\n- Australian programs seeing 8% decline due to visa changes\n- Canada gaining popularity (+22%)\n\nCompetitor activity:\n- IDP opened new office in Johor Bahru\n- SI-UK launched online application platform\n- Kaplan increasing agent commission by 2%\n\nRegulatory updates:\n- MARA scholarship applications now open\n- JPA focusing on STEM scholarships for 2026", category: "Market Intelligence", knowledgeType: KnowledgeType.MARKET, tags: ["Malaysia", "market", "Q2 2025"], authorId: icrUser.id, marketId: mktMalaysia.id },
      { title: "Standard RFP Response Template", content: "Template for responding to institutional RFPs (Requests for Proposal) for recruitment partnerships.\n\nSections:\n1. Executive Summary\n2. Company Profile & Track Record\n3. Market Coverage & Strategy\n4. Service Delivery Model\n5. Technology & Reporting Capabilities\n6. Compliance & Quality Assurance\n7. Pricing & Commercial Terms\n8. References & Case Studies\n\nKey differentiators to highlight:\n- Regional ICR model (feet on the ground)\n- Real-time CRM reporting\n- Multi-channel recruitment approach\n- Compliance certifications (ICEF, BC)", category: "Proposals", knowledgeType: KnowledgeType.PROPOSAL, tags: ["RFP", "template", "proposals"], authorId: hqUser.id },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Typed knowledge base articles created");

  // ─── PHASE 1: QBR ────────────────────────────────────────────────────
  await db.quarterlyBusinessReview.createMany({
    data: [
      { institutionId: instUCL.id, year: 2025, quarter: 1, executiveSummary: "Strong Q1 performance for UCL recruitment. 28 enrollments against 50 annual target (56% at end of Q1). Malaysian market performing well. India and Middle East markets showing growth. Key challenge: increasing visa approval rates for Nigerian applicants.", marketPerformance: { Malaysia: { applications: 22, enrollments: 12, conversion: 54.5 }, India: { applications: 15, enrollments: 8, conversion: 53.3 }, UAE: { applications: 10, enrollments: 5, conversion: 50.0 }, Nigeria: { applications: 8, enrollments: 3, conversion: 37.5 } }, roiAnalysis: { totalInvestment: 25000, enrollments: 28, costPerEnrollment: 892.86, revenuePerStudent: 3200, totalRevenue: 89600, roi: 258.4 }, strategicRecommendations: "1. Increase investment in India Tier 2 cities\n2. Develop Nigeria scholarship program to improve conversion\n3. Launch UAE parent engagement events\n4. Explore Vietnam as emerging market", kpiSummary: { applications: 55, enrollments: 28, conversionRate: 50.9, agentPartners: 8, schoolVisits: 12, events: 4 }, status: QBRStatus.APPROVED },
      { institutionId: instUOM.id, year: 2025, quarter: 1, executiveSummary: "UOM Q1 recruitment on track. 22 enrollments against 40 annual target. Contract renewal due in 45 days — critical priority. New MSc AI program generating strong interest.", marketPerformance: { Malaysia: { applications: 18, enrollments: 10, conversion: 55.6 }, India: { applications: 12, enrollments: 6, conversion: 50.0 }, UAE: { applications: 8, enrollments: 4, conversion: 50.0 }, Africa: { applications: 6, enrollments: 2, conversion: 33.3 } }, roiAnalysis: { totalInvestment: 18000, enrollments: 22, costPerEnrollment: 818.18, revenuePerStudent: 2800, totalRevenue: 61600, roi: 242.2 }, strategicRecommendations: "1. URGENT: Secure contract renewal before expiry\n2. Promote new MSc AI program heavily in India\n3. Increase scholarship communications\n4. Consider dedicated Nigeria recruitment plan", kpiSummary: { applications: 44, enrollments: 22, conversionRate: 50.0, agentPartners: 6, schoolVisits: 8, events: 3 }, status: QBRStatus.SUBMITTED },
    ],
    skipDuplicates: true,
  });
  console.log("✅ QBRs created");

  // ─── UPDATE INSTITUTIONS WITH PHASE 1 FIELDS ─────────────────────────
  await db.institution.update({ where: { id: instUCL.id }, data: { contractValue: 15000, renewalDate: new Date("2026-12-31"), budgetTotal: 30000, budgetUsed: 18500, strategicObjectives: "1. Achieve 50 enrollments for Sep 2025 intake\n2. Develop 3 new agent partnerships in underserved markets\n3. Increase Malaysia market share by 15%\n4. Launch parent engagement program in UAE\n5. Improve Nigeria conversion rate to 45%", overview: "UCL is our flagship institutional partner. Ranked #8 globally (QS 2025), it is the most sought-after university in our portfolio. We manage recruitment across 5 regions with 3 dedicated ICRs. The partnership has been active since 2020 with consistent growth.", accountManagerId: managerUser.id } });
  await db.institution.update({ where: { id: instUOM.id }, data: { contractValue: 12000, renewalDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), budgetTotal: 22000, budgetUsed: 14200, strategicObjectives: "1. Renew partnership agreement (URGENT)\n2. Achieve 40 enrollments for 2025\n3. Promote new MSc AI program\n4. Expand Africa recruitment pipeline", overview: "University of Manchester is a key Russell Group partner. Strong brand recognition especially in STEM programs. Contract renewal is critical priority — competitor agencies actively approaching UOM.", accountManagerId: managerUser.id } });
  await db.institution.update({ where: { id: instMelb.id }, data: { contractValue: 18000, renewalDate: new Date("2026-02-28"), budgetTotal: 25000, budgetUsed: 12000, strategicObjectives: "1. Achieve 30 enrollments for 2025\n2. Increase India market penetration\n3. Develop Vietnam recruitment channel\n4. Improve post-offer conversion rate", overview: "University of Melbourne is our top Australian partner. Strong appeal for STEM and health sciences students from South and Southeast Asia.", accountManagerId: managerUser.id } });
  await db.institution.update({ where: { id: instUCD.id }, data: { contractValue: 8000, renewalDate: new Date("2025-12-31"), budgetTotal: 12000, budgetUsed: 5000, strategicObjectives: "1. Establish presence in Africa market\n2. 20 enrollments for 2025\n3. Develop pathway programs", overview: "University College Dublin — key Irish partner. Growing interest from Middle East and African students.", accountManagerId: managerUser.id } });
  console.log("✅ Institution details updated");

  // ─── INSTITUTION CONTACTS ─────────────────────────────────────────────
  await db.institutionContact.createMany({
    data: [
      { institutionId: instUCL.id, name: "Dr. Patricia Hargrove", title: "Director of International Recruitment", email: "p.hargrove@ucl.ac.uk", phone: "+44-20-76791234", isPrimary: true },
      { institutionId: instUCL.id, name: "Mark Stevens", title: "Regional Manager – Asia Pacific", email: "m.stevens@ucl.ac.uk", phone: "+44-20-76795678" },
      { institutionId: instUOM.id, name: "Dr. Angela Liu", title: "Head of International Partnerships", email: "angela.liu@manchester.ac.uk", phone: "+44-161-3064321", isPrimary: true },
      { institutionId: instUOM.id, name: "James Murphy", title: "Agent Relations Coordinator", email: "j.murphy@manchester.ac.uk", phone: "+44-161-3065432" },
      { institutionId: instMelb.id, name: "Prof. David Chen", title: "Pro Vice-Chancellor (International)", email: "d.chen@unimelb.edu.au", phone: "+61-3-83447890", isPrimary: true },
      { institutionId: instUCD.id, name: "Sinead O'Brien", title: "International Office Manager", email: "sinead.obrien@ucd.ie", phone: "+353-1-7168765", isPrimary: true },
    ],
    skipDuplicates: true,
  });
  console.log("✅ Institution contacts created");

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
