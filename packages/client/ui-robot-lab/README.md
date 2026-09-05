# @deepseek-ai/dsh-client-ui-robot-lab

English | [中文](README.zh.md)

Native **Micro Duck** contributes a center `conversation.view` tab (`micro-duck`, order 40, beside Supply Chain) for **Choose → Customize → Train → Evaluate → Perform**. The sidebar's **Robot Studio** action opens the `robot-lab` tab in the [layout visual workspace](../ui-layout/README.md). Its session-maybe wrapper renders the session-scoped `robot-lab.visual.player` child. This is native slot composition, not an iframe or standalone Lab application.

The center entry declares two single/session child slots: `conversation.micro-duck.learning-plan` and `conversation.micro-duck.learning-review`. They receive no owner arguments; each registration binds the shared session draft store and the same captured-session LabClient and playback owner as the center and player. Phase navigation selects which authorized section to render without creating another request lifecycle.

The browser plugin requires `slots`, `layout`, `remote` and `remote.robotLab`. It calls the authenticated `robotLab.request` [Robot Lab service](../../robot/robot-lab/README.md); without the namespace injection it waits rather than accessing a partially published Remote. It uses no browser-held credentials or direct Lab URL. Direct controls and local music need no model key; chat uses the configured provider, including an existing AgencyCopilot sign-in.

## Configuration

The browser plugin validates these fields at activation. Backend limits also apply; viewer and music settings never alter physics or hardware admission.

| Field | Default | Meaning |
|---|---|---|
| `pollIntervalMs` | `2000` | Active-run refresh interval; integer at least 250 milliseconds |
| `maxDpr` | `1.5` | Canvas pixel-ratio ceiling, from 1 through 3 |
| `simulationSteps` | `1000` | Initial simulation and assessment horizon, integer 1–3000; Perform overrides only playback simulation, while each trial freezes its independent assessment recipe |
| `defaultEnvCount` | `4` | Positive initial parallel-environment count, editable in training |
| `evaluationEpisodes` | `5` | Positive evaluation episode count |
| `evaluationSeed` | `0` | Nonnegative integer evaluation seed |
| `maxTerminations` | `0` | Nonnegative allowed termination count |
| `minMeanUprightFraction` | `0.9` | Required mean upright fraction, from 0 through 1 |
| `quickCheckSteps` | `1024` | Positive setup-check training budget; not a skill-learning target |
| `musicSampleRate` | `22050` | Generated mono PCM sample rate; 22050 or 44100 Hz |
| `maxMusicSeconds` | `120` | Positive finite synthesis duration ceiling |
| `maxMusicSamples` | `2646000` | Positive integer allocation ceiling fitting mono PCM16 RIFF; both duration and sample limits apply |
| `playbackHudIntervalMs` | `50` | Positive browser-timer interval for playback indicator notifications; renderer time is read separately |
| `maxGroupMembers` | `8` | Positive integer duck-roster ceiling; add, duplicate and file import cannot exceed it |

## Projects and training

Built-in controls, validation, tooltips and accessibility labels are English only by explicit product choice. User-authored Unicode names retain their language. Before a session exists, the player shows “Select an existing session, or send your first message to create one.” The wrapper does not access a session store or start backend operations in that state.

Choose lists nine original experimental dance/action templates derived from the installed MJCF model's actual joint order, default pose and limits. Customize edits master move size, tempo, beat count and a seeded soundtrack recipe. **Motion blocks** composes ordered templates with per-block length and relative move size; add, reorder, duplicate and remove actions update the first-template identity and motion/music beat totals atomically in the draft store. Effective block size is relative size multiplied by master size. **Save revision** creates an immutable session-owned project. **Preview target in Studio** reuses an unchanged saved revision; an edited draft is saved before its exact revision's MuJoCo forward-kinematic frames are requested. **Refresh library** remains available after connection. **Target preview · Not physics-tested** means desired motion, not balanced dynamics or a learned policy. Model joint-limit checks do not establish physical feasibility.

Project format 2 freezes the recipe, model/profile, every resolved block/template, whole-composition training recommendation, compiled joint targets and SHA-256. The UI merges the project's resolved reward overrides over its recommended behavior's registered defaults, rather than using the first template's settings for the whole routine. Templates, clips and music retain format 1; runs retain format 3. Older project formats are rejected without migration. Project-bound training freezes the selected revision and soundtrack in its run. Editing or loading another draft cannot rename, retime or attach a different soundtrack to an existing recording. Unsaved drafts are view state, not durable projects. The [user guide](../../../docs/user/guide/robot-lab.md) covers the direct-control workflow; [Robot types](../../../docs/subsystems/robot.md) define the records.

**CPU — Standard** runs SB3 PPO learning and MuJoCo/BAM physics on CPU. Optional **MLX GPU — Apple Silicon** runs policy and critic learning on Metal, with CPU physics. Its separate PPO recipe has no symmetry loss; it is neither numerically equivalent to the CPU trainer nor a guaranteed speedup. Unavailable MLX fails without CPU fallback. A quick check establishes setup behavior, not a learned dance. **Evaluate** assesses exact exported hashes against saved criteria. **Perform** generates exploratory zero-command recordings and reports hardware blockers; neither phase has a hardware activation callback.

**Train → Advanced: custom joint experiment** accepts a numeric/JSON joint clip and a registered reward recipe. Copying a saved target into this editor does not edit the project or its target preview. Custom training freezes its clip without `projectRevisionId`, so its recording has no project soundtrack. The custom experiment ID is distinct from a Unicode project display name. A numeric clip is not a balance or safety test.

Only run format 3 is executable. Older files stay untouched under **Unsupported run records**. Intact format-3 policies incompatible with the current runtime remain inspectable with their exact reason, but cannot simulate or evaluate. There is no migration, arbitrary ONNX import or warm-start action. An earlier evaluation does not establish current compatibility.

## Learning trials and reflection

The **Learning brief** records a goal, prediction, planned change and evidence to examine. These are the student's pre-training plan, not measured results. **Save trial** freezes that brief, a saved project revision, training inputs and seeded assessment criteria without starting training. **Save and start trial** commits the trial first, then starts its one admitted run; a failed start preserves the saved trial for explicit retry. **Start saved trial** uses the displayed immutable settings, not the current draft. Advanced custom experiments remain unlinked and are not retrospectively presented as pre-registered trials. Their **Exploratory assessment settings** edit the assessment draft in Evaluate; **Check this policy** uses that draft rather than Perform's horizon, without modifying any frozen trial.

**Evaluate trial** uses the frozen episode count, requested horizon, seeds and upright/termination thresholds, independently of Perform's duration. History and readiness settle independently in one refresh. Failed reads retain prior data and report operation-labelled errors without hiding readiness or unrelated successful results; disabled readiness does not prevent history loading. Report selection identifies exact policy bytes, trial/run and target revision. Comparison requires both runs' recorded provenance and equal assessment criteria, physics, observation semantics, source fingerprints, bridge hashes and evaluation-runtime versions before presenting like-for-like deltas. Trainer backend, device, dependencies and actuator differences are described separately. Tracking means include only measured episodes and display coverage counts; differing targets or measured episode cohorts prohibit tracking-error deltas. Reward totals are not compared. Upright criteria do not establish choreography completion, robustness or hardware suitability.

**Re-simulate episode** requests new frames using the report's saved inputs and requires an owned completed run. The selected current policy must match both the report's policy ID and SHA-256; identical bytes under another policy ID do not grant replay eligibility. Shipped policies without an owned run can use exploratory performance simulation instead. The player labels episode re-simulation as new frames, never the original evaluation recording. Original metrics and verdict remain unchanged; missing or incompatible source artifacts prevent replay instead of silently substituting another policy. **Save reflection** persists the student's observation, interpretation and next change linked to the exact report and policy hash. **Review improvement draft** retrieves the parent's exact project and training recipe, copies the proposed change into an explicitly unsaved draft, and retains the parent reflection identity. Opening the draft removes the prior individual-duck training banner without changing the group roster or stopping training. Reviewing or reloading a reflection never saves or starts another trial and does not warm-start policy weights.

## Multiple ducks

Robot Studio's **Your dance group** starts with one duck. Add, duplicate, rename and remove members, retaining at least one. Each duck has its own **Policy** dropdown and saved **Training project** selection. Duplicating copies those selections, not policy weights or a training run. Line, Grid and Circle formations with editable spacing place recordings on the stage; they do not change simulation starting conditions or model collisions.

**Set up individual training** loads the selected saved project into Micro Duck's **Train** page and identifies the duck being edited; open the Micro Duck tab to continue. Save an edited project draft first. Training remains a manual, per-duck use of existing trials: start a trial, wait for its exported policy, then assign that policy to the duck in Studio. Selecting a policy does not fine-tune it; there is no group training queue or checkpoint warm start. Parallel environments train one policy, not several duck policies.

**Record group dance** captures the roster, names, policy assignments and placements before any requests. `LabClient` simulates every selected policy sequentially with the same requested horizon, reset seed and zero command, verifies the returned policy identity/hash and playable duration, then publishes all tracks together. A missing or incompatible selection prevents recording; a failed request preserves the prior recording rather than publishing a partial group. Replay is explicit: every duck shares one start and playback clock and stops at the shortest recorded duration.

The first recorded duck's matching run supplies its frozen project soundtrack when present; current training-project selections cannot replace it. Other duck policies are not retimed to match its BPM. **Motion details** selects an individual recorded duck. Roster, assignment, name and formation edits leave the loaded group unchanged until another recording succeeds. Independent rollouts do not model inter-duck collisions or learned coordination. The [group playback decision](../../../.agents/notes/implemented/feature/2026-09-05-microduck-independent-group-playback.md) records why synchronized presentation is separate from joint physics.

**Save group file** downloads `duck-dance-group.json`; **Load group file** restores its version-1 roster. The JSON object contains `version: 1`, `members`, `formation` and `spacing`. Each member contains `id`, `name`, `policyId`, `projectRevisionId`, `x` and `z`; the file embeds no ONNX policies, projects or recordings. Load in the originating session to resolve session-owned artifacts. Missing policy/project references remain visible as **Unavailable policy** or **Unavailable revision**, never silently reassigned; choose available replacements before recording or setting up the affected training project.

Files are limited to 1 MiB and 1–`maxGroupMembers` members. Loading validates JSON/version, unique positive integer member IDs, nonblank bounded names, nullable bounded references, supported formation, spacing and finite stage coordinates before replacing the roster draft. Invalid files leave the draft unchanged. A successful load does not start training or playback, and the prior recording remains unchanged until re-recording succeeds.

## Shared playback and music

One `LabClient` and one `PlaybackTransport` capture each session identity. The React-free client owns projects, run records, polling, scene data and recordings; the entry-declared store owns drafts, selection and viewing preferences. Both center controls and the right player bind those same owners. Switching conversations never retargets requests. Closing the player releases its renderer and pauses playback, but does not cancel server-owned training. Clients remain resident until plugin disposal; disposal stops polling, ignores late responses, detaches listeners and closes owned audio resources without claiming to abort an admitted server operation.

Music is original local percussion, bass and melody in Disco, Electronic, Lo-fi or Chiptune styles. Version, style, BPM, beats and seed form the persisted recipe. PCM and downloadable mono PCM16 WAV bytes are generated client-side and are not persisted by DSH. No music account, provider key, voices or commercial recordings are used. **Generate music (WAV)** downloads without autoplay; temporary download URLs are revoked.

Playback is explicit and non-looping. **Replay speed** selects 0.5×, 1×, 1.5× or 2× and remains a per-session preference. It scales shared logical recording time and audio playback together; audio tempo and pitch change, without pitch preservation. Generated PCM/WAV, recipe BPM, training and measured physics remain unchanged. Changing rate during pending audio resume cancels the pending start and leaves playback paused.

With music, `AudioContext.currentTime` is the master time for both sound and pose; only an explicit `music: null` uses the monotonic silent clock. Audio unavailability or failed resume leaves playback paused with an error; **Play without music** is an explicit choice, not a silent fallback. Pause, seek, restart, recording replacement, document/view hiding, session switch, recording end and disposal synchronize sound and pose. **Restart** returns to zero and plays; seeking preserves active playback unless it reaches the end or cancels a pending audio resume. Muting changes gain, not time. A fall can shorten the recording; sound stops with it rather than looping or extending the motion.

The r3f stage opens with an orbitable Studio grid before scene assets or a performance are loaded; it neither invents robot poses nor starts simulation or playback. Empty-stage guidance and **Preview standing policy** sit below the grid. Loaded recordings render backend meshes and timestamped frames with pose-based camera framing, lighting and ground shadows. Camera presets, Reset view, Expand view, canvas-scoped orbit controls and focused Space playback affect presentation only. Studio grid, Concrete, Sand and Grass are flat visual appearances, not terrain or friction settings. Clicking a part opens its recorded world position. **Motion details** distinguishes actual ordered joint positions/velocities, controller targets, actuator torques, root speed and tilt from kinematic target values; foot contacts are not recorded. **Routine tempo** is saved BPM; **Body speed** is measured per recorded second, not multiplied by replay speed. Average training steps/second is a separate throughput metric. The current block/beat indicator uses the recording's frozen block sequence and logical time, never the current draft.

## Model Experience

### Native studio presentation

#### What the model sees

Nothing directly from this package. It registers no tools and injects no model context. User actions call `robotLab.request`; service-owned operation records and separate tool results determine what enters session history.

#### Token effect

None from rendering, playback or music generation. Meshes, per-frame transforms and PCM are not inserted into model requests by this plugin.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

- Target previews are forward kinematics, and policy playback is recorded physics; neither is live robot telemetry or interactive motor control. No learned dance is established by setup tests, a training completion label or upright/termination criteria.
- Graphical pose manipulation, choreography-specific acceptance, uneven-terrain physics, cloud training and verified physical deployment are not provided. Local custom-clip policies remain simulation-only.
- Duck rosters, names, policy/project assignments and formations are transient per-session view state. They survive closing and reopening the Studio tab, not browser refresh; export a group file before refreshing and load it afterward. Unexported edits, loaded group recordings, unsaved drafts and transient PCM are lost on refresh. A group file preserves references, not their artifacts; retain saved project revisions and complete experiment directories to reproduce recordings.
- Original Harness integration code uses [MIT](LICENSE). Adapted Microduck Lab renderer portions retain [Apache-2.0](LICENSE-APACHE-2.0) and [NOTICE](NOTICE). Backend robot assets retain their upstream licenses.
