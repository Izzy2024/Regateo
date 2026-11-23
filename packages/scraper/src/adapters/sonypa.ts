import type { PanamaStoreConfig } from "@regateo/shared";
import type { StoreAdapter } from "../types";
import { createVtexStoreAdapter } from "./lgshoppa";

/**
 * Sony Store Panamá (`https://store.sony.com.pa`) — VTEX storefront.
 *
 * Exposes the same public VTEX Catalog Search API (`/api/catalog_system/pub/products/search`)
 * with ~384 official Sony Panamá products (BRAVIA TVs, PlayStation 5, WH/WF audio,
 * Alpha cameras, lenses and speakers) and verified HTTP 200 `/<slug>/p` URLs.
 */
export function createSonyStoreAdapter(store: PanamaStoreConfig): StoreAdapter {
  return createVtexStoreAdapter(store, {
    defaultBrand: "Sony",
    appendModelToTitle: true,
  });
}
