import * as THREE from './vendor/three.module.js';

// A fixed pool keeps repeated boosts allocation-free. Positions stay in world
// space so sparks peel away from the animated hooves instead of following them.
export function createBoostSparks(hooves) {
  const count = 480, particles = Array.from({length:count}, () => ({
    position:new THREE.Vector3(), velocity:new THREE.Vector3(), age:1, life:0,
  }));
  const positions = new Float32Array(count * 6), colors = new Float32Array(count * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.LineBasicMaterial({vertexColors:true, transparent:true,
    blending:THREE.AdditiveBlending, depthWrite:false, toneMapped:false});
  const group = new THREE.Group();
  const streaks = new THREE.LineSegments(geometry,material);
  streaks.frustumCulled=false;group.add(streaks);
  // Soft luminous cores make the spray readable even without postprocess bloom.
  const cores = new THREE.BufferGeometry();
  const corePositions = new Float32Array(count*3), coreColors = new Float32Array(count*3);
  cores.setAttribute('position',new THREE.BufferAttribute(corePositions,3).setUsage(THREE.DynamicDrawUsage));
  cores.setAttribute('color',new THREE.BufferAttribute(coreColors,3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(cores,new THREE.ShaderMaterial({
    vertexColors:true, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    vertexShader:'varying vec3 tint; void main(){tint=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(95./max(1.,-p.z),1.,12.);}',
    fragmentShader:'varying vec3 tint; void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(tint,pow(1.-r,2.));}',
  }));
  points.frustumCulled=false;group.add(points);
  let cursor=0, emitting=0, remainder=0;
  const backward=new THREE.Vector3();
  function reset(){emitting=0;remainder=0;for(const p of particles)p.life=0;group.visible=false;}
  reset();
  return {group, reset, trigger(){emitting=.55;group.visible=true;}, update(dt,velocity,reduceMotion=false){
    if(!(dt>0))return;
    dt=Math.min(dt,.08);
    backward.set(-velocity.x,-velocity.y,-velocity.z).normalize();
    if(emitting>0){
      remainder+=Math.min(dt,emitting)*(reduceMotion?140:620);
      emitting=Math.max(0,emitting-dt);
      while(remainder>=1){
        remainder--;
        const index=cursor++%count,p=particles[index];
        hooves[index%hooves.length].getWorldPosition(p.position);
        p.age=0;p.life=.18+Math.random()*.3;
        const jet=12+Math.random()*24;
        p.velocity.copy(backward).multiplyScalar(jet);
        p.velocity.x+=(Math.random()-.5)*9;
        p.velocity.y+=(Math.random()-.5)*9-3;
        p.velocity.z+=(Math.random()-.5)*9;
      }
    }
    let live=0;
    particles.forEach((p,i)=>{
      p.age+=dt;
      if(p.age>=p.life){colors.fill(0,i*6,i*6+6);coreColors.fill(0,i*3,i*3+3);return;}
      live++;
      p.velocity.y-=8*dt;p.position.addScaledVector(p.velocity,dt);
      const fade=Math.pow(1-p.age/p.life,1.5),tail=.012+.018*fade;
      positions.set([p.position.x,p.position.y,p.position.z,p.position.x-p.velocity.x*tail,p.position.y-p.velocity.y*tail,p.position.z-p.velocity.z*tail],i*6);
      const green=.22+.65*fade,blue=.02+.3*fade;
      colors.set([3*fade,green*fade*2,blue*fade,fade,green*fade*.35,0],i*6);
      corePositions.set(p.position.toArray(),i*3);
      coreColors.set([3*fade,green*fade*2,blue*fade],i*3);
    });
    group.visible=live>0 || emitting>0;
    for(const g of [geometry,cores]){g.attributes.position.needsUpdate=true;g.attributes.color.needsUpdate=true;}
  }};
}
