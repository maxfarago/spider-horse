import * as THREE from './vendor/three.module.js';
import { createCity } from './city.js';
import { createHorse } from './horse.js';
import { createWeb } from './web.js';
import { updateWebTarget } from './web-target.js';
import { cameraClearance, revealAnchor, turnTowardAnchor } from './anchor-camera.js';
import { bindHold, bindJoystick, bindLook, travelIntent, panView } from './controls.js';
import { traversalFeel } from './traversal-feel.js';
import { SwingPhysics } from './physics.js';
import { HDRLoader } from './vendor/HDRLoader.js';
import { createCinematics } from './cinematics.js';

const $ = (id) => document.getElementById(id);
const shell = $('game-shell');
const canvas = $('world');
const keys = new Set();
const touchKeys = new Set(), inputCleanups = [];
const held = code => keys.has(code) || touchKeys.has(code);
const webControlLabel = () => matchMedia('(max-width:760px), (pointer:coarse)').matches ? 'Swing' : 'Space';
const preferences = { atmosphere: 'golden', quality: 'high', camera: 'chase', audio: false, reduceMotion: false };
try { Object.assign(preferences, JSON.parse(localStorage.getItem('skystride.preferences') || '{}')); } catch { /* Private browsing still supports play. */ }
let renderer, scene, camera, city, horse, physics, sun, ambient, fill, skyMaterial, cinematics;
let started = false, paused = false, mode = 'roam', checkpoint = 0, elapsed = 0, running = false;
let now = 0, toastTimeout, renderFrames = 0, previousTime = performance.now(), accumulator = 0;
let frameSelectedAnchor = false, facingAnchor = null, viewYaw = 0, previewAge = 0;
const anchorViewState = {};
const previewStartOffset = new THREE.Vector3(), previewLookOffset = new THREE.Vector3();
let orbit = 0, pitch = .1;
let pointTarget = null;
let displayedAnchor = null, joystickSteering = 0;
let lastImpact = -1, lastReset = 0, checkpointPulse = 0, lastUI = 0, autoAttachTime = 0;
let previousTension = 0, ropeRipple = 0, lastAttachmentCount = 0;
let audioContext, windGain, windFilter, cityGain;
const particlePositions = new Float32Array(70 * 6);
const cameraTrackedHorse = new THREE.Vector3(), cameraTravel = new THREE.Vector3();
const cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), desiredTarget = new THREE.Vector3();
const horsePosition = new THREE.Vector3(), projected = new THREE.Vector3(), tetherStart = new THREE.Vector3();
const ropePoints = new Float32Array(33 * 3);
let rope, streaks, rings = [];

function toast(message, duration = 3000) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), duration);
}
function savePreferences() { try { localStorage.setItem('skystride.preferences', JSON.stringify(preferences)); } catch { /* Optional persistence. */ } }
function anyDialog() { return document.querySelector('dialog[open]') !== null; }
function clearInput() { displayedAnchor = null; keys.clear(); inputCleanups.forEach(clear => clear()); touchKeys.clear(); physics?.release(); if (physics) physics.pointZip = null; autoAttachTime = 0; }
function openDialog(id) { clearInput(); $(id).showModal(); }
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}

function createSky() {
  skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { topColor: { value: new THREE.Color('#537f9c') }, bottomColor: { value: new THREE.Color('#f1cba6') }, sunColor: { value: new THREE.Color('#fff1c5') }, sunDirection: { value: new THREE.Vector3(-.5, .14, -.84).normalize() }, time: { value: 0 }, hdrSky: { value: null }, hasHDR: { value: 0 }, skyGain: { value: 1 }, skyTint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: 'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vDirection;
      uniform vec3 topColor; uniform vec3 bottomColor; uniform vec3 sunColor; uniform vec3 sunDirection; uniform float time; uniform sampler2D hdrSky; uniform float hasHDR; uniform float skyGain; uniform vec3 skyTint;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+2.7;a*=.5;}return v;}
      void main(){vec3 d=normalize(vDirection);float h=max(d.y,0.);vec3 color=mix(bottomColor,topColor,pow(h,.48));
        float sunDot=max(dot(d,sunDirection),0.); color+=sunColor*pow(sunDot,40.)*.32; color+=sunColor*pow(sunDot,900.)*.8;
        if(d.y>0.025){vec2 uv=d.xz/(d.y+.22);float clouds=fbm(uv*2.+vec2(time*.002,0.));float detail=fbm(uv*7.);float c=smoothstep(.53,.75,clouds+.09*detail)*smoothstep(.03,.14,h);color=mix(color,sunColor,c*.34);}
        if(hasHDR>.5){vec2 panoramaUV=vec2(atan(d.z,d.x)/6.2831853+.62,asin(clamp(d.y,-1.,1.))/3.14159265+.5);vec3 photographic=texture2D(hdrSky,panoramaUV).rgb*skyGain*skyTint;photographic=mix(bottomColor*.72,photographic,smoothstep(-.03,.38,d.y));float skyBlend=smoothstep(-.01,.08,d.y);color=mix(bottomColor,photographic,skyBlend);}
        gl_FragColor=vec4(color,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment> }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 24), skyMaterial);
  sky.frustumCulled = false; sky.renderOrder = -100; scene.add(sky);
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
  const context = glowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, '#fffdeb'); gradient.addColorStop(.12, '#fff3d7'); gradient.addColorStop(.2, '#ffdf9677'); gradient.addColorStop(.5, '#f9c87914'); gradient.addColorStop(1, '#f9c87900');
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sprite.position.set(-760, 230, -1500); sprite.scale.set(500, 500, 1); sprite.visible = false; scene.add(sprite);
  return sky;
}

function atmosphere() {
  const looks = {
    golden: { fog: '#b6a496', top: '#7297ae', bottom: '#edc29c', sun: '#ffddb2', power: 3.0, sky: '#b9d0df', ground: '#5b5048', ambient: .38, exposure: 1.06, environment: .54, skyGain: .48, tint: '#ffecd8', warmth: .02, label: 'GOLDEN HOUR' },
    blue: { fog: '#657286', top: '#354b70', bottom: '#be9eb0', sun: '#c3c5ed', power: .9, sky: '#a0b8de', ground: '#38435d', ambient: .5, exposure: 1.24, environment: .52, skyGain: .6, tint: '#a8c2ff', warmth: -.02, label: 'BLUE HOUR' },
    day: { fog: '#c5d2d8', top: '#6ca9d3', bottom: '#d9e5eb', sun: '#fff3df', power: 3.6, sky: '#d5e9f2', ground: '#7a7b6e', ambient: .8, exposure: 1.02, environment: 1.0, skyGain: 1.2, tint: '#d6e9ff', warmth: 0, label: 'CLEAR DAY' },
  };
  const look = looks[preferences.atmosphere] || looks.golden;
  scene.fog.color.set(look.fog); skyMaterial.uniforms.topColor.value.set(look.top); skyMaterial.uniforms.bottomColor.value.set(look.bottom);
  skyMaterial.uniforms.sunColor.value.set(look.sun); sun.color.set(look.sun); sun.intensity = look.power;
  ambient.color.set(look.sky); ambient.groundColor.set(look.ground); ambient.intensity = look.ambient;
  renderer.toneMappingExposure = look.exposure; scene.environmentIntensity = look.environment;
  skyMaterial.uniforms.skyGain.value = look.skyGain; skyMaterial.uniforms.skyTint.value.set(look.tint);
  cinematics?.setLook({ warmth: look.warmth, bloom: preferences.atmosphere === 'blue' ? .12 : .075 });
  city?.setAtmosphere?.(preferences.atmosphere);
  savePreferences();
}
function setQuality() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, preferences.quality === 'high' ? 1.8 : 1));
  renderer.shadowMap.enabled = preferences.quality === 'high';
  renderer.setSize(shell.clientWidth, shell.clientHeight, false);
  cinematics?.resize(shell.clientWidth * renderer.getPixelRatio(), shell.clientHeight * renderer.getPixelRatio(), preferences.quality === 'high');
  savePreferences();
}
function makeCourse() {
  const ringGeometry = new THREE.TorusGeometry(8, .12, 8, 80);
  const accentGeometry = new THREE.TorusGeometry(8.55, .035, 4, 80);
  city.route.forEach((position, index) => {
    const group = new THREE.Group(); group.position.copy(position);
    const material = new THREE.MeshBasicMaterial({ color: '#c5f36a', transparent: true, opacity: .9 });
    group.add(new THREE.Mesh(ringGeometry, material));
    const accent = new THREE.Mesh(accentGeometry, new THREE.MeshBasicMaterial({ color: '#eeffc8', transparent: true, opacity: .3 })); group.add(accent);
    for (let a = 0; a < 4; a++) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(.14, 1.8, .14), material);
      dash.position.set(Math.sin(a * Math.PI / 2) * 8.6, Math.cos(a * Math.PI / 2) * 8.6, 0);
      dash.rotation.z = -a * Math.PI / 2; group.add(dash);
    }
    if (index < city.route.length - 1) group.lookAt(city.route[index + 1]);
    group.visible = false; scene.add(group); rings.push(group);
  });
}
function makeEffects() {
  rope = createWeb(); scene.add(rope.group);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  streaks = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#ecf2d4', transparent: true, opacity: 0, depthWrite: false }));
  streaks.frustumCulled = false; scene.add(streaks);
}

async function boot() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene(); scene.fog = new THREE.FogExp2('#b6a496', .0011);
    const environmentLoad = Promise.all([new HDRLoader().loadAsync('./assets/sunset-sky.hdr'), new HDRLoader().loadAsync('./assets/cloud-sky.hdr')]);
    const horseLoad = createHorse();
    camera = new THREE.PerspectiveCamera(54, shell.clientWidth / shell.clientHeight, .15, 3000);
    createSky(); cinematics = createCinematics(renderer, camera);
    ambient = new THREE.HemisphereLight('#b4c8d1', '#80745f', 2.5); scene.add(ambient);
    sun = new THREE.DirectionalLight('#ffe2aa', 3.5); sun.position.set(-150, 105, 85); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -110; sun.shadow.camera.right = 110; sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110; sun.shadow.camera.near = 10; sun.shadow.camera.far = 600;
    sun.shadow.bias = -.00012; sun.shadow.normalBias = .055; sun.shadow.radius = 2; scene.add(sun); scene.add(sun.target);
    fill = new THREE.DirectionalLight('#c8ddeb', .85); fill.position.set(100, 100, 90); scene.add(fill);
    city = createCity(scene);
    horse = await horseLoad; horse.group.scale.setScalar(1.35); scene.add(horse.group);
    physics = new SwingPhysics({ ...city, spawn: { ...city.spawn, y: city.spawn.y + 55 }, initialVelocity: { x: 0, y: -18, z: -8 }, fatalGround: true });
    const [environmentHDR, cloudHDR] = await environmentLoad;
    environmentHDR.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(environmentHDR).texture; pmrem.dispose();
    scene.environmentRotation.y = -.75;
    skyMaterial.uniforms.hdrSky.value = cloudHDR; skyMaterial.uniforms.hasHDR.value = 1;
    makeEffects(); makeCourse(); setQuality(); atmosphere();
    for (const [id, value] of [['atmosphere-select', preferences.atmosphere], ['quality-select', preferences.quality], ['camera-select', preferences.camera]]) $(id).value = value;
    $('audio-toggle').checked = preferences.audio; $('motion-toggle').checked = preferences.reduceMotion;
    document.body.classList.toggle('touch-mode', matchMedia('(pointer:coarse)').matches);
    resize(); setupEvents(); drawMinimap();
    camera.position.set(1.2, city.spawn.y + 3.6, city.spawn.z + 15); cameraTarget.set(-8, city.spawn.y + 2, city.spawn.z - 35);
    frame(performance.now());
    await renderer.compileAsync(scene, camera);
    $('loading').style.opacity = '0';
    setTimeout(() => $('loading').classList.add('hidden'), 650);
    $('intro').classList.remove('hidden');
    window.skystride = { getState: () => ({ started, paused, mode, checkpoint, elapsed, running, physics: physics.snapshot(), drawCalls: cinematics.stats.calls, triangles: cinematics.stats.triangles }), start: launch, reset: resetRun };
  } catch (error) {
    console.error(error); $('loading').classList.add('hidden'); $('error-screen').classList.remove('hidden');
    $('error-message').textContent = `The scene could not initialize: ${error.message}`;
  }
}
function resize() {
  if (!renderer) return;
  camera.aspect = shell.clientWidth / shell.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(shell.clientWidth, shell.clientHeight, false);
  cinematics?.resize(shell.clientWidth * renderer.getPixelRatio(), shell.clientHeight * renderer.getPixelRatio(), preferences.quality === 'high');
}
function launch(nextMode = mode) {
  frameSelectedAnchor = false; facingAnchor = null; viewYaw = 0; orbit = 0; pitch = .1; pointTarget = null;
  clearInput();
  if ($('loss-dialog').open) $('loss-dialog').close();
  started = true; paused = false; mode = nextMode;
  document.body.classList.add('playing'); $('intro').classList.add('hidden'); $('live-indicator').classList.remove('hidden'); $('reticle').classList.remove('hidden'); $('pause-chip').classList.add('hidden');
  horse.group.rotation.set(0, 0, 0, 'XYZ');
  physics.reset(); lastImpact = -1; lastReset = physics.resetCount; elapsed = 0; checkpoint = 0; running = mode === 'trial'; accumulator = 0;
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  $('trial-hud').classList.toggle('hidden', mode !== 'trial'); $('route-card').classList.toggle('hidden', mode === 'trial');
  $('checkpoint-label').classList.toggle('hidden', mode !== 'trial'); updateCourse();
  if (mode === 'trial') toast('Midtown Run · Fly through all 8 gates. Your clock is running.', 4000);
  else toast(`You’re falling! Hold ${webControlLabel()} to catch a rooftop.`, 5000);
  if (preferences.audio) enableAudio(); canvas.focus();
}
function loseRun() {
  running = false; paused = false; clearInput(); updateCourse();
  $('pause-chip').classList.add('hidden');
  $('loss-time').textContent = physics.time.toFixed(1);
  $('loss-distance').textContent = Math.round(physics.distanceTravelled).toLocaleString();
  $('loss-dialog').showModal(); tone(70, .2);
}
function resetRun() { if (!started) return; launch(mode); toast(mode === 'trial' ? 'Fresh start. Make this one count.' : 'Back above Midtown. Take the leap.'); }
function updateCourse() { rings.forEach((ring, index) => { ring.visible = mode === 'trial' && running && index >= checkpoint && index < checkpoint + 3; ring.scale.setScalar(index === checkpoint ? 1 : .95); ring.children.forEach(child => { child.material.opacity = index === checkpoint ? .9 : .18; }); }); }
function finishRun() {
  running = false; clearInput(); updateCourse();
  $('finish-time').textContent = formatTime(elapsed);
  let previous = Infinity;
  try { previous = Number(localStorage.getItem('skystride.best.survival-v1') || Infinity); if (elapsed < previous) localStorage.setItem('skystride.best.survival-v1', String(elapsed)); } catch { /* Optional persistence. */ }
  $('finish-best').textContent = elapsed < previous ? 'A new personal best. The city is yours.' : `Personal best ${formatTime(previous)}. There’s always a faster line.`;
  $('finish-dialog').showModal(); tone(660, .2); setTimeout(() => tone(990, .35), 160);
}
function setPaused(value) { paused = value; clearInput(); $('pause-chip').classList.toggle('hidden', !paused); if (!paused) canvas.focus(); }
function quitToTitle() {
  clearInput(); started = false; paused = false; running = false;
  physics.reset(); updateCourse();
  document.body.classList.remove('playing');
  $('intro').classList.remove('hidden');
  for (const id of ['pause-chip', 'live-indicator', 'reticle', 'web-target', 'anchor-marker', 'trial-hud', 'checkpoint-label']) $(id).classList.add('hidden');
  clearTimeout(toastTimeout); $('toast').classList.remove('visible');
  document.querySelector('#intro [data-mode]').focus();
}
function startPivotReveal() {
  previewAge = 0;
  for (const key of Object.keys(anchorViewState)) delete anchorViewState[key];
  previewStartOffset.copy(camera.position).sub(horsePosition);
  previewLookOffset.copy(cameraTarget).sub(horsePosition);
}
function currentSteer() { return THREE.MathUtils.clamp(Number(held('ArrowLeft') || held('KeyA')) - Number(held('ArrowRight') || held('KeyD')) - joystickSteering, -1, 1); }
function jumpAction() {
  if (!started || paused || anyDialog() || physics.lost) return;
  physics.viewYaw = travelIntent(physics.vel, physics.yaw, currentSteer());
  physics.contextualJump(travelIntent(physics.vel, physics.yaw, 0), pointTarget); autoAttachTime = 0;
}
function attachLedge(candidate) {
  physics.viewYaw = travelIntent(physics.vel, physics.yaw, currentSteer());
  return physics.attach(candidate);
}
function beginSwing() {
  if (!started || paused || anyDialog()) return;
  frameSelectedAnchor = false;
  if (attachLedge(undefined)) { tone(170, .08); autoAttachTime = 0; } else { autoAttachTime = 1.4; toast(physics.grounded ? 'No rooftop in reach. Jump with SHIFT and hold SPACE.' : 'Keep holding — waiting for a reachable ledge.', 1700); }
}
function setupEvents() {
  addEventListener('resize', resize);
  document.querySelectorAll('[data-mode]').forEach(button => { button.onclick = () => launch(button.dataset.mode); });
  $('route-action').onclick = () => launch('trial'); $('restart-trial').onclick = resetRun;
  for (const id of ['controls-button']) $(id).onclick = () => openDialog('controls-dialog');
  $('settings-button').onclick = () => openDialog('settings-dialog');
  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
  $('school-launch').onclick = () => { $('controls-dialog').close(); if (!started) launch(); else canvas.focus(); };
  $('settings-done').onclick = () => { $('settings-dialog').close(); canvas.focus(); };
  $('loss-dialog').addEventListener('cancel', event => event.preventDefault());
  $('play-again').onclick = () => { $('finish-dialog').close(); launch('trial'); };
  $('back-roam').onclick = () => { $('finish-dialog').close(); launch('roam'); };
  $('atmosphere-select').onchange = (event) => { preferences.atmosphere = event.target.value; atmosphere(); };
  $('quality-select').onchange = (event) => { preferences.quality = event.target.value; setQuality(); };
  $('camera-select').onchange = (event) => { preferences.camera = event.target.value; savePreferences(); };
  $('motion-toggle').onchange = (event) => { preferences.reduceMotion = event.target.checked; savePreferences(); };
  $('audio-toggle').onchange = (event) => toggleAudio(event.target.checked);
  $('sound-button').onclick = () => toggleAudio(!preferences.audio);
  updateSoundButton();
  addEventListener('keydown', (event) => {
    if ($('loss-dialog').open) {
      if (['Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) launch(event.code === 'Space' ? mode : mode === 'trial' ? 'roam' : 'trial');
      }
      return;
    }
    if (anyDialog()) return;
    if (paused) {
      if (event.code === 'Space' || event.code === 'Escape') {
        event.preventDefault();
        if (!event.repeat) { if (event.code === 'Space') setPaused(false); else quitToTitle(); }
      }
      return;
    }
    if (event.code === 'Escape') { event.preventDefault(); if (started && !event.repeat) setPaused(true); return; }
    if (event.code === 'Slash') { event.preventDefault(); openDialog('controls-dialog'); return; }
    if (['Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (!started) {
      if (event.code === 'Space' || event.code === 'Enter') { launch(); if (event.code === 'Space') keys.add('Space'); }
      return;
    }
    if (paused) return;
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'Space') beginSwing();
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') jumpAction();
    if (event.code === 'KeyC' && !physics.grounded && !physics.anchor && !physics.pointZip) physics.vel.y = Math.max(-65, physics.vel.y - 18);
    if (event.code === 'KeyQ') { orbit = 0; pitch = .1; }
    if (event.code === 'KeyR') resetRun();

  });
  addEventListener('keyup', (event) => { const wasHeld = keys.delete(event.code); if (wasHeld && event.code === 'Space' && !held('Space')) { physics.release({intentional:true}); autoAttachTime = 0; } });
  addEventListener('blur', () => { clearInput(); if (started && !anyDialog()) setPaused(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (started) setPaused(true); } previousTime = performance.now(); });
  inputCleanups.push(bindJoystick($('steering-joystick'), {
    enabled: () => started && !physics.lost && !paused && !anyDialog(),
    change: value => {
      joystickSteering = value;
      $('joystick-thumb').style.transform = `translateX(${value * 30}px)`;
    },
  }));
  inputCleanups.push(bindLook(canvas, {
    enabled: () => started && !physics.lost && !paused && !anyDialog(),
    change: (dx,dy) => { orbit -= dx * .005; pitch = THREE.MathUtils.clamp(pitch + dy * .003, -.35, .65); },
  }));
  canvas.addEventListener('dblclick', () => { orbit = 0; pitch = .1; });
  $('jump-action').onclick = jumpAction;
  document.querySelectorAll('[data-touch]').forEach(button => {
    const mapping = { swing: 'Space', left: 'ArrowLeft', right: 'ArrowRight' };
    const code = mapping[button.dataset.touch];
    inputCleanups.push(bindHold(button, {
      enabled: () => started && !physics.lost && !paused && !anyDialog(),
      press: () => {
        if (button.dataset.touch !== 'swing') { touchKeys.add(code); return; }
        touchKeys.add(code);
        if (code === 'Space') beginSwing();
      },
      release: (released) => {
        touchKeys.delete(code);
        if (code === 'Space' && !held('Space')) { physics.release({intentional:released}); autoAttachTime = 0; }
      },
    }));
  });
}

function updatePhysics(dt) {
  if (physics.lost) return { turn: 0, forward: 0 };
  const steer = currentSteer();
  const turn = physics.grounded ? 0 : steer, reel = 0;
  if (physics.grounded) physics.yaw = panView(physics.yaw, () => false, dt, -steer);
  physics.viewYaw = travelIntent(physics.vel, physics.yaw, steer);
  const forward = physics.grounded ? Number(held('ArrowUp') || held('KeyW')) - Number(held('ArrowDown') || held('KeyS')) : 0;
  const strafe = 0;
  const heading = physics.grounded ? physics.yaw : travelIntent(physics.vel, physics.yaw, 0);
  const difference = Math.atan2(Math.sin(heading-viewYaw),Math.cos(heading-viewYaw));
  viewYaw += difference * (1-Math.exp(-dt*4));
  // Steering brings the optional look offset back behind the horse.
  if (Math.abs(steer) > .05) orbit *= Math.exp(-dt * 4);
  const previous = { ...physics.pos };
  physics.step(dt, { turn, forward, strafe, reel, swingHeld: held('Space'), swingTarget: undefined, boost: false });
  if (physics.lost) { loseRun(); return { turn: 0, forward: 0 }; }
  if ((physics.attachmentCount || 0) !== lastAttachmentCount) { lastAttachmentCount = physics.attachmentCount || 0; ropeRipple = 1; tone(190, .065); }
  if (autoAttachTime > 0 && held('Space')) { autoAttachTime -= dt; if (attachLedge(undefined)) autoAttachTime = 0; }
  if (physics.resetCount !== lastReset) { lastReset = physics.resetCount; toast('Back in the city. Keep your line inside the island.'); }
  if (physics.lastImpact && physics.lastImpact.time !== lastImpact) { lastImpact = physics.lastImpact.time; if (physics.lastImpact.speed > 16) tone(65, .08); }
  if (running) {
    elapsed += dt;
    const target = city.route[checkpoint];
    if (target) {
      // Sweep the entire movement segment so fast flight cannot skip a gate.
      const start = new THREE.Vector3(previous.x, previous.y, previous.z);
      const end = new THREE.Vector3(physics.pos.x, physics.pos.y, physics.pos.z);
      const direction = end.clone().sub(start), denominator = direction.lengthSq();
      const t = denominator ? THREE.MathUtils.clamp(target.clone().sub(start).dot(direction) / denominator, 0, 1) : 0;
      if (start.addScaledVector(direction, t).distanceTo(target) < 9.8) {
        checkpoint += 1; checkpointPulse = 1; physics.energy = Math.min(1, physics.energy + .25); tone(500 + checkpoint * 60, .13);
        if (checkpoint >= city.route.length) finishRun(); else { toast(`Checkpoint ${checkpoint} / ${city.route.length} · Boost replenished`, 1200); updateCourse(); }
      }
    }
  }
  return { turn, forward };
}
function updateHorse(dt, input) {
  const feel = started ? traversalFeel(physics, preferences.reduceMotion) : null;
  let position, speed, grounded, swinging, verticalSpeed;
  if (!started) {
    position = { x: city.spawn.x, y: city.spawn.y, z: city.spawn.z };
    speed = 0; grounded = false; swinging = true; verticalSpeed = 0;
    horse.group.rotation.set(-Math.PI / 2, .08, 0, 'YXZ');
  } else {
    position = physics.pos; speed = Math.hypot(physics.vel.x, physics.vel.z); grounded = physics.grounded; swinging = !!physics.anchor; verticalSpeed = physics.vel.y;
    const pitchGoal = grounded ? 0 : physics.wallRun ? -.8 : THREE.MathUtils.clamp(-physics.vel.y * .008, -.32, .3);
    horse.group.rotation.x = THREE.MathUtils.damp(horse.group.rotation.x, pitchGoal, 4, dt);
    horse.group.rotation.y = physics.grounded ? physics.yaw : travelIntent(physics.vel, physics.yaw, 0);
    horse.group.rotation.z = THREE.MathUtils.damp(horse.group.rotation.z, -input.turn * (preferences.reduceMotion ? .08 : .18 + feel.swing * .12), 5, dt);
  }
  horse.group.position.set(position.x, position.y - 2.2, position.z);
  horsePosition.set(position.x, position.y, position.z);
  horse.update(dt, { feel, reduceMotion: preferences.reduceMotion, hanging: !started, time: now, speed, grounded, swinging, turn: input.turn, verticalSpeed, tension: started ? physics.tension || 0 : .5, stretch: started ? physics.stretch || 0 : 0 });
  if (!started) {
    horse.group.updateMatrixWorld(true);
    horse.hangingAttachment.getWorldPosition(tetherStart);
    // Keep the gaze steady while the whole hanging pose drifts gently sideways.
    horse.group.position.add(new THREE.Vector3(city.spawn.x, city.spawn.y + (shell.clientWidth < 760 ? -.5 : 3), city.spawn.z).sub(tetherStart));
    horse.group.position.x += Math.sin(now * .8) * .14;
    horse.group.updateMatrixWorld(true);
  }
}
function updateCamera(dt) {
  const feel = started ? traversalFeel(physics, preferences.reduceMotion) : {distance:0,height:0,fov:0,lookAhead:0};
  // Follow translation immediately; ease only the framing change, not the horse's motion.
  if (started) {
    cameraTravel.copy(horsePosition).sub(cameraTrackedHorse);
    camera.position.add(cameraTravel); cameraTarget.add(cameraTravel);
  }
  cameraTrackedHorse.copy(horsePosition);
  if (started && frameSelectedAnchor) {
    const candidate = physics.findAnchor();
    if (candidate !== facingAnchor) startPivotReveal();
    facingAnchor = candidate;
  }
  if (started && facingAnchor) viewYaw = turnTowardAnchor(viewYaw, horsePosition, facingAnchor, dt);

  if (!started) {
    const angle = .08 + orbit;
    const narrow = shell.clientWidth < 760;
    const distance = narrow ? 18 : 10.5;
    desiredCamera.set(horsePosition.x + Math.sin(angle) * distance, horsePosition.y + 2.1 + pitch * 4, horsePosition.z + Math.cos(angle) * distance);
    desiredTarget.set(horsePosition.x - (narrow ? 2 : 8), horsePosition.y + .3, horsePosition.z - 22);
    desiredTarget.lerp(horsePosition, Math.min(1, Math.abs(orbit) * 1.5 + Math.abs(pitch - .1)));
  } else {
    const speed = Math.hypot(physics.vel.x, physics.vel.z);
    const baseDistance = preferences.camera === 'wide' ? 19 : preferences.camera === 'close' ? 6 : 8.5;
    const distance = baseDistance + (preferences.reduceMotion ? 0 : Math.min(speed * .035, 2)) + feel.distance;
    const yaw = viewYaw + orbit;
    desiredCamera.set(horsePosition.x + Math.sin(yaw) * distance, horsePosition.y + 3 + pitch * distance + feel.height, horsePosition.z + Math.cos(yaw) * distance);
    desiredTarget.set(horsePosition.x - Math.sin(viewYaw) * 7, horsePosition.y + .8, horsePosition.z - Math.cos(viewYaw) * 7);
    // Look slightly into travel without overriding a manually panned view.
    if (!frameSelectedAnchor && Math.abs(orbit) < .1 && speed > 1) {
      const alignment = (-Math.sin(viewYaw) * physics.vel.x - Math.cos(viewYaw) * physics.vel.z) / speed;
      const ahead = feel.lookAhead * Math.max(0, alignment);
      desiredTarget.x += physics.vel.x / speed * ahead;
      desiredTarget.z += physics.vel.z / speed * ahead;
    }
    // Keep the player's chosen view until the run resets.
    desiredTarget.lerp(horsePosition, Math.min(1, Math.abs(orbit) * 1.5 + Math.abs(pitch - .1)));
    // Shorten the chase camera before it enters a facade.
    const delta = desiredCamera.clone().sub(horsePosition);
    for (let step = 1; step <= 14; step++) {
      const point = horsePosition.clone().addScaledVector(delta, step / 14);
      if (city.buildings.some(b => point.y < b.height + 1 && point.x > b.minX - 1 && point.x < b.maxX + 1 && point.z > b.minZ - 1 && point.z < b.maxZ + 1)) { desiredCamera.copy(horsePosition).addScaledVector(delta, Math.max(.15, (step - 1) / 14)); desiredCamera.y += 1; break; }
    }
    desiredCamera.y = Math.max(desiredCamera.y, 2.7);
    const fov = preferences.reduceMotion ? 57 : 54 + Math.min(speed * .1, 9) + feel.fov;
    camera.fov = THREE.MathUtils.damp(camera.fov, fov, 6, dt); camera.updateProjectionMatrix();
  }
  const framedAnchor = started && frameSelectedAnchor ? physics.findAnchor() : null;
  if (framedAnchor) {
    previewAge += dt;
    revealAnchor(camera, cameraTarget, horsePosition, framedAnchor, previewStartOffset, previewLookOffset, previewAge, city.buildings, anchorViewState);
  } else {
    camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * (started ? 3.5 : 2.8)));
    cameraTarget.lerp(desiredTarget, 1 - Math.exp(-dt * (started ? 3.5 : 7)));
  }
  camera.lookAt(cameraTarget); camera.updateMatrixWorld(true);
  if (renderFrames % 8 === 0) { sun.position.set(horsePosition.x - 150, horsePosition.y + 105, horsePosition.z + 85); sun.target.position.copy(horsePosition); }
}
function updateRope() {
  const anchor = started ? (physics.anchor || physics.pointZip?.anchor) : { x: city.spawn.x, y: city.spawn.y + 60, z: city.spawn.z };
  rope.group.visible = !!anchor;
  if (!anchor) return;
  horse.group.updateMatrixWorld(true); (started ? horse.attachment : horse.hangingAttachment).getWorldPosition(tetherStart);
  const end = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
  const distance = tetherStart.distanceTo(end);
  const tension = started ? physics.pointZip ? 1 : physics.tension || 0 : .5;
  const slack = started && !physics.pointZip ? Math.max(0, physics.ropeLength - distance) * .33 : 0;
  if (Math.abs(tension - previousTension) > .22) ropeRipple = Math.max(ropeRipple, .4);
  previousTension = tension;
  const side = new THREE.Vector3().subVectors(end, tetherStart).cross(new THREE.Vector3(0, 1, 0)).normalize();
  for (let i = 0; i < 33; i++) {
    const t = i / 32;
    const ripple = Math.sin(t * Math.PI) * Math.sin(t * 24 - now * 15) * (.015 + ropeRipple * .15) * (1 - tension * .65);
    ropePoints[i * 3] = THREE.MathUtils.lerp(tetherStart.x, end.x, t) + side.x * ripple;
    ropePoints[i * 3 + 1] = THREE.MathUtils.lerp(tetherStart.y, end.y, t) - Math.sin(t * Math.PI) * slack;
    ropePoints[i * 3 + 2] = THREE.MathUtils.lerp(tetherStart.z, end.z, t) + side.z * ripple;
  }
  rope.update(ropePoints, tension, !started);
}
function updateParticles() {
  const speed = started ? Math.hypot(physics.vel.x, physics.vel.y, physics.vel.z) : 0;
  streaks.material.opacity = preferences.reduceMotion ? 0 : THREE.MathUtils.clamp((speed - 31) / 180, 0, .19);
  if (streaks.material.opacity <= 0) return;
  const forward = new THREE.Vector3(-Math.sin(physics.yaw), 0, -Math.cos(physics.yaw));
  for (let i = 0; i < 70; i++) {
    const phase = (now * (speed * .04 + 1) + i * .331) % 1;
    const side = Math.sin(i * 433.13) * 18, height = Math.cos(i * 712.19) * 14;
    const z = 20 - phase * 40;
    const x = horsePosition.x + Math.cos(physics.yaw) * side + forward.x * z;
    const y = horsePosition.y + height;
    const zz = horsePosition.z - Math.sin(physics.yaw) * side + forward.z * z;
    particlePositions.set([x, y, zz, x - forward.x * 1.3, y, zz - forward.z * 1.3], i * 6);
  }
  streaks.geometry.attributes.position.needsUpdate = true;
}
function snapBurst() {
  if (physics.lost || physics.grounded || physics.anchor) return 0;
  const jump = physics.lastSnap && physics.lastSnap.gain > 1 ? Math.max(0, 1 - (physics.time - physics.lastSnap.time) / .45) : 0;
  const zip = Math.max(0, 1 - (physics.time - physics.zipBurstAt) / .7);
  return Math.max(jump, zip, physics.pointZip ? .75 : 0);
}
function updateUI() {
  physics.viewYaw = travelIntent(physics.vel, physics.yaw, currentSteer());
  const debug = physics.swingTelemetry();
  $('swing-debug').hidden = !started || !(location.hostname === 'localhost' || location.hostname === '127.0.0.1' || new URLSearchParams(location.search).get('debug') === '1');
  $('debug-speed').textContent = `${Math.round(debug.speed * 3.6)} km/h`;
  $('debug-phase').textContent = `${(physics.pointZip ? 'point-zip' : traversalFeel(physics).phase).toUpperCase()} · ${debug.phase}`;
  $('debug-angle').hidden = debug.angle === null;
  $('debug-angle').style.left = `${(debug.angle || 0) / 180 * 100}%`;
  $('debug-detail').textContent = `${debug.angle === null ? 'No tether' : `${Math.round(debug.angle)}° from bottom`} · vertical ${debug.verticalSpeed.toFixed(1)} m/s`;
  $('debug-snap').textContent = debug.lastSnap ? `JUMP ${Math.round(debug.lastSnap.before * 3.6)} → ${Math.round(debug.lastSnap.after * 3.6)} km/h · ${Math.max(0, physics.time - debug.lastSnap.time).toFixed(1)}s ago` : 'Jump: early for speed · later for height';
  const speed = started ? Math.hypot(physics.vel.x, physics.vel.y, physics.vel.z) * 3.6 : 0;
  $('speed').textContent = Math.round(speed).toString();
  $('speed-bar').style.width = `${Math.min(speed / 250 * 100, 100)}%`;
  $('altitude').textContent = Math.round(horsePosition.y).toString();
  $('energy-bar').style.width = `${physics.energy * 100}%`;
  const active = physics.anchor;
  $('flight-state').textContent = physics.lost ? 'Run over' : physics.grounded ? 'On a rooftop' : active ? 'Swinging' : physics.vel.y > 2 ? 'Soaring' : 'Falling';
  $('tether-status').textContent = !started ? 'Ready when you are' : physics.lost ? 'R to try again' : active ? `${Math.round((physics.tension || 0) * 100)}% tension` : physics.grounded ? 'SHIFT to jump' : 'Ready to swing';
  $('tension-bar').style.width = `${Math.min(1, physics.tension || 0) * 100}%`;
  const lowAltitude = started && !physics.lost && !physics.grounded && horsePosition.y < 20;
  shell.dataset.lowAltitude = String(lowAltitude);
  $('altitude-note').textContent = physics.lost ? 'On the ground' : lowAltitude ? 'Mind the pavement' : 'Above the street';
  $('timer').textContent = formatTime(elapsed); $('checkpoint-count').textContent = `${String(checkpoint).padStart(2, '0')} / 08`; $('progress-bar').style.width = `${checkpoint / 8 * 100}%`;
  const swingAnchor = active || physics.findAnchor();
  displayedAnchor = swingAnchor;
  const action = physics.contextualAction(travelIntent(physics.vel, physics.yaw, 0));
  pointTarget = action.target || null;
  $('jump-action').textContent = action.label;
  $('jump-action').setAttribute('aria-label', action.label);
  $('jump-action').disabled = action.kind === 'wait';
  const anchor = pointTarget?.staging || null;
  const anchorNumber = anchor ? city.anchors.findIndex(a => a.x === anchor.x && a.y === anchor.y && a.z === anchor.z) + 1 : 0;
  updateWebTarget($('web-target'), $('web-target-state'), $('web-target-distance'), { started, anchor, position: physics.pos, attached: !!active, anchorNumber });
  if (started && anchor) {
    projected.set(anchor.x, anchor.y, anchor.z).project(camera);
    const occluded = cameraClearance(camera.position, anchor, city.buildings) < 1;
    $('anchor-marker').classList.toggle('occluded', occluded);
    const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < .96 && Math.abs(projected.y) < .9;
    $('anchor-marker').classList.toggle('hidden', !visible);
    if (visible) { $('anchor-marker').style.left = `${(projected.x * .5 + .5) * 100}%`; $('anchor-marker').style.top = `${(-projected.y * .5 + .5) * 100}%`; $('anchor-label').textContent = 'Zip to point'; if (occluded) $('anchor-label').textContent += ' · Behind building'; }
  } else $('anchor-marker').classList.add('hidden');
  if (running && city.route[checkpoint]) { $('checkpoint-distance').textContent = `${Math.round(horsePosition.distanceTo(city.route[checkpoint]))} m`; }
  const district = physics.pos.z < -650 ? 'Herald Square' : physics.pos.z < -250 ? 'Midtown South' : 'Midtown West';
  $('district').textContent = district; $('map-coordinates').textContent = district;
  drawMinimap();
}
function drawMinimap() {
  const map = $('minimap'), ctx = map.getContext('2d'), scale = .6, width = map.width, height = map.height;
  const pos = started ? physics.pos : city.spawn;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#eee6d7'; ctx.fillRect(0, 0, width, height);
  for (const b of city.buildings) {
    const x = width / 2 + (b.minX - pos.x) * scale, z = height / 2 + (b.minZ - pos.z) * scale;
    if (x > width || z > height || x + (b.maxX - b.minX) * scale < 0 || z + (b.maxZ - b.minZ) * scale < 0) continue;
    ctx.fillStyle = b.height > 80 ? '#a6b4a1' : '#c9cfba'; ctx.fillRect(x, z, (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
  }
  if (running) {
    ctx.strokeStyle = '#a3665070'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(width / 2, height / 2);
    city.route.slice(checkpoint).forEach(point => ctx.lineTo(width / 2 + (point.x - pos.x) * scale, height / 2 + (point.z - pos.z) * scale)); ctx.stroke(); ctx.setLineDash([]);
    const next = city.route[checkpoint];
    if (next) { ctx.strokeStyle = '#a36650'; ctx.beginPath(); ctx.arc(width / 2 + (next.x - pos.x) * scale, height / 2 + (next.z - pos.z) * scale, 5, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.strokeStyle = '#657b6840'; ctx.beginPath(); ctx.arc(width / 2, height / 2, 20, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(-physics.yaw); ctx.fillStyle = '#a36650'; ctx.shadowColor = '#a36650'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); ctx.restore();
}

function enableAudio() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 3, audioContext.sampleRate), samples = buffer.getChannelData(0);
      let value = 0;
      for (let i = 0; i < samples.length; i++) { value = (value + (Math.random() * 2 - 1) * .02) / 1.02; samples[i] = value * 3.5; }
      const source = audioContext.createBufferSource(); source.buffer = buffer; source.loop = true;
      windFilter = audioContext.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 650;
      windGain = audioContext.createGain(); windGain.gain.value = 0; source.connect(windFilter).connect(windGain).connect(audioContext.destination); source.start();
      const hum = audioContext.createOscillator(); hum.type = 'sine'; hum.frequency.value = 57;
      cityGain = audioContext.createGain(); cityGain.gain.value = 0; hum.connect(cityGain).connect(audioContext.destination); hum.start();
    }
    audioContext.resume();
  } catch { toast('Audio is unavailable in this browser.'); }
}
function tone(frequency, duration) {
  if (!audioContext || !preferences.audio) return;
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime); oscillator.frequency.exponentialRampToValueAtTime(frequency * .6, audioContext.currentTime + duration);
  gain.gain.setValueAtTime(.06, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
}
function toggleAudio(value) { preferences.audio = value; if (value) enableAudio(); $('audio-toggle').checked = value; savePreferences(); updateSoundButton(); }
function updateSoundButton() { $('sound-button').setAttribute('aria-label', preferences.audio ? 'Mute sound' : 'Enable sound'); $('sound-button').innerHTML = preferences.audio ? '<svg viewBox="0 0 24 24"><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3c2 2 2 6 0 8m3-11c4 4 4 10 0 14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 5 6m0-6-5 6"/></svg>'; }
function updateAudio() {
  if (!audioContext || !windGain) return;
  const active = preferences.audio && !paused && !anyDialog() && started;
  const speed = Math.hypot(physics.vel.x, physics.vel.y, physics.vel.z);
  windGain.gain.setTargetAtTime(active ? Math.min(.35, speed / 180) : 0, audioContext.currentTime, .2);
  windFilter.frequency.setTargetAtTime(300 + speed * 35, audioContext.currentTime, .2);
  cityGain.gain.setTargetAtTime(active ? .012 : 0, audioContext.currentTime, .2);
}
function frame(time) {
  requestAnimationFrame(frame);
  if (document.hidden) { previousTime = time; return; }
  const dt = Math.min((time - previousTime) / 1000, .05); previousTime = time;
  const playing = started && !physics.lost && !paused && !anyDialog();
  if (playing || !started) now += dt;
  let input = { turn: 0, forward: 0 };
  if (playing) {
    accumulator += dt;
    while (accumulator >= 1 / 120 && !physics.lost) { input = updatePhysics(1 / 120); accumulator -= 1 / 120; }
  } else accumulator = 0;
  const visualDt = (playing && !physics.lost) || !started ? dt : 0;
  updateHorse(visualDt, input); updateCamera(visualDt); updateRope(); updateParticles();
  if (playing || !started) city.update(dt, now);
  ropeRipple = Math.max(0, ropeRipple - dt * 2);
  skyMaterial.uniforms.time.value = now; checkpointPulse = Math.max(0, checkpointPulse - dt * 1.5);
  if (running && rings[checkpoint]) rings[checkpoint].rotation.z = Math.sin(now * .7) * .04;
  if (time - lastUI > 75) { updateUI(); updateAudio(); lastUI = time; }
  cinematics.setSpeedBurst(preferences.reduceMotion ? 0 : snapBurst());
  cinematics.render(scene); renderFrames++;
}
boot();
