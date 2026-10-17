# SCIOP Connect — Lovable source

This folder contains the React/TanStack Start source exported from the existing Lovable SCIOP Connect project.

## Local development

Requirements: Bun compatible with `bun.lock`, Node.js 22+.

```sh
cp .env.example .env
# Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, and their VITE_ equivalents.
bun install --frozen-lockfile
bun run dev
```

## Scripts

- `bun run dev` — local development server
- `bun run build` — production build
- `bun run test` — Vitest test suite
- `bun run lint` — ESLint

## Backend requirements

The app expects a Supabase project matching `src/integrations/supabase/types.ts`. A Drizzle migration is included under `drizzle/migrations/`; validate it against a disposable database before applying it to any real project. OAuth providers, storage, RLS, password recovery and staff roles require configuration in the target Supabase project.

This is a manual source import; native Lovable GitHub sync is not connected. The source `.env` is excluded. See the root `MIGRATION_STATUS.md` for remaining verification notes.
