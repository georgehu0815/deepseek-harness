# Agent Note: Inline Web Markdown audio with retained source links

Status: implemented

English | [中文](2026-09-07-web-inline-markdown-audio.zh.md)

## Problem

An assistant reply can name a remote MP3 recording with a Markdown link. Listening in another tab interrupts reading the reply, but an inline player alone can hide the source when the remote media is unavailable or unsupported.

## Decision

The shared [`MarkdownText` renderer](../../../../packages/client/ui-primitives/README.md) adds a native `<audio controls preload="none">` beside a parsed link when its destination has an explicit `http://` or `https://` scheme, no embedded username or password, and a pathname ending in `.mp3`, case-insensitively. Query strings and fragments do not affect the suffix check. Direct links, resolved reference links, and autolinks use the same rule; inline-code URLs remain links without players.

The original anchor and authored label remain visible with the existing safe external-link attributes. The player is a sibling, not nested inside the anchor, and its accessible name comes from the link's plain text or the destination URL when that text is empty. Playback never starts automatically. Browser-owned controls require no new application copy or localization props.

Audio loading and playback belong to the browser. `preload="none"` is an advisory loading hint, not a promise that the origin receives no request. Raw HTML stays disabled. This presentation adds no host proxy, media service, session events, or model API.

## Testing

[Component tests](../../../../packages/client/ui-primitives/tests/markdown-audio.client.spec.tsx) cover URL admission and rejection, retained labels, inert HTML and code, and player identity across streaming and settlement. The [assembled Web browser test](../../../../apps/web/tests/markdown-audio.e2e.ts) seeds a persisted Session and exercises native keyboard Play/Pause without navigation. It serves deterministic PCM audio at an MP3-suffixed URL to separate URL recognition from codec support; it does not verify arbitrary remote MP3 availability or decoding.

## Alternatives considered

**Keep links without players.** This preserves navigation but does not let readers listen while staying with the reply.

**Accept raw HTML audio embeds.** Enabling authored HTML expands the untrusted-output policy beyond the required MP3 playback. Parsed Markdown links provide the destination without enabling arbitrary elements or attributes.

**Replace the link with the player.** Native media failures differ across browsers and origins. Keeping the source anchor separately preserves navigation even when the player cannot load or decode the recording.

## Consequences

The player works through the shared renderer during streaming and settled display. An MP3 suffix identifies a playback candidate, not verified media content; the browser owns loading, decoding, and error presentation. Remote origins can observe requests and the client network address under browser policy. Other media suffixes, relative destinations, unsupported schemes, and credential-bearing URLs do not create audio elements; each keeps its existing link or inert-text behavior.

The [safe assistant Markdown policy](2026-07-23-web-assistant-markdown.md), [remote-image decision](2026-07-30-web-remote-markdown-images.md), and [incremental AST renderer decision](../architecture/2026-08-06-web-markdown-incremental-ast-renderer.md) retain their independent security, image-loading, and streaming rationale. Audio complements those decisions rather than superseding them.
