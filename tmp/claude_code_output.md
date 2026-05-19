# tsconfig "No inputs were found" — Fix Summary

## Root cause

The error in `c:\Users\HP\.cursor\worktrees\legion-engine\kih\tsconfig.json` was caused by:

1. **Invalid `exclude`** — `"exclude": ["node_modules", "dist", "apps", "packages"]` removed every TypeScript source directory from the project.
2. **Empty worktree** — The `kih` folder was not a registered git worktree; it only contained a stray `tsconfig.json` with no `apps/` or `packages/` checkout, so even after fixing `exclude`, there would have been zero `.ts` files.

With no `include` set, TypeScript defaults to `**/*`, which combined with excluding `apps` and `packages` left **no inputs**.

## Fix applied

1. Removed the orphan `kih` directory.
2. Recreated it as a proper git worktree:
   ```bash
   git worktree add "c:\Users\HP\.cursor\worktrees\legion-engine\kih" HEAD --detach
   ```
3. The worktree now has the correct root `tsconfig.json` from the repo (excludes only `node_modules`, `dist`, and `**/*.test.ts` — **not** `apps` or `packages`).

## Workspace `tsconfig.json` (Downloads path)

Your open workspace config at `legion-engine/tsconfig.json` is already valid:

- `"include": ["packages/**/*.ts", "apps/**/*.ts"]` — explicitly targets source
- No `exclude` of `apps` or `packages`

No change required there unless you want to align with git `HEAD` (Bundler module resolution, `src` paths in `paths`).

## If the error reappears

Do **not** add `"apps"` or `"packages"` to root `exclude`. Use:

```json
"exclude": ["node_modules", "dist", "**/*.test.ts"]
```

Or an explicit `include` like the workspace file already has.
