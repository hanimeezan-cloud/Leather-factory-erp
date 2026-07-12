# Footwear Production Hub Pilot Setup

This project supports two modes:

- `demo`: localStorage demo auth and sample business data for meetings.
- `supabase`: Supabase Auth for login/session, Express API for authorization and business logic, local PostgreSQL for business data.

Supabase is authentication only. Do not create customer, PO, material, vendor, BOM, report, or production tables in Supabase for this deployment.

## Correct Architecture

- Supabase Auth: login, logout, session token, password reset.
- Frontend: uses Supabase only for auth and sends the Supabase access token to the Express API.
- Express API: verifies Supabase JWTs, provisions local users/profiles, checks roles, validates input, and performs all business logic.
- Local PostgreSQL: stores users, profiles, roles, customers, purchase orders, sizes, styles, BOM materials, materials, vendors, material requirements, material POs, approvals, production lines, daily updates, alerts, and report audit rows.
- Local server filesystem: stores uploaded images under `UPLOADS_DIR`.

## Quick Demo Run

Create `.env` from `.env.example` and keep:

```text
VITE_AUTH_MODE=demo
```

Install dependencies:

```bash
npm install
```

Run the website:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/login
```

Demo logins all use `password123`:

- `owner@factory.com`
- `planning@factory.com`
- `production@factory.com`
- `sales@factory.com`

Demo mode does not require Supabase, PostgreSQL, or the API.

## Supabase Auth Setup

Create a Supabase project and use only:

- Project URL
- Publishable anon key
- Auth users

Do not apply business migrations in Supabase. Historical Supabase business SQL is kept only for reference in:

```text
docs/legacy-supabase-business-migrations/
```

## Local PostgreSQL Setup

The project includes a Docker-based PostgreSQL setup for local demo/server use. Open Docker Desktop first, then run:

```bash
npm run db:start
npm run db:migrate
```

This starts a local PostgreSQL database using the same default connection already shown in `.env.example`:

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/footwear_production_hub
```

If you are using your own PostgreSQL installation instead of Docker, create a database named `footwear_production_hub` and update `DATABASE_URL` in `.env` with your real username, password, host, and port.

Set API environment:

```text
VITE_AUTH_MODE=supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_SUPABASE_PASSWORD_RESET_REDIRECT_URL=http://127.0.0.1:5173/login?reset=1
VITE_API_BASE_URL=http://127.0.0.1:8787/api
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/footwear_production_hub
API_PORT=8787
CORS_ORIGIN=http://localhost:5173
UPLOADS_DIR=uploads
ALLOW_DESTRUCTIVE_ADMIN_ACTIONS=false
```

For password reset emails, add the same `VITE_SUPABASE_PASSWORD_RESET_REDIRECT_URL` value to Supabase Auth's allowed redirect URLs. Supabase must also be able to send Auth emails; configure Supabase Auth email/SMTP settings for reliable delivery.

After changing migrations or setting up a fresh machine, run local PostgreSQL migrations:

```bash
npm run db:migrate
```

The migration runner stores applied filenames in the local `schema_migrations` table and will not rerun completed migrations.

## Archive, Cleanup, And Retention

Normal record cleanup uses archive/restore instead of permanent delete. Archived records are hidden from normal list pages by default and remain in local PostgreSQL.

Owner users can open:

```text
/admin-tools
```

Admin Tools supports:

- Manual archive/restore by record type and ID.
- Permanent delete only for already-archived records, and only when `ALLOW_DESTRUCTIVE_ADMIN_ACTIONS=true`.
- Clear Test Data with typed confirmation.
- Retention runs that archive old completed records.

Run retention from the command line:

```bash
npm run db:retention
```

Optional retention environment values:

```text
RETENTION_ARCHIVE_OLDER_THAN_YEARS=2
RETENTION_DELETE_ARCHIVED_OLDER_THAN_YEARS=
```

Leave `RETENTION_DELETE_ARCHIVED_OLDER_THAN_YEARS` blank unless you intentionally want to permanently delete records that are already archived.

## Run Supabase-Auth Local-Database Mode

Start the API and frontend in separate terminals:

```bash
npm run api:dev
npm run dev
```

Open:

```text
http://127.0.0.1:5173/login
```

Login with a Supabase Auth user. The first valid API call to `/api/me` creates local `users` and `profiles` rows automatically:

- `full_name = email`
- `department = null`
- `role = Sales`
- `active = false`

## Create The First Owner

After the first Supabase user logs in once, activate that local profile in local PostgreSQL:

```sql
update profiles
set role = 'Owner', active = true, full_name = coalesce(full_name, 'Owner')
where user_id = '<supabase-auth-user-id>';
```

Then the Owner can use the in-app Users page to activate users and change roles.

## Build Checks

```bash
npm run db:migrate
npm run api:build
npm run build
npm run lint
```

## Notes

- Passwords are stored only by Supabase Auth.
- Business authorization is enforced by Express middleware, not Supabase RLS.
- Uploaded PO images are stored on the API/server machine under `UPLOADS_DIR`.
- Demo mode remains localStorage-only and is clearly marked as demo-only in code.
