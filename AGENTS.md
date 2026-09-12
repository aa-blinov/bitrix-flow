<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Перед пушем

CI гоняет `npm run format:check`, `npm run lint`, `npm test`, `npm run build` в таком порядке. Прогоняй это же локально до `git push`, иначе джоба падает на ерунде вроде переносов в className:

```sh
npm run format && npm run lint && npm test
```

`npm run format` (prettier --write) лучше, чем `format:check`: сразу чинит вместо того, чтобы ругаться.
