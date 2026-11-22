-- Run this migration on Neon / Supabase PostgreSQL to activate pgvector HNSW semantic search
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS products_embedding_hnsw_idx
  ON products
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
