# Agent Note: Agency Copilot is the shipped default model provider

Status: implemented

English | [中文](2026-08-20-agency-copilot-default-provider.zh.md)

## Problem

The base bundle selected the direct DeepSeek route even though the harness already had a generic adapter capable of serving Anthropic Messages endpoints. Agency Copilot exposes Claude Code models through that protocol but also requires a distinct endpoint, credential reference, and integration headers. Treating it as another direct adapter would duplicate message conversion, streaming, replay, cancellation, and error normalization without introducing a new wire protocol.

## Decision

The base bundle declares `agency-copilot` as a `dsh-llm-pi-ai` provider profile. The profile uses the `anthropic-messages` protocol, resolves `CLAUDE_CODE_COPILOT_TOKEN` through `ctx.credentials`, sends `Copilot-Integration-Id: copilot-developer-cli` and `Editor-Version: vscode/1.96.0`, and advertises `claude-opus-4-8` with text and image input. `agent-default-model` selects that route and model.

The profile sets `authMode: bearer`, which sends the resolved Copilot access token as `Authorization: Bearer` instead of an Anthropic `x-api-key`. The generic adapter keeps API-key authentication as the default for other profiles.

`@deepseek-ai/dsh-llm-pi-ai` exports `AGENCY_COPILOT_PROVIDER` and `DEFAULT_COPILOT_MODEL` so programmatic consumers can use the same identifiers. The direct `deepseek-official` adapter remains mounted and selectable; this decision changes the shipped default rather than removing a provider.

The profile stays in `packages/bundle/base/cordis.patch.yml`, where deployment defaults belong. User settings merge per provider and may replace its token reference, endpoint, headers, model list, or transport settings without a new adapter implementation.

The generic adapter always requests the profile's exact `CLAUDE_CODE_COPILOT_TOKEN` reference from `ctx.credentials`. The shipped `credentials-local` provider owns Agency-specific discovery below its four exact-reference sources: ordered process environment aliases, then the signed-in `copilot-cli` OS credential on macOS or Windows. Linux has no OS-store fallback. Storing the exact reference overrides these fallbacks without teaching the adapter about aliases or credential stores.

## Alternatives considered

**Add a dedicated Agency Copilot adapter.** Putting token aliases and platform credential-store lookup in the protocol adapter would duplicate the existing pi-ai Anthropic request and stream behavior and mix local credential policy into a generic adapter. `credentials-local` can interpret the exact profile reference while preserving adapter neutrality. A separate adapter becomes justified only if Agency Copilot diverges from the Anthropic Messages protocol or requires authentication that the credentials capability cannot represent.

**Point the existing `anthropic` catalog route at Agency Copilot.** This would inherit catalog behavior not owned by the deployment and would conflate Anthropic's public service with a separate authenticated gateway. A distinct route keeps endpoint, credentials, and provider identity explicit.

**Remove the direct DeepSeek adapter from the base bundle.** Changing the default does not require removing a working alternate route. Keeping it preserves explicit DeepSeek selections and user settings.

## Consequences

A fresh profile selects Agency Copilot Claude Opus 4.8. First launch is prompt-free after the versioned internal-testing welcome notice: `credentials-local` automatically checks the exact reference sources, ordered environment aliases, and the signed-in `copilot-cli` store on macOS or Windows. Linux has no OS-store fallback. The user may optionally store a replacement from Models under the exact `CLAUDE_CODE_COPILOT_TOKEN` reference, which overrides alias and CLI-store fallbacks without exposing the value to settings or browser responses. Existing saved model selections continue to win over the composition default. Agency Copilot requests share the generic adapter's stream, replay, image, retry, timeout, and attribution behavior, while the Copilot-specific endpoint and headers remain visible and overridable configuration.

The base-bundle composition test pins the route, model, endpoint, protocol, token reference, input modalities, and integration headers. The pi-ai adapter tests continue to own protocol conversion, credential resolution, configured-header merging, cancellation, and terminal stream behavior.
