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

Hold Space to attach a web; release to soar. Hold left/right to pan the view on rooftops and in the air. A new airborne web attachment resets the view to the current direction of travel. In the air, up/down select the best predicted swing ahead/behind the camera. Momentum-aware selection forecasts two seconds of constraint-based motion at 30Hz; gameplay physics uses 120Hz substeps. On rooftops, up/down run forward/backward in the viewing direction. Esc pauses. Menus display their keyboard shortcuts.

## Project map

- `game.js`: scene, input, camera, UI and game loop.
- `physics.js`: collision, rope constraint, rooftop movement and momentum-aware ledge ranking.
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

### Swing tuning HUD

Localhost play shows **Swing Lab** with speed, vertical velocity, and tether angle
(0° directly below the anchor, 90° level with it, 180° directly above).
On a phone/LAN address, append `?debug=1` to enable it. The panel turns green and
says **Release now · SNAP** during the ascending release window (20–40° from the bottom). After release it
keeps the measured before/after speed and event age, so missed windows are visible.

A qualifying release adds just 3 m/s along the existing trajectory, capped at
78 m/s. There is no upward velocity floor. A 0.65-second soar phase uses 85% of
normal gravity and reduced horizontal drag. Successful releases briefly add
radial edge blur; Reduce motion disables it. Passive detaches never trigger it.

### Controlled traversal

Attachment preserves entry velocity. A maximum-distance rope constraint allows
up to 1.2 m compliance during a 180 ms catch, then becomes firm. Slack rope never
pushes. Corrections use swept collisions; obstructed corrections detach safely.
The street-clearance winch controls target length at a bounded rate without a
separate spring force. Within 25° of the arc bottom, a capped tangential assist
helps low speeds approach 24 m/s without slowing faster swings.
Left/right arrows and the mobile joystick pan the view and steer airborne motion.
Attached steering acts in the rope tangent plane; free flight rotates horizontal
velocity without adding speed. A rising release at 20–40° earns the small assist.
Reattachment, landing, significant impacts, and input cleanup cancel soaring.


### Traversal presentation

Catch, swing, release, and soar have distinct procedural animation and camera
responses. Catch gathers the forelegs and compresses framing; swing banks into
steering; release extends the limbs with a brief field-of-view expansion; soar
slows the airborne gait and extends forward framing. Animation blends over the
existing horse rig rather than using new authored clips. Camera collision checks
and manual view control remain active. Reduce motion removes phase camera accents
and reduces pose accents. The development HUD names the active presentation phase.

### Wall recovery

Airborne facade impacts at speed transition into an automatic wall-run. Incoming
speed supplies bounded upward movement while lateral momentum is retained. The
run lasts at most 1.15 seconds; it cannot continuously recharge against the same
wall. Clearing the roof collider triggers a swept forward vault, rather than a
teleport. Low-speed bumps and street-level contact do not launch the horse.
Attaching a new web cancels recovery. The horse pitches into the climb and gathers
its legs for the vault; the development HUD identifies both phases.

### Release-aware ledge ranking

Candidate forecasts stop at the first ascending release window within two seconds.
Ranking favors forward launch velocity and a pitch near 30°, penalizing sideways
velocity and long waits. It scores the actual assisted release velocity, then checks
eight additional 30 Hz samples of free flight for immediate collisions. Ground
contact, low clearance, obstructed webs, and interrupted swings remain strongly
penalized. A safe candidate with no release in the horizon remains a fallback.
Forecasts use at most 68 samples per candidate and retain the existing cache,
recommendation lock, manual selection, and previous-anchor exclusion.

### Forward view targeting

Automatic recommendations and mobile Select only consider ledges within 50° of
the horizontal view direction. Center alignment adds a strong preference on top
of release quality and safety scoring. Panning outside a locked target's cone
invalidates it immediately; an empty cone clears the recommendation rather than
falling back sideways or behind. Mobile choices obey the same rule after selection.
Explicit directional/manual selection (including select behind) remains an override.
