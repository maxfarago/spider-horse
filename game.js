import * as THREE from './vendor/three.module.js';
import { createCity } from './city.js';
import { createHorse, wallClimbOrientation } from './horse.js';
import { createWeb } from './web.js';
import { updateWebTarget } from './web-target.js';
import { cameraClearance, revealAnchor, turnTowardAnchor, flightCameraFrame } from './anchor-camera.js';
import { bindHold, bindJoystick, bindLook, travelIntent, panView } from './controls.js';
import { traversalFeel } from './traversal-feel.js';
import { createDelivery, deliveryTarget, advanceDelivery } from './pony-express.js';
import { SwingOnboarding, OPENING_SPAWN } from './onboarding.js';
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
let renderer, scene, camera, city, horse, physics, sun, ambient, fill, sky, skyMaterial, cinematics;
const onboarding = new SwingOnboarding();
let started = false, paused = false, mode = 'express', delivery, elapsed = 0, running = false;
let now = 0, toastTimeout, renderFrames = 0, previousTime = performance.now(), accumulator = 0;
let frameSelectedAnchor = false, facingAnchor = null, viewYaw = 0, previewAge = 0;
const anchorViewState = {};
const previewStartOffset = new THREE.Vector3(), previewLookOffset = new THREE.Vector3();
let orbit = 0, pitch = .1;
let pointTarget = null;
let displayedAnchor = null, joystickSteering = 0, joystickForward = 0;
let lastImpact = -1, lastReset = 0, lastUI = 0, autoAttachTime = 0;
let previousTension = 0, ropeRipple = 0, lastAttachmentCount = 0;
let audioContext, windGain, windFilter, cityGain;
const particlePositions = new Float32Array(70 * 6);
const cameraTrackedHorse = new THREE.Vector3(), cameraTravel = new THREE.Vector3();
const cameraTarget = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), desiredTarget = new THREE.Vector3();
const horsePosition = new THREE.Vector3(), projected = new THREE.Vector3(), tetherStart = new THREE.Vector3();
const flightRotation = new THREE.Euler(0, 0, 0, 'XYZ');
const climbRotation = new THREE.Quaternion(), climbNormal = new THREE.Vector3();
let climbBlend = 0;
const ropePoints = new Float32Array(33 * 3);
let rope, streaks, deliveryMarker, pickupPackage, carriedPackage;

function toast(message, duration = 3000) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), duration);
}
function savePreferences() { try { localStorage.setItem('skystride.preferences', JSON.stringify(preferences)); } catch { /* Optional persistence. */ } }
function anyDialog() { return document.querySelector('dialog[open]') !== null; }
function clearInput() { displayedAnchor = null; keys.clear(); inputCleanups.forEach(clear => clear()); touchKeys.clear(); if (!['swing', 'release'].includes(onboarding.stage)) physics?.release(); if (physics) physics.pointZip = null; autoAttachTime = 0; }
function openDialog(id) { clearInput(); $(id).showModal(); }
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
  sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 24), skyMaterial);
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
function makeParcel() {
  const parcel = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.3), new THREE.MeshStandardMaterial({ color: '#c79560', roughness: .85 }));
  box.castShadow = true; parcel.add(box);
  const tape = new THREE.MeshPhysicalMaterial({ color: '#a9233c', roughness: .32, metalness: .08,
    sheen: 1, sheenColor: new THREE.Color('#ed8090'), sheenRoughness: .45, side: THREE.DoubleSide });
  parcel.add(new THREE.Mesh(new THREE.BoxGeometry(.23, 1.215, 1.315), tape));
  parcel.add(new THREE.Mesh(new THREE.BoxGeometry(1.615, 1.215, .19), tape));
  // Broad, gently crowned satin strips: folded loops rather than round tubing.
  function ribbonStrip(points, width, across, tail = false) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const vertices = [], indices = [], rows = 40, columns = 4;
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= columns; col++) {
        const u = col / columns, t = row / rows;
        // Pull the middle of the final edge inward to form a swallowtail cut.
        const cut = tail ? .12 * (1 - Math.abs(u * 2 - 1)) * Math.pow(t, 10) : 0;
        const progress = t - cut;
        const point = curve.getPoint(progress);
        let fold = 0;
        if (tail) {
          // Follow the box exterior with a rounded quarter-turn at its edge.
          // A free spline cuts through this corner and makes the ribbon disappear.
          fold = Math.max(0, Math.min(1, (progress - .5) / .2)) * Math.PI / 2;
          point.x = Math.sign(points[0][0]) * (.06 + .32 * progress);
          if (progress < .5) { point.y = .66; point.z = .03 + 1.16 * progress; }
          else if (progress <= .7) { point.y = .58 + .08 * Math.cos(fold); point.z = .61 + .08 * Math.sin(fold); }
          else { point.y = .58 - (progress - .7) * 1.2; point.z = .69; }
        }
        const spread = width * (tail ? .8 + .2 * t : .55 + .45 * Math.sin(Math.PI * t));
        point.addScaledVector(across, (u - .5) * spread);
        const crown = Math.sin(u * Math.PI) * .025;
        point.y += crown * Math.cos(fold);
        point.z += crown * Math.sin(fold);
        vertices.push(point.x, point.y, point.z);
        if (row < rows && col < columns) {
          const i = row * (columns + 1) + col;
          indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const ribbon = new THREE.Mesh(geometry, tape); ribbon.castShadow = true; parcel.add(ribbon);
  }
  for (const side of [-1, 1]) {
    ribbonStrip([[0, .69, 0], [side * .3, .91, -.05], [side * .57, .87, -.07],
      [side * .59, .73, -.02], [side * .3, .66, .06], [0, .68, .02]], .27, new THREE.Vector3(0, 0, 1));
    ribbonStrip([[side * .06, .67, .03], [side * .19, .66, .27],
      [side * .29, .63, .58], [side * .34, .5, .68], [side * .38, .22, .7]], .22, new THREE.Vector3(1, 0, 0), true);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), tape);
  knot.position.set(0, .72, .015); knot.scale.set(.14, .085, .13); knot.castShadow = true; parcel.add(knot);
  return parcel;
}
const beaconUniforms = { time: { value: 0 }, motion: { value: 1 } };

function makeDelivery() {
  delivery = createDelivery(city.buildings, city.spawn);
  deliveryMarker = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: '#f4f4f4', transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
  const pad = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 64), material);
  pad.rotation.x = -Math.PI / 2; deliveryMarker.add(pad);
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: beaconUniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=-p.xyz;gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform float time; uniform float motion; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main(){
        float edge=pow(max(dot(normalize(vNormal),normalize(vView)),0.),1.6);
        float heightFade=pow(1.-vUv.y,1.8)*(1.-smoothstep(.65,1.,vUv.y));
        float phase=fract(vUv.y*4.-time*.22*motion);
        // Three slim bright rings per group, over an uninterrupted faint beam.
        float distanceToBand=min(abs(phase-.14),min(abs(phase-.205),abs(phase-.27)));
        float feather=max(fwidth(phase),.002);
        float bands=1.-smoothstep(.007,.007+feather,distanceToBand);
        float topFade=1.-smoothstep(.70,1.,vUv.y);
        float opacity=mix(.12*heightFade,topFade,bands);
        gl_FragColor=vec4(vec3(1.),edge*opacity);

      }`,
  });
  // A broad shaft of light, feathered at its sides and fading into the sky.
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 3.8, 150, 64, 1, true), beamMaterial);
  beam.position.y = 75; deliveryMarker.add(beam);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;void main(){float r=length(vUv-.5)*2.;float a=pow(max(0.,1.-r),3.);gl_FragColor=vec4(1.,1.,1.,a*.7);}`,
  }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = .03; deliveryMarker.add(glow);
  scene.add(deliveryMarker);
  pickupPackage = makeParcel(); scene.add(pickupPackage);
  carriedPackage = makeParcel(); carriedPackage.scale.setScalar(.45); carriedPackage.position.set(0, 1.9, .2); horse.group.add(carriedPackage);
  updateDelivery();
}
function updateDelivery() {
  const active = started && mode === 'express' && running;
  const target = deliveryTarget(delivery);
  deliveryMarker.visible = active;
  deliveryMarker.position.set(target.x, target.y - 1.5, target.z);
  deliveryMarker.children[0].scale.setScalar(target.radius);
  pickupPackage.position.set(delivery.pickup.x, delivery.pickup.y + .5, delivery.pickup.z);
  pickupPackage.visible = active && delivery.phase === 'pickup';
  carriedPackage.visible = active && delivery.phase === 'carrying';
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
    // Preserve depth separation between distant façades and their thin trim.
    camera = new THREE.PerspectiveCamera(54, shell.clientWidth / shell.clientHeight, 1, 3000);
    createSky(); cinematics = createCinematics(renderer, camera);
    ambient = new THREE.HemisphereLight('#b4c8d1', '#80745f', 2.5); scene.add(ambient);
    sun = new THREE.DirectionalLight('#ffe2aa', 3.5); sun.position.set(-150, 105, 85); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -110; sun.shadow.camera.right = 110; sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110; sun.shadow.camera.near = 10; sun.shadow.camera.far = 600;
    sun.shadow.bias = -.00012; sun.shadow.normalBias = .055; sun.shadow.radius = 2; scene.add(sun); scene.add(sun.target);
    fill = new THREE.DirectionalLight('#c8ddeb', .85); fill.position.set(100, 100, 90); scene.add(fill);
    city = createCity(scene);
    horse = await horseLoad; horse.group.scale.setScalar(1.35); scene.add(horse.group);
    physics = new SwingPhysics({ ...city, spawn: OPENING_SPAWN, initialVelocity: { x: 0, y: -18, z: -8 }, fatalGround: true });
    const [environmentHDR, cloudHDR] = await environmentLoad;
    environmentHDR.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(environmentHDR).texture; pmrem.dispose();
    scene.environmentRotation.y = -.75;
    skyMaterial.uniforms.hdrSky.value = cloudHDR; skyMaterial.uniforms.hasHDR.value = 1;
    makeEffects(); makeDelivery(); setQuality(); atmosphere();
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
    window.skystride = { getState: () => ({ started, paused, onboarding: onboarding.stage, mode, delivery: structuredClone(delivery), elapsed, running, physics: physics.snapshot(), drawCalls: cinematics.stats.calls, triangles: cinematics.stats.triangles }), start: launch, reset: resetRun };
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
  for (const id of ['loss-dialog', 'finish-dialog']) if ($(id).open) $(id).close();
  started = true; paused = false; mode = nextMode;
  document.body.classList.add('playing'); $('intro').classList.add('hidden'); $('live-indicator').classList.remove('hidden'); $('reticle').classList.remove('hidden'); $('pause-chip').classList.add('hidden');
  horse.group.rotation.set(0, 0, 0, 'XYZ');
  flightRotation.set(0, 0, 0); climbBlend = 0;
  physics.reset(); lastImpact = -1; lastReset = physics.resetCount; elapsed = 0; delivery.phase = 'pickup'; running = mode === 'express';
  onboarding.reset();
  updateOnboarding();
  cameraTrackedHorse.set(physics.pos.x, physics.pos.y, physics.pos.z);
  camera.position.set(physics.pos.x + Math.sin(viewYaw) * 12, physics.pos.y + 5, physics.pos.z + Math.cos(viewYaw) * 12);
  cameraTarget.set(physics.pos.x, physics.pos.y, physics.pos.z); accumulator = 0;
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  $('route-card').classList.toggle('hidden', mode === 'express');
  updateDelivery();
  clearTimeout(toastTimeout); $('toast').classList.remove('visible');
  if (preferences.audio) enableAudio(); canvas.focus();
}
function updateOnboarding() {
  const prompt = $('onboarding-prompt');
  prompt.classList.toggle('hidden', !onboarding.waiting);
  const swing = webControlLabel() === 'Swing' ? 'SWING' : 'SPACE';
  const shift = webControlLabel() === 'Swing' ? 'the action button' : 'SHIFT';
  prompt.classList.toggle('reduce-motion', preferences.reduceMotion);
  const lesson = {
    boost: ['A little horse power', 'hit', shift, 'for speed boost', ''],
    hold: ['Grab some sky', 'hold', swing, 'to start swinging', `Keep holding ${swing} until it’s time to let go.`],
    release: ['Let it fly', 'release', swing, 'to soar', ''],
    zip: ['Hoof to roof', 'hit', shift, 'to ZIP to ledge', ''],
  }[onboarding.stage];
  const artwork = {
    boost: ['horse-speed-boost-square.png', 'A horse in sunglasses speeding above the city at sunset.'],
    release: ['horse-soar-lesson.png', 'A horse releasing its web and soaring above the city at sunset.'],
    zip: ['horse-zip-lesson.png', 'A horse pulling itself toward a rooftop ledge on a web.'],
    hold: ['horse-swing-lesson.png', 'A horse swinging between buildings from a web attached to its front hoof.'],
  }[onboarding.stage];
  $('lesson-art').classList.toggle('hidden', !artwork);
  if (artwork) {
    $('lesson-art').src = `./assets/${artwork[0]}`;
    $('lesson-art').alt = artwork[1];
  }
  prompt.classList.toggle('has-art', !!artwork);
  prompt.classList.toggle('has-hint', onboarding.stage === 'hold');
  $('lesson-hint').classList.toggle('hidden', onboarding.stage !== 'hold');
  if (lesson) {
    ['lesson-title', 'lesson-verb', 'lesson-key', 'lesson-action', 'lesson-hint'].forEach((id, i) => { $(id).textContent = lesson[i]; });
  }
}
function onboardingPress() {
  if (onboarding.stage !== 'hold') return false;
  if (!physics.attach(onboarding.anchor)) return false;
  onboarding.press(); updateOnboarding(); tone(170, .065);
  return true;
}
function releaseSwing(intentional) {
  if (onboarding.stage === 'fall' || onboarding.stage === 'hold') return;
  if (onboarding.stage === 'swing' && intentional) { launch(mode); return; }
  if (onboarding.stage === 'release') {
    if (!intentional) return;
    onboarding.release(physics.time); updateOnboarding();
  }
  physics.release({intentional}); autoAttachTime = 0;
}
let lossArtIndex = 0;
const lossArtDescriptions = [
  'A horse in sunglasses crash-landing on a city street.',
  'A horse in sunglasses sprawled on the street at sunset.',
  'A horse in sunglasses resting against a bent streetlamp.',
  'A horse in sunglasses lying upside down with its hooves in the air.',
];
function loseRun() {
  const art = $('loss-art');
  art.style.backgroundPosition = `${lossArtIndex % 2 ? 100 : 0}% ${lossArtIndex >= 2 ? 100 : 0}%`;
  art.setAttribute('aria-label', lossArtDescriptions[lossArtIndex]);
  lossArtIndex = (lossArtIndex + 1) % 4;
  running = false; paused = false; clearInput(); updateDelivery();
  $('pause-chip').classList.add('hidden');
  $('loss-stats').classList.toggle('hidden', mode === 'express');
  $('loss-switch').firstChild.textContent = mode === 'express' ? 'Try Free Roam ' : 'Try Pony Express ';
  $('loss-time').textContent = physics.time.toFixed(1);
  $('loss-distance').textContent = Math.round(physics.distanceTravelled).toLocaleString();
  $('loss-dialog').showModal(); tone(70, .2);
}
function resetRun() { if (!started) return; launch(mode); toast(mode === 'express' ? 'Fresh start. Make this one count.' : 'Back above Midtown. Take the leap.'); }
function finishRun() {
  running = false; clearInput(); updateDelivery();
  $('finish-dialog').showModal(); tone(660, .2); setTimeout(() => tone(990, .35), 160);
}
const pauseArtDescriptions = [
  'A horse taking a rooftop coffee break at sunset.',
  'A horse relaxing on a sunny rooftop.',
  'A horse watching the skyline under a full moon.',
  'A horse enjoying pizza on a sofa.',
  'A horse having coffee beside a rain-streaked window.',
  'A horse sitting on a bridge overlooking the sunset.',
  'A horse lounging in a sunny city park.',
  'A horse sipping coffee beneath rooftop string lights.',
  'A horse taking a snowy rooftop break.',
];
let pauseArtBag = [], previousPauseArt = -1;
function nextPauseArt() {
  if (!pauseArtBag.length) {
    pauseArtBag = pauseArtDescriptions.map((_, i) => i);
    for (let i = pauseArtBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pauseArtBag[i], pauseArtBag[j]] = [pauseArtBag[j], pauseArtBag[i]];
    }
    // The first pick of a new shuffle must differ from the last one shown.
    if (pauseArtBag.at(-1) === previousPauseArt) {
      [pauseArtBag[0], pauseArtBag[8]] = [pauseArtBag[8], pauseArtBag[0]];
    }
  }
  previousPauseArt = pauseArtBag.pop();
  const art = $('pause-art');
  art.style.backgroundPosition = `${previousPauseArt % 3 * 50}% ${Math.floor(previousPauseArt / 3) * 50}%`;
  art.setAttribute('aria-label', pauseArtDescriptions[previousPauseArt]);
}
function setPaused(value) { if (value && !paused) nextPauseArt(); paused = value; clearInput(); $('pause-chip').classList.toggle('hidden', !paused); $('pause-chip').classList.toggle('reduce-motion', preferences.reduceMotion); if (paused) $('resume-button').focus(); else canvas.focus(); }
function quitToTitle() {
  onboarding.stage = 'done'; updateOnboarding();
  clearInput(); started = false; paused = false; running = false;
  physics.reset(); updateDelivery();
  document.body.classList.remove('playing');
  $('intro').classList.remove('hidden');
  for (const id of ['pause-chip', 'live-indicator', 'reticle', 'web-target', 'anchor-marker']) $(id).classList.add('hidden');
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
  if (!started || paused || (!onboarding.freeControl && !['boost', 'zip'].includes(onboarding.stage)) || anyDialog() || physics.lost) return;
  physics.viewYaw = travelIntent(physics.vel, physics.yaw, currentSteer());
  const jumped = physics.contextualJump(travelIntent(physics.vel, physics.yaw, 0), onboarding.stage === 'zip' ? onboarding.target : onboarding.stage === 'boost' ? null : pointTarget); autoAttachTime = 0;
  onboarding.shift(jumped, physics.time); updateOnboarding();
  if (jumped && physics.pointZip) tone(380, .12);
}
function attachLedge(candidate) {
  physics.viewYaw = travelIntent(physics.vel, physics.yaw, currentSteer());
  return physics.attach(candidate);
}
function beginSwing() {
  if (!started || paused || !onboarding.freeControl || anyDialog()) return;
  frameSelectedAnchor = false;
  if (physics.perch) { toast('SHIFT to launch from your perch.', 1600); return; }
  if (attachLedge(undefined)) { tone(170, .08); autoAttachTime = 0; } else { autoAttachTime = 1.4; toast(physics.grounded ? 'No rooftop in reach. Jump with SHIFT and hold SPACE.' : 'Keep holding — waiting for a reachable ledge.', 1700); }
}
function setupEvents() {
  addEventListener('resize', resize);
  document.querySelectorAll('[data-mode]').forEach(button => { button.onclick = () => launch(button.dataset.mode); });
  $('route-action').onclick = () => launch('express');
  for (const id of ['controls-button']) $(id).onclick = () => openDialog('controls-dialog');
  $('settings-button').onclick = () => openDialog('settings-dialog');
  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
  $('school-launch').onclick = () => { $('controls-dialog').close(); if (!started) launch(); else canvas.focus(); };
  $('settings-done').onclick = () => { $('settings-dialog').close(); canvas.focus(); };
  $('loss-restart').onclick = () => launch(mode);
  $('loss-switch').onclick = () => launch(mode === 'express' ? 'roam' : 'express');
  $('loss-dialog').addEventListener('cancel', event => event.preventDefault());
  $('play-again').onclick = () => {
    $('finish-dialog').close();
    delivery = createDelivery(city.buildings, delivery.dropoff);
    launch('express');
  };
  $('atmosphere-select').onchange = (event) => { preferences.atmosphere = event.target.value; atmosphere(); };
  $('quality-select').onchange = (event) => { preferences.quality = event.target.value; setQuality(); };
  $('camera-select').onchange = (event) => { preferences.camera = event.target.value; savePreferences(); };
  $('motion-toggle').onchange = (event) => { preferences.reduceMotion = event.target.checked; savePreferences(); };
  $('audio-toggle').onchange = (event) => toggleAudio(event.target.checked);
  $('sound-button').onclick = () => toggleAudio(!preferences.audio);
  $('resume-button').onclick = () => setPaused(false);
  $('pause-quit-button').onclick = quitToTitle;
  updateSoundButton();
  addEventListener('keydown', (event) => {
    if ($('loss-dialog').open) {
      if (['Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) launch(event.code === 'Space' ? mode : mode === 'express' ? 'roam' : 'express');
      }
      return;
    }
    if (anyDialog()) return;
    if (onboarding.waiting && !paused) {
      if (['boost', 'zip'].includes(onboarding.stage) && ['ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault(); if (!event.repeat) jumpAction(); return;
      }
      if (event.code === 'Space' && ['hold', 'release'].includes(onboarding.stage)) {
        event.preventDefault();
        if (!event.repeat) { keys.add('Space'); if (onboarding.stage === 'hold') onboardingPress(); }
      }
      if (event.code !== 'Escape') return;
    }
    if (paused) {
      if (event.code === 'Tab') {
        event.preventDefault();
        const items = [...$('pause-chip').querySelectorAll('button, a[href]')];
        const current = items.indexOf(document.activeElement);
        items[(current + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
      if (event.code === 'Space' || event.code === 'Escape') {
        event.preventDefault();
        if (!event.repeat) { if (event.code === 'Space') setPaused(false); else quitToTitle(); }
      }
      return;
    }
    if (onboarding.stage === 'fall' && event.code !== 'Escape') { event.preventDefault(); return; }
    if (event.code === 'Escape') { event.preventDefault(); if (started && !event.repeat) setPaused(true); return; }
    if (event.code === 'Slash') { event.preventDefault(); openDialog('controls-dialog'); return; }
    if (['Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (!started) {
      if (event.code === 'Space' || event.code === 'Enter') { launch(); if (event.code === 'Space') keys.add('Space'); }
      return;
    }
    if (paused) return;
    if (onboarding.stage === 'swing' && !['Space', 'KeyR'].includes(event.code)) return;
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'Space') beginSwing();
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') jumpAction();
    if (event.code === 'KeyC' && !physics.grounded && !physics.anchor && !physics.pointZip) physics.vel.y = Math.max(-65, physics.vel.y - 18);
    if (event.code === 'KeyQ') { orbit = 0; pitch = .1; }
    if (event.code === 'KeyR') resetRun();

  });
  addEventListener('keyup', (event) => { const wasHeld = keys.delete(event.code); if (wasHeld && event.code === 'Space' && !held('Space')) { releaseSwing(true); } });
  addEventListener('blur', () => { clearInput(); if (started && !anyDialog()) setPaused(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (started) setPaused(true); } previousTime = performance.now(); });
  inputCleanups.push(bindJoystick($('steering-joystick'), {
    enabled: () => started && !physics.lost && !paused && !anyDialog() && onboarding.freeControl,
    change: (x, y) => {
      joystickSteering = x;
      joystickForward = -y;
      $('joystick-thumb').style.transform = `translate(${x * 30}px, ${y * 30}px)`;
    },
  }));
  inputCleanups.push(bindLook(canvas, {
    enabled: () => started && !physics.lost && !paused && !anyDialog() && onboarding.freeControl,
    change: (dx,dy) => { orbit -= dx * .005; pitch = THREE.MathUtils.clamp(pitch + dy * .003, -.35, .65); },
  }));
  canvas.addEventListener('dblclick', () => { orbit = 0; pitch = .1; });
  $('jump-action').onclick = jumpAction;
  document.querySelectorAll('[data-touch]').forEach(button => {
    const mapping = { swing: 'Space', left: 'ArrowLeft', right: 'ArrowRight' };
    const code = mapping[button.dataset.touch];
    inputCleanups.push(bindHold(button, {
      enabled: () => started && !physics.lost && !paused && !anyDialog() && onboarding.stage !== 'fall',
      press: () => {
        if (button.dataset.touch !== 'swing') { touchKeys.add(code); return; }
        touchKeys.add(code);
        if (code === 'Space' && !onboardingPress() && !onboarding.waiting) beginSwing();
      },
      release: (released) => {
        touchKeys.delete(code);
        if (code === 'Space' && !held('Space')) { releaseSwing(released); }
      },
    }));
  });
}

function updatePhysics(dt) {
  if (physics.lost) return { turn: 0, forward: 0 };
  const wasPerched = !!physics.perch;
  const steer = onboarding.freeControl ? currentSteer() : 0;
  const turn = physics.grounded ? 0 : steer, reel = 0;
  if (physics.grounded) physics.yaw = panView(physics.yaw, () => false, dt, -steer);
  physics.viewYaw = travelIntent(physics.vel, physics.yaw, steer);
  const forward = (physics.grounded || physics.wallRun) ? THREE.MathUtils.clamp(Number(held('ArrowUp') || held('KeyW')) - Number(held('ArrowDown') || held('KeyS')) + joystickForward, -1, 1) : 0;
  const strafe = 0;
  const heading = physics.grounded ? physics.yaw : travelIntent(physics.vel, physics.yaw, 0);
  const difference = Math.atan2(Math.sin(heading-viewYaw),Math.cos(heading-viewYaw));
  viewYaw += difference * (1-Math.exp(-dt*4));
  // Steering brings the optional look offset back behind the horse.
  if (Math.abs(steer) > .05) orbit *= Math.exp(-dt * 4);
  physics.step(dt, { turn, forward, strafe, reel, swingHeld: ['fall', 'seek-swing'].includes(onboarding.stage) ? false : held('Space'), swingTarget: undefined, autoRelease: onboarding.freeControl, boost: false });
  const previousStage = onboarding.stage;
  onboarding.update(physics);
  if (['fall', 'seek-zip'].includes(onboarding.stage)) {
    const action = physics.contextualAction(travelIntent(physics.vel, physics.yaw, 0));
    onboarding.updateContext(physics, action);
    if (onboarding.waiting) pointTarget = action.target || null;
  }
  if (previousStage !== onboarding.stage) {
    if (onboarding.stage === 'hold') clearInput();
    updateOnboarding();
  }
  if (!wasPerched && physics.perch) tone(180, .09);
  if (physics.lost) { loseRun(); return { turn: 0, forward: 0 }; }
  if ((physics.attachmentCount || 0) !== lastAttachmentCount) { lastAttachmentCount = physics.attachmentCount || 0; ropeRipple = 1; tone(190, .065); }
  if (autoAttachTime > 0 && held('Space')) { autoAttachTime -= dt; if (attachLedge(undefined)) autoAttachTime = 0; }
  if (physics.resetCount !== lastReset) { lastReset = physics.resetCount; toast('Back in the city. Keep your line inside the island.'); }
  if (physics.lastImpact && physics.lastImpact.time !== lastImpact) { lastImpact = physics.lastImpact.time; if (physics.lastImpact.speed > 16) tone(65, .08); }
  if (running) {
    elapsed += dt;
    const event = advanceDelivery(delivery, physics);
    if (event === 'carrying') {
      updateDelivery(); tone(580, .15);
      toast('Package collected! Follow the new searchlight to deliver it.', 5000);
    } else if (event === 'delivered') finishRun();
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
    climbBlend = 0;
    flightRotation.set(0, 0, 0);
  } else {
    position = physics.pos; speed = Math.hypot(physics.vel.x, physics.vel.z); grounded = physics.grounded; swinging = !!physics.anchor; verticalSpeed = physics.vel.y;
    const pitchGoal = grounded ? 0 : THREE.MathUtils.clamp(-physics.vel.y * .008, -.32, .3);
    flightRotation.x = grounded ? 0 : THREE.MathUtils.damp(flightRotation.x, pitchGoal, 4, dt);
    flightRotation.y = grounded ? physics.yaw : travelIntent(physics.vel, physics.yaw, 0);
    flightRotation.z = grounded ? 0 : THREE.MathUtils.damp(flightRotation.z, -input.turn * (preferences.reduceMotion ? .08 : .18 + feel.swing * .12), 5, dt);
    if (physics.wallRun) {
      climbNormal.copy(physics.wallRun.normal);
      wallClimbOrientation(climbNormal, climbRotation);
    }
    climbBlend = grounded ? 0 : THREE.MathUtils.damp(climbBlend, physics.wallRun ? 1 : 0, 14, dt);
    horse.group.quaternion.setFromEuler(flightRotation).slerp(climbRotation, climbBlend);
  }
  horse.group.position.set(position.x, position.y - 2.2, position.z);
  // Bring the hoof plane to the façade while keeping the torso outside it.
  horse.group.position.x -= climbNormal.x * 1.08 * climbBlend;
  horse.group.position.z -= climbNormal.z * 1.08 * climbBlend;
  horse.group.position.y += 2.2 * climbBlend;
  horsePosition.set(position.x, position.y, position.z);
  horse.update(dt, { wallNormal: started ? physics.wallRun?.normal : null, webTarget: started ? (physics.anchor || physics.pointZip?.anchor) : null, feel, reduceMotion: preferences.reduceMotion, hanging: !started, time: now, speed, grounded, perched: started && !!physics.perch, swinging, turn: input.turn, verticalSpeed, tension: started ? physics.tension || 0 : .5, stretch: started ? physics.stretch || 0 : 0 });
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
  const flightFrame = started ? flightCameraFrame(cameraTrackedHorse.y, horsePosition, physics.vel, dt, {
    active: !preferences.reduceMotion && !physics.grounded && !physics.wallRun && !frameSelectedAnchor,
    distance: preferences.camera === 'close' ? 6 : preferences.camera === 'wide' ? 19 : 8.5,
    anchor: physics.anchor,
    gravity: 25 * (1 - .15 * physics.soarWeight()),
  }) : null;
  // Horizontal tracking stays immediate; vertical tracking has a bounded lag.
  if (started) {
    cameraTravel.copy(horsePosition).sub(cameraTrackedHorse);
    cameraTravel.y = flightFrame.trackedY - cameraTrackedHorse.y;
    camera.position.add(cameraTravel); cameraTarget.add(cameraTravel);
  }
  cameraTrackedHorse.copy(horsePosition);
  if (flightFrame) cameraTrackedHorse.y = flightFrame.trackedY;
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
    desiredCamera.set(horsePosition.x + Math.sin(yaw) * distance, cameraTrackedHorse.y + 3 + pitch * distance + feel.height, horsePosition.z + Math.cos(yaw) * distance);
    desiredTarget.set(horsePosition.x - Math.sin(viewYaw) * 7, horsePosition.y + .8, horsePosition.z - Math.cos(viewYaw) * 7);
    // Look slightly into travel without overriding a manually panned view.
    if (!frameSelectedAnchor && Math.abs(orbit) < .1 && speed > 1) {
      const alignment = (-Math.sin(viewYaw) * physics.vel.x - Math.cos(viewYaw) * physics.vel.z) / speed;
      const weight = Math.max(0, alignment) * (1 - Math.min(1, Math.abs(pitch - .1) * 3));
      desiredTarget.x += flightFrame.ahead.x * weight;
      desiredTarget.y += flightFrame.ahead.y * weight;
      desiredTarget.z += flightFrame.ahead.z * weight;
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
  // Lagged/smoothed positions must be safe too, not just the desired endpoint.
  if (started && !framedAnchor) {
    const delta = camera.position.clone().sub(horsePosition);
    for (let step = 1; step <= 20; step++) {
      const point = horsePosition.clone().addScaledVector(delta, step / 20);
      if (city.buildings.some(b => point.y < b.height + 1 && point.x > b.minX - 1 && point.x < b.maxX + 1 && point.z > b.minZ - 1 && point.z < b.maxZ + 1)) {
        camera.position.copy(horsePosition).addScaledVector(delta, (step - 1) / 20); break;
      }
    }
    camera.position.y = Math.max(camera.position.y, 2.7);
  }
  camera.lookAt(cameraTarget); camera.updateMatrixWorld(true);
  sky.position.copy(camera.position);
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
  const speed = started ? Math.hypot(physics.vel.x, physics.vel.y, physics.vel.z) * 3.6 : 0;
  $('speed').textContent = Math.round(speed).toString();
  $('speed-bar').style.width = `${Math.min(speed / 250 * 100, 100)}%`;
  $('altitude').textContent = Math.round(horsePosition.y).toString();
  $('energy-bar').style.width = `${physics.energy * 100}%`;
  const active = physics.anchor;
  $('flight-state').textContent = physics.lost ? 'Run over' : physics.perch ? 'Perched' : physics.grounded ? 'On a rooftop' : active ? 'Swinging' : physics.vel.y > 2 ? 'Soaring' : 'Falling';
  $('tether-status').textContent = !started ? 'Ready when you are' : physics.lost ? 'R to try again' : active ? `${Math.round((physics.tension || 0) * 100)}% tension` : physics.grounded ? 'SHIFT to jump' : 'Ready to swing';
  $('tension-bar').style.width = `${Math.min(1, physics.tension || 0) * 100}%`;
  const lowAltitude = started && !physics.lost && !physics.grounded && horsePosition.y < 20;
  shell.dataset.lowAltitude = String(lowAltitude);
  $('altitude-note').textContent = physics.lost ? 'On the ground' : lowAltitude ? 'Mind the pavement' : 'Above the street';
  const swingAnchor = active || physics.findAnchor();
  displayedAnchor = swingAnchor;
  const action = physics.contextualAction(travelIntent(physics.vel, physics.yaw, 0), onboarding.stage === 'zip' ? onboarding.target : undefined);
  pointTarget = action.target || null;
  $('jump-action').textContent = action.label;
  $('jump-action').setAttribute('aria-label', action.label);
  $('jump-action').disabled = action.kind === 'wait';
  const anchor = pointTarget?.anchor || null;
  const anchorNumber = anchor ? city.anchors.findIndex(a => a.x === anchor.x && a.y === anchor.y && a.z === anchor.z) + 1 : 0;
  updateWebTarget($('web-target'), $('web-target-state'), $('web-target-distance'), { started, anchor, position: physics.pos, attached: !!active, anchorNumber });
  const district = physics.pos.z < -650 ? 'Herald Square' : physics.pos.z < -250 ? 'Midtown South' : 'Midtown West';
  $('district').textContent = district;
}
// Project the posed horse, not just its center, so legs and head stay uncovered.
const lessonHorseBounds = new THREE.Box3(), lessonCorner = new THREE.Vector3();
let lessonBoundsStage = null;
function positionOnboarding(dt) {
  if (!onboarding.waiting) { lessonBoundsStage = null; return; }
  const prompt = $('onboarding-prompt');
  if (lessonBoundsStage !== onboarding.stage || dt > 0) {
    horse.group.updateMatrixWorld(true);
    lessonHorseBounds.setFromObject(horse.group, true);
    lessonBoundsStage = onboarding.stage;
  }
  const height = shell.clientHeight;
  let top = height, bottom = 0;
  for (let i = 0; i < 8; i++) {
    lessonCorner.set(i & 1 ? lessonHorseBounds.max.x : lessonHorseBounds.min.x,
      i & 2 ? lessonHorseBounds.max.y : lessonHorseBounds.min.y,
      i & 4 ? lessonHorseBounds.max.z : lessonHorseBounds.min.z).project(camera);
    const y = (1 - lessonCorner.y) * height / 2;
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const margin = 16, gap = 20, cardHeight = prompt.offsetHeight;
  const above = Math.max(0, top - gap - margin);
  const below = Math.max(0, height - margin - bottom - gap);
  const useBelow = below >= cardHeight || below > above;
  const room = useBelow ? below : above;
  const scale = Math.min(1, room / Math.max(1, cardHeight));
  const y = useBelow ? Math.max(margin, bottom + gap) : Math.max(margin, top - gap - cardHeight * scale);
  prompt.style.top = `${y}px`;
  prompt.style.transform = `translateX(-50%) scale(${scale})`;
}

// Track the physical ledge, not the elevated waypoint used by the zip approach.
// Reproject each frame with the current camera, independently of text HUD updates.
function updateLedgeMarker() {
  const anchor = pointTarget?.anchor || null;
  if (started && anchor) {
    projected.set(anchor.x, anchor.y, anchor.z).project(camera);
    const occluded = cameraClearance(camera.position, anchor, city.buildings) < 1;
    $('anchor-marker').classList.toggle('occluded', occluded);
    const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < .96 && Math.abs(projected.y) < .9;
    $('anchor-marker').classList.toggle('hidden', !visible);
    if (visible) { $('anchor-marker').style.left = `${(projected.x * .5 + .5) * 100}%`; $('anchor-marker').style.top = `${(-projected.y * .5 + .5) * 100}%`; $('anchor-label').textContent = 'Zip to point'; if (occluded) $('anchor-label').textContent += ' · Behind building'; }
  } else $('anchor-marker').classList.add('hidden');
}
function drawMinimap() {
  if (!started) return;
  const map = $('minimap'), ctx = map.getContext('2d');
  const size = 192, center = size / 2, radius = center - 5, scale = .32;
  const pos = physics.pos;
  const heading = physics.grounded ? physics.yaw : travelIntent(physics.vel, physics.yaw, 0);
  ctx.setTransform(map.width / size, 0, 0, map.height / size, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#244653f5'; ctx.fillRect(0, 0, size, size);
  // Rotate the city and objective around the fixed, forward-facing player.
  ctx.save(); ctx.translate(center, center); ctx.rotate(heading); ctx.translate(-center, -center);
  const coast = city.island;
  ctx.fillStyle = '#112630ed';
  ctx.fillRect(center + (coast.minX-pos.x)*scale, center + (coast.minZ-pos.z)*scale,
    (coast.maxX-coast.minX)*scale, (coast.maxZ-coast.minZ)*scale);
  ctx.strokeStyle = '#b1cecb88'; ctx.lineWidth = 1.5;
  ctx.strokeRect(center + (coast.minX-pos.x)*scale, center + (coast.minZ-pos.z)*scale,
    (coast.maxX-coast.minX)*scale, (coast.maxZ-coast.minZ)*scale);
  for (const b of city.buildings) {
    const x = center + (b.minX - pos.x) * scale, z = center + (b.minZ - pos.z) * scale;
    const w = (b.maxX - b.minX) * scale, h = (b.maxZ - b.minZ) * scale;
    if (x > size || z > size || x + w < 0 || z + h < 0) continue;
    ctx.fillStyle = b.height > 80 ? '#5e7b86' : '#3b5864';
    ctx.fillRect(x, z, w, h);
    ctx.strokeStyle = '#a1c0ca22'; ctx.lineWidth = .6; ctx.strokeRect(x, z, w, h);
  }
  const shade = ctx.createRadialGradient(center, center, 45, center, center, radius);
  shade.addColorStop(0, '#091a2400'); shade.addColorStop(1, '#091a2480');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, size, size);
  if (running) {
    const target = deliveryTarget(delivery);
    const dx = (target.x - pos.x) * scale, dz = (target.z - pos.z) * scale;
    const distance = Math.hypot(dx, dz), factor = Math.min(1, (radius - 14) / Math.max(distance, 1));
    ctx.save(); ctx.translate(center + dx * factor, center + dz * factor);
    ctx.strokeStyle = '#ffe2a0'; ctx.fillStyle = '#ffe2a0'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#ffd78c'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 0); ctx.lineTo(0, 5); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill();
    if (distance > radius - 14) {
      ctx.rotate(Math.atan2(dz, dx));
      ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(11, 0); ctx.lineTo(8, 3); ctx.stroke();
    } else { ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore();
  ctx.save(); ctx.translate(center, center);
  ctx.shadowColor = '#000'; ctx.shadowBlur = 5; ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff7ec'; ctx.fillStyle = '#ff503e';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
  ctx.restore();
  ctx.strokeStyle = '#e9f5f06b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f5f6ed'; ctx.font = '600 9px Arial'; ctx.textAlign = 'center';
  ctx.fillText('N', center + Math.sin(heading) * (radius - 12), center - Math.cos(heading) * (radius - 12) + 3);
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
  const active = preferences.audio && !onboarding.waiting && !paused && !anyDialog() && started;
  const speed = Math.hypot(physics.vel.x, physics.vel.y, physics.vel.z);
  windGain.gain.setTargetAtTime(active ? Math.min(.35, speed / 180) : 0, audioContext.currentTime, .2);
  windFilter.frequency.setTargetAtTime(300 + speed * 35, audioContext.currentTime, .2);
  cityGain.gain.setTargetAtTime(active ? .012 : 0, audioContext.currentTime, .2);
}
function frame(time) {
  requestAnimationFrame(frame);
  if (document.hidden) { previousTime = time; return; }
  const dt = Math.min((time - previousTime) / 1000, .05); previousTime = time;
  const playing = started && !physics.lost && !paused && !onboarding.waiting && !anyDialog();
  if (playing || !started) now += dt;
  let input = { turn: 0, forward: 0 };
  if (playing) {
    accumulator += dt;
    while (accumulator >= 1 / 120 && !physics.lost && !paused && !onboarding.waiting && !anyDialog()) { input = updatePhysics(1 / 120); accumulator -= 1 / 120; }
  } else accumulator = 0;
  const visualDt = (playing && !physics.lost) || !started ? dt : 0;
  updateHorse(visualDt, input); updateCamera(visualDt); updateRope(); updateParticles();
  if (playing || !started) city.update(dt, now, preferences.reduceMotion);
  ropeRipple = Math.max(0, ropeRipple - dt * 2);
  skyMaterial.uniforms.time.value = now;
  beaconUniforms.time.value = now;
  beaconUniforms.motion.value = preferences.reduceMotion ? 0 : 1;

  if (time - lastUI > 75) { updateUI(); updateAudio(); lastUI = time; }
  cinematics.setSpeedBurst(preferences.reduceMotion ? 0 : snapBurst());
  updateLedgeMarker();
  positionOnboarding(visualDt);
  drawMinimap();
  cinematics.render(scene); renderFrames++;
}
boot();
