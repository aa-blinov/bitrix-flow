# AGENTS.md — agent context for `bitrix-flow`

BitrixFlow is a Next.js application that puts a board, a table and a workload
calendar over the tasks of one Bitrix24 portal. It mirrors the tasks of the
portal into MongoDB and writes every change back to the portal, so the portal
stays the source of truth.

This file is what you need to work on the project without reading all of it.

## Run / build / test

```bash
npm ci              # install
npm run dev         # the app on http://localhost:3000
npm test            # vitest, the files src/**/*.test.ts
npm run test:ui     # playwright, needs a MongoDB on 127.0.0.1:27018
npm run build       # next build
npm run lint        # eslint
npm run format      # prettier --write
```

Node 20. CI runs `npm run format:check`, `npm run lint`, `npm test` and
`npm run build` in that order, and a second job runs the Playwright tests
inside `mcr.microsoft.com/playwright:v1.63.0-noble` against a MongoDB 7
service.

The UI tests want their own database, `bitrix_kanban_test` on port 27018.
`npm run test:ui:db` starts it with Compose, and `./scripts/ui-tests-docker.sh`
runs the whole thing in the image CI uses.

## Where things live

| Path | What it is |
| --- | --- |
| `src/app/api/` | Every route handler: the REST proxy, the OAuth flow, the event handler of the portal, the queries over the mirror. |
| `src/app/(dashboard)/` | The pages behind the login. |
| `src/proxy.ts` | The guard of the requests. The file is `proxy.ts`, not `middleware.ts`. |
| `src/lib/bitrix24.ts` | The calls to the portal and the cache in front of them. The same file runs in the browser and on the server. |
| `src/lib/bitrix-request.ts` | The HTTP layer: IPv4 only, the timeouts, the choice of an address. |
| `src/lib/oauth-client.ts` | The calls with the token of the user, and the refresh of that token. |
| `src/lib/mongo.ts` | The connection, the indexes, and the two workers it starts. |
| `src/lib/task-mirror.ts` | The mirror of the tasks and the queue of the syncs. |
| `src/lib/background-sync.ts` | The poller that asks the portal for the changes. |
| `src/lib/task-filters.ts` | The vocabulary of the filters, shared by the bar and by the three pages. |
| `src/store/kanban.ts` | The Zustand store. |
| `src/components/` | The interface. `src/components/ui/` holds the shadcn primitives. |
| `tests/` | The Playwright tests and the reference images. |
| `scripts/` | The backups, the health check, the seed of the test database. |
| `DESIGN.md` | The tokens, the two themes and the components. A new surface follows them. |

## Traps

- **The Next.js of this repository is not the one in your training data.** The
  block at the top of this file is written by `next dev` itself. Read the
  guide in `node_modules/next/dist/docs/` before you write code against an
  API you do not recognise.
- **The portal is reached over IPv4 only.** `src/lib/bitrix-request.ts` pins
  every call to family 4, because the portal publishes AAAA records that hang
  until the timeout and the default selection of Node then holds the
  handshake for the whole request.
- **The connect timeout is 2 seconds and the answer timeout is 30.** They are
  separate on purpose: the answer to a big list of tasks takes seconds, but a
  dead address must not hold the card open for 30.
- **Reads race three addresses, mutations never do.** A mutation sent to
  several addresses can create two tasks. `postBitrixJson` decides by the
  name of the method, and `isReadMethod` holds the list.
- **An address that fails to connect, or that answers after three seconds, is
  put aside for 30 minutes.** Without that, every third request hit the same
  dead edge of the portal.
- **A mutation is never repeated.** The proxy sends a mutation once, because
  the request may already have gone through, and a second one would create a
  duplicate task or a duplicate comment. Inside the request layer, only a
  failure to connect is repeated; a timeout of the answer stops the attempt.
- **The tags need two requests.** `tasks.task.get` returns the ordinary
  fields without a select and the tags only with one, so the code asks twice
  in parallel. A single call loses either the fields or the tags.
- **The history of the results cannot be read.** `tasks.task.result.list`
  uses a filter that the portal does not recognise, so the application writes
  results and never lists them. Do not build a screen on that call.
- **A status change is not an update.** `tasks.task.update` with a status
  bypasses the permissions and the history of the portal. The transitions go
  through `tasks.task.start`, `pause`, `defer`, `complete` and `renew`, and
  the store picks between `renew` and `pause` when a task goes back to new.
- **A deleted task has to leave both collections.** The list joins
  `task_mirror` and `tasks`, so a record left in one of them comes back as a
  ghost.
- **The background sync keys the `tasks` collection by the id of the task
  alone.** Keying it by the project as well made a second record when a task
  moved between projects.
- **`member_id` never comes from a request.** The browser sends
  `X-Member-Id`, and the server ignores it for the authorization:
  `getAuthorizedMemberId` takes the member from the session and from the
  collection of the tokens. A second portal in the same database would turn
  that header into an IDOR.
- **The application token may only be adopted within an hour of the
  installation.** An installation made before that check existed stored
  none, and adopting the token from the first event without a deadline would
  let anyone who knows the `member_id` send events as the portal.
- **The screenshots are compared pixel by pixel, in the Playwright image.** A
  local Chrome draws the fonts slightly differently and the comparison fails
  without a change in the code. Run `./scripts/ui-tests-docker.sh`.
- **The UI tests need their own database.** `bitrix_kanban_test` on port
  27018, seeded by `scripts/seed-test-db.mjs`, and the portal is mocked with
  `MOCK_B24=1`.
- **Compose pins the addresses.** The services sit on `172.32.10.0/24`,
  because the internal DNS of Docker twice a day stopped resolving the names
  of the containers, and the proxy then answered 502 with the app alive.
- **The session lives in two places.** The cookie carries the signature, and
  the hash of the id is in MongoDB. The second is what makes a logout revoke
  the cookie at once.

## Style / safety rails

- **The portal is where the truth lives.** The mirror is a mirror. A feature
  that keeps data only in the application does not belong here.
- **The interface is Russian.** The documents are English. The code, the
  comments and the commits keep the language they are in.
- **Both themes work.** Any new surface has to render in the light theme and
  in the dark theme.
- **Comments explain why, never what.** The comments in this codebase are
  unusually good on that point. Keep them that way.
- **Do not add a method to the allowlist of the REST proxy** without a use
  in the interface. The list in `src/app/api/bitrix/[...path]/route.ts` is
  the boundary of what a session can reach.
- **A mutation never goes behind a GET.** With `SameSite=Lax` a GET that
  changes data is a CSRF from any page that links to it.
- **No emoji**, in any file.

## Where the product truth lives

`PRODUCT.md` holds it. Read it before you change the behaviour, and write the
change there when the behaviour changes.
