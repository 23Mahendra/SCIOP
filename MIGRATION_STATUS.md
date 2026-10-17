# SCIOP migration and verification status

## Source migration

- Migrated the text/source files from the existing Lovable project into `lovable-app/`.
- Included the Lovable project metadata, favicon, package manifest and Bun lockfile.
- Excluded `.env` so credentials are not copied into Git.
- Added `.env.example` with blank environment values.
- The original `src/assets/innovation-lab.jpg` could not be retrieved losslessly through the available Lovable source-file connector. The SVG artwork embedded in the JPEG metadata has been preserved as `src/assets/innovation-lab.svg`, and the two source imports now point to it. Replace with the original JPEG if exact fidelity is required.
- The earlier root `app.html` prototype remains in place as a fallback.

## Application wiring added

- Root-level session provider.
- Home route wired to the existing SCIOP feed and shell components.
- Typed routes for discovery, people, opportunities, projects, ideas, communities, messages, notifications, profile, settings, saved items, admin review, authentication, and detail pages.
- Profile editing, connection requests, notification read state, messaging against existing conversations, and staff report review are wired to Supabase calls in the migrated source.

## Verification still required

- GitHub Actions runs currently terminate before reporting any job steps or logs. This prevents confirmation of the configured CI build/test/lint jobs from the current GitHub runner environment.
- The Lovable AI agent is unavailable because the workspace reports zero credits.
- No successful production build, live Supabase connection, full end-to-end test, or deployment has been confirmed.
- Before real users: verify Supabase migrations, RLS, OAuth, storage policies, staff-role provisioning, and all database actions in a test project.
