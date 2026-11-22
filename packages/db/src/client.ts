import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://admin@localhost:5432/regateoapp_dev";

// Detect Neon (-pooler) or Supabase (:6543) transaction poolers automatically
const isPooler =
  process.env.DATABASE_POOLER === "true" ||
  connectionString.includes("-pooler.") ||
  connectionString.includes(":6543");

const isSsl =
  connectionString.includes("sslmode=require") ||
  connectionString.includes("neon.tech") ||
  connectionString.includes("supabase.co");

export const sqlClient = postgres(connectionString, {
  max: isPooler ? 10 : 15,
  idle_timeout: 20,
  connect_timeout: 10,
  // Required for PgBouncer / Supabase :6543 / Neon transaction pooler
  prepare: isPooler ? false : true,
  ssl: isSsl ? "require" : false,
});

export const db = drizzle(sqlClient, { schema });
export type Database = typeof db;
