import "dotenv/config";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.API_PORT ?? 8787),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  databaseUrl: required("DATABASE_URL"),
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  serverFilesDir: process.env.SERVER_FILES_DIR ?? "server-files",
  companyName: process.env.COMPANY_NAME ?? "Footwear Production Hub",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "",
  allowDestructiveAdminActions: process.env.ALLOW_DESTRUCTIVE_ADMIN_ACTIONS === "true",
};
