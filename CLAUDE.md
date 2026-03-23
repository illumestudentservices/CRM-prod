@AGENTS.md

# Illume CRM — Project Reference

Full-stack CRM + ERP for Illume Student Advisory Services.
Built with Next.js 16 (App Router), React 19, Prisma 7 + PostgreSQL, NextAuth v5, TailwindCSS v4.

---

## Stack at a Glance

| Layer | Tech |
|---|---|
| Framework | Next.js 16 App Router (server + client components) |
| Auth | NextAuth v5 (Credentials provider, JWT, Prisma adapter) |
| Database | PostgreSQL via `@prisma/adapter-pg` (connection pooling with `pg`) |
| ORM | Prisma 7 — schema at `prisma/schema.prisma` |
| Styles | TailwindCSS v4 with PostCSS (`@tailwindcss/postcss`) |
| UI Components | Shadcn/Radix UI primitives in `components/ui/` |
| Charts | Recharts |
| Email | Resend API (`lib/email.ts`) |
| Forms | React Hook Form + Zod |
| Drag & Drop | @dnd-kit (Kanban board) |
| PDF | @react-pdf/renderer |
| State | Zustand (light usage) |

**Dev:** `npm run dev` · **Sync schema:** `npm run db:push` · **Seed:** `npm run db:seed`

---

## Directory Structure

```
app/
  (auth)/login/              Login page + auth layout
  (dashboard)/               All authenticated pages — wrapped in AppShell
    dashboard/               Home dashboard
    students/                Lead/student CRM (list + kanban + detail)
    sources/                 Lead sources + campaigns
    institutions/            Partner institution ERM
    events/                  Events management
    reports/                 Monthly ICR reports + approvals
    analytics/               Analytics dashboards (executive / regional / ICR)
    hr/                      HR & ERP module
    settings/                Admin settings (users, regions, security/permissions)
    activity-log/            Audit log viewer (SUPER_ADMIN only)
    search/                  Global search
  api/                       All API routes (see section below)

components/
  layout/
    app-shell.tsx            Server — loads session + effective nav keys, renders AppShellClient
    app-shell-client.tsx     Client shell — sidebar + topbar + children
    sidebar.tsx              (Legacy) sidebar component
    topbar.tsx               Top navigation bar
  providers/                 SessionProvider, ToastProvider
  shared/                    Reusable business components (stat-card, page-header, data-table, etc.)
  ui/                        Shadcn primitives (button, card, dialog, table, tabs, etc.)

lib/
  db.ts                      Prisma client singleton — import this everywhere, never new PrismaClient()
  auth.ts                    NextAuth config + handlers + session shape
  permissions.ts             Static RBAC matrix + hasPermission() + NAV_PERMISSIONS
  effective-permissions.ts   Dynamic permissions merging DB overrides — use in API routes
  activity-logger.ts         Fire-and-forget audit logger — logActivity()
  email.ts                   Email templates via Resend
  utils.ts                   cn(), formatDate/Currency/Percent, getInitials, calculateROI, etc.

prisma/
  schema.prisma              Full DB schema — 48 models
  seed.ts                    Seeds regions, super admin, demo data
```

---

## Auth & Session

- Login: `POST /api/auth/[...nextauth]` — Credentials provider, bcrypt password check
- Session shape (JWT): `{ id, email, name, role, image, regionId }`
- `session.user.role` and `session.user.regionId` always available in API routes
- On login, an `AuditLog` entry is created automatically (action: LOGIN)
- bcryptjs is server-only — listed in `serverExternalPackages` in `next.config.ts`

---

## RBAC — Roles & Permissions

### The 8 roles (Prisma enum `Role`)

| Role | Description |
|---|---|
| SUPER_ADMIN | Full access to everything |
| HQ_EXECUTIVE | Read + approve across all CRM; manages announcements |
| HQ_ANALYTICS | Analytics focus; read access to CRM |
| REGIONAL_MANAGER | Read + write CRM for their region; approves reports |
| ICR | Institutional Client Rep — owns their leads/reports |
| INSTITUTION_CLIENT | Read-only access to institution-related data |
| HR_MANAGER | Full access to HR/ERP; read-only on users |
| EMPLOYEE | Self-service HR (leave, attendance, tasks, knowledge base) |

### Permission system — two layers

**Layer 1 — Static matrix** (`lib/permissions.ts`)
- `PERMISSION_MATRIX[role][resource][action]` — hardcoded defaults
- Resources: `leads, sources, institutions, events, reports, analytics, erp, erp_hr, users, settings, announcements, knowledge_base`
- Actions: `read, write, delete, approve, export`

**Layer 2 — DB overrides** (`lib/effective-permissions.ts`)
- `PermissionOverride` table stores per-role/resource/action overrides set via the Security tab in Settings
- `effectiveHasPermission(role, resource, action)` — async, merges both layers, cached per request via React `cache()`
- `getEffectiveNavKeys(role)` — returns sidebar nav keys the role can see based on effective permissions
- **Always use `effectiveHasPermission()` in API routes** — not the static `hasPermission()`

### Navigation gating
`AppShell` (server component) calls `getEffectiveNavKeys(role)` and passes `allowedNavKeys` to `AppShellClient`. Permission changes to nav-gating resources reflect on the user's next page load.

---

## API Routes — Full Map

### Leads (CRM)
```
GET  /api/leads                       List leads (role/region/stage/source/country filters)
POST /api/leads                       Create lead
GET  /api/leads/[id]                  Detail + activities + notes + documents
PATCH /api/leads/[id]                 Update lead
DELETE /api/leads/[id]                Soft delete
GET/POST /api/leads/[id]/notes        Notes
PATCH /api/leads/[id]/stage           Stage update
```

### Sources & Campaigns
```
GET/POST            /api/sources
GET/PATCH/DELETE    /api/sources/[id]
GET/POST            /api/campaigns
```

### Institutions (ERM)
```
GET/POST            /api/institutions
GET/PATCH           /api/institutions/[id]
GET/POST            /api/institutions/[id]/contacts
GET/POST            /api/institutions/[id]/contracts
GET/POST            /api/institutions/[id]/engagement
```

### Events
```
GET/POST            /api/events
GET/PATCH/DELETE    /api/events/[id]
GET/POST            /api/events/[id]/expenses
```

### Reports
```
GET/POST                /api/reports
GET/PATCH               /api/reports/[id]
POST                    /api/reports/[id]/approve
GET/POST/PATCH          /api/reports/[id]/forecast
```

### Analytics & Dashboard
```
GET /api/analytics/overview       Executive overview KPIs
GET /api/analytics/regional       Regional breakdown
GET /api/dashboard/stats          Dashboard summary stats
```

### HR / ERP
```
GET/POST            /api/hr/employees
GET/PATCH/DELETE    /api/hr/employees/[id]
POST                /api/hr/employees/[id]/reset-password
GET                 /api/hr/employees/[id]/kpis

GET/POST            /api/hr/leave
GET/PATCH/DELETE    /api/hr/leave/[id]

GET/POST/PATCH      /api/hr/attendance
GET/POST            /api/hr/holidays
PATCH/DELETE        /api/hr/holidays/[id]

GET/POST            /api/hr/tasks
GET/PATCH           /api/hr/tasks/[id]

GET/POST            /api/hr/announcements
POST                /api/hr/announcements/[id]/read

GET/POST            /api/hr/assets
GET/PATCH           /api/hr/assets/[id]

GET/POST            /api/hr/knowledge-base
POST                /api/hr/knowledge-base/attachments        Upload file (multipart/form-data)
GET                 /api/hr/knowledge-base/attachments/[id]   Download file (binary stream)

GET                 /api/hr/regions
```

### Settings (SUPER_ADMIN only)
```
GET/POST            /api/settings/users
GET/POST/DELETE     /api/settings/regions
GET                 /api/settings/permissions     Matrix + active overrides
PUT                 /api/settings/permissions     Bulk upsert/delete overrides
```

### System
```
GET  /api/activity-log        Paginated audit log (SUPER_ADMIN only)
GET  /api/notifications       User notifications
POST /api/email/test          Test email
GET  /api/auth/[...nextauth]  NextAuth handler
```

---

## Database Models — Quick Reference

### Auth & Users
- **User** — email, password (bcrypt), role, regionId, active, deletedAt
- **Account / Session / VerificationToken** — NextAuth adapter tables

### CRM
- **Region** — name, code, description
- **Lead** — fullName, email, phone, nationality, countryOfResidence, interestedProgram, faculty, studyLevel, intakeYear/Month, stage (`NEW → ENROLLED`), assignedICRId, regionId, institutionId, sourceId, eventId
- **LeadActivity** — stage changes, notes, activity audit trail
- **LeadNote** — free-text notes
- **LeadDocument** — uploaded docs (URL-based)
- **Source** — type: `AGENT / SCHOOL / WALK_IN / CAMPAIGN / DIGITAL / PARTNER`
- **Campaign** — marketing campaigns linked to source (budget, leadsGenerated)

### ERM
- **Institution** — accountStatus: `PROSPECT / ACTIVE / RENEWAL_DUE / CHURNED`
- **InstitutionContact / Contract / EngagementLog / Deliverable / EnrollmentTarget / InstitutionDocument**

### Events
- **Event** — type: `EDUCATION_FAIR / CAMPUS_VISIT / WEBINAR / AGENT_TRAINING / SCHOOL_PRESENTATION / EXHIBITION`
- **EventExpense** — itemized expenses with receipt

### Reports
- **MonthlyReport** — status: `DRAFT → PENDING_REVIEW → REGIONAL_APPROVED → HQ_REVIEW → FINAL_APPROVED / RETURNED`
- **ReportApproval** — approval chain with comments
- **ForecastEntry** — confidence: `HIGH(0.8) / MEDIUM(0.5) / LOW(0.25)` → weightedProbability

### HR / ERP
- **Employee** — linked to User; jobTitle, employmentType, managerId, startDate
- **LeaveBalance** — per type/year: `ANNUAL / SICK / MATERNITY / PATERNITY / UNPAID / COMP_OFF`
- **LeaveRequest** — status: `PENDING / APPROVED / REJECTED / CANCELLED`
- **Attendance** — daily check-in/out, hoursWorked, overtime
- **Worklog** — time tracking entries
- **TravelRequest** — travel approvals
- **PerformanceReview / KPITarget / TrainingRecord**
- **Task** — priority: `LOW/MEDIUM/HIGH/URGENT`, status: `TODO/IN_PROGRESS/DONE/CANCELLED`
- **ITAsset + AssetAssignment** — asset tracking
- **EmployeeDocument / OnboardingItem / Department**

### Cross-Cutting
- **Notification** — in-app per user
- **Announcement + AnnouncementRead** — global/regional broadcasts with read receipts
- **KnowledgeBase** — HR policy articles (title, content, category, tags, isPublished)
- **KnowledgeBaseAttachment** — binary file storage (`data Bytes` — no external storage needed)
- **Holiday** — public/regional holidays
- **PermissionOverride** — DB-stored permission customisations (role + resource + action → granted)
- **AuditLog** — full audit trail (userId, action, entity, entityId, changes JSON, ipAddress, userAgent)

---

## Key Patterns & Conventions

### Adding a new API route
```ts
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { logActivity } from "@/lib/activity-logger";
import type { Role } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!await effectiveHasPermission(session.user.role as Role, "resource", "read"))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // ... logic ...

    void logActivity(session.user.id, "READ", "ENTITY", entityId, null, req);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("[route] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### Adding a new page
1. Create `app/(dashboard)/<page>/page.tsx`
2. Add nav item to `NAV_ITEMS` in `components/layout/app-shell-client.tsx`
3. Add the key + allowed roles to `NAV_PERMISSIONS` in `lib/permissions.ts`
4. Add `{ key: "nav_key", resource: "X", action: "read" }` to `NAV_RESOURCE_MAP` in `lib/effective-permissions.ts`

### Adding a new permission resource
1. Add to `Resource` type in `lib/permissions.ts`
2. Add to `PERMISSION_MATRIX` for all 8 roles
3. Add to `ALL_RESOURCES` in `app/api/settings/permissions/route.ts`
4. Add to `RESOURCE_GROUPS` in `app/(dashboard)/settings/_components/security-tab.tsx`

### Prisma schema changes
```bash
npx prisma db push        # Apply schema to DB (no migration file)
npx prisma generate       # Regenerate Prisma client
# IMPORTANT: After generate, restart dev server.
# If Turbopack shows "export X doesn't exist": rm -rf .next && restart
```

### Audit logging
```ts
// Fire-and-forget — never throws, never blocks the response
void logActivity(userId, "CREATE", "ENTITY_NAME", entityId, { field: value }, req);
```

---

## Environment Variables

```env
DATABASE_URL=           # PostgreSQL connection string
NEXTAUTH_SECRET=        # Random secret for JWT signing
NEXTAUTH_URL=           # App URL (e.g. http://localhost:3000)
RESEND_API_KEY=         # Resend API key for email
```

---

## Contact

System admin: **it@illumestudentservices.ca**
