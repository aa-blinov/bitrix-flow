# Changelog

All notable changes to bitrix-flow. Versions are ordered newest first.

<!--
  The format is Keep a Changelog. Each entry says what changed and why it
  was worth changing.

  The traps do not go here. They go in AGENTS.md, because the changelog is
  read by the people who use the software and the traps are read by whoever
  works on the code next.
-->

## [Unreleased]

## [0.5.2] - 2026-10-26

### Fixed

- The language switch no longer sticks out of the sidebar: it sits under the theme switch.
- The filter count is spaced from the "Фильтры" label, status chips in the projects summary no longer
  run together, and the member count has a tooltip.
- Chat avatars without a picture take initials from letters only, not from separators such as "|".

## [0.5.1] - 2026-10-26

### Changed

- Tab titles follow the interface language (read from the `bitrix-flow-locale` cookie on the server).
  The weekly digest stays Russian: it goes to colleagues, not to one reader.

## [0.5.0] - 2026-10-25

### Added

- Interface in English next to Russian. The language switch is in the sidebar, the choice lives in the
  `bitrix-flow-locale` cookie. Texts sent to colleagues in Bitrix (quotes, forwards) stay Russian.
  `i18n.test.ts` fails if a `t('...')` string has no English entry.

### Fixed

- When the portal refuses every request because its disk quota is exhausted, the messenger now
  says so ("на портале закончилось место на диске") instead of a generic load error.
- `health-watch.sh` marks a poller warning as sent only after the Sentry alert really went out;
  Sentry answers 429 when its quota is spent, and the alert used to be lost for an hour.

## 0.4.0 — 2026-10-25

### Added

- The weekly digest can also go to Telegram, any https webhook (Slack, Mattermost, n8n, mail
  gateways) and by email over SMTP, each channel on its own keys and off by default; one
  failing channel does not stop the others. `POST /api/digest` sends to every enabled channel
  and reports each result.
- Messenger messages can be focused with the keyboard: the actions panel opens on focus,
  Enter or Space keep it open, Tab walks through the buttons; the viewer keeps focus inside
  and gives it back to the photo on Escape. Covered by keyboard tests, not only by axe.

### Changed

- New dependency `nodemailer` (SMTP delivery of the digest; hand-written SMTP would be worse).

## 0.3.0 — 2026-10-25

### Added

- Messenger: the dialog list loads the next page by itself on scroll instead of a button;
  chats are also searched across the whole portal; forwarding keeps files (the server
  re-uploads them, up to 20 MB each, five at most); group owners and managers can delete
  other people's messages; pdf and text files open in a new tab; plain group chats can be
  renamed, get new members, remove members and be left from a settings window.
- CSV: the task list exports every task matching the filters (up to 2000), not only the
  open page; the project summary and the team workload export too. Cells that start with
  `=`, `+`, `-` or `@` are escaped so a task title cannot run as a spreadsheet formula.
- Workload: the plan hours no longer count a parent's estimate on top of its estimated
  subtasks (the parent's own estimate is used only when no subtask has one); the task
  count in a cell is unchanged.
- A weekly digest of overdue tasks by project and person can be posted to a Bitrix chat
  (`DIGEST_DIALOG_ID`, off by default); `POST /api/digest` sends it on demand.
- Messenger: a button opens the dialog in Bitrix itself, where calls and video conferences
  live (REST cannot create them).
- Operations: `/api/health` reports stale pollers in `warnings` and `health-watch.sh` raises
  a Sentry alert for them; `scripts/deploy.sh` deploys with a health wait and rolls back to the
  previous image if the new one does not come up; accessibility checks (axe) cover the
  messenger dialog, the viewer and the chat settings in both themes.
- Presence in the messenger shows the real state: online (green), do not disturb (red),
  away or on a break (yellow), and for everyone else when they were last seen ("Был в
  сети 12 минут назад", "вчера в 18:20"). The dot is on avatars in the dialog list and the
  header, next to message authors in groups, in the mention list and when searching for
  people for a new chat.

## 0.2.0 — 2026-10-24

### Added

- Messenger (`/messenger`): personal chats, project groups, task discussions and
  other Bitrix24 chats in one list with tabs, reading, sending and read marks.
  Opens with `g` then `c`.
  Dialogs and message history page through the portal cursors ("show more",
  "show earlier").
- Messenger shows who read your message (one tick sent, two ticks read, a count in
  groups with the names on hover).
- Messages read both Bitrix tags and Markdown; attachments arrive as real images,
  audio, video and file links, bot cards render as blocks instead of "[Вложение]".
- Messenger sends files (picker or paste, up to 20 MB, caption from the input) and
  voice messages recorded in the browser.
- Photos and videos open in an in-page viewer with paging across the whole dialog,
  zoom and download instead of a new tab; other formats download with their name.
- Media in the messenger shows a skeleton with a spinner while it loads, and a
  "could not load" message with a retry button when the portal drops the file, both in
  the dialog and in the viewer.
- Messenger message actions: reply (as a quote, REST does not return reply links),
  like, forward as a quote, edit and delete your own messages, `@` mentions with a
  participant list, search inside a dialog with a jump to the found message, and a
  list of who read a group message and who did not.
- New chat with any person (portal search) and group chat creation; a "Channels" tab
  for Bitrix channels, read-only when the user may not post.
- Messenger updates in real time: the server reads the portal event queue
  (`im.v2.Event.get`) while a tab is open and pushes events through the existing SSE,
  so new messages, edits, deletions and likes appear at once; polling is only a fallback.
- Unread badge on "Messages" in the sidebar and optional browser notifications with a
  sound (a bell button in the dialog list), skipped for muted chats.
- Dialog menu: pin, mark unread, mute; pinned dialogs stay on top. "Typing…" signal to
  the other side and an online dot for people.
- Links to portal tasks and projects open inside BitrixFlow and show as "Task #N".
- Sidebar items can be reordered by dragging (touch: long press; keyboard: Space,
  arrows, Space); the order is kept in the browser.

- Files in messages show their names (images and video with the size), voice messages
  are labelled, show their length at once and play at 1x, 1.5x or 2x.
- After a page reload the messenger reopens the dialog you were in (address `?dialog=`
  and the browser), even when it is not on the first page of the list.
- A dialog can also be pinned with a button in its header.
- Files wait in a tray before sending (picker, paste or drag-and-drop into the dialog),
  show a preview and can be removed; sending shows upload progress.

### Fixed

- The "online" dot showed for everyone: the portal user `status` is the chosen status,
  not presence. A person is online only with fresh activity (web, phone or desktop, up
  to five minutes) and no "away" mark.
- Every page had an empty 24 px line at the top: the tooltip of the floating phone menu
  button is an inline span, and in the page flow it made a line box. The button now sits
  in a fixed container. This also stopped the messenger field from being cut off at the
  bottom; on phones the messenger leaves a strip for the menu button instead of sitting
  under it.
- Voice recording asked for the microphone but the browser never showed a prompt:
  the proxy sent `Permissions-Policy: microphone=()`. It now allows `microphone=(self)`.
- The message field sat 7 px above the attach and microphone buttons.

## 0.1.0 — 2026

### Added

- The first release. What it does, in one paragraph, and what a user can
  do with it that they could not do before.
