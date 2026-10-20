# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The application is a Next.js 16 site (React 19, App Router) with a MongoDB 7
database and a Caddy reverse proxy in front of it. The interface is in Russian
and is served from one address. There is no native application and no separate
backend service: the route handlers under `src/app/api` are the backend, and
they hold the OAuth token of the portal.

The deployment is Docker Compose with three services: the app, the proxy and
the database. The database has no port published to the host, and the app
reaches it as a user with `readWrite` on one database.

## Users

The internal team of EORA. The repository's own product record names two
groups: the project managers and the leads, who watch the summary of the
projects, the workload of the team and the deadlines, and the performers, who
work through their own tasks in "My tasks", on the board of a project and in
the card of a task.

The situation: the tasks already live in a Bitrix24 portal, and the portal's
own task pages are slow and cannot report across projects. The job is to see
what is late, what is overloaded and how the hours went, without walking
through the portal task by task.

No audience beyond that is recorded. The repository carries no description on
GitHub, no stars and no issue history to point at, and the installation
protects one portal behind one shared login.

## Product Purpose

BitrixFlow is a workspace for the projects and tasks of a Bitrix24 portal, in
the spirit of Asana. It exists because the native task interface of the
portal is slow and awkward, and because there is no report across projects
there.

Success for the user: the project managers and the leads open BitrixFlow
instead of the portal for their daily work with tasks and for the control of
the projects. Success for the product: every change lands in the portal, so
the two never disagree.

## Positioning

The same Bitrix24 and the same tasks, with a faster interface and the reports
that the portal has no screen for:

- the speed of an Asana-like interface over the native one;
- a summary by project, planned hours against actual hours and the
  operational status, and the workload of the team across the projects;
- a board, a table, groupings and saved views;
- a clear feed of the changes in the tasks, in place of the noise of the
  portal.

The mirror is the part a neighbour cannot copy as it is: it takes the tasks
of the portal, holds them in one database and calculates over the whole set,
which the portal does not do across projects.

## Operating Context

- The installation goes through the Bitrix24 OAuth flow, at `/install` or at
  `/api/oauth`, and the application binds four task events to
  `/api/b24/handler`.
- The portal has to reach that handler, so the address in `BITRIX24_APP_URL`
  is a public HTTPS address in production.
- Behind the portal there is one shared login for the application itself, and
  the session lasts eight hours.
- The sections are: Home, My tasks, All tasks, Projects (board and table),
  Project summary, Team workload, Notifications and Search.
- The interface is Russian (`lang="ru"`), with keyboard shortcuts and a quick
  create.
- The portal keeps the truth. The application keeps the mirror, the
  notifications and the reports.

## Capabilities and Constraints

Confirmed by the code:

- The Bitrix24 portal is where the truth lives. Every change goes to the
  portal, and the application keeps a mirror of the tasks in MongoDB.
- Two ways into a project: a board whose columns are the stages of the
  project, and a table that filters, sorts and groups.
- The filters cover the status, the deadline, the assignee, the creator, the
  co-assignee, the observer, the project, the stage, the tag, the priority,
  the dates of the creation and of the last change, the kind of the task, the
  overrun and the closed tasks. A field accepts several values at once, and
  the set survives a return to the screen.
- The card carries the description, the tags, the subtasks, the checklist, the
  time log, the comments, the results and the attachments.
- The summary of a project adds up the estimates and the time log, keeps the
  parent tasks out of the sum so that a task is counted once, and shows the
  difference.
- The workload calendar is a week per assignee, and its counters are computed
  over the whole mirror.
- The notifications feed holds the events of the tasks, filters by project and
  by type, and is paginated.
- The events arrive over a server-sent event stream, and the interface shows
  when the connection is down.
- The REST proxy accepts a fixed list of methods, and a mutation only goes
  through POST.
- The session is signed, stored hashed in the database, and lasts eight hours.
- The portal is reached over IPv4, with a separate timeout for the connection
  and for the answer.

Deliberately not true, and worth knowing before a change:

- There is no automatic update. An update is a rebuild of the image and a
  restart of the stack.
- The tokens of the portal are stored as they are in MongoDB. The backup is
  encrypted instead.
- The history of the task results cannot be read: the filter of that call is
  not one the portal recognises, so the application writes results and never
  lists them.
- There is no content security policy for the scripts of the page, because
  Next inlines the runtime.

Not decided, and to be answered by the owner rather than guessed:

- Whether a language other than Russian is needed.
- How much the mobile version matters.
- Which accessibility standard the interface has to meet.

## Brand Commitments

**Name:** BitrixFlow. **Tone:** plain and technical. The interface speaks in
short sentences and reports the state of the work rather than reassuring the
user.

A failure is named. A project that will not load says so, with a button to
try again, and the state of the live connection is on the screen.

The visual system lives in `DESIGN.md`: the tokens, the two themes and the
components. A new surface follows them.

## Evidence on Hand

- `README.md` describes the screens, the running, the production stack, the
  backups, the monitoring and the tests.
- `docs/screenshots/` holds the seven screens of the interface.
- `tests/` holds the Playwright tests and the reference images of nine
  screens at two viewports.
- `src/lib/` holds the behaviour that the unit tests cover: the filters, the
  session, the tags, the tree of the tasks, the choice of an address.
- `src/lib/mock-b24.ts` and `scripts/seed-test-db.mjs` hold the fixed data
  set that the screenshots and the reference images are made of.

Absent, and not to be invented: no usage numbers, no download counts, no
testimonials, no comparison with another tool, and no description on the page
of the repository. The name of the product in the manifest of the package is
still `bitrix-kanban`, and the licence file was missing from the repository.

## Product Principles

1. **Faster than the portal in every action.** If something takes longer in
   BitrixFlow than in the portal, it is a defect.
2. **The portal is the main one.** Nothing lives only here: the data always
   agrees with the portal.
3. **Control at a glance.** A project manager sees the problems, the overdue
   tasks, the overload and the difference between the plan and the fact
   without digging through the tasks.
4. **Signal, not noise.** The notifications and the counters show what has to
   be dealt with.
5. **Both themes, always.** A new surface has to work in the light theme and
   in the dark theme.

## Accessibility & Inclusion

- The interface is in Russian, and the page declares `lang="ru"`.
- The application is reachable from the keyboard: `/` opens the search, `n`
  opens the creation of a task, `g` followed by a letter moves between the
  sections, and `?` lists the shortcuts. The shortcuts stay out of the way
  while a field holds the focus.
- The layout is tested at a phone viewport as well as at 1440 by 900, and the
  navigation has a separate drawer on a small screen.
- The controls carry their accessible names, the dialogs carry a heading, and
  the interface states the outcome in words and not only in a colour.
- The accessibility standard is still open. `axe-core` is a development
  dependency, but no test of the repository runs it, so nothing checks the
  contrast or the names automatically yet.
