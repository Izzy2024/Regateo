import { db, sql, sqlClient } from "@regateo/db";

/**
 * Resumen semanal de ofertas para canales (WhatsApp/Telegram) y digest de
 * favoritos por correo.
 *
 * - `buildChannelDealsMessage()`: top ofertas verificables entre 2+ tiendas con
 *   stock, listas para pegar en un canal de Panamá (enlace medido `/out/...`).
 * - `sendWeeklyFavoritesDigest()`: avisa a cada usuario cuyos favoritos bajaron
 *   de precio respecto al `saved_price_cents` con el que los guardó.
 */

export interface ChannelDeal {
  productName: string;
  bestPriceCents: number;
  storeName: string;
  savingsCents: number;
  savingsPercent: number;
  storeCount: number;
  bestListingId: string;
}

export interface ChannelDealsOptions {
  limit?: number;
  apiUrl?: string;
}

export interface WeeklyDigestOptions {
  dryRun?: boolean;
  apiUrl?: string;
}

export interface ChannelDealsMessage {
  text: string;
  dealCount: number;
}

export interface WeeklyDigestResult {
  usersEvaluated: number;
  emailsSent: number;
}

const DEFAULT_LIMIT = 5;

function apiBaseUrl(override?: string): string {
  return (override ?? process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

function formatUsd(cents: number): string {
  // Canal/email: formato compacto "$1,499.95" en lugar de "USD 1.499,95".
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)}`;
}

function percentLabel(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/**
 * Formatea las ofertas como mensaje Markdown-friendly para WhatsApp/Telegram.
 * Puro (sin BD) para poder testearlo y reutilizarlo desde la API.
 */
export function formatChannelDealsText(
  deals: ChannelDeal[],
  options: ChannelDealsOptions = {}
): string {
  const limit = Math.max(1, Math.min(20, options.limit ?? DEFAULT_LIMIT));
  const apiUrl = apiBaseUrl(options.apiUrl);
  const selected = deals.slice(0, limit);
  const date = new Intl.DateTimeFormat("es-PA", {
    dateStyle: "medium",
    timeZone: "America/Panama",
  }).format(new Date());

  const header = [
    "🔥 *Regateo · Ofertas verificadas en Panamá*",
    `📅 ${date} · precios reales de tiendas panameñas`,
    "",
  ];

  if (selected.length === 0) {
    return [
      ...header,
      "Hoy no hay ofertas con ahorro verificado entre 2+ tiendas.",
      "",
      "_Compara precios reales antes de comprar · Regateo_",
    ].join("\n");
  }

  const body: string[] = [];
  selected.forEach((deal, index) => {
    const link = `${apiUrl}/out/${deal.bestListingId}?src=whatsapp`;
    body.push(
      `${index + 1}. *${deal.productName}*`,
      `   💵 ${formatUsd(deal.bestPriceCents)} en ${deal.storeName}`,
      `   📉 Ahorras ${formatUsd(deal.savingsCents)} (${percentLabel(
        deal.savingsPercent
      )}) vs ${deal.storeCount} tiendas`,
      `   👉 ${link}`,
      ""
    );
  });

  return [
    ...header,
    ...body,
    "_Compras locales, garantía local. Compara antes de regatear · Regateo_",
  ].join("\n");
}

/**
 * Consulta las top ofertas materializadas (`savings_cents` de Fase 2) y devuelve
 * el mensaje del canal. Solo considera productos en stock en 2+ tiendas.
 */
export async function buildChannelDealsMessage(
  options: ChannelDealsOptions = {}
): Promise<ChannelDealsMessage> {
  const limit = Math.max(1, Math.min(20, options.limit ?? DEFAULT_LIMIT));

  const rows = await db.execute(sql`
    WITH best AS (
      SELECT DISTINCT ON (sl.product_id)
             sl.product_id,
             sl.id AS listing_id,
             sl.price_cents
      FROM store_listings sl
      WHERE sl.in_stock = true
      ORDER BY sl.product_id, sl.price_cents ASC, sl.id ASC
    )
    SELECT p.canonical_name,
           best.price_cents,
           best.listing_id,
           p.savings_cents,
           p.savings_percent,
           p.store_count,
           s.name AS store_name
    FROM products p
    JOIN best ON best.product_id = p.id
    JOIN store_listings sl ON sl.id = best.listing_id
    JOIN stores s ON s.id = sl.store_id
    WHERE p.savings_cents > 0
      AND p.store_count >= 2
      AND p.in_stock_count >= 2
    ORDER BY p.savings_cents DESC, p.savings_percent DESC
    LIMIT ${limit}
  `);

  const deals: ChannelDeal[] = Array.from(
    rows as unknown as Array<{
      canonical_name: string;
      price_cents: number;
      listing_id: string;
      savings_cents: number;
      savings_percent: number;
      store_count: number;
      store_name: string;
    }>
  ).map((row) => ({
    productName: row.canonical_name,
    bestPriceCents: Number(row.price_cents),
    storeName: row.store_name,
    savingsCents: Number(row.savings_cents),
    savingsPercent: Number(row.savings_percent),
    storeCount: Number(row.store_count),
    bestListingId: row.listing_id,
  }));

  return {
    text: formatChannelDealsText(deals, { limit, apiUrl: options.apiUrl }),
    dealCount: deals.length,
  };
}

interface FavoriteDropRow {
  user_id: string;
  email: string;
  name: string | null;
  product_slug: string;
  canonical_name: string;
  saved_price_cents: number;
  best_price_cents: number;
  listing_id: string;
}

interface UserDigest {
  userId: string;
  email: string;
  name: string | null;
  items: FavoriteDropRow[];
  totalSavedCents: number;
}

function buildDigestEmail(user: UserDigest, apiUrl: string): { subject: string; html: string } {
  const subject = "🔥 Tus favoritos bajaron de precio · Regateo";
  const items = user.items
    .map((item) => {
      const drop = item.saved_price_cents - item.best_price_cents;
      const link = `${apiUrl}/out/${item.listing_id}?src=digest`;
      return `<li style="margin:0 0 14px">
        <a href="${link}" style="color:#0f172a;font-weight:600;text-decoration:none">${item.canonical_name}</a><br/>
        <span style="color:#475569;font-size:14px">Antes ${formatUsd(
          item.saved_price_cents
        )} → ahora <strong>${formatUsd(item.best_price_cents)}</strong> · ahorras ${formatUsd(
          drop
        )}</span>
      </li>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
    <tr><td style="padding:28px">
      <p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#0d9488">Regateo · Resumen semanal</p>
      <h1 style="margin:0 0 8px;font-size:22px">Tus favoritos bajaron de precio</h1>
      <p style="margin:0 0 20px;color:#475569">Hola ${user.name ?? "vecino"}, tienes ${
        user.items.length
      } favorito(s) más barato(s) esta semana. Ahorro total: <strong>${formatUsd(
        user.totalSavedCents
      )}</strong>.</p>
      <ul style="margin:0 0 24px;padding-left:18px">${items}</ul>
      <p style="margin:0;font-size:12px;color:#94a3b8">Precios verificados en tiendas panameñas; pueden cambiar sin previo aviso.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}

async function sendResendEmail(
  email: string,
  subject: string,
  html: string,
  apiKey: string
): Promise<boolean> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERTS_FROM_EMAIL ?? "Regateo <alertas@regateoapp.com>",
        to: [email],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`  ⚠️  Resend ${response.status} para ${email}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`  ⚠️  Digest: no se pudo enviar a ${email}: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Digest semanal de favoritos. Con `dryRun` (o sin `RESEND_API_KEY`) imprime el
 * resumen estructurado en lugar de enviar correos.
 */
export async function sendWeeklyFavoritesDigest(
  options: WeeklyDigestOptions = {}
): Promise<WeeklyDigestResult> {
  const apiUrl = apiBaseUrl(options.apiUrl);
  const rows = await db.execute(sql`
    SELECT f.user_id,
           u.email,
           u.name,
           p.slug AS product_slug,
           p.canonical_name,
           f.saved_price_cents,
           p.best_price_cents,
           best.listing_id
    FROM user_favorites f
    JOIN "user" u ON u.id = f.user_id
    JOIN products p ON p.id = f.product_id
    JOIN LATERAL (
      SELECT sl.id AS listing_id
      FROM store_listings sl
      WHERE sl.product_id = p.id AND sl.in_stock = true
      ORDER BY sl.price_cents ASC, sl.id ASC
      LIMIT 1
    ) best ON TRUE
    WHERE p.best_price_cents IS NOT NULL
      AND p.best_price_cents > 0
      AND p.best_price_cents < f.saved_price_cents
    ORDER BY u.email, (f.saved_price_cents - p.best_price_cents) DESC
  `);

  const byUser = new Map<string, UserDigest>();
  for (const row of Array.from(rows as unknown as FavoriteDropRow[])) {
    const current = byUser.get(row.user_id) ?? {
      userId: row.user_id,
      email: row.email,
      name: row.name,
      items: [],
      totalSavedCents: 0,
    };
    current.items.push(row);
    current.totalSavedCents += Number(row.saved_price_cents) - Number(row.best_price_cents);
    byUser.set(row.user_id, current);
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const dryRun = options.dryRun === true || !apiKey;
  let emailsSent = 0;

  for (const user of byUser.values()) {
    const { subject, html } = buildDigestEmail(user, apiUrl);

    if (dryRun) {
      console.log(
        `  📬 [DIGEST RESUMEN] usuario=${user.email} favoritos_con_bajada=${user.items.length} ahorro_total=${formatUsd(
          user.totalSavedCents
        )}${apiKey ? " (dry-run)" : " (sin RESEND_API_KEY)"}`
      );
      for (const item of user.items) {
        console.log(
          `      • ${item.canonical_name} · antes ${formatUsd(
            item.saved_price_cents
          )} → ahora ${formatUsd(item.best_price_cents)} · ${apiUrl}/out/${item.listing_id}?src=digest`
        );
      }
      continue;
    }

    const sent = await sendResendEmail(user.email, subject, html, apiKey);
    if (sent) {
      emailsSent += 1;
      console.log(
        `  📧 [DIGEST ENVIADO] ${user.email} · ${user.items.length} favoritos · ahorro ${formatUsd(
          user.totalSavedCents
        )}`
      );
    }
  }

  console.log(
    `📬 Digest semanal: ${byUser.size} usuario(s) con bajadas · ${emailsSent} correo(s) enviado(s)${
      dryRun ? " · modo dry-run" : ""
    }`
  );

  return { usersEvaluated: byUser.size, emailsSent };
}

if (import.meta.main) {
  try {
    const dryRun =
      process.argv.includes("--dry-run") || !process.env.RESEND_API_KEY?.trim();
    const channel = await buildChannelDealsMessage();
    console.log(channel.text);
    await sendWeeklyFavoritesDigest({ dryRun });
  } catch (error) {
    console.error(`❌ Digest falló: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  }
}
