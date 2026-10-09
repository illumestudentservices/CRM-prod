# Illume CRM/ERM — Deployment Guide

## Prerequisites
- Node.js 18+ and npm
- A [Neon](https://neon.tech) or Supabase PostgreSQL database
- A [Vercel](https://vercel.com) account
- A [Resend](https://resend.com) account (for email notifications)

---

## 1. Local Development Setup

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd illume-crm

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your real values (see below)

# 4. Generate Prisma client + push schema + seed data
npm run setup

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 2. Environment Variables

Edit `.env.local` with the following:

### DATABASE_URL (Required)
Get a free PostgreSQL database from [Neon](https://neon.tech):
1. Sign up at neon.tech
2. Create a new project
3. Copy the connection string from the dashboard
4. Add `?sslmode=require` to the end

```
DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

### AUTH_SECRET (Required)
Generate a secure random string:
```bash
openssl rand -base64 32
```
```
AUTH_SECRET="your-generated-secret-here"
```

### NEXTAUTH_URL
```
NEXTAUTH_URL="http://localhost:3000"  # dev
NEXTAUTH_URL="https://your-app.vercel.app"  # production
```

### RESEND_API_KEY (Optional but recommended)
1. Sign up at [resend.com](https://resend.com)
2. Create an API key
```
RESEND_API_KEY="re_xxxxxxxxxxxx"
EMAIL_FROM="Illume CRM <noreply@yourdomain.com>"
```

---

## 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database (no migration files)
npm run db:push

# OR use migrations (recommended for production)
npm run db:migrate

# Seed with demo data
npm run db:seed
```

### Seed Login Credentials
After seeding, these accounts are available:

| Email | Password | Role |
|-------|----------|------|
| admin@illume.edu | password123 | SUPER_ADMIN |
| hq@illume.edu | password123 | HQ_EXECUTIVE |
| analytics@illume.edu | password123 | HQ_ANALYTICS |
| manager@illume.edu | password123 | REGIONAL_MANAGER |
| icr@illume.edu | password123 | ICR |
| hr@illume.edu | password123 | HR_MANAGER |

---

## 4. Deploy to Vercel

### Option A: Vercel CLI (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Follow the prompts, then set environment variables:
vercel env add DATABASE_URL
vercel env add AUTH_SECRET
vercel env add NEXTAUTH_URL
vercel env add RESEND_API_KEY
vercel env add EMAIL_FROM
vercel env add NEXT_PUBLIC_APP_URL

# Deploy to production
vercel --prod
```

### Option B: Vercel Dashboard

1. Push your code to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your GitHub repository
4. Configure environment variables:
   - Go to **Settings → Environment Variables**
   - Add all variables from `.env.example`
   - Set `NEXTAUTH_URL` to your Vercel deployment URL
5. Click **Deploy**

### Post-Deploy: Run Seed
After first deployment, run the seed script:
```bash
# Using Vercel CLI
vercel env pull .env.local
npm run db:seed
```

---

## 5. Neon Database (Recommended)

Neon is a serverless PostgreSQL perfect for Vercel:

1. Sign up at [neon.tech](https://neon.tech)
2. Create project → Copy connection string
3. Enable **Connection Pooling** in Neon dashboard
4. Use the **pooled connection string** for `DATABASE_URL` in production

**Connection string format:**
```
postgresql://user:pass@ep-xxx-yyy.us-east-2.aws.neon.tech/neondb?sslmode=require
```

---

## 6. Production Checklist

- [ ] Set `AUTH_SECRET` to a strong random value
- [ ] Set `NEXTAUTH_URL` to your production domain
- [ ] Enable connection pooling in Neon
- [ ] Run `npm run db:seed` after first deploy
- [ ] Verify login works for all roles
- [ ] Test email delivery via Resend
- [ ] Change all seed user passwords via Settings

---

## 7. Available npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run setup` | Generate + push schema + seed (first-time setup) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:push` | Push schema changes to DB |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Run seed script |
| `npm run db:studio` | Open Prisma Studio (DB GUI) |
| `npm run db:reset` | Reset DB and re-seed |

---

## 8. Architecture Overview

```
illume-crm/
├── app/
│   ├── (auth)/          # Login pages
│   ├── (dashboard)/     # All CRM pages (protected)
│   │   ├── dashboard/   # Role-based dashboards
│   │   ├── students/    # Lead pipeline (Kanban + list)
│   │   ├── sources/     # Agent/school/campaign management
│   │   ├── institutions/# Partner/ERM management
│   │   ├── analytics/   # Charts and dashboards
│   │   ├── events/      # Event management + ROI
│   │   ├── reports/     # Monthly reports + forecasting
│   │   ├── hr/          # ERP/HR module
│   │   └── settings/    # Admin settings
│   └── api/             # API routes
├── components/
│   ├── ui/              # Base UI primitives (shadcn-style)
│   ├── layout/          # Sidebar, topbar, app shell
│   ├── shared/          # DataTable, StatCard, etc.
│   └── providers/       # Context providers
├── lib/
│   ├── auth.ts          # NextAuth configuration
│   ├── db.ts            # Prisma client singleton
│   ├── permissions.ts   # RBAC permission matrix
│   └── utils.ts         # Utility functions
└── prisma/
    ├── schema.prisma    # Full database schema (60+ models)
    └── seed.ts          # Comprehensive seed data
```

---

## 9. Troubleshooting

**Build fails with Prisma errors:**
```bash
npm run db:generate
```

**"Session not found" errors:**
- Ensure `AUTH_SECRET` is set and consistent across deployments
- Check `NEXTAUTH_URL` matches your actual deployment URL

**Database connection errors:**
- Check `DATABASE_URL` includes `?sslmode=require` for Neon
- Ensure IP is not blocked (Neon allows all by default)

**Email not sending:**
- Verify `RESEND_API_KEY` is valid
- Check Resend dashboard for delivery logs
- App still functions without email; notifications are in-app

---

## 10. Backups and recovery

> Added 2026-10-09. Until then there was no backup job: the dumps in
> `/root/db-backups` had each been taken by hand before a risky migration, the
> newest was nineteen days old, and a cron entry that merely `chmod`-ed the
> backup directory made the area look covered.

### What runs

| When | Command | Label |
|---|---|---|
| Nightly 02:30 | `scripts/backup-db.sh nightly` (cron) | `nightly` |
| Every deploy | called by `deploy.sh` before the build is swapped in | `pre-deploy` |
| By hand | `scripts/backup-db.sh pre-042` | whatever you pass |

Dumps land in `/root/db-backups/illume_crm-<label>-<timestamp>.sql.gz`, mode
`600`. `nightly` and `pre-deploy` dumps are pruned after **14 days**. Dumps under
any other label are never pruned, so the hand-made pre-migration ones are kept
indefinitely.

The script refuses to call a dump a backup until it has verified it: `pg_dump`'s
own exit status (not the pipeline's), gzip integrity, at least one
`CREATE TABLE`, the presence of `users` / `employees` / `leads` /
`leave_requests`, and a size floor. It writes to `.part` and renames only on
success, and it **prunes only after** the new dump has passed — rotating first
would mean the night the dump breaks is the night the old ones are deleted.

A failing deploy backup **aborts the deploy**. That is deliberate.

### Restoring

```bash
# Inspect first — never restore blind
zcat /root/db-backups/illume_crm-nightly-20261009-023000.sql.gz | head -40

# Restore into a scratch database and look at it before touching production
sudo -u postgres createdb illume_crm_restore
zcat /root/db-backups/<file>.sql.gz | sudo -u postgres psql -d illume_crm_restore

# Only then, and only if you are sure:
pm2 stop illume-crm
sudo -u postgres dropdb illume_crm && sudo -u postgres createdb illume_crm
zcat /root/db-backups/<file>.sql.gz | sudo -u postgres psql -d illume_crm
pm2 start illume-crm
```

### What a backup does NOT cover

These matter if the **server itself** is lost rather than the data:

1. **The dumps live on the same machine they protect** (`/root/db-backups`).
   Losing the VPS loses the backups with it. On-server retention was the chosen
   trade-off on 2026-10-09; moving a copy off the box is still the open item.
2. **`.env` is not in git and is not copied anywhere.** It holds `AUTH_SECRET`,
   `DATABASE_URL` and `BREVO_API_KEY`. Without `AUTH_SECRET` every existing
   session is invalidated; without the rest the app will not boot or send mail.
   Keep a copy in a password manager.
3. **The SSH key** `~/.ssh/illume_vps` is the only way in — password auth is
   disabled on the server.

Knowledge-base attachments *are* covered: `KnowledgeBaseAttachment.data` is
stored as bytes in the database, so a dump includes them. There is no separate
uploads directory to back up.
