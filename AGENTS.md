# AGENTS

## Bun Instructions
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Rules
- Do not `cd` into the project for every command;
- After each change, run the commands `bun typecheck`, `bun test`, `bun lint`, `bun check` and  `bun format`;
- Use `bun test` to run tests.
- Update README.md after keybinding changes
