# Contribuir a RegateoApp

## Requisitos Locales
- Bun >= 1.2
- PostgreSQL 15+ (o una instancia Neon / Supabase)
- Firecrawl CLI autenticado o `FIRECRAWL_API_KEY` (opcional `FIRECRAWL_API_URL` para instancia local/self-hosted)

## Flujo de Trabajo
1. Mantener todos los esquemas de validación compartidos en `packages/shared`.
2. Cualquier cambio de esquema en `packages/db/src/schema.ts` debe incluir índices en claves foráneas y columnas de filtro frecuente.
3. Todas las rutas de API en `apps/api` deben encadenarse para preservar la inferencia de tipos de Hono RPC (`AppType`).
4. Ejecutar `bun run typecheck` y `bun run build` antes de abrir un Pull Request.
