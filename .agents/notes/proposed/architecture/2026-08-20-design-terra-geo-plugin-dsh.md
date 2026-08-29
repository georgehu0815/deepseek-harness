# Agent Note: Geo domain layers for the Terra port

Status: proposed

English | [中文](2026-08-20-design-terra-geo-plugin-dsh.zh.md)

Phases 1–2 of the Terra port shipped — the geo seam, query/control tools, the `geoCommand` projection, and the CesiumJS globe with an agent→Earth command loop — and the first-class Earth grid column shipped, promoting the globe from the overlay into a fourth `ui-layout` track. Both are recorded in [Agent Note: Port Terra's geo experience into DeepSeek Harness as plugins](../../implemented/architecture/2026-08-20-terra-geo-plugin-port.md). This proposal covers the remaining geo domain-layer work.

## Problem

The shipped geo seam serves only geocoding and static base-map presets; Terra's richer value is its domain data (catalog search, airports/buildings/lidar layers, supply-chain simulation) served by a Fastify BFF over SQLite. It is deferred because it is a large backend surface that should not be rushed.

## Proposal

**Geo domain layers.** Grow the seam and tools beyond geocoding, keeping the self-contained provider as the default and a Terra-backed provider as a drop-in:

- Host: a `@deepseek-ai/dsh-host-geo-bff` provider that either proxies Terra's Fastify `:4176` (`/api/catalog/search`, `/api/domains/{layer}?bbox=&lod=`, `/api/assets`, `/api/domains/{layer}/feature/{id}`) or re-expresses hot routes as Typert Remote methods on `dsh-api-gateway`; and a `@deepseek-ai/dsh-geo-viewcontext` request-context plugin injecting live camera/view-bbox and nearby context into each request.
- Tools: extend `tool-geo-query` with `geo_catalog_search`, `geo_domain_query`, `geo_feature_get`; extend `tool-geo-control` with `toggle_domain`, `draw_point`/`draw_polyline`/`draw_polygon`, `move_feature`, all appending `geo/command` variants folded by the `geoCommand` projection.
- Client: a `@deepseek-ai/dsh-client-ui-geo-layers` layer/source/domain control surface seated inside the earth column, and controller support for domain imagery/vector layers.
- Optional: port `plugin-geo/skills/*/SKILL.md` playbooks into the `skill` registry.

## Acceptance criteria

- The agent toggles at least one domain layer and draws a feature that appears on the globe, driven through the `geoCommand` projection, verified by a real-composition test and a keyless snapshot.
- The default geo provider stays self-contained; a Terra-backed provider is selectable by config without changing tools or client.

## Alternatives considered

**Rewrite Terra's domain routes natively before proxying.** Faithful and process-light, but a large backend migration up front; proxying `:4176` first proves the tools and client, and hot routes migrate to Typert Remote later without reworking either.

## Risks

- **Cesium assets and bundle size.** The engine already bundles at ~10.9 MB into `client.js`; domain imagery/worker assets and `CESIUM_BASE_URL` handling may push toward plugin-owned external loading. Needs a build-integration spike.
- **BFF process coupling.** Proxying Terra's Fastify `:4176` reintroduces a second Node process; confirm whether that is acceptable short-term or whether hot routes should be native from the start. SSRF guards and the COG/domain workers stay behind whichever path is chosen.
- **Snapshot and GIF coverage.** Every model- or GUI-visible change needs keyless snapshot coverage and, for the GUI, a GIF recorded from the real server, per repository policy.
