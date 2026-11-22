// ============================================================================
// Barrel del catálogo — ningún import externo se rompe:
//   import { searchProducts, getProductBySlug, ... } from "./services/catalog"
// ============================================================================
export * from "./catalog/shared";
export * from "./catalog/search";
export * from "./catalog/similar";
export * from "./catalog/ai-tools";
export * from "./catalog/insights";
export * from "./catalog/guides";
