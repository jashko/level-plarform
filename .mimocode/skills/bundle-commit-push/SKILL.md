---
name: bundle-commit-push
description: "Rebuild esbuild bundle, verify output, commit source + bundle, and push to GitHub. Use after any edit to src/ files that need to be reflected in the live UI."
---

# Bundle, Commit & Push

After editing `src/app.js`, `src/engine/`, or `src/data/`, the bundled output in `ui/` must be regenerated before the UI works in the browser or after deployment.

## Steps

### 1. Bundle

```bash
npm run bundle 2>&1
```

This runs esbuild to produce `ui/app.js` and `ui/engine.js` from `src/`.

**If bundle fails:** Fix the TypeScript/JS error in `src/` first. Common causes: unclosed brackets, missing imports, syntax errors in `React.createElement` chains.

### 2. Verify bundle (optional but recommended)

After bundling, confirm the expected strings/components made it into the minified output:

```bash
grep -c 'ComponentName\|expected_string' ui/app.js
```

Zero matches = something was lost during bundling (dead code elimination, wrong import path, etc.).

### 3. Commit source + bundle together

Always commit both `src/` (source) and `ui/` (bundle output) in the same commit:

```bash
git add src/app.js ui/app.js && git commit -m "$(cat <<'EOF'
<concise description of what changed>

<bullet list of specific changes>
EOF
)"
```

**Convention:** Commit message starts with an imperative verb (Add, Fix, Implement, Redraw, Wire, Replace, etc.). Body lists what was done in short bullet points.

**Important files to include when relevant:**
- `src/app.js` + `ui/app.js` — always together (source + bundle)
- `ui/index.html` — only when HTML structure changed
- `src/data/*.ts` + `src/engine/**/*.ts` — when data or engine logic changed
- `.github/workflows/*.yml` — when CI config changed

### 4. Push

```bash
git push origin main 2>&1
```

For Vercel-deployed projects, push to main triggers automatic deployment.

### 5. Handle rebase conflicts (when remote has newer commits)

If push fails due to remote changes:

```bash
git pull --rebase origin main 2>&1
# Resolve any conflicts in src/ files
npm run bundle 2>&1           # Rebuild after resolving
git add -A && git rebase --continue
git push origin main 2>&1
```

If rebase is too messy, abort and reset:

```bash
git rebase --abort && git pull origin main
npm run bundle 2>&1
git add src/app.js ui/app.js && git commit -m "..." && git push origin main
```

## Key facts

- **Build tool:** esbuild (configured in `package.json` `bundle` script)
- **Entry points:** `src/engine/index.ts` → `ui/engine.js`, `src/app.js` → `ui/app.js`
- **Target:** ES2020, browser platform, minified
- **JSON imports:** esbuild handles `.json` loader natively
- **Deploy target:** Vercel (builds `ui/` output directory)
- **Never commit without bundling first** — the UI serves `ui/app.js`, not `src/app.js`
