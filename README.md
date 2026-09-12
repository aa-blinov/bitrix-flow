# Bitrix24 Kanban

Asana-like project and task workspace for Bitrix24. The application uses Bitrix24 OAuth,
keeps a task mirror in MongoDB, and receives verified task events for background updates.

## Local setup

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Fill every required value in `.env.local`. This file is deliberately ignored by Git; never
paste tokens, passwords, Mongo connection strings, or production URLs into issues or commits.

For production, configure a public **HTTPS** address in `BITRIX24_APP_URL` and
`BITRIX24_REDIRECT_URI`. Bitrix24 must be able to reach `/api/b24/handler` to deliver events.

## Commands

```bash
npm run lint          # ESLint and Next.js rules
npm run format:check  # Prettier validation
npm run format        # Apply Prettier
npm test              # Unit tests
npm run build         # Production build and TypeScript validation
```

GitHub Actions runs all four checks on pull requests and on pushes to `main`.

## Production

```bash
docker compose --env-file .env.local up -d --build
```

MongoDB has no host port mapping and is only available within the Compose network. Keep
`.env.local` mode `0600` on the host. The app session cookie is `HttpOnly`; server-side session
records are hashed and stored in MongoDB, so logging out revokes the current device session.

## Before publishing to GitHub

1. Run `git status --ignored` and verify that `.env.local`, `.next`, and `node_modules` are ignored.
2. Run the commands in **Commands**.
3. Add a remote and push only after reviewing `git diff --cached`.
4. Put deployment values in GitHub/hosting secrets, never in repository variables or workflow files.

### Health and monitoring

`GET /api/health` answers without a session and pings MongoDB, so `docker compose ps` shows
`healthy` only while the app can actually reach the database. Compose restarts the service when
three checks in a row fail.

### Proxy hardening

Caddy adds HSTS, `nosniff`, `Referrer-Policy` and a `frame-ancestors` policy that allows
embedding only into the app's own origin and Bitrix24 portals. Adjust the list in
`caddy/Caddyfile` if the app has to run inside another host.

### UI checks

The interface is audited with axe-core (WCAG 2.1 A/AA plus best practice) on both a 390px and
a 1440px viewport, in light and dark themes. Keep it at zero violations: controls need an
accessible name, dialogs need a title, and body text must stay at 4.5:1 contrast.
