import * as THREE from './vendor/three.module.js';

// Linear-light rendering, contact occlusion and restrained optical bloom.
// The final pass applies exposure, a filmic response and display encoding once.
export function createCinematics(renderer, camera) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const bloomA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const bloomB = bloomA.clone();
  const passScene = new THREE.Scene(), passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vertexShader = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const make = (uniforms, fragmentShader) => new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false });
  const extract = make({ source: { value: target.texture } }, `varying vec2 vUv; uniform sampler2D source;
    void main(){vec3 c=texture2D(source,vUv).rgb;float l=max(max(c.r,c.g),c.b);gl_FragColor=vec4(c*smoothstep(1.3,3.2,l),1.);}`);
  const blur = make({ source: { value: bloomA.texture }, direction: { value: new THREE.Vector2() } }, `varying vec2 vUv; uniform sampler2D source; uniform vec2 direction;
    void main(){vec3 c=texture2D(source,vUv).rgb*.227027;c+=texture2D(source,vUv+direction*1.384615).rgb*.316216;c+=texture2D(source,vUv-direction*1.384615).rgb*.316216;c+=texture2D(source,vUv+direction*3.230769).rgb*.070270;c+=texture2D(source,vUv-direction*3.230769).rgb*.070270;gl_FragColor=vec4(c,1.);}`);
  const finish = make({
    source: { value: target.texture }, depthMap: { value: target.depthTexture }, bloom: { value: bloomA.texture },
    inverseProjection: { value: camera.projectionMatrixInverse }, resolution: { value: new THREE.Vector2(1, 1) },
    exposure: { value: 1 }, aoStrength: { value: .75 }, bloomStrength: { value: .085 }, warmth: { value: .025 },
  }, `varying vec2 vUv; uniform sampler2D source; uniform sampler2D depthMap; uniform sampler2D bloom;
    uniform mat4 inverseProjection;uniform vec2 resolution;uniform float exposure;uniform float aoStrength;uniform float bloomStrength;uniform float warmth;
    vec3 positionAt(vec2 uv){float d=texture2D(depthMap,uv).r;vec4 p=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
    vec3 filmic(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
    void main(){vec3 color=texture2D(source,vUv).rgb;float depth=texture2D(depthMap,vUv).r;
      if(depth<.99999 && aoStrength>.01){
        vec3 p=positionAt(vUv);vec3 n=normalize(cross(dFdx(p),dFdy(p)));float occ=0.;
        float radius=clamp(2.5/max(-p.z,1.),.002,.035);
        for(int i=0;i<12;i++){float a=float(i)*2.399963;float r=sqrt((float(i)+.5)/12.);vec2 offset=vec2(cos(a)*resolution.y/resolution.x,sin(a))*radius*r;
          vec2 uv=clamp(vUv+offset,vec2(.001),vec2(.999));vec3 delta=positionAt(uv)-p;float distance=length(delta);
          float horizon=max(dot(n,delta/max(distance,.0001))-.16,0.);float range=1.-smoothstep(.2,3.4,distance);occ+=horizon*range;
        }
        color*=1.-clamp(occ/12.*aoStrength*2.1,0.,.36);
      }
      color+=texture2D(bloom,vUv).rgb*bloomStrength;
      color*=exposure;float lum=dot(color,vec3(.2126,.7152,.0722));
      color=mix(vec3(lum),color,1.035);color*=vec3(1.+warmth,1.,1.-warmth*.65);
      color=filmic(color);float vignette=dot(vUv-.5,vUv-.5);color*=1.-vignette*.19;
      gl_FragColor=vec4(color,1.);
      #include <colorspace_fragment>
    }`);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), finish); quad.frustumCulled = false; passScene.add(quad);
  let width = 1, height = 1, highQuality = true, bloomAmount = .085;
  const stats = { calls: 0, triangles: 0 };
  const pass = (material, output) => { quad.material = material; renderer.setRenderTarget(output); renderer.render(passScene, passCamera); };
  return {
    stats,
    resize(w, h, high = true) {
      width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h)); highQuality = high;
      target.setSize(width, height); bloomA.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2)); bloomB.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
      finish.uniforms.resolution.value.set(width, height); finish.uniforms.aoStrength.value = high ? .75 : 0;
    },
    setLook({ warmth = .025, bloom = .085 } = {}) { finish.uniforms.warmth.value = warmth; bloomAmount = bloom; },
    render(scene) {
      const mapping = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles;
      if (highQuality) {
        pass(extract, bloomA); blur.uniforms.source.value = bloomA.texture; blur.uniforms.direction.value.set(5 / width, 0); pass(blur, bloomB);
        blur.uniforms.source.value = bloomB.texture; blur.uniforms.direction.value.set(0, 5 / height); pass(blur, bloomA);
      }
      finish.uniforms.bloomStrength.value = highQuality ? bloomAmount : 0;
      finish.uniforms.exposure.value = renderer.toneMappingExposure; finish.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      pass(finish, null); renderer.toneMapping = mapping;
    },
  };
}
