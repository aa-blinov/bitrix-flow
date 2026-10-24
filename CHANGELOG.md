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
