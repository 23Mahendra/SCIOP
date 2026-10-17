# SCIOP — SCI Open Innovation Platform

SCIOP connects people, skills, ideas, projects, requirements and opportunities across domains.

## Architecture
- `app.html`: responsive UI and routed workflows
- `server/server.js`: Express API, validation, session cookies and PostgreSQL access
- `server/schema.sql`: relational schema and starter domains, skills, communities

## Implemented API workflows
Signup/login/logout/session restoration; editable profiles; discovery and matching; feed, posts, reactions, comments, saved items and reports; follows/connections; opportunity posts and applications; projects and collaboration requests; ideas; communities; direct messages for accepted connections; notifications; verification requests; moderator/admin dashboard.

## Run the app
Requires Node.js 20+ and PostgreSQL.

Set `DATABASE_URL`, `JWT_SECRET` (32+ random characters in production), `NODE_ENV=production`, and optionally `APP_ORIGIN`. Set `SCIOP_ADMIN_EMAIL` before the owner's first signup if that email should receive the initial admin role. Install dependencies with `npm install`, then run `npm start`. The API initializes `server/schema.sql` at startup. Test `/api/health`.

## Deployment requirements
Use a persistent PostgreSQL instance, TLS, backups and private environment variables. The repository has not yet been deployed or end-to-end tested in a live environment.

## Known gaps
Password reset needs email delivery and a secure reset-token flow. Media uploading, live websocket messaging/notifications, poll voting, events, group chat and external AI integrations are future work. Before public launch, test all authenticated routes, authorization rules and database changes with a production-style environment. Do not put confidential documents in public URLs.
