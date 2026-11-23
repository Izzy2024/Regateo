import type { PanamaStoreConfig } from "@regateo/shared";
import type { StoreAdapter } from "../types";
import { createDoitCenterAdapter } from "./doitcenter";
import { createEvisionStoreAdapter } from "./evisionstore";
import { createFirecrawlStoreAdapter } from "./firecrawl-store";
import { createLgShopAdapter } from "./lgshoppa";
import { createPanafotoAdapter } from "./panafoto";
import { createPlayntradeAdapter } from "./pntpanama";
import { createPtytecAdapter } from "./ptytec";
import { createRaencoAdapter } from "./raenco";
import { createSamsungAdapter } from "./samsungpa";
import { createShopifyAdapter } from "./shopify";
import { createSonyStoreAdapter } from "./sonypa";
import { createYoytecAdapter } from "./yoytec";

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
    evisionstore: () => createEvisionStoreAdapter(store),
    raenco: () => createRaencoAdapter(store),
    pntpanama: () => createPlayntradeAdapter(store),
    samsungpa: () => createSamsungAdapter(store),
    lgshoppa: () => createLgShopAdapter(store),
    sonypa: () => createSonyStoreAdapter(store),
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
  createDoitCenterAdapter,
  createEvisionStoreAdapter,
  createFirecrawlStoreAdapter,
  createLgShopAdapter,
  createPanafotoAdapter,
  createPlayntradeAdapter,
  createPtytecAdapter,
  createRaencoAdapter,
  createSamsungAdapter,
  createShopifyAdapter,
  createSonyStoreAdapter,
  createYoytecAdapter,
};
