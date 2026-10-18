import test from 'node:test';
import assert from 'node:assert/strict';
import { SwingPhysics } from './physics.js';
import { traversalFeel } from './traversal-feel.js';

test('presentation follows catch, swing, deliberate release, and soar without changing physics', () => {
  const p=new SwingPhysics({spawn:{x:0,y:100,z:0}});
  p.connect({x:0,y:130,z:-30});
  assert.equal(traversalFeel(p).phase,'catch');
  p.step(.12); p.step(.12); p.step(.12); p.step(.12); p.step(.12); p.step(.12);
  assert.equal(traversalFeel(p).phase,'swing');
  p.release({launch:true});
  p.soarUntil=p.time+1.1;
  const before=p.snapshot();
  const feel=traversalFeel(p);
  assert.equal(feel.phase,'release');
  assert.ok(feel.fov>0 && feel.distance>0);
  assert.deepEqual(p.snapshot(),before);
  for(let i=0;i<4;i++)p.step(.12);
  assert.equal(traversalFeel(p).phase,'soar');
  p.connect({x:0,y:p.pos.y+30,z:p.pos.z-20});
  assert.equal(traversalFeel(p).release,0,'new catch cannot reuse a release accent');
});

test('cleanup does not trigger release and reduced motion removes camera accents', () => {
  const p=new SwingPhysics();p.connect({x:0,y:80,z:20});
  const reduced=traversalFeel(p,true);
  for(const key of ['distance','height','fov','lookAhead'])assert.ok(reduced[key] === 0);
  p.release();
  assert.equal(traversalFeel(p).release,0);
  assert.equal(traversalFeel(p).phase,'air');
});
