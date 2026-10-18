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

Hold **Space / Swing** to chain forward swings automatically; release to let go.
**Left/right or A/D / joystick** steer travel. **Up/down or W/S** move on rooftops.
**Shift / contextual action** jumps from a roof or attached swing. In flight, it
zips to a marked perch within 12° of travel direction and a clear approach;
without a perch it performs a short air zip. Near perch arrival it becomes
**Launch**. Mobile has exactly two action buttons: **Swing** and **Jump/Zip/Launch**.
**C** dives in free flight. The camera follows travel direction; steering
recenters any optional look offset. **Right-drag / drag the open scene on touch**
looks around; **Q or double-tap** recenters. Esc pauses. Looking does not choose
perches or swing anchors. These are keyboard/touch equivalents of PS4-style actions;
Gamepad API/controller bindings are not implemented in this pass.

This branch uses the original PS4 game as its behavioral reference. It does not
claim identical proprietary physics. Reference: [PlayStation's 2018 hands-on](https://blog.playstation.com/2018/06/15/playing-marvels-spider-man-made-me-feel-like-spider-man/).

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

The default and Pages production branch is `master`. GitHub Actions runs tests, syntax checks and the static build on pushes and pull requests. After all three succeed on a push to `master`, the same job deploys `dist/` to production. Pull requests and other branches never deploy. A manual workflow run on `master` also validates and deploys.

The game is deployed to the Cloudflare Pages project `spider-horse` in the same account as Neigho Geo. Its approved custom domain is https://spider.max.horse; the fallback is https://spider-horse.pages.dev. `wrangler.toml` records its project name and output directory. The Neigho Geo registry has not been changed.

This project uses Cloudflare Pages Direct Upload through `.github/workflows/validate.yml`. Deployment uses the repository Actions secret `CLOUDFLARE_API_TOKEN`, with Pages edit access for the configured account. Runs are serialized per branch without interrupting an active upload. Check the **Validate and deploy game** workflow for deployment status and the resulting URL.

### Manual releases

Run tests, syntax checks and build, then deploy the generated directory:

```sh
npm test
npm run check
npm run build
CLOUDFLARE_ACCOUNT_ID=c7698f65669d1881d1f02fd4bcbc250a npx wrangler@4.135.0 pages deploy dist --project-name spider-horse --branch master
```

The upload updates the public game at https://spider.max.horse and https://spider-horse.pages.dev. Verify the release before updating its listing in the Neigho Geo registry.

For local manual releases, load `CLOUDFLARE_API_TOKEN` from your shell profile. GitHub Actions uses its own saved secret; rotating the local token also requires updating that secret. No credentials are committed to this repository.

Keep the GitHub repository private and preserve all third-party license notices. Preserve the current controls, horse/title pose, minimalist HUD, elastic physics and momentum-aware selection performance during future changes.

## Assets

Keep `vendor/LICENSE.three`, `assets/LICENSE.warhorse.txt` and `assets/attribution.json`. The horse is Warhorse Lite by Literock Studios; HDR environments are from Poly Haven. Application source has no newly assigned open-source license. Google Fonts are loaded by the stylesheets. Google Maps is not integrated.

### Swing tuning HUD

Localhost play shows **Swing Lab** with speed, vertical velocity, and tether angle
(0° directly below the anchor, 90° level with it, 180° directly above).
On a phone/LAN address, append `?debug=1` to enable it. The panel shows the
current phase without prescribing a jump instant. After a swing-jump it keeps
the measured before/after speed and event age.

Swing-jumps blend a forward push into upward lift across the ascent: earlier
for speed, later for height. After at least 0.3 seconds attached, rising ordinary release adds 15% speed
(up to 6 m/s) along the current trajectory and starts a 0.85-second soar at
85% gravity. Cleanup and descending release never add a boost. Swing-jumps can add radial edge
blur; Reduce motion disables it. Speed remains capped at 78 m/s.

### Controlled traversal

Attachment preserves entry velocity. A maximum-distance rope constraint allows
up to 1.2 m compliance during a 180 ms catch, then becomes firm. Slack rope never
pushes. Corrections use swept collisions; obstructed corrections detach safely.
The street-clearance winch controls target length at a bounded rate without a
separate spring force. Within 35° of the arc bottom, a capped tangential assist
helps low speeds approach 38 m/s without slowing faster swings.
Left/right arrows and the mobile joystick steer; camera look is independent.
Attached steering acts in the rope tangent plane; free flight rotates horizontal
velocity without adding speed. Swing-jump assistance varies continuously; rising release adds a bounded trajectory-aligned boost.
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

### Travel intent and point targeting

Swing recommendations use a ±50° cone around travel intent: current momentum
with a small steering lead, or body heading at low speed. Center preference,
release-quality scoring, safety checks, and previous-anchor exclusion remain.
Camera movement cannot alter this cone. The diamond now marks a separate
view-biased point-zip destination, not a swinging anchor. Point zips use a swept
approach outside the roof corner, then cross above the edge. Collisions cancel
the zip; there is no teleport through buildings. Jump near arrival launches
onward; otherwise the horse settles onto the roof. Air zips have a cooldown and
require nearby geometry. Holding Swing after a swing-jump can catch again after
0.55 seconds; releasing Swing cancels the pending automatic catch.


Air zip adds 18 m/s toward a 42–72 m/s horizontal burst, with a 0.7-second
soar and radial edge blur. Perch zip travels at up to 68 m/s. Reduce Motion
suppresses the blur. Bottom-of-arc assistance is limited to 18 m/s², and total
normal traversal speed remains capped at 78 m/s.


### Held-swing continuity

Holding Swing finishes a taut ascending arc when forward speed drops below 78%
of its peak, after at least 0.45 seconds attached and 36° past the bottom. The
horse releases with the existing bounded kick, spends at least 0.7 seconds in
free flight, then searches for a valid forward anchor. It never reuses the previous
ledge; without a valid target it remains airborne. Manual release cancels the
pending catch. Collision breaks still require a fresh press.

Soar assistance now fades smoothly over its final 0.45 seconds and as downward
speed grows from 0 to 8 m/s. Gravity and horizontal drag share that envelope.
Free-air horizontal drag is 0.06/s, blending toward 0.015/s at full soar strength.
This pass changes physics only; camera and animation follow-up work is separate.

### Flight camera

Horizontal tracking stays immediate. Vertical tracking eases with a distance-scaled
lag capped at 2.5 m, allowing the horse to move within the frame through an arc.
The camera aims along a bounded 0.35-second flight prediction: ballistic while
free, curved toward the tether while attached. Manual look suppresses predictive
aiming; Reduce Motion removes the added lag and look-ahead. Teleports and grounded
or wall-running states reset vertical tracking. Both desired and smoothed camera
positions are checked against building obstructions.
