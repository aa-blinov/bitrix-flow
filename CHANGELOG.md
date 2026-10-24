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
- Sidebar items can be reordered by dragging (touch: long press; keyboard: Space,
  arrows, Space); the order is kept in the browser.

### Fixed

- Voice recording asked for the microphone but the browser never showed a prompt:
  the proxy sent `Permissions-Policy: microphone=()`. It now allows `microphone=(self)`.
- The message field sat 7 px above the attach and microphone buttons.

## 0.1.0 — 2026

### Added

- The first release. What it does, in one paragraph, and what a user can
  do with it that they could not do before.
