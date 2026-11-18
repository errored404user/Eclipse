# Eclipse Community deployment

This repository contains the Eclipse Community server, but it does **not** deploy a public service by itself. Treat Community as a production authentication and moderation system: deploy it only after the required hosting, database, SMTP, security, privacy, and moderation work is in place.

## What the service provides

- Separate Eclipse email/password accounts with a unique case-insensitive Eclipse username.
- Password hashing with Node `scrypt`; passwords are never sent to Roblox or stored in plaintext.
- Email verification before a user can search for a username, send or accept a message request, or use chat.
- Random opaque 30-day sessions. Only HMAC hashes are stored in PostgreSQL. Browser sessions are sent in `HttpOnly`, `SameSite=Lax`, `Secure` (HTTPS) cookies; Electron uses its main-process bridge and does not place its session token in renderer storage.
- Username lookup, outgoing/incoming message requests, private text messages, and official Roblox place invites only after the recipient accepts.
- Block and report endpoints plus persistent moderation-event/audit records.
- Per-process registration, verification, login, lookup, and message throttles as a baseline. Use edge/rate-limit controls as well in a multi-instance deployment.
- A strict 1,500-character message limit and a 16 KiB JSON-body limit.

The service intentionally has **no media upload endpoint**. `mediaUploads` reports `false` and the UI presents text chat only. Do not add image, GIF, or file uploads until there is object storage, content-type/signature validation, malware scanning, abuse handling, retention policy, signed-download controls, and a moderation workflow.

Community is never a Roblox login system. Do not collect, proxy, transform, infer, or associate Roblox credentials with Eclipse Community accounts.

## Message-request chat flow

The browser deployment exposes the following same-origin Community routes under `/api/community`; Electron uses the same contract through its main-process bridge:

1. `GET /chats` lists accepted private chats plus incoming and outgoing message requests.
2. `POST /message-requests` with `{ "username" }` sends a request to a verified Eclipse username.
3. `POST /message-requests/:id/accept` or `/decline` records the recipient's choice. Acceptance opens the private chat for both accounts.
4. `GET /conversations?contact=<username>` and `POST /conversations` with `{ "contact", "body" }` read and send text-only chat messages after acceptance.
5. `POST /place-invites` with `{ "contact", "placeId" }` sends an official Roblox place invite only in an accepted private chat.

Legacy `/friends`, `/friend-requests`, and `/messages` Community routes are not provided. The persistent storage table currently retains a compatibility name, documented below, but it stores message-request records.

## Required environment

Start with [`.env.example`](.env.example). All of these values are required before Community enables itself:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string with a dedicated least-privileged application role. |
| `COMMUNITY_SESSION_SECRET` | Secret of at least 32 characters from a secure secret manager. Rotate with an intentional session invalidation plan. |
| `COMMUNITY_SMTP_URL` | Transactional SMTP URL. The process checks the SMTP connection at startup. |
| `COMMUNITY_EMAIL_FROM` | Sender address authorized by the SMTP provider. |
| `COMMUNITY_PUBLIC_URL` | Exact public HTTPS origin, such as `https://community.example.com`. Used in verification links and origin checks. |

`COMMUNITY_DATABASE_SSL` defaults to verified TLS. Set it to `false` only for a local development database with an intentional private network boundary. `COMMUNITY_TRUST_PROXY=true` is appropriate only if the immediate proxy overwrites incoming `X-Forwarded-For`; otherwise leave it false so request throttling uses the peer IP.

For local development only, `NODE_ENV=development` permits a `http://localhost` public URL. Production rejects non-HTTPS public URLs.

## Deploy to Vercel

The repository is Vercel-ready: `api/index.js` creates the same Eclipse HTTP application used by `server.js`, and `vercel.json` rewrites every request to it. This keeps the browser interface and `/api/community` same-origin; do not add permissive CORS settings.

1. Import this repository into a Vercel Node.js project or deploy it with the Vercel CLI.
2. Provision PostgreSQL and transactional SMTP outside Vercel (or connect approved managed services). Vercel does not safely invent these credentials for a production account system.
3. In **Project Settings → Environment Variables**, add every required value from the table above to the **Production** environment. Set `COMMUNITY_PUBLIC_URL` to the final Vercel/custom `https://` domain. Keep `COMMUNITY_TRUST_PROXY=false` unless a separately managed, immediate trusted proxy overwrites `X-Forwarded-For`.
4. Redeploy after setting the variables. The first invocation runs idempotent schema setup, cleanup, and SMTP verification. Community stays unavailable if any of those steps fails.
5. Verify registration email delivery, verification-link origin, session cookies, message-request acceptance, block/report audit records, and database backup/restore procedures before inviting users.

A serverless function can be cold-started and process-local throttles are not shared among instances. Configure edge rate limiting, monitoring, alerting, abuse controls, and a managed PostgreSQL connection limit appropriate for your Vercel plan. Do not treat a successful build as proof that Community is enabled.

## Run and containerize

```bash
npm ci
set -a && . ./.env && set +a
npm start
```

The service binds `0.0.0.0` on `PORT` (default `4173`). It initializes its PostgreSQL schema and deletes expired sessions and verification tokens on startup.

A minimal container build is included:

```bash
docker build -t eclipse-community .
docker run --rm --env-file .env -p 4173:4173 eclipse-community
```

Use your platform's encrypted secret store rather than distributing `.env` to operators. Place the container behind an HTTPS reverse proxy or managed HTTPS endpoint. The proxy must preserve the original host for normal application routing, terminate TLS, and restrict direct access to the application port. Do not add permissive CORS rules: the browser Community UI is same-origin by design.

## Database operations

Schema creation and indexes are idempotent at startup. Before a version upgrade, take a tested PostgreSQL backup. The Community tables are prefixed `eclipse_community_` and include users, sessions, verification tokens, message-request records, blocks, messages, and moderation events. The current compatibility table name retains `friend_requests`; it stores message-request records and should not drive product terminology.

Use a dedicated database role with rights limited to this database/schema. Enable encrypted backups, define a retention period for account and moderation records, and document a lawful/valid process for user deletion and data export requests before public launch. Test restoring a backup—not merely creating one.

## Public-launch checklist

- [ ] HTTPS is active for `COMMUNITY_PUBLIC_URL`; HTTP redirects and HSTS are configured at the edge.
- [ ] A real PostgreSQL backup, restoration exercise, monitoring, and alerting are in place.
- [ ] SMTP delivery, SPF/DKIM/DMARC, sender reputation, and verification-link delivery have been tested.
- [ ] Environment secrets are held in a secret manager and unavailable to logs, source control, and browser code.
- [ ] Reverse-proxy forwarding is configured safely; `COMMUNITY_TRUST_PROXY` is enabled only when appropriate.
- [ ] Edge throttling, bot/abuse monitoring, incident response, and alerting exist in addition to the process-local limits.
- [ ] A moderator has access to protected moderation-event records and documented response procedures for blocks/reports.
- [ ] Privacy notice, terms, retention policy, age/consent requirements, account recovery, and regional legal obligations have been reviewed by the operator.
- [ ] Penetration/security review covers authentication, session expiry, proxy configuration, dependency updates, logging, and abuse paths.
- [ ] Media uploads remain disabled until the separate hardened upload design is complete.

## Desktop configuration

The browser deployment calls `/api/community` on the same origin. The Electron package does not run a production database service locally. Launch it with an HTTPS Community origin:

```bash
ECLIPSE_COMMUNITY_API_URL=https://community.example.com npm run desktop:dev
```

The Electron main process makes the requests through an allowlisted bridge. If this variable is missing or is not HTTPS, Community shows an explicit unavailable state rather than pretending a local draft is online.
