# BitrixFlow

A task and project workspace on top of a Bitrix24 portal. It signs in through
the portal's OAuth, keeps a mirror of the tasks in MongoDB, and shows them as
a board, a table and a weekly workload calendar, so a project lead can see the
overdue work and the planned hours against the actual ones across every
project at once.

![The home screen of BitrixFlow](docs/screenshots/home.png)

[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![CI](https://github.com/aa-blinov/bitrix-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/aa-blinov/bitrix-flow/actions/workflows/ci.yml)

---

## Quick start

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Node 20 and npm. Fill in `.env.local` before the first run: the Bitrix24
client id and secret, the public address of the app, the Mongo connection,
the login password and the session secret. The file is in `.gitignore`, and
no token, password or connection string belongs in an issue or in a commit.

| Target | Command | What it needs |
| --- | --- | --- |
| Local development | `npm run dev` | Node 20 and a reachable MongoDB |
| Production | `docker compose --env-file .env.local up -d --build` | Docker and the same `.env.local` |

The production stack is three Compose services on the fixed subnet
`172.32.10.0/24`: the app on port 3000, Caddy in front of it for TLS and the
security headers, and MongoDB 7 with no port published to the host.

## What it does

- **One login for one portal.** The application enters through the Bitrix24
  OAuth flow, and the session cookie is the only key to the data. A shared
  account from the environment guards the application itself.
- **A board per project.** The columns are the stages of that project in the
  portal, each column paginated on its own. A task moves by the status
  buttons in the card or by drag and drop in the table.
- **A table across every project.** The grid filters, sorts and groups inside
  MongoDB, so the counters in the group headers cover the whole task set and
  not the page on screen.
- **A weekly workload calendar.** A row per assignee, a cell per day, with
  separate blocks for the overdue tasks and for the tasks without a deadline.
- **Planned hours against actual hours.** The project summary adds up the
  estimates and the time log, keeps the parent tasks out of the sum so a
  task is counted once, and shows the difference.
- **A card that holds the whole task.** Description, tags, subtasks,
  checklist, time log, comments, results and attachments, read from the portal
  and written back to it.
- **A feed of what changed.** A new task, a comment, a status change and a
  deletion arrive as portal events and land in a notifications feed that
  filters by project and by event type.
- **Tags out of the text.** A `#hashtag` in a title or in a description
  becomes a tag, next to the portal's own tags, and either kind can be
  filtered on.
- **Live without a reload.** A server-sent event stream tells the open tabs
  that the data moved, and the interface says when the connection is down.

## Screenshots

| Home | Project board |
| :---: | :---: |
| ![Home](docs/screenshots/home.png) | ![Project board](docs/screenshots/kanban.png) |

| Task card | Team workload |
| :---: | :---: |
| ![Task card](docs/screenshots/task-modal.png) | ![Team workload](docs/screenshots/workload.png) |

| Project summary | Notifications |
| :---: | :---: |
| ![Project summary](docs/screenshots/projects-summary.png) | ![Notifications](docs/screenshots/notifications.png) |

![Search](docs/screenshots/search.png)

Every picture was taken against the fixed data set of the UI tests
(`MOCK_B24=1`), not against a live portal. The names, the projects and the
tasks are made up.

## How it works

```
browser -> Next.js route handlers -> MongoDB mirror
                |                          ^
                v                          |
                +-> Bitrix24 REST <- background sync and portal events
```

The browser never talks to the portal. Every call goes through a route
handler under `src/app/api`, and the handler holds the OAuth token.

`/api/bitrix/[...path]` is the REST proxy. It accepts only the methods the
interface uses, so a stolen session cannot open the whole REST surface of the
portal. A read is cached for 30 seconds, the stages of a project for five
minutes, and the comments and the time log of a task for a minute. A mutation
always goes straight to the portal and clears the cache of that member.

The mirror lives in the `task_mirror` collection. `/api/tasks/all` filters,
sorts, groups and paginates inside MongoDB with one aggregation, so the
browser receives a page and the counters cover the whole set. The background
sync in `src/lib/background-sync.ts` asks the portal every 60 seconds for the
tasks changed since the last pass, with a two-minute overlap at the boundary,
and reconciles the full list every ten minutes to drop the tasks that were
deleted while the server was down.

The events of the portal arrive at `/api/b24/handler`. The handler compares
the `application_token` in constant time, writes a notification, pushes an
event into the stream, marks the project summary stale and queues a sync for
that one task. The portal gets its acknowledgement at once, and the mirror is
corrected afterwards.

`/api/events` is the server-sent event stream: one connection per member, a
poll of MongoDB every second and a heartbeat every 30 seconds. The browser
keeps a single `EventSource` per member and shares it between the components
that listen.

The OAuth tokens live in MongoDB and are refreshed a minute before they
expire. The session cookie carries an HMAC-SHA256 signature, and the hash of
the session id is stored in MongoDB as well, so a logout revokes the cookie
at once. The `member_id` is resolved from the session and never from a header
or from a query parameter.

## Configuration

Every setting is an environment variable, and `.env.example` lists them all.

| Variable | Default | What it does |
| --- | --- | --- |
| `BITRIX24_CLIENT_ID` | none | The id of the Bitrix24 application. |
| `BITRIX24_CLIENT_SECRET` | none | The secret of that application. |
| `BITRIX24_APP_URL` | `http://localhost:3000` | The public address of the app. The portal calls back on it. |
| `BITRIX24_REDIRECT_URI` | `http://localhost:3000/api/oauth` | Where the portal returns after the OAuth exchange. |
| `MONGO_URL` | `mongodb://localhost:27017` | The MongoDB connection string. |
| `MONGO_DB` | `bitrix_kanban` | The name of the database. |
| `MONGO_USERNAME` | `bitrix_app` | The user the app writes with. |
| `MONGO_PASSWORD` | none | The password of that user. |
| `DUCKDNS_TOKEN` | none | The token for the TLS challenge of the DuckDNS domain. |
| `AUTH_USERNAME` | `admin` | The login for the app itself. |
| `AUTH_PASSWORD` | none | The password of that login. |
| `AUTH_SESSION_SECRET` | none | The key that signs the session cookie. |
| `SENTRY_DSN` | none | Where the errors go. Without it nothing is sent. |
| `SENTRY_AUTH_TOKEN` | none | Needed only to upload the source maps at build time. |

Compose asks for two more of its own: `MONGO_APP_USERNAME` and
`MONGO_APP_PASSWORD` belong to the application user in MongoDB, and both are
required.

Two values are read at the build rather than at the runtime:
`NEXT_PUBLIC_SENTRY_DSN` is compiled into the browser bundle, and
`APP_RELEASE` marks the events with the commit they came from.

`MOCK_B24=1` replaces the portal with the fixed data set in
`src/lib/mock-b24.ts`. The UI tests run against it, and it is off everywhere
else.

## Development

```bash
npm ci              # install
npm run dev         # the app on http://localhost:3000
npm test            # the unit tests
npm run test:ui     # the Playwright screenshot tests
npm run build       # the production build
npm run lint        # ESLint
npm run format      # Prettier, writes the files
```

CI runs `npm run format:check`, `npm run lint`, `npm test` and `npm run build`
on Node 20, in that order, for every pull request and every push to `main`.
A second job runs the UI tests in the Playwright image, against a MongoDB 7
service and the seeded test database.

`npm test` is Vitest over the files `src/**/*.test.ts`: the vocabulary of the
filters, the signature of the session, the parsing of the tags, the choice of
an address for the portal, the tree of the tasks, the sort of the board.
`npm run test:ui` is Playwright: nine screens at a desktop and at a phone
viewport, compared against the reference images in `tests/`, plus nine flows
that open a card, change a tag, move a task and filter a list.

The reference images were taken in the Playwright container. A local Chrome
draws the fonts slightly differently and the comparison fails without a single
change in the code, so run the tests through the script:

```bash
./scripts/ui-tests-docker.sh                     # the same run as CI
./scripts/ui-tests-docker.sh --update-snapshots  # refresh the references
```

| Path | What it holds |
| --- | --- |
| `src/app/api/` | The route handlers: the REST proxy, the OAuth flow, the event handler, the queries over the mirror. |
| `src/lib/bitrix24.ts` | The calls to the portal and the cache in front of them. |
| `src/lib/bitrix-request.ts` | The HTTP layer: IPv4, the timeouts, the choice of an address. |
| `src/lib/mongo.ts` | The connection, the indexes and the two background workers. |
| `src/lib/task-mirror.ts` | The mirror of the tasks and the queue of the syncs. |
| `src/lib/background-sync.ts` | The poller that asks the portal for the changes. |
| `src/store/kanban.ts` | The Zustand store: the projects, the tasks, the filters, the actions. |
| `src/components/` | The interface. `src/components/ui/` holds the shadcn primitives. |
| `tests/` | The Playwright tests and the reference images. |
| `scripts/` | The backups, the health check, the seed of the test database. |

## License

MIT, © Alexander Blinov. See [LICENSE](LICENSE).
