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

## GitHub and Cloudflare Pages

Private source repository: https://github.com/maxfarago/spider-horse

The default and Pages production branch is `master`. GitHub Actions runs tests, syntax checks and the static build on pushes and pull requests. It does not deploy.

The game is deployed to the Cloudflare Pages project `spider-horse` in the same account as Neigho Geo. Its approved custom domain is https://spider.max.horse; the fallback is https://spider-horse.pages.dev. `wrangler.toml` records its project name and output directory. The Neigho Geo registry has not been changed.

This project uses Direct Upload for deliberate releases. GitHub pushes alone do not publish it. GitHub Actions can be extended to upload releases later; switching to Cloudflare's built-in Git integration requires a new Pages project. See the [Cloudflare Direct Upload guide](https://developers.cloudflare.com/pages/get-started/direct-upload/).

### Manual releases

Run tests, syntax checks and build, then deploy the generated directory:

```sh
npm test
npm run check
npm run build
CLOUDFLARE_ACCOUNT_ID=c7698f65669d1881d1f02fd4bcbc250a npx wrangler@4.135.0 pages deploy dist --project-name spider-horse --branch master
```

The upload updates the public game at https://spider.max.horse and https://spider-horse.pages.dev. Verify the release before updating its listing in the Neigho Geo registry.

Wrangler needs a valid Cloudflare login or an API token with Pages edit access for the configured account. During setup, the environment API token was rejected, but the existing OAuth login worked after removing `CLOUDFLARE_API_TOKEN` and `CF_API_TOKEN` from that command's environment. No credentials are stored in this repository.

Keep the GitHub repository private and preserve all third-party license notices. Preserve the current controls, horse/title pose, minimalist HUD, elastic physics and momentum-aware selection performance during future changes.

## Assets

Keep `vendor/LICENSE.three`, `assets/LICENSE.warhorse.txt` and `assets/attribution.json`. The horse is Warhorse Lite by Literock Studios; HDR environments are from Poly Haven. Application source has no newly assigned open-source license. Google Fonts are loaded by the stylesheets. Google Maps is not integrated.
