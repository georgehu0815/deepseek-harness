/** Author wider, beat-aligned contact-constrained dances using installed-model IK; no physics. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, } from 'node:crypto';
import { createRequire } from 'node:module';
import { solveWalkingPose, walkingFeet, walkingLegs } from '../../packages/client/ui-robot-lab/src/client/clip-leg-ik.ts';
import { validateWalkingClip, measureWalkingContacts } from '../../packages/client/ui-robot-lab/src/client/clip-walking.ts';
const require = createRequire(new URL('../../packages/client/ui-robot-lab/package.json', import.meta.url));
const { Quaternion, Vector3 } = require('three');
const out = new URL('./', import.meta.url);
const { profile, scene, limits } = JSON.parse(readFileSync(new URL('model.json', out), 'utf8'));
const rig = scene.kinematics;
const { bodies } = walkingLegs(profile, rig);
const neutral = { joints: profile.joints.map(j => j.defaultPosition), rootPitch: 0, rootYaw: 0, rootRoll: 0, rootPosition: [...rig.rootPosition] };
const feet = walkingFeet(rig, bodies, neutral);
const styles = [
  { id: 'bachata', name: 'MicroDuck Bachata v2', bpm: 130, steps: 32, stepBeats: 4, introBeats: 2, lift: .016, head: .48,
    headings: [.2,.4,.2,0,-.2,-.4,-.2,0,.45,0,-.45,0],
    sections: ['Lift and reach each foot forward/back while turning left', 'Return through center into a right-facing rhythm', 'Reverse the foot reaches with visible head and weight shifts', 'Alternate larger bounded left/right turns and lifted steps'] },
  { id: 'breakdance', name: 'MicroDuck Standing Breakdance v2', bpm: 140, steps: 32, stepBeats: 4, introBeats: 4, lift: .021, head: .56,
    headings: [.3,.6,.9,.6,.3,0,-.3,-.6,-.9,-.6,-.3,0],
    sections: ['Standing toprock with high alternating foot lifts and reaches', 'Bounded left-facing turn and head accents, not a floor spin', 'Reverse the toprock direction with deliberate head hits', 'Right-facing lifted steps and return to neutral heading'] },
  { id: 'cumbia', name: 'MicroDuck Cumbia v2', bpm: 120, steps: 28, stepBeats: 4, introBeats: 4, lift: .018, head: .44,
    headings: [.2,.4,.6,.4,.2,0,-.2,-.4,-.6,-.4,-.2,0],
    sections: ['Backward-and-forward lifted foot reaches in cumbia rhythm', 'Larger left-facing turn with rocking head accents', 'Reverse the rocking and stepping pattern to the other side', 'Forward/back foot arcs with a right turn and recovery'] },
  { id: 'martial_arts', name: 'MicroDuck Gentle Kata v2', bpm: 60, steps: 24, stepBeats: 2, introBeats: 6, lift: .021, head: .6,
    headings: [.2,.4,.6,.4,.2,0,-.2,-.4,-.6,-.4,-.2,0],
    sections: ['Deliberate higher foot lifts and long forward/back reaches', 'Turn left and shift weight while keeping the support foot planted', 'Alternate the lifted foot with decisive head turns', 'Turn right and return to neutral; no arms, strikes or kicks'] },
  { id: 'robot', name: 'MicroDuck Robot Pop v2', bpm: 100, steps: 24, stepBeats: 4, introBeats: 2, lift: .018, head: .62,
    headings: [0,.35,.7,.35,0,0,0,-.35,-.7,-.35,0,0],
    sections: ['Large alternating foot arcs with regular robot pulses', 'Left-facing robot turns with head isolation', 'Mirror the foot reaches and turn to the opposite side', 'Right-facing turns, neck pulses, and neutral recovery'] },
  { id: 'salsa', name: 'MicroDuck Salsa v2', bpm: 180, steps: 40, stepBeats: 4, introBeats: 4, lift: .019, head: .52,
    headings: [.3,.6,.9,.6,.3,0,-.3,-.6,-.9,-.6,-.3,0],
    sections: ['Larger lifted forward-back foot reaches with salsa accents', 'Left-facing salsa steps and visible neck rhythm', 'Reverse the basic reach with alternating lifted feet', 'Right-facing lifted steps and return to neutral heading'] },
];
const ease = u => u * u * (3 - 2 * u);
const round = (v, n = 8) => Number(v.toFixed(n));
const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
const hash = text => createHash('sha256').update(text).digest('hex');
function target(foot, yaw) {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0,0,1), yaw);
  const offset = new Vector3().fromArray(feet[foot].position).sub(new Vector3().fromArray(rig.rootPosition));
  return { position: offset.applyQuaternion(q).add(new Vector3().fromArray(rig.rootPosition)).toArray(),
    quaternion: q.multiply(new Quaternion().fromArray(feet[foot].quaternion)).toArray() };
}
function interpolateFoot(a,b,u,height) {
  return { position: mix(a.position,b.position,ease(u)).map((v,i)=>v+(i===2?height*Math.sin(Math.PI*u)**2:0)),
    quaternion: new Quaternion().fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion),ease(u)).toArray() };
}
function author(style) {
  const beat = 60 / style.bpm, intro = style.introBeats * beat, stepTime = style.stepBeats * beat;
  const duration = 2 * intro + style.steps * stepTime;
  const clip = { version: 3, name: style.name, duration, loop: true, modelSha256: profile.modelSha256, keys: [], contacts: [] };
  let previous = structuredClone(neutral);
  const add = (t, targets, yaw) => {
    const envelope = ease(Math.min(1,t/intro,(duration-t)/intro));
    const preferred = [(targets[0].position[0] + targets[1].position[0])/2,
      (targets[0].position[1] + targets[1].position[1])/2, rig.rootPosition[2] - .006 * envelope];
    const seed = { ...previous, rootPosition: preferred };
    try { previous = solveWalkingPose(profile, rig, seed, targets, yaw, preferred); }
    catch (error) { throw new Error(`${style.id} at ${t.toFixed(4)} s: ${error.message}`); }
    const pulse = 2*Math.PI*t/beat;
    const headPhrase = Math.sin(2*Math.PI*t/(8*beat));
    previous.joints[5] = neutral.joints[5] + envelope*(.13*Math.sin(pulse/2)+.05*Math.sin(pulse));
    previous.joints[6] = neutral.joints[6] + envelope*(-.10*Math.sin(pulse/2)+.065*Math.sin(pulse));
    previous.joints[7] = envelope*style.head*headPhrase;
    previous.joints[8] = envelope*.13*Math.sin(pulse/4);
    const key = { t, joints: previous.joints.map(v=>round(v)), rootPitch: 0, rootYaw: yaw,
      rootRoll: round(previous.rootRoll), rootPosition: previous.rootPosition.map(v=>round(v,10)) };
    if (t===0 || t===duration) Object.assign(key,structuredClone(neutral));
    clip.keys.push(key);
  };
  for(const [i,foot] of ['left','right'].entries()) clip.contacts.push({start:0,end:intro,foot,...structuredClone(feet[i])});
  const introSamples = style.id==='salsa'?12:Math.ceil(intro*8);
  for(let s=0;s<=introSamples;s++) add(intro*s/introSamples,feet,0);
  let current = structuredClone(feet), oldYaw = 0;
  const headings = [0,...style.headings], pairs=style.steps/2;
  for(let p=0;p<pairs;p++) {
    const pathAt=(p+1)/pairs*(headings.length-1), lo=Math.min(headings.length-2,Math.floor(pathAt)), fraction=pathAt-lo;
    const yaw=headings[lo]+(headings[lo+1]-headings[lo])*fraction;
    for(let half=0;half<2;half++) {
      const swing = yaw >= oldYaw ? half : 1-half, stance=1-swing;
      const start=intro+(p*2+half)*stepTime, end=intro+(p*2+half+1)*stepTime;
      const landing = target(swing,yaw);
      clip.contacts.push({ start,end,foot:['left','right'][stance],...structuredClone(current[stance]) });
      const samples=style.steps===40?10:12;
      for(let s=1;s<=samples;s++) {
        const u=s/samples;
        const desired=current.map((f,i)=>i===swing?interpolateFoot(f,landing,u,style.lift):f);
        const heading=oldYaw+(yaw-oldYaw)*(half+ease(u))/2;
        const reach=.022*Math.sin(Math.PI*u)**2*(p%2===0?1:-1);
        desired[swing].position[0]+=reach*Math.cos(heading);
        desired[swing].position[1]+=reach*Math.sin(heading);
        add(start+(end-start)*u,desired,heading);
      }
      current[swing]=landing;
    }
    oldYaw=yaw;
  }
  const endSteps=intro+style.steps*stepTime;
  for(const [i,foot] of ['left','right'].entries()) clip.contacts.push({start:endSteps,end:duration,foot,...structuredClone(feet[i])});
  for(let s=1;s<=introSamples;s++) add(endSteps+intro*s/introSamples,feet,0);
  clip.keys.at(-1).t=duration;
  Object.assign(clip.keys.at(-1),structuredClone(neutral));
  const validated=validateWalkingClip(clip,profile,scene,limits);
  const body = JSON.stringify(validated,null,2)+'\n';
  if(Buffer.byteLength(body)>262144) throw new Error(`${style.id}: file budget ${Buffer.byteLength(body)}`);
  const guide=[{start:0,end:intro,description:'Start from exact neutral, settle into the rhythm, and nod.'}];
  for(let i=0;i<4;i++) guide.push({start:intro+style.steps*stepTime*i/4,end:intro+style.steps*stepTime*(i+1)/4,description:style.sections[i]+'.'});
  guide.push({start:endSteps,end:duration,description:'Plant both feet, soften the head motion, and return to exact neutral.'});
  const guideText=guide.map(s=>`${s.start.toFixed(2)}–${s.end.toFixed(2)} s: ${s.description}`).join('\n');
  const asset={bpm:style.bpm,guide:guideText,clip:validated};
  writeFileSync(new URL(`${style.id}_microduck_v2.clip.json`,out),body);
  writeFileSync(new URL(`${style.id}_microduck_v2.guide.json`,out),JSON.stringify(guide,null,2)+'\n');
  writeFileSync(new URL(`${style.id}_microduck_v2.dance.json`,out),JSON.stringify(asset,null,2)+'\n');
  const entry={dance:style.id,id:style.id+'_v2',clipFile:`${style.id}_microduck_v2.clip.json`,danceFile:`${style.id}_microduck_v2.dance.json`,
    clipSha256:hash(body),duration,bpm:style.bpm,keys:clip.keys.length,bytes:Buffer.byteLength(body),stepCount:style.steps,
    plannedFootLiftMeters:style.lift,headingRangeRad:[Math.min(...clip.keys.map(k=>k.rootYaw)),Math.max(...clip.keys.map(k=>k.rootYaw))],
    contactMeasurements:measureWalkingContacts(validated,profile,rig),guideText};
  console.log(JSON.stringify(entry));
  return entry;
}
const selected=process.argv[2]?styles.filter(s=>s.id===process.argv[2]):styles;
const clips=selected.map(author);
writeFileSync(new URL(process.argv[2]?'probe.json':'manifest.json',out),JSON.stringify({revision:'v2',schemaVersion:3,modelSha256:profile.modelSha256,
  description:'Original, larger contact-constrained kinematic dance interpretations. v2 names the dance revision; schema 3 retains root and contact targets. No physics, trained policy, balance or hardware-safety claim.', clips},null,2)+'\n');
