import { CATEGORY_LABELS, type ProductCategory } from "@regateo/shared";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdWholeFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatUsd(cents: number): string {
  if (!Number.isFinite(cents)) return "$0.00";
  return usdFormatter.format(cents / 100);
}

export function formatUsdWhole(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  return usdWholeFormatter.format(Math.round(cents / 100));
}

export function formatRelativeEs(isoDate: string | null | undefined): string {
  if (!isoDate) return "Sin registro";
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "Reciente";

  const diffMs = Date.now() - parsed.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Hace instantes";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr} ${diffHr === 1 ? "hora" : "horas"}`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Ayer";
  if (diffDay < 7) return `Hace ${diffDay} días`;

  return parsed.toLocaleDateString("es-PA", {
    day: "numeric",
    month: "short",
    year: diffDay > 300 ? "numeric" : undefined,
  });
}

export function formatShortDateEs(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("es-PA", {
    day: "numeric",
    month: "short",
  });
}

export function formatDateTimeEs(isoDate: string | null | undefined): string {
  if (!isoDate) return "Pendiente";
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "Pendiente";
  return parsed.toLocaleString("es-PA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SHORT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  computadoras: "Computadoras",
  celulares: "Celulares",
  televisores: "Televisores",
  "linea-blanca": "Línea Blanca",
  audio: "Audio",
  perifericos: "Periféricos",
  gaming: "Gaming",
  "aires-acondicionados": "Aires",
  electrodomesticos: "Hogar",
  accesorios: "Accesorios",
};

export function getCategoryLabel(category: ProductCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function getCategoryShortLabel(category: ProductCategory): string {
  return SHORT_CATEGORY_LABELS[category] ?? CATEGORY_LABELS[category] ?? category;
}

export function sanitizeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function getDomainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
