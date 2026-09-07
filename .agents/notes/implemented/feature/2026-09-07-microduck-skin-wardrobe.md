# Agent Note: MicroDuck presentation-only skin wardrobe

Status: implemented

English | [中文](2026-09-07-microduck-skin-wardrobe.zh.md)

## Problem

Distinct duck appearances must remain independent of choreography and training. A cosmetic edit changes recorded pixels without changing the motion reference, so treating it as either a motion edit or an untracked view preference gives the wrong playback or review behavior.

## Decision

The [wardrobe](../../../../packages/client/ui-robot-lab/README.md#clip-gen) separates browsing from explicit application to the current appearance target or all ducks. Ten custom finishes and the original finish use existing meshes and joints. The [render cache](../../../../packages/client/ui-robot-lab/src/client/clip-skin-geometry.ts) owns recolored mesh copies, preserving topology and source geometry; the stage retains existing kinematics and picking.

The declared session store retains applied skins across component remounts, not browser reload. Skin changes preserve motion, playback and the pending AI import's edit epoch, but invalidate the export revision and manual review. Capture freezes appearance mutations. PNG and MP4 contain rendered skins; motion JSON and training carry no appearance state.

## Alternatives considered

**Change model geometry or joints for clothing.** Cosmetic customization does not justify altering kinematics, picking or physics. Existing mesh colors and material finishes provide the appearance without those changes.

**Persist skins in motion JSON or training metadata.** Appearance is not a motion target or learned behavior. Keeping it separate avoids changing reference formats, at the cost of not restoring a captured look from motion JSON.

## Consequences

Each duck can look different without acquiring another motion editor or playback clock. Applied looks remain transient, and an appearance change requires renewed review before another MP4. Verification must cover independent targeting, unchanged motion and geometry, capture locks and reset behavior; decoded PNG/MP4 inspection remains necessary because state assertions alone cannot prove recorded appearance.

## Related decisions

The [native Clip Gen decision](2026-09-05-microduck-native-clip-gen.md) retains motion-authoring and reviewed-export ownership. The [PNG decision](2026-09-07-simulation-current-view-png.md) retains render-before-readback ownership. Neither is superseded: skins add presentation state without replacing either mechanism.
