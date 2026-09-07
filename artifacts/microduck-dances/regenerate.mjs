/** Regenerate authored MicroDuck interpretations; never retarget G1 joint indices or run physics. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateClipSequence } from '../../packages/client/ui-robot-lab/src/client/clip-sequence.ts';
import { validatePreviewClip } from '../../packages/client/ui-robot-lab/src/client/clip-preview.ts';
import { clipRigs, sampleAuthoredClip } from '../../packages/client/ui-robot-lab/src/client/clip-motion.ts';

const output = dirname(fileURLToPath(import.meta.url));
const input = '/Volumes/ExternalSSD/geoagent/Unitree-G1-Research/dance_examples/generated';
const { profile, limits } = JSON.parse(readFileSync(join(output, 'model.json'), 'utf8'));
const neutral = profile.joints.map(j => j.defaultPosition);
const names = profile.joints.map(j => j.name);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const save = (name, data) => writeFileSync(join(output, name), JSON.stringify(data, null, 2) + '\n');
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const pulse = beat => (1 - Math.cos(2 * Math.PI * beat)) / 2;
const sine = (beat, period) => Math.sin(2 * Math.PI * beat / period);
const definitions = {
  bachata: { bpm: 130, name: 'MicroDuck Bachata', movement: 'Small side sways with a gentle fourth-beat knee accent; head tilts replace flowing arm gestures.' },
  breakdance: { bpm: 140, name: 'MicroDuck Standing Breakdance', movement: 'Small standing knee pulses and head accents; two standing holds replace floor freezes. No crossed legs, windmills or power moves.' },
  cumbia: { bpm: 120, name: 'MicroDuck Cumbia', movement: 'Gentle coupled hip sway and bounded twists, with slow head turns replacing arm waves. No lifted-foot stepping.' },
  martial_arts: { bpm: 60, name: 'MicroDuck Gentle Kata', movement: 'Four small standing gestures replace horse, crane, tiger and dragon stances; no deep crouches, strikes or one-leg balance.' },
  robot: { bpm: 100, name: 'MicroDuck Robot Pop', movement: 'Small head turns and nods with deliberate holds replace angular arm poses and mechanical steps.' },
  salsa: { bpm: 180, name: 'MicroDuck Salsa', movement: 'Gentle knee pulses and sways; bounded head turns at the source spin windows replace full spins. No fast footwork or arm choreography.' },
};

function motion(dance, t, beat) {
  const q = { sway: 0, squat: 0, twist: 0, look: 0, yaw: 0, roll: 0 };
  switch (dance) {
    case 'bachata':
      q.sway = .025 * sine(beat, 8);
      q.squat = .009 * pulse(beat) * (Math.floor(beat) % 4 === 3 ? 1.5 : 1);
      q.roll = .045 * sine(beat, 8); q.look = .06 * pulse(beat / 2); break;
    case 'cumbia':
      q.sway = .025 * sine(beat, 4); q.twist = .02 * sine(beat, 8);
      q.squat = .008 * pulse(beat); q.yaw = .10 * sine(beat, 8); q.roll = .03 * sine(beat, 4); break;
    case 'breakdance': {
      q.squat = .014 * pulse(beat); q.sway = .018 * sine(beat, 4);
      q.yaw = .08 * sine(beat, 4); q.look = .06 * pulse(beat / 2);
      for (const [start, end, sign] of [[8, 10, 1], [20, 22, -1]]) {
        const blend = smooth((t - start + .5) / .5) * smooth((end + .5 - t) / .5);
        const hold = { sway: 0, squat: .01, twist: 0, look: .04, yaw: sign * .10, roll: sign * .025 };
        for (const key of Object.keys(q)) q[key] = q[key] * (1 - blend) + hold[key] * blend;
      }
      break;
    }
    case 'martial_arts': {
      const phase = Math.floor(t / 8) % 4;
      const local = t % 8;
      const envelope = smooth(local / 2) * smooth((8 - local) / 2);
      if (phase === 0) { q.squat = .014; q.look = .05; }
      if (phase === 1) { q.yaw = .10; q.roll = .04; }
      if (phase === 2) { q.squat = .018; q.look = .08; }
      if (phase === 3) { q.yaw = .12 * sine(local, 8); q.twist = .02 * sine(local, 8); }
      for (const key of Object.keys(q)) q[key] *= envelope;
      break;
    }
    case 'robot': {
      const index = Math.floor(beat / 2) % 4;
      const local = beat % 2;
      const envelope = smooth(local / .5) * smooth((2 - local) / .5);
      q.yaw = [.10, 0, -.10, 0][index] * envelope;
      q.look = [0, .10, 0, .06][index] * envelope;
      q.squat = .006 * envelope; break;
    }
    case 'salsa':
      q.sway = .018 * sine(beat, 4); q.squat = .009 * pulse(beat);
      q.roll = .025 * sine(beat, 4); q.look = .04 * pulse(beat / 2);
      for (const [start, end, sign] of [[8, 9.5, 1], [15, 16.5, -1]]) {
        if (t >= start && t <= end) q.yaw = sign * .14 * pulse((t - start) / (end - start));
      }
      break;
    default: throw new Error(`Unsupported source dance ${dance}`);
  }
  return q;
}

const rows = [];
const files = readdirSync(input).filter(name => name.endsWith('.json')).sort();
assert.equal(files.length, 6);
for (const file of files) {
  const bytes = readFileSync(join(input, file));
  const source = JSON.parse(bytes);
  const definition = definitions[source.dance];
  assert.ok(definition, file);
  assert.equal(source.joint_count, 29);
  assert.equal(source.frames.length, source.frame_count);
  assert.equal(source.control_frequency_hz, 50);
  assert.equal(source.frame_count, source.duration_seconds * 50);
  source.frames.forEach((frame, i) => {
    assert.ok(Math.abs(frame.time - i / 50) < 1e-9);
    assert.equal(frame.joints.length, 29);
    assert.ok(frame.joints.every(Number.isFinite));
  });
  const { bpm, name, movement } = definition;
  const duration = source.duration_seconds;
  const opening = 120 / bpm, closing = duration - opening;
  const guide = [{ start: 0, end: opening, description: 'Begin at the exact installed neutral pose; gently enter the motion.' }];
  const sections = source.dance === 'breakdance'
    ? [[8, 'Small standing knee pulses and head accents; ease into a hold.'], [10, 'Hold a small standing head turn; this replaces the baby freeze.'], [20, 'Resume gentle knee pulses and head accents; ease into the second hold.'], [22, 'Hold the opposite head turn, standing on both feet; this replaces the chair freeze.'], [closing, movement]]
    : source.dance === 'salsa'
      ? [[8, 'Small knee pulses and sways.'], [9.5, 'One bounded positive head-yaw turn and return, not a full spin.'], [15, 'Resume small knee pulses and sways.'], [16.5, 'One bounded negative head-yaw turn and return, not a full spin.'], [closing, movement]]
      : source.dance === 'martial_arts'
        ? [[8, 'Gentle coupled knee bend and head dip; return to neutral.'], [16, 'Small head turn and tilt, both feet near neutral; return.'], [24, 'Modest coupled knee bend and nod; return.'], [32, 'Slow bounded head and hip turns; return.'], [closing, 'Repeat the small coupled knee bend and head dip.']]
        : [[closing, movement]];
  for (const [end, description] of sections) guide.push({ start: guide.at(-1).end, end, description });
  guide.push({ start: closing, end: duration, description: 'Ease out of the motion and finish at the exact installed neutral pose.' });
  const times = new Set([0, duration, opening, closing]);
  for (let i = 1; i * 15 / bpm < duration; i++) times.add(i * 15 / bpm);
  if (source.dance === 'breakdance') for (const t of [7.5, 8, 10, 10.5, 19.5, 20, 22, 22.5]) times.add(t);
  if (source.dance === 'salsa') for (const t of [8, 8.75, 9.5, 15, 15.75, 16.5]) times.add(t);
  const sorted = [...times].sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1] > 1e-8);
  const keys = sorted.map(t => {
    if (t === 0 || t === duration) return { t, joints: [...neutral], rootPitch: 0 };
    const envelope = smooth(t / opening) * smooth((duration - t) / opening);
    const q = motion(source.dance, t, t * bpm / 60);
    const joints = [...neutral];
    for (const rig of ['sway', 'squat', 'twist', 'look']) {
      for (const [joint, coefficient] of Object.entries(clipRigs[rig])) joints[names.indexOf(joint)] += coefficient * q[rig] * envelope;
    }
    joints[names.indexOf('head_yaw')] += q.yaw * envelope;
    joints[names.indexOf('head_roll')] += q.roll * envelope;
    return { t, joints, rootPitch: 0 };
  });
  const sequence = validateClipSequence({ version: 1, modelSha256: profile.modelSha256, jointNames: names, bpm,
    clip: { version: 1, name, duration, loop: true, keys } }, profile, limits);
  validatePreviewClip(sequence.clip, profile, limits);
  assert.deepEqual(keys[0].joints, neutral); assert.deepEqual(keys.at(-1).joints, neutral);
  let maxVelocity = 0, maxOffset = 0;
  keys.forEach((key, i) => key.joints.forEach((value, j) => {
    maxOffset = Math.max(maxOffset, Math.abs(value - neutral[j]));
    if (i) maxVelocity = Math.max(maxVelocity, Math.abs(value - keys[i - 1].joints[j]) / (key.t - keys[i - 1].t));
  }));
  assert.ok(maxVelocity < 1, `${file}: authored speed exceeds 1 rad/s`);
  for (let i = 0; i <= duration * 50; i++) {
    const pose = sampleAuthoredClip(sequence.clip, i / 50);
    assert.equal(pose.rootPitch, 0);
    pose.joints.forEach((value, j) => assert.ok(value >= profile.joints[j].lower && value <= profile.joints[j].upper));
  }
  const stem = source.dance + '_microduck';
  save(stem + '.clip.json', sequence.clip);
  save(stem + '.sequence.json', sequence);
  save(stem + '.guide.json', guide);
  const guideText = guide.map(s => `${s.start.toFixed(2)}–${s.end.toFixed(2)} s: ${s.description}`).join('\n');
  assert.ok(guideText.length <= 2000);
  rows.push({ source: join(input, file), sourceSha256: sha256(bytes), sourceFrames: source.frame_count,
    dance: source.dance, bpm, duration, keys: keys.length, maxOffsetRad: maxOffset, maxLinearVelocityRadPerSecond: maxVelocity,
    clipFile: stem + '.clip.json', clipSha256: sha256(readFileSync(join(output, stem + '.clip.json'))),
    sequenceFile: stem + '.sequence.json', guideFile: stem + '.guide.json', guideText,
    adaptation: movement, validation: { modelIdentity: true, exactNeutralEndpoints: true, appSequenceParser: true,
      appAnimateImportParser: true, jointLimitsAt50Hz: true, rootPitchZero: true } });
}
save('manifest.json', { version: 1, modelSha256: profile.modelSha256,
  method: 'Authored thematic regeneration using source durations, source-generator BPM and movement sections; not numerical G1 retargeting.',
  limitations: 'Kinematic targets only. No training, physics rollout, balance assessment, collision clearance certification, audio synchronization or hardware control.', clips: rows });
console.log(JSON.stringify(rows.map(({ dance, bpm, duration, keys, maxOffsetRad, maxLinearVelocityRadPerSecond }) =>
  ({ dance, bpm, duration, keys, maxOffsetRad, maxLinearVelocityRadPerSecond })), null, 2));
