// ============================================================================
// Neon Realtime — Live SQL query sealing on the server.
// Uses NEON_REALTIME_SECRET (server-only) and NEON_REALTIME_URL (public ws).
// Never exposes PII columns (contact_email, details) in sealed public queries.
// ============================================================================
import { createRealtime, rawSql, type SealedLiveQuery } from "@neon/realtime/server";

export interface RealtimeStoreRequestRow {
  id: string;
  store_name: string;
  normalized_key: string;
  website_url: string | null;
  category_hint: string | null;
  votes: number;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function extractDatabaseName(databaseUrl?: string): string {
  if (!databaseUrl) return "neondb";
  try {
    const pathname = new URL(databaseUrl).pathname.replace(/^\/+/, "");
    return pathname || "neondb";
  } catch {
    return "neondb";
  }
}

export function getNeonRealtimeConfig() {
  const url = process.env.NEON_REALTIME_URL?.trim() || null;
  const secret = process.env.NEON_REALTIME_SECRET?.trim() || null;
  const db = extractDatabaseName(process.env.DATABASE_URL);
  return {
    configured: Boolean(url && secret),
    url,
    db,
  };
}

let cachedRealtimeServer: ReturnType<typeof createRealtime> | null = null;
let cachedRealtimeSecret: string | null = null;

function getRealtimeServer() {
  const secret = process.env.NEON_REALTIME_SECRET?.trim();
  const url = process.env.NEON_REALTIME_URL?.trim();
  if (!secret || !url) return null;

  if (!cachedRealtimeServer || cachedRealtimeSecret !== secret) {
    cachedRealtimeSecret = secret;
    cachedRealtimeServer = createRealtime({
      secret,
      db: extractDatabaseName(process.env.DATABASE_URL),
    });
  }
  return cachedRealtimeServer;
}

/**
 * Live SQL query for popular community store requests (public columns only).
 * Deterministic read-only SELECT with primary key `id`.
 */
const popularStoreRequestsQuery = rawSql<RealtimeStoreRequestRow>(
  `SELECT id, store_name, normalized_key, website_url, category_hint, votes, status, created_at, updated_at
   FROM store_requests
   WHERE status IN ('pending', 'reviewing')
   ORDER BY votes DESC, updated_at DESC
   LIMIT 8`
);

export async function sealPopularStoreRequestsQuery(): Promise<{
  enabled: true;
  url: string;
  sealed: SealedLiveQuery<RealtimeStoreRequestRow>;
} | {
  enabled: false;
  url: null;
  sealed: null;
}> {
  const server = getRealtimeServer();
  const url = process.env.NEON_REALTIME_URL?.trim();
  if (!server || !url) {
    return { enabled: false, url: null, sealed: null };
  }
  const sealed = await server.seal({ query: popularStoreRequestsQuery });
  return { enabled: true, url, sealed };
}
