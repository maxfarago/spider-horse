# Standalone extraction

Mapping: existing standalone game at `/Users/max/code/ember/alkaline-demo/games/skystride` → new project root `/Users/max/code/spider-horse`. Runtime files, tests, assets and license notices copied; package renamed; build script, ignore rules, pinned Node version and README handoff added.

Delivered: fresh local repository on `codex/standalone`, no inherited Git history or remotes. Static build outputs only runtime files in `dist/`. Original game copy retained as backup. Local preview at port 4177 now serves this directory. README includes commands, architecture, current controls, asset notices and a private-GitHub/Cloudflare-Pages handoff prompt. No GitHub or cloud changes performed.

Verification tier: extraction slice. SHA-256 comparison verified 31 original game files unchanged (package metadata intentionally updated). All 46 tests, syntax checks, static build and diff check pass. Validated 24 built files and local import/resource references; no tests/server/package metadata in build. Browser title screen and model/scenery load, no console errors. Screenshot: `screenshots/standalone.png`. No seed or legal invariant checks applicable to this isolated game; no shared application code changed.

Approximate wall time: inspection 2m; extraction/build preparation 2m; verification/handoff 2m. Assumptions: GitHub connection/deployment will be completed in the new project by the next Codex session; private repository recommended to preserve asset distribution boundaries. Implementation commit: `4b3289d`.
