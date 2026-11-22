import { db, inArray, priceAlerts, sql, sqlClient } from "@regateo/db";

/**
 * Post-scrape price-alert engine.
 *
 * After every barrido revisa las alertas activas y verificadas, cruza cada una
 * con la mejor oferta EN STOCK del producto y dispara un correo (Resend) cuando
 * el precio cae al objetivo. En desarrollo (sin `RESEND_API_KEY`) registra un log
 * estructurado para que la alerta siga siendo auditable.
 */

const ALERT_COOLDOWN_HOURS = 24;

export interface AlertTriggerInput {
  active: boolean;
  verified: boolean;
  inStock: boolean;
  targetPriceCents: number;
  bestPriceCents: number | null | undefined;
  lastTriggeredAt?: Date | string | null;
  now?: Date;
  cooldownHours?: number;
}

/**
 * Reglas puras de disparo (sin BD) para poder testearlas y reutilizarlas:
 * alerta activa + verificada + producto en stock + precio ≤ objetivo +
 * sin disparo en las últimas 24 h.
 */
export function shouldTriggerAlert(input: AlertTriggerInput): boolean {
  if (!input.active || !input.verified || !input.inStock) return false;
  const best = input.bestPriceCents;
  if (typeof best !== "number" || !Number.isFinite(best) || best <= 0) return false;
  if (best > input.targetPriceCents) return false;

  if (!input.lastTriggeredAt) return true;
  const last =
    input.lastTriggeredAt instanceof Date
      ? input.lastTriggeredAt.getTime()
      : new Date(input.lastTriggeredAt).getTime();
  if (!Number.isFinite(last)) return true;

  const now = (input.now ?? new Date()).getTime();
  const cooldownMs = (input.cooldownHours ?? ALERT_COOLDOWN_HOURS) * 60 * 60 * 1000;
  return now - last >= cooldownMs;
}

export interface AlertDispatchResult {
  checked: number;
  triggered: number;
  emailed: number;
  failed: number;
}

interface AlertRow extends Record<string, unknown> {
  alert_id: string;
  product_id: string;
  email: string;
  target_price_cents: number;
  product_name: string;
  product_slug: string;
  listing_id: string;
  price_cents: number;
  listing_url: string;
  store_slug: string;
  store_name: string;
  store_color: string;
}

function apiBaseUrl(): string {
  return (process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

function fromEmail(): string {
  return process.env.ALERTS_FROM_EMAIL ?? "RegateoApp <alertas@regateoapp.com>";
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("es-PA", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function alertLink(listingId: string): string {
  return `${apiBaseUrl()}/out/${listingId}?src=alert`;
}

function buildEmailHtml(alert: AlertRow): string {
  const price = formatUsd(alert.price_cents);
  const target = formatUsd(alert.target_price_cents);
  const link = alertLink(alert.listing_id);
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${alert.store_color}">RegateoApp · Alerta de precio</p>
      <h1 style="margin:0;font-size:22px;line-height:1.3">🔥 ${alert.product_name}</h1>
    </td></tr>
    <tr><td style="padding:8px 28px 0">
      <p style="margin:16px 0;font-size:16px">
        Ahora cuesta <strong style="font-size:24px;color:#0f172a">${price}</strong>
        en <strong>${alert.store_name}</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#475569">
        Tu precio objetivo era ${target}. Buen momento para regatear.
      </p>
      <p style="margin:0 0 28px">
        <a href="${link}" style="display:inline-block;padding:12px 20px;background:#0f172a;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">
          Ver la oferta en ${alert.store_name} ↗
        </a>
      </p>
    </td></tr>
    <tr><td style="padding:0 28px 24px;border-top:1px solid #e2e8f0">
      <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">
        Recibes este correo porque creaste una alerta en RegateoApp. Precios verificados
        directamente en la tienda; pueden cambiar sin previo aviso.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

async function sendWithResend(alert: AlertRow, apiKey: string): Promise<boolean> {
  const price = formatUsd(alert.price_cents);
  const subject = `🔥 Bajó de precio: ${alert.product_name} a ${price} en ${alert.store_name}`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail(),
        to: [alert.email],
        subject,
        html: buildEmailHtml(alert),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 240);
      console.warn(`  ⚠️  Resend ${response.status} para ${alert.email}: ${detail}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      `  ⚠️  No se pudo enviar correo a ${alert.email}: ${(error as Error).message}`
    );
    return false;
  }
}

/**
 * Evalúa las alertas y despacha las que se cumplieron. Devuelve métricas para
 * el resumen del pipeline. Nunca lanza: un fallo de correo no debe romper el scrape.
 */
export async function evaluateAndDispatchPriceAlerts(
  log: (message: string) => void = (message) => console.log(message)
): Promise<AlertDispatchResult> {
  const result: AlertDispatchResult = { checked: 0, triggered: 0, emailed: 0, failed: 0 };

  let rows: AlertRow[] = [];
  try {
    const executed = await db.execute<AlertRow>(sql`
      SELECT pa.id AS alert_id,
             pa.product_id,
             pa.email,
             pa.target_price_cents,
             p.canonical_name AS product_name,
             p.slug AS product_slug,
             best.id AS listing_id,
             best.price_cents,
             best.url AS listing_url,
             s.slug AS store_slug,
             s.name AS store_name,
             s.color AS store_color
      FROM price_alerts pa
      JOIN products p ON p.id = pa.product_id
      JOIN LATERAL (
        SELECT sl.id, sl.price_cents, sl.url, sl.store_id
        FROM store_listings sl
        WHERE sl.product_id = pa.product_id
          AND sl.in_stock = true
        ORDER BY sl.price_cents ASC
        LIMIT 1
      ) best ON TRUE
      JOIN stores s ON s.id = best.store_id
      WHERE pa.active = true
        AND pa.verified = true
        AND (pa.last_triggered_at IS NULL
             OR pa.last_triggered_at < now() - make_interval(hours => ${ALERT_COOLDOWN_HOURS}))
        AND best.price_cents <= pa.target_price_cents
      ORDER BY best.price_cents ASC
    `);
    rows = Array.from(executed as unknown as AlertRow[]);
  } catch (error) {
    log(`  ⚠️  No se pudieron evaluar las alertas: ${(error as Error).message}`);
    return result;
  }

  result.checked = rows.length;
  if (rows.length === 0) {
    log("🔔 Alertas: 0 alertas cumplidas (nada que despachar)");
    return result;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const delivered: string[] = [];

  for (const alert of rows) {
    result.triggered += 1;
    const price = formatUsd(alert.price_cents);
    const target = formatUsd(alert.target_price_cents);
    const link = alertLink(alert.listing_id);

    if (apiKey) {
      const sent = await sendWithResend(alert, apiKey);
      if (sent) {
        result.emailed += 1;
        delivered.push(alert.alert_id);
        log(
          `  📧 [ALERTA ENVIADA] ${alert.product_name} · ${price} en ${alert.store_slug} → ${alert.email}`
        );
      } else {
        result.failed += 1;
      }
      continue;
    }

    // Desarrollo / sin proveedor de correo: log estructurado y auditable.
    delivered.push(alert.alert_id);
    log(
      `  🔔 [ALERTA DISPARADA] producto="${alert.product_name}" precio=${price} objetivo=${target} tienda=${alert.store_slug} email=${alert.email} link=${link}`
    );
  }

  if (delivered.length > 0) {
    try {
      await db
        .update(priceAlerts)
        .set({ lastTriggeredAt: new Date() })
        .where(inArray(priceAlerts.id, delivered));
    } catch (error) {
      log(`  ⚠️  No se pudo actualizar last_triggered_at: ${(error as Error).message}`);
    }
  }

  log(
    `🔔 Alertas: ${result.triggered} cumplidas · ${result.emailed} enviadas por correo${
      apiKey ? "" : " (sin RESEND_API_KEY: log estructurado)"
    }${result.failed > 0 ? ` · ${result.failed} con error` : ""}`
  );

  return result;
}

if (import.meta.main) {
  try {
    await evaluateAndDispatchPriceAlerts();
  } finally {
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  }
}
