import {
  createRealtimeClient,
  type SealedLiveQuery,
} from "@neon/realtime/client";
import type { StoreRequestSummaryDTO } from "@regateo/shared";
import { useEffect, useState } from "react";
import { fetchSealedStoreRequests } from "@/lib/api";

interface RealtimeStoreRequestRow {
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

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRealtimeRow(row: RealtimeStoreRequestRow): StoreRequestSummaryDTO {
  return {
    id: row.id,
    storeName: row.store_name,
    normalizedKey: row.normalized_key,
    websiteUrl: row.website_url,
    categoryHint: row.category_hint,
    votes: Number(row.votes),
    status: row.status as StoreRequestSummaryDTO["status"],
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

/**
 * Suscripción en vivo vía Neon Realtime para las tiendas más pedidas.
 * Se activa cuando el modal está abierto y el backend expone NEON_REALTIME_URL;
 * renueva automáticamente la consulta sellada antes de expirar y hace fallback
 * silencioso a REST si Realtime no está configurado o falla la conexión.
 */
export function useRealtimeStoreRequests(enabled: boolean): {
  items: StoreRequestSummaryDTO[] | null;
  isLive: boolean;
} {
  const [items, setItems] = useState<StoreRequestSummaryDTO[] | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsLive(false);
      return;
    }

    let cancelled = false;
    let renewTimer: ReturnType<typeof setTimeout> | undefined;
    let cleanupClient: (() => void) | undefined;

    async function connect() {
      try {
        const res = await fetchSealedStoreRequests();
        if (cancelled || !res.enabled || !res.url || !res.sealed) return;

        const client = createRealtimeClient({ url: res.url });
        const sealed = res.sealed as SealedLiveQuery<RealtimeStoreRequestRow>;
        const sub = client.subscribe<RealtimeStoreRequestRow>(sealed);

        const scheduleRenewal = (expiresAt: number) => {
          if (renewTimer) clearTimeout(renewTimer);
          const delay = Math.max(5_000, expiresAt - Date.now() - 10_000);
          renewTimer = setTimeout(async () => {
            if (cancelled) return;
            try {
              const next = await fetchSealedStoreRequests();
              if (cancelled || !next.enabled || !next.sealed) return;
              await sub.renew(next.sealed as SealedLiveQuery<RealtimeStoreRequestRow>);
              scheduleRenewal(next.sealed.expiresAt);
            } catch {
              // El modal mantiene los datos REST mientras se reconecta.
            }
          }, delay);
        };

        const unlisten = sub.onChange((snapshot) => {
          if (cancelled) return;
          setIsLive(snapshot.status === "live");
          if (snapshot.data) {
            setItems(snapshot.data.map(mapRealtimeRow));
          }
        });

        scheduleRenewal(sealed.expiresAt);

        cleanupClient = () => {
          if (renewTimer) clearTimeout(renewTimer);
          unlisten();
          sub.unsubscribe();
          client.close();
        };
      } catch {
        // Fallback silencioso a TanStack Query REST.
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (renewTimer) clearTimeout(renewTimer);
      cleanupClient?.();
      setIsLive(false);
    };
  }, [enabled]);

  return { items, isLive };
}
