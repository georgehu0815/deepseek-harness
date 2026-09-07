MicroDuck MP4 audio export verification

Normal-duration example:
- bachata-v2-with-audio.mp4: H.264 video plus AAC stereo audio.
- bachata-v2-silent.mp4: the paired video-only file selected by unchecking Save MP4's With audio checkbox.
- no-soundtrack.mp4: a new clip with no associated soundtrack; video only.
- verification.json: measured stream metadata, SHA-256 digests, decoded audio RMS and browser capture timing.
- with-audio-controls.png: the real existing GUI after generation.

Final-bundle recheck:
The quick-* files use a deliberately retimed three-second dance to exercise the final bundle's native encoder, cleanup and audio retiming. quick-verification.json binds that recheck to the client bundle's exact SHA-256. These are test samples, not normal-speed dance examples.

Verification ran in fresh Playwright Chromium against the existing GUI at http://127.0.0.1:3082/. It checked default-on and shared checkbox state, actual saved-file selection, muted/zero-volume and half-speed preview independence, and video-only behavior without a soundtrack. All six retained MP4s passed complete FFmpeg decoding with -xerror, -fps_mode:v passthrough and -enc_time_base:v demux. The latter options preserve native variable-frame-rate timestamps when decoding to the null muxer. The audio-bearing files contain nonzero decoded PCM, not merely an advertised audio MIME type.

Native capture is real-time and not frame-exact. The reports include actual file duration, authored duration, startup delay, stop lag and observed render gaps; this headless run rendered much slower than the requested maximum capture rate. These are authored kinematic videos, not physics, trained-policy or hardware evidence. No microphone, physical robot or speaker audition was used.

To repeat, provide the authenticated existing GUI URL privately in DSH_VERIFY_URL and run node artifacts/microduck-mp4-audio/verify-browser.mjs. The optional DSH_VERIFY_SECONDS=3 selects the short retiming recheck. Credentials are not saved in this directory.

Code checks: pnpm run test:gui passed 5,518 tests (one platform skip); all four affected assembled GUI snapshots passed read-only replay; scoped lint and the ui-robot-lab TypeScript build passed. The owning README and Agent Note bilingual pairs passed their named pairing check. Repository-wide doc-sync remains red on pre-existing documentation/catalog/pairing and unrelated JSDoc issues; no unrelated files were repaired for this feature.
