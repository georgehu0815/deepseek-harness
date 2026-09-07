---
name: microduck-choreography
description: Plan a timed MicroDuck movement guide and author conservative, model-bound 14-joint choreography JSON for Clip Gen Sequence By AI or an explicitly requested manual clip.
user-invocable: true
disable-model-invocation: false
---

# MicroDuck choreography

Use this skill to turn a movement request into an authored MicroDuck clip. Work in the current session with its selected model. Do not delegate to child agents, start training, run simulation, or activate hardware. An authored clip is a movement target, not evidence of balance, learned skill, beat synchronization, or physical safety.

## Inputs and tools

The Sequence By AI request supplies `requestId`, `requestedBpm`, the installed `modelSha256`, all 14 ordered joint names, joint limits, neutral pose, and allowed tempo, duration, and key-count limits. Use those supplied values, not remembered robot metadata or an example's names or hash. Respect the request's language for the guide and clip name.

For a Sequence By AI request, loading this skill with the `skill` tool is permitted; do not call additional tools or create files. Return one final JSON envelope only, without Markdown fences, commentary, progress messages, or separate guide output. For a standalone human request, create a JSON file only when the human explicitly asks for a file; never modify a read-only attachment. If required model metadata is missing in a standalone request, ask for it rather than inventing it.

## Plan the movement first

1. Identify the requested movements and repetitions. Replace unsupported anatomy with achievable gestures: MicroDuck has no authored arm, hand, wing, or facial actuators. Express waving or hand gestures through small head nods, tilts, and turns; describe the substitution honestly.
2. Set the sequence's `bpm` to `requestedBpm`. One beat lasts `60 / requestedBpm` seconds. Choose a reasonable duration within the supplied limits; use the requested duration when allowed. Neither 120 BPM nor 32 seconds is a universal default.
3. Divide the whole duration into timed movement segments, including an opening transition from neutral and a closing return to neutral. Assign useful descriptions in the user's language, not a reasoning transcript. The guide must tell the viewer what moves and when; do not promise actions absent from the keys.
4. Keep `start` and `end` in seconds. The first segment starts at 0, every segment has `end > start`, each segment's start equals the previous end, and the last end equals `clip.duration`. Every description is nonblank. Keep the complete formatted guide, including time labels, separators and line breaks, within 2000 UTF-16 code units; prefer short descriptions and a small number of segments.

## Author conservative motion

- Map each joint by its supplied name and position in the ordered `jointNames` array. Every key has exactly 14 finite numeric angles in radians, within that joint's supplied limits. Channels 0–13 index the `joints` array; servo labels 1–14 are display labels, and `mjcfJointIndex` identifies a joint in the installed model rather than an array position. None of these numbers identifies a rotation axis. Interpret neck and hip rotations in the model's local axes; do not apply a world-axis assumption or assign an arbitrary channel to a gesture. If the supplied metadata does not establish a movement's axis, keep that joint neutral and choose a known gesture instead.
- Use small neck motions and modest hip, knee, and ankle offsets. Keep feet near the neutral stance; avoid extreme extension, crossed legs, sudden reversals, or unsupported jumps. Couple leg adjustments conservatively rather than swinging a single loaded leg. Limits are outer bounds, not target amplitudes.
- Interpret requests such as three left/right turns as three bounded twists with returns toward neutral. Do not encode accumulated 360-degree spins or describe a bounded twist as a full spin. Head turns can express the direction when whole-body rotation is not supported.
- Keep `rootPitch: 0` in every key. Root pitch is not another servo and is not a substitute for a hip or neck channel.
- Start at `t: 0` with the exact supplied neutral joint vector. End at exactly `t: clip.duration` with that same exact vector. Copy neutral values without rounding them. Key times must be strictly increasing and never exceed the duration; include transition and movement extrema on beat or half-beat times where useful. Use a compact number of keys within the supplied key-count limit.
- Honor a requested `loop` value; otherwise prefer `true` for a reusable repeating dance. If looping, the first and last joint vectors and root pitch must match exactly. Neutral endpoints are required even for a non-looping clip.
- Check that the guide, repetitions, tempo, duration, and authored keys describe the same movement. Do not call simulation to justify or repair an authoring response.

## Optional health-dance reference

For a request specifically resembling a 120-BPM, 32-second health dance, the guide may use this progression: 0–6 seconds, three bounded left twists; 6–12, three bounded right twists; 12–14, gentle neck motion; 14–16, modest hip motion; 16–20, sleepy head dip and wake-up lift; 20–22, head wiggle instead of hand exercise; 22–24, small alternating foot motions; 24–26, a slow breathing-like neck rise and fall; 26–28, gentle knee pulses; 28–30, friendly head tilts and small steps; 30–32, a polite nod and exact neutral standing pose. Begin the first section from neutral, and include neutral returns within the repeated twists. These are motion cues, not literal breathing, facial expressions, full spins, or medical benefits. Adapt the segments to the actual request and installed model; do not copy this duration, tempo, or guide into unrelated requests.

## One final response

Put `guide` before `sequence` in one JSON object. The field inventory below is descriptive, not a literal clip: replace placeholders with supplied metadata and your authored values; emit no extra fields.

```text
{
  "kind": "microduck-sequence",
  "requestId": <exact requestId>,
  "guide": [
    {"start": 0, "end": <seconds>, "description": <localized movement description>},
    ...
  ],
  "sequence": {
    "version": 1,
    "modelSha256": <exact installed modelSha256>,
    "jointNames": <all 14 exact names in supplied order>,
    "bpm": <requestedBpm>,
    "clip": {
      "version": 1,
      "name": <short localized name>,
      "duration": <seconds>,
      "loop": <boolean>,
      "keys": [
        {"t": 0, "joints": <exact 14-value neutral vector>, "rootPitch": 0},
        ...,
        {"t": <duration>, "joints": <exact 14-value neutral vector>, "rootPitch": 0}
      ]
    }
  }
}
```

The application validates and loads the sequence and offers the bare `clip` object as downloadable JSON. Do not replace the final envelope with that bare object for a Sequence By AI request. In standalone file authoring, follow the human's requested export format and preserve the model identity when a sequence is requested.
