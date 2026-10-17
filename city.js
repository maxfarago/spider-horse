import * as THREE from './vendor/three.module.js';

// All architecture and surface artwork are generated locally for this game.
export function createCity(scene) {
  let state = 714831;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const range = (a, b) => a + random() * (b - a);
  const pick = (a) => a[Math.floor(random() * a.length)];
  const group = new THREE.Group();
  group.name = 'Manhattan — procedural city';
  scene.add(group);
  const buildings = [], anchors = [], batches = new Map();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const cone = new THREE.ConeGeometry(1, 1, 8);
  const sphere = new THREE.IcosahedronGeometry(1, 2);
  const canopyPositions = sphere.attributes.position;
  for (let i = 0; i < canopyPositions.count; i++) {
    const x = canopyPositions.getX(i), y = canopyPositions.getY(i), z = canopyPositions.getZ(i);
    const r = 1 + Math.sin(x * 17 + y * 9) * Math.cos(z * 14 - y * 7) * .11;
    canopyPositions.setXYZ(i, x * r, y * r, z * r);
  }
  sphere.computeVertexNormals();
  const standard = (hex, roughness = .8, metalness = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
  const stone = standard('#a99e89'), limestone = standard('#d4c9b0'), roof = standard('#555653');
  const darkMetal = standard('#293137', .62, .55), silver = standard('#8e9696', .48, .6);
  const asphalt = standard('#343b41'), sidewalk = standard('#98978d');
  const whitePaint = standard('#d9d6bd'), yellowPaint = standard('#bca960');
  const foliage = standard('#65704b'), trunk = standard('#5b4b3d');
  const taxiYellow = standard('#dbaa30', .32, .38), carGlass = standard('#263c49', .19, .65);
  const redBrick = standard('#85624f'), parkGrass = standard('#6d7250');
  const lampGlow = new THREE.MeshStandardMaterial({ color: '#ffddb0', emissive: '#ffb968', emissiveIntensity: .9, roughness: .5 });
  const terracotta = standard('#a57d65'), paleStone = standard('#c3bca8'), bronze = standard('#655d4e', .5, .65);
  const storefrontFrame = standard('#464b49', .56, .45), awning = standard('#ffffff');

  function add(geometry, material, position, scale, rotation = null, tint = null) {
    const key = `${geometry.uuid}/${material.uuid}`;
    let batch = batches.get(key);
    if (!batch) { batch = { geometry, material, matrices: [], colors: [] }; batches.set(key, batch); }
    dummy.position.set(...position); dummy.scale.set(...scale);
    dummy.rotation.set(rotation?.[0] || 0, rotation?.[1] || 0, rotation?.[2] || 0);
    dummy.updateMatrix(); batch.matrices.push(dummy.matrix.clone());
    batch.colors.push(tint);
  }
  const cube = (mat, x, y, z, w, h, d, tint = null) => add(box, mat, [x, y, z], [w, h, d], null, tint);
  // Architectural choices are keyed to the lot, never the gameplay RNG.
  const detail = (x, z, salt = 0) => {
    const value = Math.sin(x * 12.9898 + z * 78.233 + salt * 39.417) * 43758.5453;
    return value - Math.floor(value);
  };
  function pole(mat, a, b, radius) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    dummy.position.copy(start.add(end).multiplyScalar(.5));
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    dummy.scale.set(radius, direction.length(), radius); dummy.updateMatrix();
    const key = `${cylinder.uuid}/${mat.uuid}`;
    let batch = batches.get(key);
    if (!batch) { batch = { geometry: cylinder, material: mat, matrices: [], colors: [] }; batches.set(key, batch); }
    batch.matrices.push(dummy.matrix.clone()); batch.colors.push(null);
  }

  // Textures have their own random stream: visual edits never move buildings,
  // colliders, or the route's swing anchors.
  let surfaceState = 486921;
  const surfaceRandom = () => { surfaceState = (Math.imul(1664525, surfaceState) + 1013904223) >>> 0; return surfaceState / 4294967296; };
  const surfaceRange = (a, b) => a + surfaceRandom() * (b - a);
  const atlasCache = new Map();
  const makeCanvas = (width, height = width) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    return [canvas, canvas.getContext('2d', { willReadFrequently: true })];
  };
  function canvasTexture(canvas, srgb = false) {
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8;
    return texture;
  }
  function normalFromHeight(heightCanvas, strength = 1) {
    const size = heightCanvas.width, h = heightCanvas.height;
    const src = heightCanvas.getContext('2d').getImageData(0, 0, size, h).data;
    const [canvas, ctx] = makeCanvas(size, h), image = ctx.createImageData(size, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < size; x++) {
      const at = (xx, yy) => src[(((yy + h) % h) * size + (xx + size) % size) * 4] / 255;
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1), i = (y * size + x) * 4;
      image.data[i] = (nx * inv * .5 + .5) * 255;
      image.data[i + 1] = (ny * inv * .5 + .5) * 255;
      image.data[i + 2] = (inv * .5 + .5) * 255; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0); return canvasTexture(canvas);
  }
  // Each family has its own window language, proportion and floor rhythm. The
  // same atlas is still shared by every building in that family.
  const architecture = [
    { name: 'limestone-office', columns: 6, rows: 8, width: 22.8, height: 33.6, windowW: .49, windowH: .7, base: [192, 186, 173], frame: '#c6bdab', mullion: '#807e72', tint: '#ddd1bb' },
    { name: 'cast-iron-loft', columns: 4, rows: 6, width: 19.2, height: 27, windowW: .8, windowH: .77, base: [141, 120, 102], frame: '#918c7c', mullion: '#525c5d', tint: '#ba9b83' },
    { name: 'art-deco', columns: 8, rows: 8, width: 23.2, height: 32, windowW: .48, windowH: .81, base: [201, 191, 168], frame: '#b8b3a5', mullion: '#676e6b', tint: '#eadbc3' },
    { name: 'red-brick-apartment', columns: 6, rows: 8, width: 19.2, height: 28.8, windowW: .53, windowH: .6, base: [126, 84, 65], frame: '#b9ab91', mullion: '#4e514a', tint: '#bc8d70' },
    { name: 'granite-office', columns: 5, rows: 7, width: 21, height: 29.4, windowW: .74, windowH: .6, base: [151, 151, 142], frame: '#8a8d87', mullion: '#565f5e', tint: '#b6bab2' },
    { name: 'blue-curtain-wall', columns: 8, rows: 8, width: 20, height: 31.2, windowW: .97, windowH: .94, base: [48, 65, 73], frame: '#526a73', mullion: '#455960', tint: '#9bb9c6' },
    { name: 'bronze-glass', columns: 6, rows: 8, width: 22.8, height: 32.8, windowW: .95, windowH: .78, base: [76, 77, 70], frame: '#827d67', mullion: '#5d5d50', tint: '#b9b6a0' },
    { name: 'prewar-limestone', columns: 6, rows: 8, width: 21.6, height: 30.4, windowW: .59, windowH: .67, base: [190, 173, 147], frame: '#c8baa2', mullion: '#707267', tint: '#d9c5a6' },
  ];
  function facadeAtlas(kind, profile) {
    if (atlasCache.has(profile.name)) return atlasCache.get(profile.name);
    const size = 1024, [albedo, ctx] = makeCanvas(size), [height, bump] = makeCanvas(size);
    // R: lit-room mask. G: physical roughness. B: glass reflection mask.
    const [surface, pbr] = makeCanvas(size);
    ctx.fillStyle = kind === 'brick' ? '#887263' : '#b9b4a7'; ctx.fillRect(0, 0, size, size);
    bump.fillStyle = '#a0a0a0'; bump.fillRect(0, 0, size, size);
    pbr.fillStyle = 'rgb(0,228,0)'; pbr.fillRect(0, 0, size, size);
    if (kind !== 'glass') {
      const brick = kind === 'brick', bh = brick ? 4 : 20, bw = brick ? 14 : 57;
      ctx.fillStyle = brick ? '#afa397' : '#918d80'; ctx.fillRect(0, 0, size, size);
      bump.fillStyle = '#6c6c6c'; bump.fillRect(0, 0, size, size);
      for (let y = 0; y < size; y += bh) for (let x = (y / bh % 2 ? -bw / 2 : 0); x < size; x += bw) {
        const shade = surfaceRange(-13, 14), warm = surfaceRange(-5, 5);
        const [r, g, b] = profile.base;
        ctx.fillStyle = `rgb(${r + shade},${g + shade + warm},${b + shade})`;
        ctx.fillRect(x + .6, y + .6, bw - 1, bh - .9);
        const depth = Math.round(surfaceRange(155, 181)); bump.fillStyle = `rgb(${depth},${depth},${depth})`;
        bump.fillRect(x + .7, y + .6, bw - 1.2, bh - 1);
      }
    }
    // Fine aggregate and uneven weathering are continuous across window bays.
    for (let i = 0; i < 34000; i++) {
      ctx.fillStyle = surfaceRandom() > .48 ? 'rgba(255,247,226,.055)' : 'rgba(23,27,25,.07)';
      ctx.fillRect(surfaceRandom() * size, surfaceRandom() * size, surfaceRange(.5, 2), surfaceRange(.5, 2.5));
    }
    for (let i = 0; i < 180; i++) {
      const x = surfaceRandom() * size, y = surfaceRandom() * size, w = surfaceRange(1, 5), h = surfaceRange(10, 170);
      const streak = ctx.createLinearGradient(0, y, 0, y + h);
      streak.addColorStop(0, 'rgba(42,43,35,.10)'); streak.addColorStop(1, 'rgba(42,43,35,0)');
      ctx.fillStyle = streak; ctx.fillRect(x, y, w, h);
    }
    const { columns, rows } = profile, cw = size / columns, rh = size / rows;
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const glassWall = kind === 'glass', w = cw * profile.windowW, h = rh * profile.windowH;
      const x = col * cw + (cw - w) / 2, y = row * rh + (rh - h) * .42;
      const lit = surfaceRandom() > .91, blue = surfaceRange(-11, 11);
      // Deco spandrels and loft floor plates are baked between bays rather than
      // imposing the same horizontal stripe on every architectural family.
      if (profile.name === 'art-deco') {
        ctx.fillStyle = '#9f9a89'; ctx.fillRect(x, row * rh, w, rh * .11);
        for (let rib = 1; rib < 5; rib++) { ctx.fillStyle = '#c3bda9'; ctx.fillRect(x + w * rib / 5, row * rh, 2, rh * .1); }
      } else if (profile.name === 'cast-iron-loft') {
        ctx.fillStyle = '#777b70'; ctx.fillRect(0, row * rh, size, 4);
        bump.fillStyle = '#b8b8b8'; bump.fillRect(0, row * rh, size, 4);
      } else if (profile.name === 'bronze-glass') {
        ctx.fillStyle = '#66675f'; ctx.fillRect(col * cw, row * rh, cw, rh * .14);
        pbr.fillStyle = 'rgb(0,143,151)'; pbr.fillRect(col * cw, row * rh, cw, rh * .14);
      }
      // Deep reveal, stone jambs, a highlighted sill, and black gaskets.
      ctx.fillStyle = '#373b39'; ctx.fillRect(x - 4, y - 4, w + 8, h + 9);
      ctx.fillStyle = profile.frame; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      bump.fillStyle = '#484848'; bump.fillRect(x - 4, y - 4, w + 8, h + 9);
      bump.fillStyle = '#c6c6c6'; bump.fillRect(x - 2, y - 2, w + 4, h + 4);
      bump.fillStyle = '#747474'; bump.fillRect(x, y, w, h);
      // Glass uses subdued albedo; the environment supplies the reflection.
      const bronzeGlass = profile.name === 'bronze-glass';
      ctx.fillStyle = lit ? '#74624a' : bronzeGlass ? `rgb(${57 + blue},${60 + blue},${56 + blue})` : `rgb(${38 + blue},${53 + blue},${61 + blue})`;
      ctx.fillRect(x, y, w, h);
      pbr.fillStyle = lit ? 'rgb(46,93,80)' : `rgb(0,${glassWall ? 42 : 57},${glassWall ? 166 : 118})`;
      pbr.fillRect(x, y, w, h);
      const shadeHeight = surfaceRandom() < .63 ? surfaceRange(h * .13, h * .73) : 0;
      if (shadeHeight) {
        ctx.fillStyle = lit ? '#b1a387' : '#778080'; ctx.globalAlpha = lit ? .65 : .28;
        ctx.fillRect(x, y, w, shadeHeight); ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(15,22,25,.18)';
        for (let yy = y + 3; yy < y + shadeHeight; yy += 4) ctx.fillRect(x, yy, w, .7);
      }
      // Slight room silhouettes and a ceiling strip replace painted sky glare.
      if (lit) {
        ctx.fillStyle = '#bea97e'; ctx.fillRect(x + 5, y + 6, w - 10, 2);
        ctx.fillStyle = '#3d3931'; ctx.fillRect(x + w * .2, y + h * .79, w * .66, h * .21);
        pbr.fillStyle = 'rgb(2,105,72)'; pbr.fillRect(x + w * .2, y + h * .79, w * .66, h * .21);
      }
      const verticals = profile.name === 'cast-iron-loft' ? [1 / 3, 2 / 3] : glassWall || profile.name === 'art-deco' ? [] : [.5];
      const horizontals = profile.name === 'cast-iron-loft' ? [.32, .66] : glassWall ? [] : [profile.name === 'red-brick-apartment' ? .5 : .62];
      for (const [context, fill] of [[ctx, profile.mullion], [bump, '#adadad'], [pbr, 'rgb(0,145,80)']]) {
        context.fillStyle = fill;
        for (const f of verticals) context.fillRect(x + w * f - 1, y, 2, h);
        for (const f of horizontals) context.fillRect(x, y + h * f, w, 2);
      }
      if (profile.name === 'red-brick-apartment' && row % 3 === 1 && col % 2 === 0) {
        // Window AC units and their grime trails are a domestic detail, absent
        // from the office and modern curtain-wall elevations.
        ctx.fillStyle = '#77796b'; ctx.fillRect(x + w * .45, y + h - 11, w * .6, 16);
        bump.fillStyle = '#d8d8d8'; bump.fillRect(x + w * .45, y + h - 11, w * .6, 16);
        for (let vent = 0; vent < 5; vent++) { ctx.fillStyle = '#3b423f'; ctx.fillRect(x + w * .5, y + h - 8 + vent * 2.5, w * .48, 1); }
      }
      if (!glassWall) {
        ctx.fillStyle = '#c7beaa'; ctx.fillRect(x - 6, y + h + 3, w + 12, 3);
        ctx.fillStyle = 'rgba(32,31,25,.6)'; ctx.fillRect(x - 6, y + h + 6, w + 12, 3);
        bump.fillStyle = '#e0e0e0'; bump.fillRect(x - 6, y + h + 3, w + 12, 3);
      }
    }
    const maps = { map: canvasTexture(albedo, true), normalMap: normalFromHeight(height, 1.3), roughnessMap: canvasTexture(surface) };
    maps.metalnessMap = maps.roughnessMap; atlasCache.set(profile.name, maps); return maps;
  }
  function worldProjected(material, tileWidth, tileHeight, ground = false, columns = 6, rows = 8) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCityPosition;\nvarying vec3 vCityNormal;\nvarying vec3 vCityOrigin;\nvarying vec2 vCityHalfExtent;');
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 cityPosition = vec4(transformed, 1.0);
        vec4 cityOrigin = vec4(0.0, 0.0, 0.0, 1.0);
        vec3 cityNormal = normal;
        vCityHalfExtent = vec2(0.5);
        #ifdef USE_INSTANCING
          cityPosition = instanceMatrix * cityPosition;
          cityOrigin = instanceMatrix * cityOrigin;
          cityNormal = mat3(instanceMatrix) * cityNormal;
          vCityHalfExtent = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz)) * 0.5;
        #endif
        vCityPosition = (modelMatrix * cityPosition).xyz;
        vCityNormal = normalize(mat3(modelMatrix) * cityNormal);
        vCityOrigin = (modelMatrix * cityOrigin).xyz;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCityPosition;\nvarying vec3 vCityNormal;\nvarying vec3 vCityOrigin;\nvarying vec2 vCityHalfExtent;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        float cityU = abs(vCityNormal.z) > 0.5 ? vCityPosition.x - vCityOrigin.x + vCityHalfExtent.x : vCityPosition.z - vCityOrigin.z + vCityHalfExtent.y;
        float citySeed = floor(fract(sin(dot(vCityOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453) * 8.0);
        vec2 cityUV = ${ground ? `vCityPosition.xz / vec2(${tileWidth.toFixed(1)}, ${tileHeight.toFixed(1)})` : `vec2(cityU / ${tileWidth.toFixed(1)} + citySeed / ${columns.toFixed(1)}, vCityPosition.y / ${tileHeight.toFixed(1)} + citySeed / ${rows.toFixed(1)})`};
        diffuseColor *= texture2D(map, cityUV);
        ${ground ? '' : 'if (abs(vCityNormal.y) > 0.5) diffuseColor.rgb *= 0.35;'}
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        vec3 citySurface = texture2D(roughnessMap, cityUV).rgb;
        float roughnessFactor = roughness * citySurface.g;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * citySurface.b;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
        vec3 cityMapNormal = texture2D(normalMap, cityUV).xyz * 2.0 - 1.0;
        cityMapNormal.xy *= normalScale;
        mat3 cityTbn = getTangentFrame(-vViewPosition, normal, cityUV);
        normal = normalize(cityTbn * cityMapNormal);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        totalEmissiveRadiance *= citySurface.r;
      `);
    };
    material.customProgramCacheKey = () => `world-city-pbr-v4-${tileWidth}-${tileHeight}-${ground}-${columns}-${rows}`;
    return material;
  }
  function facade(base, _glass, kind = 'brick', profileIndex = 0) {
    // Preserve the original layout stream, including the original window draws.
    for (let i = 0; i < 17000; i++) for (let j = 0; j < 5; j++) random();
    for (let i = 0; i < (kind === 'glass' ? 8 : 6) * 14; i++) { random(); if (random() > .45) random(); }
    const profile = architecture[profileIndex];
    const tint = new THREE.Color(base).lerp(new THREE.Color('#ffffff'), .82);
    const material = new THREE.MeshStandardMaterial({
      ...facadeAtlas(kind, profile), color: tint, roughness: 1, metalness: 1,
      normalScale: new THREE.Vector2(.65, .8), envMapIntensity: kind === 'glass' ? 1.5 : 1.2,
      emissive: '#ffd7a1', emissiveIntensity: .85,
    });
    material.name = profile.name;
    return worldProjected(material, profile.width, profile.height, false, profile.columns, profile.rows);
  }
  const facades = [
    facade('#9b8974', '#73858e', 'stone', 0), facade('#78584a', '#667784', 'brick', 1),
    facade('#ad9c81', '#82929a', 'stone', 2), facade('#6f5041', '#6b7b84', 'brick', 3),
    facade('#8c877b', '#7d8a91', 'stone', 4), facade('#596e76', '#99a9ae', 'glass', 5),
    facade('#737c7a', '#9ca9aa', 'glass', 6), facade('#b3a58c', '#788b95', 'stone', 7),
  ];

  function pavementMaterial(material, concrete) {
    const size = 512, [albedo, ctx] = makeCanvas(size), [height, bump] = makeCanvas(size), [surface, pbr] = makeCanvas(size);
    ctx.fillStyle = concrete ? '#bbb8ad' : '#40474a'; ctx.fillRect(0, 0, size, size);
    bump.fillStyle = '#808080'; bump.fillRect(0, 0, size, size);
    pbr.fillStyle = concrete ? 'rgb(0,231,0)' : 'rgb(0,215,0)'; pbr.fillRect(0, 0, size, size);
    for (let i = 0; i < 32000; i++) {
      const x = surfaceRandom() * size, y = surfaceRandom() * size, s = surfaceRange(.3, 1.8);
      const light = surfaceRandom() > .55;
      ctx.fillStyle = light ? 'rgba(240,230,208,.12)' : 'rgba(14,21,22,.19)'; ctx.fillRect(x, y, s, s);
      bump.fillStyle = light ? '#959595' : '#757575'; bump.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 35; i++) {
      const x = surfaceRandom() * size, y = surfaceRandom() * size, radius = surfaceRange(5, 60);
      const stain = ctx.createRadialGradient(x, y, 0, x, y, radius);
      stain.addColorStop(0, concrete ? 'rgba(54,53,42,.07)' : 'rgba(8,17,22,.18)'); stain.addColorStop(1, 'rgba(8,17,22,0)');
      ctx.fillStyle = stain; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    if (concrete) {
      ctx.strokeStyle = '#85857d'; ctx.lineWidth = 1.2; bump.strokeStyle = '#424242'; bump.lineWidth = 2;
      for (const c of [ctx, bump]) for (let i = 0; i <= size; i += size / 4) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i, size); c.moveTo(0, i); c.lineTo(size, i); c.stroke();
      }
    } else {
      ctx.strokeStyle = 'rgba(17,23,24,.42)'; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        let x = surfaceRandom() * size, y = surfaceRandom() * size;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let j = 0; j < 8; j++) { x += surfaceRange(-13, 13); y += surfaceRange(2, 17); ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    material.color.set('#ffffff'); material.map = canvasTexture(albedo, true); material.normalMap = normalFromHeight(height, .75);
    material.roughnessMap = canvasTexture(surface); material.metalnessMap = material.roughnessMap;
    material.normalScale.set(.35, .35); material.roughness = 1; material.metalness = 1;
    return worldProjected(material, concrete ? 6 : 12, concrete ? 6 : 12, true);
  }
  pavementMaterial(asphalt, false); pavementMaterial(sidewalk, true);

  // Pavement, sidewalks, avenue markings and the river beyond the west side.
  cube(asphalt, 0, -.25, -360, 1100, .5, 1700);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(470, 2000, 1, 1), new THREE.MeshStandardMaterial({ color: '#6c8e93', roughness: .26, metalness: .45 }));
  water.rotation.x = -Math.PI / 2; water.position.set(-805, -.18, -420); water.receiveShadow = true; group.add(water);
  cube(stone, -561, .4, -360, 18, .8, 1700);
  cube(sidewalk, -544, .15, -360, 16, .3, 1700);
  for (let z = -1120; z < 470; z += 20) {
    cube(whitePaint, -518, .018, z, .15, .025, 10);
    cube(yellowPaint, -530, .018, z, .18, .025, 10);
  }

  function tree(x, z, size = 1) {
    // Branching canopies retain the same layout-random draws as the old trees.
    const yaw = random() * 6, tint = pick(['#b8c29b', '#a4b987', '#c0bf91']);
    add(cylinder, trunk, [x, 2.35 * size, z], [.17 * size, 4.7 * size, .17 * size]);
    add(sphere, foliage, [x, 6.1 * size, z], [1.85 * size, 2.7 * size, 1.7 * size], [0, yaw, 0], tint);
    for (let i = 0; i < 7; i++) {
      const angle = yaw + i * 2.4, reach = surfaceRange(1, 2) * size;
      const tx = x + Math.cos(angle) * reach, tz = z + Math.sin(angle) * reach, ty = surfaceRange(4.6, 6.3) * size;
      pole(trunk, [x, 3.2 * size, z], [tx, ty, tz], .065 * size);
      add(sphere, foliage, [tx, ty, tz], [surfaceRange(1.1, 1.6) * size, surfaceRange(1.2, 2) * size, surfaceRange(1.1, 1.6) * size], [surfaceRandom(), angle, surfaceRandom()], tint);
    }
    cube(stone, x, .18, z, 2.2, .18, 2.2);
    cube(roof, x, .28, z, 1.65, .06, 1.65);
  }
  function streetLamp(x, z, side = 1) {
    add(cylinder, darkMetal, [x, 4.2, z], [.11, 8.4, .11]);
    pole(darkMetal, [x, 8.4, z], [x + side * 2.3, 8.7, z], .095);
    cube(darkMetal, x + side * 2.3, 8.64, z, 1.1, .19, .5);
    cube(lampGlow, x + side * 2.3, 8.53, z, .86, .05, .34);
    add(cylinder, darkMetal, [x, .27, z], [.28, .54, .28]);
  }
  function rooftop(x, z, w, d, h, old, style = 0) {
    const trim = old ? style === 3 ? terracotta : paleStone : style === 6 ? bronze : silver;
    cube(roof, x, h + .3, z, w + .3, .6, d + .3);
    cube(trim, x, h + .8, z - d / 2, w + .6, .8, .45);
    cube(trim, x, h + .8, z + d / 2, w + .6, .8, .45);
    cube(trim, x - w / 2, h + .8, z, .45, .8, d);
    cube(trim, x + w / 2, h + .8, z, .45, .8, d);
    const ox = x + w * (detail(x, z, 1) * .48 - .24), oz = z + d * (detail(x, z, 2) * .48 - .24);
    const equipment = Math.floor(detail(x, z, 3) * 3);
    if (equipment === 0) {
      // Paired cooling units, exposed fan housings and service conduits.
      for (const offset of [-2.5, 2.5]) {
        cube(silver, ox, h + 1.1, oz + offset, Math.min(4, w * .2), 1.5, 3.7);
        add(cylinder, darkMetal, [ox, h + 1.91, oz + offset], [1.05, .12, 1.05]);
      }
      cube(silver, ox + 2, h + .85, oz, .4, .45, 8);
    } else if (equipment === 1) {
      cube(trim, ox, h + 1.7, oz, w * .33, 2.8, d * .23);
      cube(darkMetal, ox, h + 3.15, oz, w * .34, .15, d * .24);
      for (let i = -2; i <= 2; i++) cube(darkMetal, ox + i * .7, h + 1.8, oz - d * .117, .3, 1.4, .1);
    } else {
      cube(silver, ox, h + 1.15, oz, Math.min(4, w * .2), 1.7, Math.min(6, d * .22));
      for (let i = 0; i < 3; i++) {
        const cx = x - w * .31 + i * 1.5;
        cube(old ? terracotta : darkMetal, cx, h + 1.8, z - d * .31, .8, 2.8, .8);
        cube(darkMetal, cx, h + 3.24, z - d * .31, 1, .16, 1);
      }
    }
    // Roofline accents are modest service structures within the original lot;
    // all traversable floors and anchor positions retain their original bounds.
    if (style === 2) {
      for (const side of [-1, 1]) {
        cube(paleStone, x + side * w * .33, h + 1.3, z, .9, 2, d * .96);
        cube(paleStone, x, h + 1.3, z + side * d * .33, w * .96, 2, .9);
      }
    } else if (style === 1 || style === 3) {
      const fx = x + w * .22;
      cube(redBrick, fx, h + 1.25, z - d * .25, w * .28, 1.8, d * .24);
      cube(darkMetal, fx, h + 2.21, z - d * .25, w * .3, .14, d * .26);
    }
    if (old && w > 14 && random() > .44) {
      const tx = x - w * .24, tz = z + d * .22, th = h + 4;
      for (const dx of [-1.3, 1.3]) for (const dz of [-1.3, 1.3]) pole(darkMetal, [tx + dx, h, tz + dz], [tx + dx * .8, th, tz + dz * .8], .1);
      add(cylinder, redBrick, [tx, th + 2, tz], [1.85, 4, 1.85]);
      add(cone, darkMetal, [tx, th + 4.7, tz], [2.15, 1.4, 2.15]);
      for (const bh of [th + .4, th + 2, th + 3.6]) add(cylinder, darkMetal, [tx, bh, tz], [1.89, .1, 1.89]);
    }
  }
  function building(x, z, w, d, h, style) {
    const material = facades[style];
    const tint = pick(['#ffffff', '#f6ede0', '#e2dfd6', '#f7f0e7']);
    const lotTint = new THREE.Color(tint).multiplyScalar(.87 + detail(x, z, 7) * .2);
    cube(material, x, h / 2, z, w, h, d, lotTint);
    buildings.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h });
    const trim = [paleStone, storefrontFrame, paleStone, terracotta, stone, silver, bronze, paleStone][style];
    cube(trim, x, 4.3, z, w + .3, .55, d + .3);
    cube(trim, x, .65, z, w + .2, 1.3, d + .2);
    if (style < 5 || style === 7) {
      cube(trim, x, h - 1.2, z, w + .6, .8, d + .6);
      if (h > 35 && style !== 2 && style !== 3) cube(trim, x, h * (style === 7 ? .72 : .34), z, w + .16, .35, d + .16);
    }
    // Shadow-casting architectural depth makes the masonry read at fly-by range.
    const masonry = style < 5 || style === 7;
    if (masonry) {
      const edgeWidth = style === 2 ? .85 : .5;
      const edgeInset = edgeWidth / 2 + .08;
      if (style !== 3) for (const offset of [-1, 1]) {
        cube(trim, x + offset * (w / 2 - edgeInset), h / 2, z, edgeWidth, h - 2, d + .22);
        cube(trim, x, h / 2, z + offset * (d / 2 - edgeInset), w + .22, h - 2, edgeWidth);
      }
      cube(trim, x, h - .42, z, w + (style === 7 ? 1.6 : 1.05), style === 7 ? .4 : .22, d + (style === 7 ? 1.6 : 1.05));
      if (style !== 2) cube(trim, x, h - .79, z, w + .82, .18, d + .82);
      cube(trim, x, 4.72, z, w + .62, .18, d + .62);
      if (style === 2 || style === 1) {
        const pitch = architecture[style].width / architecture[style].columns;
        // Deco piers emphasize height; cast-iron columns frame much wider bays.
        for (let xx = x - w / 2 + pitch; xx < x + w / 2 - .5; xx += pitch) for (const side of [-1, 1]) {
          cube(trim, xx, h * .5 + 2.5, z + side * (d / 2 + .12), style === 2 ? .4 : .16, h - 5, .24);
        }
        for (let zz = z - d / 2 + pitch; zz < z + d / 2 - .5; zz += pitch) for (const side of [-1, 1]) {
          cube(trim, x + side * (w / 2 + .12), h * .5 + 2.5, zz, .24, h - 5, style === 2 ? .4 : .16);
        }
      }
      if (style === 4) {
        for (let yy = 8.4; yy < h - 2; yy += 8.4) cube(trim, x, yy, z, w + .26, .32, d + .26);
      } else if (style === 7) {
        // A rusticated plinth and ornamental upper story identify prewar blocks.
        for (const yy of [1.5, 2.4, 3.3, h - 5.1]) cube(trim, x, yy, z, w + .4, .16, d + .4);
      }
      if (Math.abs(x) < 125 && z > -920) {
        const fx = x - Math.sign(x) * (w / 2 + .12);
        // Actual sills and pilasters on the avenues; the atlas carries the fine detail.
        for (let zz = z - d / 2 + 2; zz < z + d / 2 - 1; zz += 3.4) {
          cube(trim, fx, 2.2, zz, .35, 3.9, .32);
        }
        if (style === 1) for (let yy = 9; yy < h - 4; yy += 9) cube(trim, x, yy, z, w + .26, .18, d + .26);
        const escape = Math.abs(Math.round(x * 13 + z * 3)) % 5 === 0;
        if (escape && h < 95) {
          const ex = x - Math.sign(x) * (w / 2 + .6), ez = z + d * .22;
          for (let yy = 8; yy < h - 6; yy += 4) {
            cube(darkMetal, ex, yy, ez, 1.4, .12, 3.4);
            cube(darkMetal, ex - Math.sign(x) * .65, yy + .5, ez, .055, 1, 3.4);
            for (const dz of [-1.6, 1.6]) pole(darkMetal, [ex - .6, yy, ez + dz], [ex - .6, yy + 1, ez + dz], .035);
            pole(darkMetal, [ex, yy, ez - 1.4], [ex, yy + 4, ez + 1.4], .055);
            pole(darkMetal, [ex + .65, yy, ez - 1.4], [ex + .65, yy + 4, ez + 1.4], .055);
          }
        }
      }
    } else {
      // Full-height metal mullions break up curtain-wall silhouettes.
      const mullionPitch = style === 5 ? 2.5 : 3.8;
      for (let xx = x - w / 2 + mullionPitch; xx < x + w / 2; xx += mullionPitch) {
        cube(trim, xx, h / 2, z - d / 2 - .035, style === 5 ? .055 : .13, h, .09);
        cube(trim, xx, h / 2, z + d / 2 + .035, style === 5 ? .055 : .13, h, .09);
      }
      for (let zz = z - d / 2 + mullionPitch; zz < z + d / 2; zz += mullionPitch) {
        cube(trim, x - w / 2 - .035, h / 2, zz, .09, h, style === 5 ? .055 : .13);
        cube(trim, x + w / 2 + .035, h / 2, zz, .09, h, style === 5 ? .055 : .13);
      }
      if (style === 6) for (let yy = 8.2; yy < h - 2; yy += 8.2) cube(bronze, x, yy, z, w + .14, .24, d + .14);
    }
    rooftop(x, z, w, d, h, style < 5, style);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) anchors.push(new THREE.Vector3(x + dx * (w / 2 + .2), h + 1.2, z + dz * (d / 2 + .2)));
    // Awnings and storefront glass create a street-level scale.
    if (Math.abs(x) < 150) {
      const side = Math.sign(x) || 1, fx = x - side * (w / 2 + .08);
      const storefrontPitch = style === 1 ? 6.3 : style > 4 && style < 7 ? 8 : 5;
      const awningColors = ['#3d504b', '#774f46', '#b4a98d', '#414b59'];
      for (let zz = z - d / 2 + storefrontPitch * .6; zz < z + d / 2 - 2; zz += storefrontPitch) {
        cube(carGlass, fx, 2.25, zz, .12, 2.8, storefrontPitch - 1.15);
        cube(storefrontFrame, fx - side * .09, 2.1, zz + storefrontPitch * .12, .16, 3, .1);
        cube(storefrontFrame, fx - side * .1, 3.55, zz, .18, .12, storefrontPitch - .8);
        const covered = detail(x, zz, 10) > .3 && style !== 5 && style !== 6;
        if (covered) {
          const awningTint = awningColors[Math.floor(detail(x, zz, 11) * awningColors.length)];
          add(box, awning, [fx - side * .8, 3.8, zz], [1.65, .12, storefrontPitch - .5], [0, 0, side * .13], awningTint);
          cube(awning, fx - side * 1.6, 3.65, zz, .12, .4, storefrontPitch - .5, awningTint);
        } else {
          cube(style === 5 || style === 6 ? silver : paleStone, fx - side * .25, 3.85, zz, .55, .28, storefrontPitch - .5);
        }
        cube(lampGlow, fx - side * .15, 3.25, zz, .06, .05, storefrontPitch * .48);
      }
    }
  }

  for (let ix = -6; ix <= 6; ix++) {
    for (let iz = -15; iz <= 4; iz++) {
      const x = ix * 72 + 36, z = iz * 72 + 36;
      cube(sidewalk, x, .12, z, 50, .24, 50);
      // A pocket of park and mature trees opens the western skyline.
      if ((ix === -4 || ix === -3) && iz >= -9 && iz <= -6) {
        cube(parkGrass, x, .27, z, 45, .08, 45);
        cube(limestone, x, .33, z, 3, .08, 45);
        cube(limestone, x, .33, z, 45, .08, 3);
        for (let i = 0; i < 8; i++) tree(x + range(-19, 19), z + range(-19, 19), range(1.1, 1.6));
        continue;
      }
      const closeAvenue = Math.abs(x) < 42;
      const style = Math.floor(random() * facades.length);
      if (random() > .75 && !closeAvenue) {
        const h = range(95, 180);
        building(x, z, 43, 43, h * .67, style);
        building(x, z, 32, 32, h, style);
      } else if (random() > .58) {
        building(x, z, 44, 43, range(closeAvenue ? 55 : 35, closeAvenue ? 110 : 125), style);
      } else {
        const base = range(closeAvenue ? 43 : 25, closeAvenue ? 78 : 80);
        building(x - 11.4, z, 21.5, 44, base + range(0, 24), style);
        building(x + 11.4, z, 21.5, 44, base + range(-8, 35), (style + 2) % facades.length);
      }
      if (Math.abs(x) < 190 && iz > -12) {
        tree(x - 23, z - 13, range(.7, .95));
        tree(x + 23, z + 12, range(.7, .95));
        streetLamp(x - 24, z + 16, -1); streetLamp(x + 24, z - 16, 1);
      }
    }
  }

  // A stepped limestone landmark, visible beyond the opening avenue.
  const lx = 108, lz = -765;
  const landmarkStages = [[46, 46, 90, 0], [37, 36, 55, 90], [29, 28, 40, 145], [23, 22, 32, 185], [16, 15, 28, 217], [10, 10, 16, 245]];
  for (const [w, d, h, bottom] of landmarkStages) {
    cube(facades[2], lx, bottom + h / 2, lz, w, h, d);
    cube(limestone, lx, bottom + h, lz, w + .4, 1.3, d + .4);
    buildings.push({ minX: lx - w / 2, maxX: lx + w / 2, minZ: lz - d / 2, maxZ: lz + d / 2, height: bottom + h });
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) anchors.push(new THREE.Vector3(lx + dx * (w / 2 + .18), bottom + h + .65, lz + dz * (d / 2 + .18)));
    for (let xx = -w / 2 + 2; xx < w / 2; xx += 4) {
      cube(limestone, lx + xx, bottom + h / 2, lz - d / 2 - .07, .4, h, .3);
      cube(limestone, lx + xx, bottom + h / 2, lz + d / 2 + .07, .4, h, .3);
    }
  }
  add(cone, silver, [lx, 272, lz], [4.4, 23, 4.4]);
  add(cylinder, silver, [lx, 292, lz], [.45, 25, .45]);


  // Intersections, crosswalks, lane dividers and traffic signals.
  for (let ix = -6; ix <= 7; ix++) {
    const x = ix * 72;
    for (let z = -1080; z < 360; z += 14) {
      if (Math.abs(z / 72 - Math.round(z / 72)) < .2) continue;
      cube(yellowPaint, x - .21, .018, z, .11, .025, 6);
      cube(yellowPaint, x + .21, .018, z, .11, .025, 6);
      cube(whitePaint, x - 6, .018, z, .12, .025, 5);
      cube(whitePaint, x + 6, .018, z, .12, .025, 5);
    }
    for (let iz = -15; iz <= 5; iz++) {
      const z = iz * 72;
      for (let dx = -9; dx <= 9; dx += 2.7) {
        cube(whitePaint, x + dx, .025, z - 13.3, 1.3, .025, 4.1);
        cube(whitePaint, x + dx, .025, z + 13.3, 1.3, .025, 4.1);
        cube(whitePaint, x - 13.3, .025, z + dx, 4.1, .025, 1.3);
        cube(whitePaint, x + 13.3, .025, z + dx, 4.1, .025, 1.3);
      }
      if (Math.abs(x) < 180 && iz > -13) {
        const sx = x + 12, sz = z + 12;
        pole(darkMetal, [sx, 0, sz], [sx, 6.8, sz], .11);
        pole(darkMetal, [sx, 6.8, sz], [sx - 8, 6.8, sz], .095);
        cube(taxiYellow, sx - 7, 6.2, sz, .44, 1.18, .45);
        cube(darkMetal, sx - 7, 6.2, sz - .24, .31, 1.04, .07);
        cube(lampGlow, sx - 7, 5.93, sz - .29, .19, .19, .03);
      }
    }
  }
  for (let iz = -15; iz <= 5; iz++) {
    for (let x = -450; x < 500; x += 14) {
      if (Math.abs(x / 72 - Math.round(x / 72)) < .2) continue;
      cube(yellowPaint, x, .02, iz * 72, 5, .03, .14);
    }
  }

  // Cars are low, correctly scaled silhouettes with windows, wheels and taxi signs.
  const vehicleColors = [taxiYellow, taxiYellow, standard('#c6c5bb', .35, .4), standard('#4b5254', .32, .4), standard('#77858b', .34, .4), standard('#815349', .4, .3)];
  for (let i = 0; i < 280; i++) {
    const lane = Math.round(range(-5, 6)) * 72;
    let x = lane + pick([-8, -3.5, 3.5, 8]), z = range(-1090, 340);
    if (Math.abs(z / 72 - Math.round(z / 72)) < .18) continue;
    const material = pick(vehicleColors);
    cube(material, x, .72, z, 1.95, .74, 4.6);
    cube(carGlass, x, 1.3, z - .15, 1.67, .65, 2.45);
    cube(material, x, 1.68, z - .15, 1.72, .12, 2.05);
    cube(material, x, 1.35, z, .11, .65, 2.7);
    cube(darkMetal, x, .6, z - 2.28, 1.8, .2, .1);
    cube(silver, x, .64, z + 2.29, 1.8, .12, .1);
    for (const dx of [-1, 1]) for (const dz of [-1.4, 1.4]) add(cylinder, darkMetal, [x + dx * .91, .43, z + dz], [.38, .18, .38], [0, 0, Math.PI / 2]);
    if (material === taxiYellow) cube(lampGlow, x, 1.89, z - .1, .7, .3, .32);
  }

  // Suspension bridge silhouette over the river, beyond the playable blocks.
  const bridgeZ = -840, bridgeY = 19;
  cube(stone, -830, bridgeY, bridgeZ, 620, 2.4, 26);
  for (const bx of [-1010, -665]) {
    for (const zz of [-15, 15]) {
      cube(stone, bx, 31, bridgeZ + zz, 11, 62, 11);
      cube(stone, bx, 64, bridgeZ + zz, 14, 5, 14);
    }
    cube(stone, bx, 56, bridgeZ, 11, 7, 35);
  }
  for (const side of [-14.3, 14.3]) {
    let prev = null;
    for (let x = -1140; x <= -520; x += 10) {
      let y;
      if (x < -1010) y = 66 - (-1010 - x) * .34;
      else if (x > -665) y = 66 - (x + 665) * .30;
      else y = 29 + 37 * ((x + 837.5) / 172.5) ** 2;
      const pt = [x, y, bridgeZ + side];
      if (prev) pole(darkMetal, prev, pt, .22);
      pole(darkMetal, [x, bridgeY, bridgeZ + side], pt, .065); prev = pt;
    }
  }

  // Distant buildings fill the horizon without expensive roof details.
  for (let i = 0; i < 150; i++) {
    const x = range(-700, 850), z = range(-1650, -1210), h = range(35, 160);
    cube(pick(facades), x, h / 2, z, range(17, 39), h, range(17, 35), '#ccd0cc');
  }

  // Bake the scene to a small collection of GPU-instanced batches.
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
    for (let i = 0; i < batch.matrices.length; i++) {
      mesh.setMatrixAt(i, batch.matrices[i]);
      mesh.setColorAt(i, color.set(batch.colors[i] || '#ffffff'));
    }
    mesh.castShadow = batch.material !== whitePaint && batch.material !== yellowPaint && batch.material !== asphalt;
    mesh.receiveShadow = true; mesh.computeBoundingSphere();
    mesh.name = 'City architectural instances'; group.add(mesh);
  }
  const route = [
    new THREE.Vector3(0, 40, -75), new THREE.Vector3(0, 55, -210),
    new THREE.Vector3(-5, 48, -355), new THREE.Vector3(-72, 65, -465),
    new THREE.Vector3(-72, 42, -610), new THREE.Vector3(0, 58, -720),
    new THREE.Vector3(0, 72, -880), new THREE.Vector3(72, 62, -1010),
  ];
  const safeAnchors = anchors.filter(a => !buildings.some(b => a.x > b.minX && a.x < b.maxX && a.z > b.minZ && a.z < b.maxZ && a.y < b.height + .6));
  return {
    buildings, anchors: safeAnchors, route,
    spawn: new THREE.Vector3(0, 69, 50),
    bounds: { minX: -477, maxX: 513, minZ: -1100, maxZ: 360 },
    update(_dt, time) { water.material.color.setHSL(.53, .13, .43 + Math.sin(time * .16) * .008); },
  };
}
