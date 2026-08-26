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
docker compose up -d --build
```

MongoDB has no host port mapping and is only available within the Compose network. Keep
`.env.local` mode `0600` on the host. The app session cookie is `HttpOnly`; server-side session
records are hashed and stored in MongoDB, so logging out revokes the current device session.

## Before publishing to GitHub

1. Run `git status --ignored` and verify that `.env.local`, `.next`, and `node_modules` are ignored.
2. Run the commands in **Commands**.
3. Add a remote and push only after reviewing `git diff --cached`.
4. Put deployment values in GitHub/hosting secrets, never in repository variables or workflow files.
