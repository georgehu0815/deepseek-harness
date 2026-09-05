# Agent Note: Unified student extension tutorial

Status: implemented

English | [中文](2026-08-20-unified-student-extension-tutorial.zh.md)

## Problem

The user documentation taught individual plugin, tool, and capability tasks but did not provide one ordered path from system architecture to a complete custom Harness composition. A student had to infer how profiles, Cordis plugins, agents, durable sessions, capability providers, skills, MCP tools, commands, workflows, and Claude Code integration fit together from references owned by separate packages.

Repeating every package contract in a new guide would create competing reference documentation and make the tutorial difficult to maintain. Publishing only another architecture reference would not give students runnable extension examples or verification steps.

## Decision

The bilingual user tutorial [Build on the Harness backbone](../../../../docs/user/develop/practice/backbone.md) provides the ordered learning path. It starts with the system and module architecture, follows a model turn, and then builds progressively through plugins, agent flow, Bundle composition, a three-role capability, skills, MCP, commands, and Claude Code integration.

Each chapter answers what an extension point owns, how to use it, and why it remains separate from adjacent responsibilities. Examples extend an existing `web` or `headless` Profile and preserve the default agent loop unless the required turn semantics cannot be expressed through existing extension points.

The tutorial provides enough local behavior, failure, ownership, and verification detail to complete each exercise. Package READMEs, subsystem references, architecture documentation, and testing policy remain authoritative for exhaustive contracts and limits. Links connect each example to those owners instead of reproducing their complete inventories.

The documentation website publishes both language variants in the Develop Practice navigation. Translation pairing requires the English and Chinese structure and code fences to remain consistent.

## Alternatives considered

**Keep separate topic guides only.** Rejected because students would still need to design the learning order and infer how independently documented extension mechanisms compose in one runtime.

**Turn the architecture reference into a tutorial.** Rejected because the architecture page is an ordered system map for contributors. Adding setup, code exercises, and user integration procedures would mix reference and tutorial forms and exceed its permitted detail.

**Copy complete package contracts into the tutorial.** Rejected because duplicated configuration fields, limitations, and lifecycle semantics would drift from their owning package documentation.

## Consequences

Students have one discoverable path from architecture to an assembled extension and can verify behavior at each layer. The tutorial is intentionally broad, so maintainers must update both language variants and their links when a covered public integration changes. Detailed lookup remains distributed across the owning references, and readers follow those links when they need complete configuration or protocol semantics.
