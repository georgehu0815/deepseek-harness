# Agent Note: Frozen pre-training choreography assessment

Status: implemented

English | [中文](2026-09-05-microduck-frozen-choreography-assessment.zh.md)

## Problem

An upright policy can remain still or miss the requested movement. One aggregate tracking error also hides incomplete cycles, weak motion and failing blocks. Choosing thresholds or rebuilding a reference after training permits an assessment to change with the result it is meant to judge. Matching a Python digest string alone does not bind the host's decoded scientific inputs. A measured fragment exceeding an RMSE or movement-ratio limit does not necessarily prove that the planned whole window must fail: the remaining measurements can change a mean or ratio, unlike an observed maximum displacement.

## Decision

The [Robot Lab records](../../../../docs/subsystems/robot.md) support optional, fully explicit version-1 and version-2 dance criteria in saved trial evaluation inputs. Plan and criteria versions must match; unsupported versions fail. The provider resolves a policy-independent plan before training: exact sampled reference and raw clip hashes, actual control clock, cycles and authored blocks, joint/root identities, evaluator, runtime, physics and criteria. Direct dance evaluation requires that owned run's matching pre-training plan; no operation invents retrospective criteria or a default preset.

The host compares the plan's evaluation with the saved trial and commits `RobotTrialBinding.dancePlanSha256` before starting the trainer. This host canonical hash covers the complete decoded plan, including its opaque Python `sha256`. The Python digest retains its own canonicalization; retaining that string cannot conceal later changes to decoded thresholds, reference identity or other plan fields. Evaluation and reflection records remain bound to the exact completed policy and saved assessment.

The [MicroDuck provider](../../../../packages/robot/robot-lab-microduck/README.md) measures every required cycle and authored block at the simulator's full control rate. Joint/root-orientation RMSE, reference-matched gain, amplitude and horizontal drift remain distinct evidence; inactive reference joints have null movement ratios. Coverage excludes missing or nonfinite measurements rather than substituting target values. No phase alignment or time stretching improves a recorded score. Authored duration and actual runtime cycle duration are both visible because they need not be identical.

Version 1 retains rejection of observed-fragment RMSE and movement-ratio violations, including on incomplete coverage. Version 2 instead rejects partial joint/root error only when its lower bound proves the planned whole-window limit cannot be met. Unobserved squared errors are nonnegative, so observed squared error divided by the planned sample count bounds the eventual mean from below; each cycle and block needs its own denominator. Ratios depend on the completed sample means and reference energy, so they become decisive only with all planned finite measurements, even if termination prevents completion. Maximum drift remains monotonic and decisive on partial coverage. Recorded fields retain observed-subset metrics; the lower bound is not imputed data. Incomplete windows cannot pass, and episode termination or early truncation remains an independent failure.

`passed` retains its balance-only meaning. Separate `danceStatus` and per-window verdicts report passed, failed or incomplete under the explicit criteria. Absence of a dance plan is unassessed, not success. The [UI](../../../../packages/client/ui-robot-lab/README.md) displays verdicts, plan identity, clock differences, measurements and the report plan's frozen thresholds, including each joint's limit and movement role. It does not substitute current editor settings for frozen evidence. Its optional pre-training editor accepts explicit, uncalibrated criteria; balance-only assessment remains the default, and no recommended thresholds are supplied. Rounded measurement display does not recompute or change the stored full-precision verdict.

The editor keeps incomplete numeric text in the existing recoverable `RobotDraft`, not a second validated assessment. New opt-ins start with blank version-2 limits; loaded criteria retain version 1 or 2. Disabling retains work while omitting choreography from draft-derived requests. Enabled invalid input prevents new trial save/start and unlinked assessment instead of silently weakening the plan to balance-only. Recovery rejects simultaneous raw-editor and numeric choreography copies, preserving one active owner. Already saved trials remain immutable and independently startable/evaluable; draft errors do not rewrite or block their frozen assessment.

## Alternatives considered

**Use native number inputs for recoverable choreography text.** Browser sanitization can hide a retained literal while the shared numeric resolver still accepts it, creating a display/state mismatch. The advanced editor uses `type="text"` with `inputMode="decimal"` to keep recovered and incomplete text visible; the shared resolver still owns finite-number and range validation.

**Treat balance or mean tracking error as dance completion.** Neither requires sufficient movement or complete repeated cycles and blocks. Independent criteria retain those distinctions without changing historical balance results.

**Choose defaults or reconstruct a plan after training.** Filled-in uncalibrated defaults can look like endorsed limits, while convenient retrospective thresholds weaken the experiment's evidence. Admission instead requires all criteria and rejects an insufficient evaluation horizon.

**Reuse Python's digest as the host binding.** The host must bind the decoded inputs it authorizes, not only a hash computed under another runtime's JSON rules. Two owner-specific hashes preserve that responsibility without rewriting Python provenance.

**Apply whole-window rules retroactively to version 1.** Evaluator source hashes do not select a validator's verdict rules. An explicit version-2 plan freezes the different semantics prospectively; version-1 reports retain their statuses, reasons, plans and hashes, and frozen unstarted version-1 trials remain admissible without automatic upgrade.

**Show a verdict without its frozen criteria.** A pass is meaningful only under the limits that produced it. Displaying those limits and their unmeasured dimensions prevents a later draft or a rounded value from appearing to explain a different assessment.

**Rebuild observations to apply shipped-policy commands.** The environment's observation getter advances joint-velocity history; another call changes the controller's input timing. The rollout instead overlays only twist on a copy of the returned observation, preserving its other channels and retained arrays. Owned-run inference does not use that overlay, so a shipped-command cadence defect does not explain failures on the owned path. [Observation and nominal-physics semantics](../../../../docs/subsystems/robot.md#policy-observations) owns the exact slices and seeded reset behavior.

**Treat position-reference failure as target infeasibility.** The position-reference baseline has joint-error servo feedback, not body-balance feedback, and does not use the clip's root-pitch target. A perturbed standing spawn is not a settled equilibrium. A failed position-only controller therefore does not discriminate an infeasible target from insufficient balance control and cannot justify relaxing frozen thresholds.

**Score downsampled playback or fill missing samples.** Presentation cadence and plausible target values are not measured physics. Scoring keeps full-rate finite coverage and exposes incomplete intervals.

## Consequences

Training preflight validates frozen inputs with a stdlib-only helper before RLX workers fork; reference-grid recomputation occurs in admission, evaluation and completion checks. The packaged evaluator helper participates in the bridge fingerprint, so changed measurement code invalidates replay under a different runtime. Provider step and record bounds still apply; a requested multi-cycle assessment may require larger deployment limits.

Neither version measures beat phase, frequency error, accumulated timing drift, foot slip or motor saturation. These are experimental nominal-simulation criteria, not a calibrated general dance standard, disturbance-robustness evidence or hardware permission. Behavior-default practice budgets are likewise unqualified, not demonstrated learning recommendations. Timing and independent-control qualification, real end-to-end assessment evidence, durable beginner recovery and physical-world work remain separate obligations. No learned skill or complete learning phase is claimed.

The [student learning-loop proposal](../../proposed/feature/2026-09-05-microduck-student-learning-loop.md) remains active for its broader beginner workflow and scientific qualification. This decision replaces only its lack of explicit pre-training choreography measurements. The [RLX backend decision](2026-09-05-microduck-rlx-backend.md) retains learner/export identity and numerical rationale; these assessment records apply independently of learner choice.
