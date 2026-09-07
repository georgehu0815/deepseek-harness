# Agent Note: Full-width Micro Duck Train and Evaluate subtabs

Status: implemented

English | [中文](2026-09-05-microduck-train-evaluate-columns.zh.md)

## Problem

Training plans and measured evidence need enough space to read and edit without losing work when switching between them. Simultaneous columns constrain form width, while a step wizard makes assessment look conditional on completing earlier pages. Removing target setup entirely would prevent choosing, saving or previewing the project required for training.

## Decision

The [Micro Duck center](../../../../packages/client/ui-robot-lab/README.md) provides accessible, localized **Train** and **Evaluate** subtabs, with Train selected by default. Only the selected panel is visible and occupies the full center width. There are no step numbers, Choose/Customize/Perform pages or Next footer.

Train retains template choice, customization, saving and target preview in an initially collapsed **Training target** section. Its learning-plan child, brief, assessment planning, trials and training controls remain available. Evaluate owns policy evaluation, evidence, reflection, episode replay and hardware-blocker inspection. The center exposes no exploratory Perform controls; Robot Studio group recording, standing-policy preview and playback retain their existing behavior.

Both panels and their declared child slots stay mounted when hidden, preserving drafts, expanded details and each panel's scroll position across subtab switches. They use the existing captured-session owners. The session view store maps `evaluate` and `perform` to Evaluate and other retained page values to Train. Reviewing a run selects Evaluate; opening an improvement draft returns to Train. Mounting or switching subtabs starts no Robot Lab operation: saving, training, evaluation, simulation and playback still require explicit actions.

This decision partially supersedes the navigation in the [Studio proposal](../../proposed/feature/2026-09-04-microduck-studio.md) and [student learning-loop proposal](../../proposed/feature/2026-09-05-microduck-student-learning-loop.md). Both remain active for their broader authoring, evidence, scientific-runtime and hardware requirements. The [independent-group decision](../feature/2026-09-05-microduck-independent-group-playback.md) remains applicable; this layout does not change group behavior or remove provider simulation operations.

## Alternatives considered

**Keep simultaneous columns.** Both activities remain visible, but splitting the available width constrains forms and evidence. Full-width panels prioritize the selected activity while retaining the other panel's state.

**Keep the step wizard and Next footer.** This makes assessment look like a later required phase rather than an independently available action.

**Delete setup with the Choose and Customize pages.** Training still requires an authored, saved target. A collapsed section preserves that setup without a separate navigation phase.

**Keep exploratory Perform controls beside evaluation.** The requested center is limited to training and assessment. Explicit episode replay and the existing Studio controls retain inspection without a third center activity.

## Consequences

Users switch tabs to compare plans and evidence rather than seeing both simultaneously. Hidden panels retain their mounted state; switching is not a reset, save or execution request. No layout state grants hardware authority or starts work automatically.

Component regressions and the [assembled Studio scenario](../../../../apps/web/tests/robot-studio.snapshot.ts) own verification of default selection, accessible localized navigation, exclusive visibility, retained inputs and details, collapsed target setup, absent wizard/Perform controls and explicit operation dispatch. Rebuilt-browser inspection owns full-width layout and independent scroll retention. These checks do not establish learned motion or hardware safety.
