import type { PanamaStoreConfig } from "@regateo/shared";
import { createDoitCenterAdapter } from "./doitcenter";
import { createFirecrawlStoreAdapter } from "./firecrawl-store";
import { createPanafotoAdapter } from "./panafoto";
import { createPtytecAdapter } from "./ptytec";
import { createShopifyAdapter } from "./shopify";
import { createYoytecAdapter } from "./yoytec";
import type { StoreAdapter } from "../types";

/**
 * Adapter registry. Adding a new Panamanian store means adding it to
 * `PANAMA_STORES` (`@regateo/shared`) and returning the right adapter here.
 */
export function createStoreAdapter(store: PanamaStoreConfig): StoreAdapter {
  const bySlug: Record<string, () => StoreAdapter> = {
    multimax: () => createShopifyAdapter(store),
    rodelag: () => createShopifyAdapter(store),
    titan: () => createShopifyAdapter(store),
    photura: () => createShopifyAdapter(store),
    panafoto: () => createPanafotoAdapter(store),
    doitcenter: () => createDoitCenterAdapter(store),
    yoytec: () => createYoytecAdapter(store),
    ptytec: () => createPtytecAdapter(store),
  };

  const factory = bySlug[store.slug];
  if (factory) return factory();

  switch (store.platform) {
    case "shopify":
      return createShopifyAdapter(store);
    case "magento":
      return createPanafotoAdapter(store);
    default:
      return createFirecrawlStoreAdapter(store);
  }
}

export {
  createShopifyAdapter,
  createPanafotoAdapter,
  createFirecrawlStoreAdapter,
  createDoitCenterAdapter,
  createYoytecAdapter,
  createPtytecAdapter,
};
