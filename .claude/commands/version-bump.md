---
description: "Bump project version: update all references, verify, commit, tag, and push."
---

Bump the MPlayer project version. Usage: `/version-bump 1.4.0`

**Prerequisites**: $ARGUMENTS must specify the new version (e.g. `1.4.0`).

**Step 1: Update package.json**
```bash
# Find current version
grep '"version"' package.json | head -1

# Update version
sed -i 's/"version": "CURRENT"/"version": "NEW_VERSION"/' package.json
```

**Step 2: Find all version references**
```bash
grep -rn 'OLD_VERSION\|OLD_VERSION_DASHED\|OLD_VERSION_UNDERSCORED' --include="*.json" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" --include="*.html" . 2>/dev/null | grep -v node_modules | grep -v ".git/"
```
Update any references found (especially `SettingsPage.tsx` version display, `electron-builder.yml`, etc.).

**Step 3: Regenerate lock file**
```bash
npm install --package-lock-only 2>&1 | tail -3
```

**Step 4: Run verify cycle**
```bash
npm run lint 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -5
npm run test:run 2>&1 | tail -10
```
If any step fails, fix before continuing.

**Step 5: Commit, tag, and push**
```bash
git add package.json package-lock.json <any-other-changed-files>
git commit -m "chore: bump version to NEW_VERSION"
git tag -a vNEW_VERSION -m "vNEW_VERSION"
git push origin master
git push origin vNEW_VERSION
```

Report the final state: version, tag, and push status.
