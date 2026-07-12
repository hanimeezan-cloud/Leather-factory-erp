# Legacy Supabase Business Migrations

These files are reference-only.

The active architecture uses Supabase for authentication only. Business data now belongs in the local PostgreSQL database managed by the Express API and `api/migrations`.

Do not apply these SQL files to Supabase for the local-server pilot.
