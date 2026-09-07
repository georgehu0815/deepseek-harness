# Agent Note: Selectable Clip Gen music with shared capture timing

Status: implemented

English | [中文](2026-09-07-clip-gen-selectable-music.zh.md)

## Problem

A reader can audition a music link in chat without making it the soundtrack of an authored robot clip. Selecting music in an editor also needs to affect the actual exported MP4, not only the live preview or its label. Full recordings are much longer than the motion references, and external media origins can disappear or deny browser audio decoding.

## Decision

[Clip Gen](../../../../packages/client/ui-robot-lab/README.md#clip-gen) keeps its original per-dance rhythm and adds three curated, credited SoundHelix excerpts. They are not chart-ranked recommendations. Embedded source metadata preserves recording URLs, permission text, source/output hashes, estimated tempo and excerpt offsets; [NOTICE](../../../../packages/client/ui-robot-lab/NOTICE) retains the attribution terms. Native audition controls do not select a track. A radio group owns the exclusive session-local choice, stops motion and invalidates review when changed, and is locked during capture. No model, training or hardware operation is introduced.

The excerpts cover estimated 32-beat grids and are normalized offline to 120 BPM with short join fades. One resolved soundtrack carries the source, duration, playback rate and repeat flag to both the preview clock and recorder. Original rhythms retain full-cycle retiming; alternatives use authored BPM divided by source BPM and loop to fill the clip. Duration edits scale BPM with key times. Playback rate also changes pitch; runtime time-stretching is not provided. The audio clock accumulates excerpt wraps without restarting a longer dance, and a complete motion loop restarts its music phase. Estimated beat grids are not proof of movement-to-music synchronization.

Generated audio and silent variants retain the selected source and attribution from the same capture. Choosing another track leaves the old video intact and marks its revision stale; generation is required to change its bytes. The captured credit is visible and downloadable as companion JSON, not burned into frames. Sharing a SoundHelix-backed MP4 requires artist and SoundHelix credit. Audio selection remains outside motion JSON and saved guide sequences.

## Alternatives considered

**Stream complete remote MP3s at runtime.** Native audition can play a remote URL while Web Audio export cannot decode it without suitable cross-origin permission. Bundling permitted excerpts keeps the selected bytes available to both paths without a proxy or runtime network dependency.

**Fit an entire song into every clip.** Compressing several minutes into a short motion changes tempo far beyond the authored beat grid. Repeating a bounded excerpt preserves the selected tempo relationship and limits bundled bytes.

**Replace a completed video's soundtrack when its radio selection changes.** That would combine a reviewed capture with a later draft and require another muxing operation. Immutable paired captures preserve attribution and review identity; the user generates again explicitly.

## Testing

[Soundtrack plans](../../../../packages/client/ui-robot-lab/tests/clip-soundtrack.client.spec.ts), [audio clocks](../../../../packages/client/ui-robot-lab/tests/clip-audio.client.spec.ts), [panel controls](../../../../packages/client/ui-robot-lab/tests/clip-gen-panel.client.spec.tsx), [simulation](../../../../packages/client/ui-robot-lab/tests/clip-simulation.client.spec.tsx) and [paired capture](../../../../packages/client/ui-robot-lab/tests/clip-movie.client.spec.ts) cover exclusive selection, audition without selection, replacement, review and recording locks, source retention, tempo, repeated excerpts and captured credits. The [assembled workflow](../../../../apps/web/tests/robot-studio.snapshot.ts) records the built radio controls and selected sources with fixture RPC and mocked playback. A separate [native browser test](../../../../apps/web/tests/clip-music-export.e2e.ts) uses the emitted helpers, real Web Audio and MediaRecorder to decode all three excerpts and produce MP4s with nonzero decoded audio; its canvas is test artwork, not robot-rendering evidence.

## Consequences

The excerpts add approximately 755 KB of encoded audio before base64 expansion. They work offline after the plugin loads, but selection and generated media remain transient browser state. Native media timing and estimated source grids do not guarantee frame-exact beat synchronization; users must review the music and motion together. Browser codec availability and the existing capture failure behavior remain unchanged.

The [native Clip Gen decision](2026-09-05-microduck-native-clip-gen.md) remains active for authoring, original rhythms, shared state and capture ownership; this addition only expands soundtrack selection. The [inline Markdown player](2026-09-07-web-inline-markdown-audio.md) retains its separate remote-link rendering policy. Neither is fully superseded or archived.
