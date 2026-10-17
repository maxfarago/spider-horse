# SPIDER-HORSE

A standalone browser game about a horse swinging through a procedural Manhattan-inspired city. Three.js, plain JavaScript and CSS; no bundler, backend, database or API key required. Runtime libraries and game assets are included.

## Local development

Use Node.js 20 or newer. With mise, run commands as `mise exec -- npm ...` (the Node version is pinned in `.tool-versions`). No dependency installation is needed.

```sh
npm start
npm test
npm run check
npm run build
```

The local server listens on http://127.0.0.1:4177/. `SKYSTRIDE_PORT=4178 npm start` chooses another port. `start.command` launches the server on macOS with mise installed. The build command produces `dist/`, containing only the static runtime and its assets/licenses. Publish `dist/` with a static hosting service; `server.mjs` is a local preview server, not a deployed backend.

## Controls

Hold Space to attach a web; release to soar. In the air, left/right cycle nearby recommended ledges; up/down select the best predicted swing ahead/behind the camera. Momentum-aware selection forecasts two seconds of spring motion at 30Hz; gameplay physics uses 120Hz substeps. On rooftops, arrows run and strafe. Esc pauses. Menus display their keyboard shortcuts.

## Project map

- `game.js`: scene, input, camera, UI and game loop.
- `physics.js`: collision, elastic web, rooftop movement and momentum-aware ledge ranking.
- `city.js`: procedural buildings, scenery and anchor generation.
- `horse.js`, `web.js`, `anchor-camera.js`: horse animation, web rendering and cinematic framing.
- `index.html`, `style.css`, `hud.css`: title, loader and HUD.
- `*.test.js`: Node test runner regressions (46 tests at extraction).
- `assets/`, `vendor/`: models, HDR environments, Three.js and license notices.

## GitHub and deployment handoff

This folder was extracted from a different local project without its Git history, environment files, screenshots or other application code. A fresh local Git repository holds only this game. No GitHub remote or hosting project has been created, and nothing has been uploaded.

Suggested next steps in Codex:

1. Open this folder as the project and run test, check and build.
2. Create a **private** GitHub repository and connect this fresh repository. Preserve all third-party license notices; the horse asset has its own redistribution restrictions in `assets/LICENSE.warhorse.txt`.
3. Set up Cloudflare Pages to fit the existing Neigho Geo hosting approach: build command `npm run build`, output directory `dist`, Node 20 or newer. GitHub preview deployments can run test/check/build before publishing.
4. Confirm the desired game URL/domain, connect it, then add the game to the separate Neigho Geo registry. Neither that registry nor any hosting account has been changed here.

Suggested Codex opening prompt:

> Continue developing SPIDER-HORSE in this standalone repository. Read README.md and the asset license notices, run the tests and build, then help connect a private GitHub repository and prepare Cloudflare Pages deployment consistent with Neigho Geo. Confirm the intended hosting project/domain before publishing. Preserve the current controls, horse/title pose, minimalist HUD, elastic physics and momentum-aware selection performance.

## Assets

Keep `vendor/LICENSE.three`, `assets/LICENSE.warhorse.txt` and `assets/attribution.json`. The horse is Warhorse Lite by Literock Studios; HDR environments are from Poly Haven. Application source has no newly assigned open-source license. Google Fonts are loaded by the stylesheets. Google Maps is not integrated.
