/* eslint-disable @typescript-eslint/no-explicit-any */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env.js";
import { HttpError } from "./http.js";

export type SqlValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | SqlValue[]
  | Record<string, unknown>;
export type SqlParams = readonly SqlValue[];

export interface DbExecutor {
  query<T extends QueryResultRow = any>(
    text: string,
    params?: SqlParams,
  ): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
}

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

function normalizeParam(value: SqlValue): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalizeParam);
  return value;
}

function publicDbError(error: unknown) {
  const candidate = error as {
    code?: string;
    detail?: string;
    message?: string;
    constraint?: string;
  };
  if (candidate.code === "ECONNREFUSED") {
    return {
      status: 503,
      message: "Local PostgreSQL is unreachable. Start the database and try again.",
    };
  }
  if (candidate.code === "3D000") {
    return {
      status: 503,
      message: "Local PostgreSQL database was not found. Create it or run the bundled database.",
    };
  }
  if (candidate.code === "28P01") {
    return {
      status: 503,
      message: "Local PostgreSQL rejected the configured username or password.",
    };
  }
  if (candidate.code === "23505") {
    return { status: 400, message: "A record with the same unique value already exists." };
  }
  if (candidate.code === "23503")
    return { status: 400, message: "This record is linked to another record and cannot be saved." };
  if (candidate.code === "23514") {
    return { status: 400, message: "The submitted value is not allowed." };
  }
  if (candidate.code === "22P02") {
    return { status: 400, message: "One of the submitted IDs is invalid." };
  }
  if (candidate.code === "42804") {
    return {
      status: 500,
      message:
        "Database type mismatch while saving this record. The API query needs an explicit field cast.",
    };
  }
  if (candidate.code === "42703" || candidate.code === "42P01") {
    return {
      status: 500,
      message: "Database schema is missing a required table or column. Run npm.cmd run db:migrate.",
    };
  }
  return {
    status: 400,
    message: `The database could not complete this request${
      candidate.code ? ` (${candidate.code})` : ""
    }. ${candidate.message ?? "Check the server logs for details."}`,
  };
}

export function toHttpDbError(error: unknown, text?: string, params?: SqlParams) {
  console.error("Database query failed", { text, params, error });
  const publicError = publicDbError(error);
  return new HttpError(publicError.status, publicError.message);
}

export async function query<T extends QueryResultRow = any>(text: string, params: SqlParams = []) {
  try {
    return await pool.query<T>(text, params.map(normalizeParam));
  } catch (error) {
    throw toHttpDbError(error, text, params);
  }
}

export async function one<T extends QueryResultRow = any>(text: string, params: SqlParams = []) {
  const result = await query<T>(text, params);
  if (!result.rows[0]) throw new HttpError(404, "Record not found.");
  return result.rows[0];
}

export async function maybeOne<T extends QueryResultRow = any>(
  text: string,
  params: SqlParams = [],
) {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function many<T extends QueryResultRow = any>(text: string, params: SqlParams = []) {
  return (await query<T>(text, params)).rows;
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error instanceof HttpError) throw error;
    throw toHttpDbError(error);
  } finally {
    client.release();
  }
}
