# RCA — Deploy run 5b59f920-69cb-4c3b-bdba-ff6a35d9e64c (vastgoed-app)

## Outcome
Build FAILED at `build_image` (frontend compile / ESLint). The previous run (74c8c275…) is still live and serving — **the app is NOT down**. A failed run is never promoted.

## Symptom (from Cloud Build logs)
```
Failed to compile.
[eslint]
src/components/KioskPrintsOverlay.jsx
  Line 60:19:  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps
  Line 61:60:  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps
  Line 62:69:  Definition for rule 'react-hooks/exhaustive-deps' was not found  react-hooks/exhaustive-deps
error Command failed with exit code 1.
```

## Root cause
`frontend/.eslintrc.json` sets `"root": true` and does **not** `extends: ["react-app"]` nor declare any `plugins`. With `root:true`, CRA/craco's base config (`eslint-config-react-app`, which registers the `eslint-plugin-react-hooks` plugin and the `react-hooks/exhaustive-deps` rule) is cut off, so that rule is never registered during the production build.

`frontend/src/components/KioskPrintsOverlay.jsx` lines 60–62 carry trailing `// eslint-disable-line react-hooks/exhaustive-deps` comments. ESLint cannot resolve a disable directive for an unregistered rule → it raises a hard **error** (not a warning) → `craco build` exits 1 → `build_image` fails.

The plugin is only "MISSING" because the config never registers it; the package itself ships transitively via react-scripts. This is purely a lint-config + source-comment mismatch.

## Reproduction (eph sandbox, run source at /app/scratch)
- `yarn install --frozen-lockfile` → OK
- `CI=true yarn build` → reproduced the exact 3-line "Definition for rule not found" failure, exit 1.

## Fix (verified in sandbox)
Remove the three trailing `// eslint-disable-line react-hooks/exhaustive-deps` comments in `frontend/src/components/KioskPrintsOverlay.jsx` (lines 60–62). Because the react-hooks rule is not active under this config, there is nothing to disable, so removing the directive is safe and does not surface any new warning.

Lines after fix:
```jsx
  }, [emp?.key]);
  useEffect(() => { setLogs(null); load(); }, [emp?.key]);
  useEffect(() => { if (printsVersion) load(); }, [printsVersion]);
```
Verification: `CI=true yarn build` → **"Compiled successfully." (exit 0)**.

### Alternative (optional, broader) fix
If the team WANTS the exhaustive-deps lint active, instead add `"extends": ["react-app"]` to `frontend/.eslintrc.json` (which registers the react-hooks plugin). Note this will then re-evaluate the three hooks and may emit real exhaustive-deps warnings that CI treats as errors — the comment-removal fix above is the lower-risk option.

## Next step
E1 applies the fix in the source environment, then re-triggers the redeploy. Do not re-run the pipeline on the current (unfixed) source — it will fail identically.
