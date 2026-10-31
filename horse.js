import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

// Nose (-Z) points upward; the back (+Y) faces away from the façade.
export function wallClimbOrientation(normal, target = new THREE.Quaternion()) {
  const back = new THREE.Vector3(normal.x, 0, normal.z).normalize();
  const rear = new THREE.Vector3(0, -1, 0);
  const right = new THREE.Vector3().crossVectors(back, rear);
  return target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, back, rear));
}

// Warhorse Lite by Literock Studios. The embedded PBR maps, rig and authored
// locomotion clips remain together; see assets/LICENSE.warhorse.txt.
export async function createHorse() {
  const gltf = await new GLTFLoader().loadAsync(new URL('./assets/warhorse.glb', import.meta.url).href);
  const group = new THREE.Group();
  group.name = 'Skystride • Warhorse';
  const suspension = new THREE.Group();
  suspension.name = 'suspension-response';
  group.add(suspension);
  const model = gltf.scene;
  // The artist's model faces +Z. The game uses -Z, with the hoof soles at Y=0.
  model.rotation.y = Math.PI;
  model.position.y = 0.0011;
  suspension.add(model);
  const meshes = [];
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = true;
    object.frustumCulled = false;
    meshes.push(object);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const map of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
        if (map) map.anisotropy = 8;
      }
    }
  });

  const clip = name => {
    const result = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!result) throw new Error(`Horse animation is missing: ${name}`);
    return result;
  };
  const idleClip = clip('idle_loop');
  const canterClip = clip('canter_loop');
  const hangingClip = canterClip.clone();
  hangingClip.name = 'intro_hanging';
  const mixer = new THREE.AnimationMixer(model);
  const actions = {
    hanging: mixer.clipAction(hangingClip),
    idle: mixer.clipAction(idleClip),
    walk: mixer.clipAction(clip('walk_loop')),
    canter: mixer.clipAction(canterClip),
    airborne: mixer.clipAction(makeAirborneGallop(idleClip, canterClip)),
  };
  for (const [name, action] of Object.entries(actions)) {
    action.setEffectiveWeight(name === 'idle' ? 1 : 0).play();
  }
  actions.hanging.paused = true;
  actions.hanging.time = hangingClip.duration * .25;
  mixer.update(0);
  model.updateMatrixWorld(true);

  const saddle = model.getObjectByName('saddle_socket');
  if (!saddle) throw new Error('Horse saddle socket is missing');
  const attachment = new THREE.Object3D();
  attachment.name = 'tether';
  const webHoof = model.getObjectByName('finger_R');
  webHoof.add(attachment);
  attachment.position.set(0, 0, 0);
  group.userData.attachment = attachment;
  group.userData.model = 'Warhorse Lite by Literock Studios';
  // The suspension rotates around the saddle, so a catch lifts the chest while
  // the legs and hindquarters lag below it instead of rotating around the feet.
  const suspensionPivot = saddle.getWorldPosition(new THREE.Vector3());
  suspension.position.copy(suspensionPivot);
  model.position.sub(suspensionPivot);

  const hangingAttachment = new THREE.Object3D();
  hangingAttachment.name = 'intro-rope-knot';
  group.add(hangingAttachment);
  const slingGeometry = new THREE.BufferGeometry();
  slingGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((2 + 2 * (160 + 48)) * 6), 3));
  const sling = new THREE.LineSegments(slingGeometry, new THREE.LineBasicMaterial({ color: '#d8d5ca', transparent: true, opacity: .78 }));
  sling.name = 'intro-ankle-sling';
  sling.frustumCulled = false;
  sling.visible = false;
  group.add(sling);
  const ankleL = model.getObjectByName('toe_L'), ankleR = model.getObjectByName('toe_R');
  const left = new THREE.Vector3(), right = new THREE.Vector3(), knot = new THREE.Vector3();
  const calfPoint = new THREE.Vector3(), axis = new THREE.Vector3();
  const silkU = new THREE.Vector3(), silkV = new THREE.Vector3();
  const silkA = new THREE.Vector3(), silkB = new THREE.Vector3(), silkStart = new THREE.Vector3();
  const silkUp = new THREE.Vector3(0, 1, 0), silkRight = new THREE.Vector3(1, 0, 0);
  function updateAnkleSilk() {
    const positions = slingGeometry.attributes.position;
    let vertex = 4;
    const segment = (a, b) => {
      positions.setXYZ(vertex++, a.x, a.y, a.z);
      positions.setXYZ(vertex++, b.x, b.y, b.z);
    };
    for (const [foot, calfName, seed] of [[left, 'foot_L', 0], [right, 'foot_R', 2.3]]) {
      model.getObjectByName(calfName).getWorldPosition(calfPoint);
      group.worldToLocal(calfPoint);
      axis.subVectors(calfPoint, foot).normalize();
      silkU.crossVectors(axis, Math.abs(axis.y) > .9 ? silkRight : silkUp).normalize();
      // Quarter-turn the silk around the ankle, keeping every wrap attached.
      silkU.applyAxisAngle(axis, Math.PI / 2);
      silkV.crossVectors(axis, silkU);
      // Uneven overlapping turns hug the pastern, in the animated leg's frame.
      const point = (t, out) => {
        const angle = t * Math.PI * 8 + seed + .2 * Math.sin(t * 31 + seed);
        const radius = .051 + .004 * Math.sin(angle * 3 + seed);
        return out.copy(foot).addScaledVector(axis, -.018 + t * .105)
          .addScaledVector(silkU, Math.cos(angle) * radius)
          .addScaledVector(silkV, Math.sin(angle) * radius * .85);
      };
      for (let i = 0; i < 160; i++) {
        point(i / 160, silkA); point((i + 1) / 160, silkB); segment(silkA, silkB);
      }
      // A few asymmetric load-bearing threads gather immediately above the legs.
      for (let strand = 0; strand < 6; strand++) {
        point(.12 + strand * .14, silkStart);
        for (let i = 0; i < 8; i++) {
          const path = (t, out) => out.copy(silkStart).lerp(knot, t)
            .addScaledVector(silkU, Math.sin(t * Math.PI) * ((strand - 2.5) * .025 + Math.sin(t * 9 + strand) * .009));
          path(i / 8, silkA); path((i + 1) / 8, silkB); segment(silkA, silkB);
        }
      }
    }
    positions.needsUpdate = true;
  }

  const neck = model.getObjectByName('neck_02');
  const head = model.getObjectByName('head');
  const tail = [1, 2, 3, 4, 5].map(n => model.getObjectByName(`tail_0${n}`));
  const forelegs = ['upperarm_L', 'upperarm_R'].map(name => model.getObjectByName(name));
  const lowerlegs = ['forearm_L', 'forearm_R'].map(name => model.getObjectByName(name));
  const hindlegs = ['thigh_L', 'thigh_R'].map(name => model.getObjectByName(name));
  const phasePose = { catch: 0, swing: 0, release: 0, soar: 0, wallRun: 0, vault: 0 };
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisZ = new THREE.Vector3(0, 0, 1);
  const offset = new THREE.Quaternion();
  let hangingNeck = null, hangingHead = null;
  const weights = { hanging: 0, idle: 1, walk: 0, canter: 0, airborne: 0 };
  let speed = 0, flight = 0, tension = 0, extension = 0, descent = 0, ascent = 0, turn = 0, clock = 0;
  let walkRate = 0.8, canterRate = 0.8, perchPose = 0;
  const rearShins = ['calf_L', 'calf_R'].map(name => model.getObjectByName(name));
  const perchBones = [...forelegs, ...lowerlegs, ...hindlegs, ...rearShins, neck, head];
  let beforePerchPose = null;
  let bodyPitch = 0, pitchVelocity = 0, lift = 0, liftVelocity = 0, previousLoad = 0;

  const supportingArm = model.getObjectByName('upperarm_R');
  const supportingElbow = model.getObjectByName('forearm_R');
  const limbNames = ['upperarm','forearm','hand','finger','thigh','calf','foot','toe'];
  const limbRest = limbNames.flatMap(name => ['L','R'].map(side => {
    const bone = model.getObjectByName(`${name}_${side}`);
    return {bone, rotation:bone.quaternion.clone()};
  }));
  let webPose = 0;
  const lastWebTarget = new THREE.Vector3();
  const shoulderPoint = new THREE.Vector3(), elbowPoint = new THREE.Vector3(), hoofPoint = new THREE.Vector3();
  const reachDirection = new THREE.Vector3(), bendDirection = new THREE.Vector3();
  const elbowGoal = new THREE.Vector3(), hoofGoal = new THREE.Vector3();
  const fromDirection = new THREE.Vector3(), toDirection = new THREE.Vector3();
  const worldRotation = new THREE.Quaternion(), parentRotation = new THREE.Quaternion(), aimRotation = new THREE.Quaternion();
  function aimJoint(bone, end, goal) {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    fromDirection.copy(end.getWorldPosition(new THREE.Vector3())).sub(origin).normalize();
    toDirection.copy(goal).sub(origin).normalize();
    aimRotation.setFromUnitVectors(fromDirection, toDirection);
    bone.getWorldQuaternion(worldRotation);
    bone.parent.getWorldQuaternion(parentRotation).invert();
    bone.quaternion.copy(parentRotation.multiply(aimRotation).multiply(worldRotation));
    group.updateMatrixWorld(true);
  }
  function poseWebLeg(state, dt) {
    const attached = !!state.webTarget && !state.grounded && !state.hanging;
    if (attached) {
      if (webPose < .001) lastWebTarget.copy(state.webTarget);
      else lastWebTarget.lerp(state.webTarget, 1-Math.exp(-dt*16));
    }
    webPose = state.grounded || state.hanging || state.wallNormal ? 0 : THREE.MathUtils.damp(webPose, attached ? 1 : 0, attached ? 22 : 9, dt);
    if (webPose < .001) return;
    // Remove the running cycle from the hanging limbs before aiming the support leg.
    for (const {bone,rotation} of limbRest) bone.quaternion.slerp(rotation, webPose);
    forelegs[0].quaternion.multiply(offset.setFromAxisAngle(axisX, .75 * webPose));
    lowerlegs[0].quaternion.multiply(offset.setFromAxisAngle(axisX, -1.45 * webPose));
    for (const bone of hindlegs) bone.quaternion.multiply(offset.setFromAxisAngle(axisX, .25 * webPose));
    group.updateMatrixWorld(true);
    supportingArm.getWorldPosition(shoulderPoint);
    supportingElbow.getWorldPosition(elbowPoint);
    webHoof.getWorldPosition(hoofPoint);
    const upperLength = shoulderPoint.distanceTo(elbowPoint), lowerLength = elbowPoint.distanceTo(hoofPoint);
    reachDirection.copy(lastWebTarget).sub(shoulderPoint).normalize();
    // Anatomical reach stays above the chest, even with an anchor behind the horse.
    group.getWorldQuaternion(worldRotation);
    reachDirection.applyQuaternion(parentRotation.copy(worldRotation).invert());
    reachDirection.set(THREE.MathUtils.clamp(reachDirection.x,-.65,.65), Math.max(.35,reachDirection.y), Math.min(-.15,reachDirection.z)).normalize().applyQuaternion(worldRotation);
    const reach = (upperLength + lowerLength) * .93;
    hoofGoal.copy(shoulderPoint).addScaledVector(reachDirection, reach);
    bendDirection.set(0,-1,0).applyQuaternion(worldRotation);
    bendDirection.addScaledVector(reachDirection,-bendDirection.dot(reachDirection)).normalize();
    const along = (upperLength*upperLength + reach*reach - lowerLength*lowerLength) / (2*reach);
    elbowGoal.copy(shoulderPoint).addScaledVector(reachDirection,along).addScaledVector(bendDirection,Math.sqrt(Math.max(0,upperLength*upperLength-along*along)));
    const originalArm = supportingArm.quaternion.clone(), originalElbow = supportingElbow.quaternion.clone();
    aimJoint(supportingArm,supportingElbow,elbowGoal);
    aimJoint(supportingElbow,webHoof,hoofGoal);
    supportingArm.quaternion.slerp(originalArm,1-webPose);
    supportingElbow.quaternion.slerp(originalElbow,1-webPose);
    group.updateMatrixWorld(true);
  }

  function update(dt, state = {}) {
    // The pause menu passes zero: neither clip time nor secondary motion advances.
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.08);
    clock += dt;
    if (beforePerchPose) perchBones.forEach((bone, i) => bone.quaternion.copy(beforePerchPose[i]));
    for (const phase of Object.keys(phasePose)) {
      const target = state.hanging || state.grounded ? 0 : state.feel?.[phase] || 0;
      phasePose[phase] = state.hanging || state.perched ? 0 : THREE.MathUtils.damp(phasePose[phase], target, 12, dt);
    }
    const accent = state.reduceMotion ? .35 : 1;
    const climbing = !!state.wallNormal;
    const zipping = !!state.feel?.zip;
    const leaping = state.feel?.leap || 0;
    const poised = leaping > 0 || zipping || (state.perched && (state.speed || 0) < .15);
    perchPose = state.perched ? (poised ? 1 : 0) : THREE.MathUtils.damp(perchPose, poised ? 1 : 0, 20, dt);
    const gaitSpeed = climbing ? Math.hypot(state.speed || 0, state.verticalSpeed || 0) : Math.max(0, state.speed || 0);
    speed = state.perched ? gaitSpeed : THREE.MathUtils.damp(speed, gaitSpeed, climbing ? 16 : 5, dt);
    flight = state.perched ? 0 : THREE.MathUtils.damp(flight, state.grounded || climbing ? 0 : 1, climbing ? 16 : state.grounded ? 8 : 5, dt);
    const ropeTension = THREE.MathUtils.clamp(state.tension || 0, 0, 1);
    const ropeExtension = THREE.MathUtils.clamp((state.stretch || 0) / 6, 0, 1);
    tension = THREE.MathUtils.damp(tension, ropeTension, 5, dt);
    extension = THREE.MathUtils.damp(extension, ropeExtension, 5, dt);
    descent = THREE.MathUtils.damp(descent, THREE.MathUtils.clamp(-(state.verticalSpeed || 0) / 35, 0, 1), 4, dt);
    ascent = THREE.MathUtils.damp(ascent, THREE.MathUtils.clamp((state.verticalSpeed || 0) / 35, 0, 1), 4, dt);
    turn = THREE.MathUtils.damp(turn, state.turn || 0, 4, dt);

    if (state.hanging) {
      // The title is a still hanging portrait, not an airborne animation.
      flight = 0;
      bodyPitch = pitchVelocity = lift = liftVelocity = previousLoad = 0;
    }

    const moving = THREE.MathUtils.smoothstep(speed, 0.15, 1.35);
    const running = THREE.MathUtils.smoothstep(speed, 4.0, 9.0);
    // All four legs keep cycling in the air, including at the top of an arc.
    // Full authored limb motion blends into the ground gait on landing.
    weights.airborne = flight * (1 - perchPose);
    weights.idle = (1 - flight) * (1 - moving) * (1 - perchPose) + perchPose;
    weights.walk = (1 - flight) * moving * (1 - running) * (1 - perchPose);
    weights.canter = (1 - flight) * moving * running * (1 - perchPose);
    weights.hanging = state.hanging ? 1 : 0;
    for (const [name, action] of Object.entries(actions)) action.setEffectiveWeight(state.hanging ? (name === 'hanging' ? 1 : 0) : weights[name]);

    // Ground speed changes stride cadence within an equine range, even when
    // gameplay momentum exceeds a real horse's running speed.
    walkRate = THREE.MathUtils.damp(walkRate, THREE.MathUtils.clamp(speed / 2.4, 0.65, 1.3), 4, dt);
    const groundCadence = THREE.MathUtils.clamp(speed / 8.5, 0.75, 1.28);
    const airCadence = (.94 + tension * .14 + descent * .10 + Math.min(speed / 40, 1) * .06) * (1 - phasePose.soar * .65 - phasePose.release * .3);
    canterRate = THREE.MathUtils.damp(canterRate, THREE.MathUtils.lerp(groundCadence, airCadence, flight), 4, dt);
    actions.walk.setEffectiveTimeScale(walkRate);
    actions.canter.setEffectiveTimeScale(canterRate);
    // These clips have identical duration and phase, avoiding a leg-position
    // jump as the airborne/grounded weights change.
    actions.airborne.setEffectiveTimeScale(canterRate);
    actions.idle.setEffectiveTimeScale(state.perched && speed <= .15 ? 0 : .85);
    mixer.update(dt);
    if (state.hanging) {
      hangingNeck ??= neck.quaternion.clone();
      hangingHead ??= head.quaternion.clone();
      neck.quaternion.copy(hangingNeck);
      head.quaternion.copy(hangingHead);
    } else { hangingNeck = null; hangingHead = null; }
    if (state.hanging) {
      // Use the gathered half of the authored stride on both sides: relaxed,
      // tucked limbs rather than a frozen asymmetric running silhouette.
      model.updateMatrixWorld(true);
      for (const [tip, base, chain] of [
        ['finger', 'scapula', ['upperarm', 'forearm', 'hand', 'finger']],
        ['toe', 'thigh', ['thigh', 'calf', 'foot', 'toe']],
      ]) {
        const reach = side => model.getObjectByName(`${tip}_${side}`).getWorldPosition(new THREE.Vector3()).distanceTo(model.getObjectByName(`${base}_${side}`).getWorldPosition(new THREE.Vector3()));
        const source = reach('L') < reach('R') ? 'L' : 'R';
        const destination = source === 'L' ? 'R' : 'L';
        for (const joint of chain) model.getObjectByName(`${joint}_${destination}`).quaternion.copy(model.getObjectByName(`${joint}_${source}`).quaternion);
      }
    }

    // Feed the actual rope load to this spring. Filtering it a second time
    // would erase the catch/recoil; the spring itself smooths the response.
    const load = flight * (ropeTension * .7 + ropeExtension * .3);
    pitchVelocity += (load - previousLoad) * .6;
    liftVelocity += (load - previousLoad) * .18;
    previousLoad = load;
    const targetPitch = accent * (.12 * phasePose.catch - .12 * phasePose.release - .06 * phasePose.soar) + flight * (.12 * ropeTension + .06 * ropeExtension - .10 * descent + .04 * ascent);
    const targetLift = accent * (-.1 * phasePose.catch + .09 * phasePose.release) + flight * (.055 * ropeTension + .035 * ropeExtension);
    // A damped secondary spring carries the body through a catch and release.
    // Substeps keep the recoil stable even when a rendering frame is delayed.
    const steps = Math.ceil(dt * 120), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      pitchVelocity += ((targetPitch - bodyPitch) * 65 - pitchVelocity * 8) * h;
      bodyPitch += pitchVelocity * h;
      liftVelocity += ((targetLift - lift) * 75 - liftVelocity * 9) * h;
      lift += liftVelocity * h;
    }
    suspension.rotation.set(bodyPitch * flight, 0, -turn * .025 * flight);
    suspension.position.copy(suspensionPivot);
    suspension.position.y += lift * flight;

    // Additive poses distinguish a gathered catch from an extended release.
    // Mixer evaluation restores the authored transforms every frame.
    const gather = accent * (.24 * phasePose.catch + .1 * phasePose.swing + .2 * phasePose.vault);
    const reach = accent * (.25 * phasePose.release + .18 * phasePose.soar);
    for (const bone of forelegs) bone.quaternion.multiply(offset.setFromAxisAngle(axisX, gather - reach));
    for (const bone of lowerlegs) bone.quaternion.multiply(offset.setFromAxisAngle(axisX, -gather * 1.3 + reach * .4));
    for (const bone of hindlegs) bone.quaternion.multiply(offset.setFromAxisAngle(axisX, -gather * .65 + reach * .65));

    // This rig's local X runs across the animal; Z swings a bone laterally.
    // Clip evaluation restores all joints before these small additive offsets.
    neck.quaternion.multiply(offset.setFromAxisAngle(axisX, flight * (-.07 * tension - .025 * extension + .065 * descent - pitchVelocity * .025 + Math.sin(clock * 1.6) * .012)));
    head.quaternion.multiply(offset.setFromAxisAngle(axisZ, -turn * 0.035 * flight));
    if (state.hanging) {
      neck.quaternion.multiply(offset.setFromAxisAngle(axisX, -.35));
      head.quaternion.multiply(offset.setFromAxisAngle(axisX, -.25));
    }
    for (let i = 0; i < tail.length; i++) {
      const bone = tail[i];
      bone.quaternion.multiply(offset.setFromAxisAngle(axisX, flight * (.065 + tension * .04 - pitchVelocity * .025) / (1 + i * .35)));
      bone.quaternion.multiply(offset.setFromAxisAngle(axisZ, flight * (Math.sin(clock * 3.2 - i * .6) * .045 - turn * .055)));
    }
    // Ground bob and hoof timing remain authored; the load-driven spring adds
    // suspension movement without replacing the animal's gait.
    group.updateMatrixWorld(true);
    sling.visible = !!state.hanging;
    if (state.hanging) {
      ankleL.getWorldPosition(left); ankleR.getWorldPosition(right);
      knot.copy(left).add(right).multiplyScalar(.5);
      knot.y = Math.max(left.y, right.y) + .35;
      group.worldToLocal(left); group.worldToLocal(right); group.worldToLocal(knot);
      hangingAttachment.position.copy(knot);
      slingGeometry.attributes.position.array.set([...left.toArray(), ...knot.toArray(), ...right.toArray(), ...knot.toArray()]);
      updateAnkleSilk();
      group.updateMatrixWorld(true);
    }
    poseWebLeg(state, dt);
    beforePerchPose = perchBones.map(bone => bone.quaternion.clone());
    if (leaping > 0) {
      // A deliberately ridiculous streamlined leap: every hoof trails the body.
      // Aim in the horse's frame so steering rotates the whole silhouette.
      for (const side of ['L', 'R']) {
        for (const [upperName, lowerName, hoofName] of [['upperarm','forearm','finger'], ['thigh','calf','toe']]) {
          const upper=model.getObjectByName(`${upperName}_${side}`), lower=model.getObjectByName(`${lowerName}_${side}`), hoof=model.getObjectByName(`${hoofName}_${side}`);
          const upperBefore=upper.quaternion.clone(),lowerBefore=lower.quaternion.clone();
          const root=group.worldToLocal(upper.getWorldPosition(new THREE.Vector3()));
          const kneeGoal=group.localToWorld(root.clone().add(new THREE.Vector3(0,-.12,.65)));
          const hoofGoal=group.localToWorld(root.clone().add(new THREE.Vector3(0,-.18,1.6)));
          aimJoint(upper,lower,kneeGoal);aimJoint(lower,hoof,hoofGoal);
          upper.quaternion.slerp(upperBefore,1-leaping);lower.quaternion.slerp(lowerBefore,1-leaping);
        }
      }
      const neckBefore=neck.quaternion.clone();
      const neckGoal=group.worldToLocal(neck.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0,0,-2));
      aimJoint(neck,head,group.localToWorld(neckGoal));
      neck.quaternion.slerp(neckBefore,1-leaping);
    } else if (state.perched && (state.speed || 0) < .15) {
      // Lower the body over a compact support footprint, then solve the legs
      // back to planted hooves. The raised chest keeps the gaze over the city.
      const legs = ['L', 'R'].flatMap(side => [
        ['upperarm', 'forearm', 'finger', side], ['thigh', 'calf', 'toe', side],
      ]).map(([upper, lower, hoof, side]) => ({
        upper: model.getObjectByName(`${upper}_${side}`),
        lower: model.getObjectByName(`${lower}_${side}`),
        hoof: model.getObjectByName(`${hoof}_${side}`),
        rear: upper === 'thigh',
      }));
      const goals = legs.map(leg => {
        const point = group.worldToLocal(leg.hoof.getWorldPosition(new THREE.Vector3()));
        point.x *= .9;
        point.z *= leg.rear ? .32 : .85;
        return group.localToWorld(point);
      });
      suspension.position.y -= .55;
      suspension.rotation.x = .18;
      group.updateMatrixWorld(true);
      legs.forEach((leg, i) => {
        const root = leg.upper.getWorldPosition(new THREE.Vector3());
        const knee = leg.lower.getWorldPosition(new THREE.Vector3());
        const foot = leg.hoof.getWorldPosition(new THREE.Vector3());
        const upperLength = root.distanceTo(knee), lowerLength = knee.distanceTo(foot);
        const direction = goals[i].clone().sub(root);
        const distance = Math.min(direction.length(), (upperLength + lowerLength) * .995);
        direction.normalize();
        const bend = knee.clone().sub(root);
        bend.addScaledVector(direction, -bend.dot(direction)).normalize();
        const along = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * distance);
        const kneeGoal = root.clone().addScaledVector(direction, along)
          .addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
        aimJoint(leg.upper, leg.lower, kneeGoal);
        aimJoint(leg.lower, leg.hoof, goals[i]);
      });
      neck.quaternion.multiply(offset.setFromAxisAngle(axisX, -.18));
    } else {
      const crouch = perchPose * .65;
      for (const bone of forelegs) bone.quaternion.multiply(offset.setFromAxisAngle(axisX, crouch));
      for (const bone of lowerlegs) bone.quaternion.multiply(offset.setFromAxisAngle(axisX, -crouch * 1.4));
      for (const bone of hindlegs) bone.quaternion.multiply(offset.setFromAxisAngle(axisX, -crouch * .7));
      neck.quaternion.multiply(offset.setFromAxisAngle(axisX, -.1 * perchPose));
    }
    group.updateMatrixWorld(true);
    for (const mesh of meshes) if (mesh.isSkinnedMesh) mesh.skeleton.update();
  }

  return { group, update, attachment, hangingAttachment };
}

function makeAirborneGallop(idle, canter) {
  const airborne = canter.clone();
  airborne.name = 'airborne_gallop';
  const idleTracks = new Map(idle.tracks.map(track => [track.name, track]));
  // Retain every animated joint and the source loop's timing. Only reduce the
  // grounded root/hip bounce: the tether now supplies the main vertical motion.
  for (const track of airborne.tracks) {
    if (!/^(root|pelvis)\.position$/.test(track.name)) continue;
    const rest = idleTracks.get(track.name)?.createInterpolant().evaluate(0);
    if (!rest) continue;
    for (let i = 0; i < track.values.length; i++) {
      track.values[i] = THREE.MathUtils.lerp(rest[i % 3], track.values[i], .35);
    }
  }
  return airborne;
}
