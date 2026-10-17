# SCIOP — SCI Open Innovation Platform

SCIOP is the open innovation and collaboration platform from SPACE CRAFTER INFRASTRUCTURE PVT LTD. It is designed to connect people, skills, ideas, projects, communities, opportunities and cross-domain collaboration.

## Repository layout

- `lovable-app/` — migrated React 19, TanStack Start/Router, TypeScript, Tailwind CSS and Supabase source from the existing Lovable **SCIOP Connect** project.
- `server/` — separate Node API/PostgreSQL prototype; it remains separate from the Lovable/Supabase backend.
- `index.html` and `app.html` — the earlier standalone static prototype retained as a fallback during migration.

## Run the migrated app

Requirements: Node.js 22+ and Bun compatible with the committed `bun.lock`.

```sh
cd lovable-app
cp .env.example .env
# Fill the Supabase URL and publishable key for your own Supabase project.
bun install --frozen-lockfile
bun run dev
```

Run validation with `bun run build`, `bun run test`, and `bun run lint`.

## Environment and security

- `lovable-app/.env.example` documents required variables. The actual `.env` was intentionally excluded from Git.
- Use only a Supabase publishable key in browser configuration. Never commit service-role keys, database passwords, signing secrets or private API keys.
- Before production, verify the database migration, Row Level Security policies, OAuth providers, storage policies, email/password recovery and staff-role provisioning against the intended Supabase project.

## Migration notes

Text/source files from Lovable are copied into `lovable-app/`. The original JPEG asset could not be retrieved as lossless binary through the available source connector. A vector artwork embedded in its image metadata is included as `src/assets/innovation-lab.svg`, and the affected imports now use it. Replace that fallback with the original JPEG if exact asset fidelity is required.

The Lovable native GitHub sync has not been connected; this is a manual source migration. Lovable's AI agent also reported that the workspace is out of credits, so further agent-side edits could not run.

## Delivery status

GitHub source migration is in place. Build/test status, live Supabase connectivity, end-to-end behavior and production deployment still require successful validation. A GitHub push alone does not publish the app.
