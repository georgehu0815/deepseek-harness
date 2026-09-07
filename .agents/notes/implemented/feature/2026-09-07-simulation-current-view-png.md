# Agent Note: Simulation current-view PNG capture

Status: implemented

English | [中文](2026-09-07-simulation-current-view-png.zh.md)

## Problem

A still image must preserve the scene a user is inspecting without seeking or modifying its authored motion. Reading a WebGL canvas after browser compositing can return a cleared drawing buffer instead of the visible scene.

## Decision

Simulation's **Capture view (PNG)** downloads the existing canvas at its backing resolution. The [pose stage](../../../../packages/client/ui-robot-lab/src/client/ClipPoseStage.tsx) renders its current scene and camera immediately before PNG readback in the same synchronous task. This includes visible geometry, environment and scene labels, but not HTML controls. A ready preview is required; MP4 export excludes still capture.

Capture is presentation-only: it does not key a pose, seek, change the clip or alter review. The file is a browser download, not a saved project asset or cover metadata embedded in MP4 or clip JSON. The [Clip Gen decision](2026-09-05-microduck-native-clip-gen.md) retains ownership of motion authoring and reviewed MP4 recording.

## Alternatives considered

**Enable `preserveDrawingBuffer`.** Retaining every frame changes the renderer's buffer behavior for occasional screenshots. Immediate render/readback obtains the requested image without that persistent cost.

**Read the canvas without rendering.** A demand-rendered preview can remain idle after compositing clears its buffer. A successful PNG encoding alone cannot establish that the file contains the displayed scene.

## Consequences

Still capture preserves the user's view and permits unkeyed poses without weakening MP4 review requirements. Resolution follows the existing canvas and pixel-ratio ceiling, not an independent export size. The result is a visual reference, not physics or policy evidence.

## Verification

The [browser PNG regression](../../../../apps/web/tests/clip-image-capture.e2e.ts) exercises the Simulation component in Chromium at device pixel ratio 2, downloads and decodes PNGs after idle frames, and checks backing dimensions, opaque nonblank pixels and changed background after camera/environment edits. It uses a test composition, not the existing running GUI. [Simulation component tests](../../../../packages/client/ui-robot-lab/tests/clip-simulation.client.spec.tsx) own unavailable-preview and MP4-export guards; a mocked encoder cannot prove WebGL readback content.
