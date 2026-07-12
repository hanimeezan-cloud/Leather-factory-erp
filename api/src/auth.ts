import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import { env } from "./env.js";
import { HttpError } from "./http.js";
import { one, transaction } from "./db.js";
import type { Profile, Role } from "../../src/lib/domain.js";

export interface AuthContext {
  userId: string;
  email: string;
  role: Role | null;
  active: boolean;
  profile: Profile;
}

export interface AuthedRequest extends Request {
  auth: AuthContext;
}

const supabaseAuth = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type ProfileRow = {
  user_id: string;
  email: string;
  full_name?: string | null;
  department?: string | null;
  role?: Role | null;
  active?: boolean | null;
};

function mapProfile(row: ProfileRow): Profile {
  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name ?? null,
    department: row.department ?? null,
    role: row.role ?? null,
    active: Boolean(row.active),
  };
}

async function provisionAndLoadProfile(userId: string, email: string) {
  await transaction(async (client) => {
    const existingByEmail = await client.query<{ id: string }>(
      "select id from users where lower(email) = lower($1) limit 1",
      [email],
    );
    const localUserId = existingByEmail.rows[0]?.id;
    if (localUserId && localUserId !== userId) {
      await client.query("update users set id = $1, email = $2 where id = $3", [
        userId,
        email,
        localUserId,
      ]);
    }

    await client.query(
      `
        insert into users (id, email)
        values ($1, $2)
        on conflict (id) do update
        set email = excluded.email
      `,
      [userId, email],
    );
    await client.query(
      `
        insert into profiles (user_id, full_name, department, role, active)
        values ($1, $2, null, 'Sales', false)
        on conflict (user_id) do nothing
      `,
      [userId, email],
    );
  });

  return one<ProfileRow>(
    `
      select
        p.user_id,
        u.email,
        p.full_name,
        p.department,
        p.role,
        p.active
      from profiles p
      join users u on u.id = p.user_id
      where p.user_id = $1
    `,
    [userId],
  );
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    next(new HttpError(401, "Missing bearer token"));
    return;
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) {
    next(new HttpError(401, "Invalid or expired session"));
    return;
  }

  try {
    const email = data.user.email ?? "";
    const row = await provisionAndLoadProfile(data.user.id, email);
    const profile = mapProfile(row);
    (req as AuthedRequest).auth = {
      userId: profile.userId,
      email: profile.email,
      role: profile.role,
      active: profile.active,
      profile,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireActive(req: Request, _res: Response, next: NextFunction) {
  const auth = (req as AuthedRequest).auth;
  if (!auth.active || !auth.role) {
    next(new HttpError(403, "Your account is waiting for role activation."));
    return;
  }
  next();
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = (req as AuthedRequest).auth;
    if (auth.role === "Owner" || (auth.role && roles.includes(auth.role))) {
      next();
      return;
    }
    next(new HttpError(403, "You do not have access to this action."));
  };
}
