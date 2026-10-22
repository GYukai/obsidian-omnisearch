# Maintained distribution

Public GitHub fork / BRAT repository: `GYukai/obsidian-omnisearch`. Plugin ID: `keronmisearch`. Independent version line starts at **2.0.0**, unrelated to upstream versions. Update package.json, manifest.json, manifest-beta.json (if present), and versions.json together before each release. Preserve original license and attribution. Never commit data.json, tokens, caches, or vault contents.

## Upstream

Official source: https://github.com/scambier/obsidian-omnisearch, branch `master`. Recorded common baseline: `e7762203b308f3ce6a1cb12a0609aaa9184a3e45` (also in upstream.json). Run `node scripts/fetch-upstream.mjs` in a fresh clone to recreate the upstream remote and fetch changes. The manual Fetch upstream for review GitHub workflow refreshes `upstream-tracking`; it does not merge or release. Review and merge/cherry-pick upstream changes, resolve conflicts while retaining this fork's identity, version, workflows and customizations, then build/test and publish a new maintained version.

## BRAT

Subscribe to `GYukai/obsidian-omnisearch`, select Latest, no private-repository token is required. Disable the original plugin before enabling this maintained copy. Migrate data.json locally only. Release assets must be main.js, manifest.json and styles.css.

The `maintained` default branch contains personal changes; the original upstream branch is preserved. Public release line begins at 2.0.1 (2.0.0 was prepared during the initial private setup).
