-- Run on local PostgreSQL, Neon, or Supabase for <5ms ILIKE search at 20,000+ products
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_canonical_name_trgm_idx
  ON products USING gin (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_slug_trgm_idx
  ON products USING gin (slug gin_trgm_ops);

CREATE INDEX IF NOT EXISTS store_listings_title_trgm_idx
  ON store_listings USING gin (title_at_store gin_trgm_ops);

CREATE INDEX IF NOT EXISTS store_listings_external_id_idx
  ON store_listings (external_id);
