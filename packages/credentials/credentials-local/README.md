# dsh-credentials-local

English | [中文](README.zh.md)

File-backed [credentials](../credentials/README.md) provider: four layers, one honest precedence.

| Layer | Source id | Writable | Wins |
|---|---|---|---|
| Inherited process environment | `env` | no | always |
| `$DSH_HOME/.credentials.yaml` document | `file` | yes (`set`/`unset`) | over both `.env` layers |
| `<invocation cwd>/.env` | `project-env` | not here | over the user `.env` |
| `$DSH_HOME/.env` | `user-env` | not here | otherwise |

The launching environment wins because a per-run override (`DEEPSEEK_API_KEY=… dsh`, a CI secret, a container `-e`) is operator intent for this run — and because it cannot be edited from inside, it must be *visibly* read-only: `describe()` reports `source: 'env', writable: false`, and `set`/`unset` reject instead of writing a change the reader would never see.

Everything below it loses to the managed store, so a key written by the Models page takes effect immediately even when an older key sits in a `.env`. Those two layers still resolve when nothing is stored, and `describe()` names them `project-env` or `user-env` with `writable: true` — storing a key replaces them as the effective source.

Under the product CLI, resolution reads the launcher's frozen [environment snapshot](../../util/launch-environment/README.md) rather than `process.env`: only the snapshot can say whether a value came from the launching shell or from a file. A composition the product CLI did not boot has the inherited environment as its only layer, which keeps embedders on the semantics they already had.

## Agency Copilot fallback

The shipped `CLAUDE_CODE_COPILOT_TOKEN` reference has a provider-specific fallback below every exact-reference source in the table. After the exact process environment, managed document, project `.env`, and user `.env` all miss, the provider checks process aliases in this order: `GH_COPILOT_TOKEN`, `GITHUB_COPILOT_TOKEN`, `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`.

If no alias is present, macOS reads the signed-in `copilot-cli` credential from Keychain service `copilot-cli`, and Windows reads Credential Manager entries matching `copilot-cli`. Linux has no OS-store fallback. Alias and `copilot-cli` descriptions remain writable because `set` stores the exact `CLAUDE_CODE_COPILOT_TOKEN` reference in the managed document and overrides either fallback. An exact reference inherited from the process environment remains read-only.

## Config

| Field | Default | Meaning |
|---|---|---|
| `path` | `<harness home>/.credentials.yaml` | Credentials document location. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home used when `path` is omitted. |
| `watch` | `true` | Hot-publish external edits. |
| `debounceMs` | `100` | Watcher write-settle window. |

## The document

A YAML mapping of credential reference to value, and nothing else:

```yaml
DEEPSEEK_API_KEY: sk-…
OPENAI_API_KEY: sk-…
```

The document holds credentials only, so every deviation is a rejection rather than a skipped entry — a silently ignored key would read as "the secret I stored has no effect". A non-mapping root, a key that is not a POSIX identifier, a non-string value, an empty string, a duplicate key, and malformed YAML all fail: loud at boot, and warn-and-keep-the-last-good-snapshot on a live reload. There is no `version` field and no wrapper level; the format is the mapping.

Writes patch the parsed document rather than rebuilding it, so comments and the formatting of every untouched entry survive. A comment directly above an entry is that entry's annotation and is removed with it. Every write first re-reads the document under the cross-process writer lock of [`dsh-atomic-write`](../../util/atomic-write/README.md) and publishes anything it had not observed, then commits atomically with mode `0600` under an owner-only (`0700`) directory — so a concurrent writer or an external edit inside the watcher's debounce window is folded in rather than overwritten. An on-disk document that no longer parses fails the write instead of overwriting content the provider could not understand.

Any string value round-trips, multi-line values included, so no entry is unwritable for want of a quoting style. An empty stored value is absent, per the seam rule — which is why an empty string in the document is rejected outright: `unset` removes a key, it does not blank it.

## Permissions

The provider creates the directory `0700` and creates or atomically replaces the document `0600`. It holds what it *reads* to that same bound: on POSIX a document carrying any group or other permission bit fails before its contents are parsed — at boot and on every reload — and the error names the `chmod 600` repair. Windows has no mode to inspect, so the check is skipped there rather than faked.

## Hot reload

External edits publish `credentials/updated` per changed reference after the snapshot is replaced **wholesale** — an entry deleted on disk never lingers in memory. Before Chokidar opens the target, the provider realpaths its deepest existing ancestor and restores any missing suffix; file access and diagnostics retain the configured path, while Windows cannot mix an 8.3 alias with long-form libuv events. The provider's own writes are recognized by content and publish exactly their one commit event. An unreadable or invalid document at runtime keeps the last good snapshot and warns; an absent file is an empty store; an unreadable or invalid file at boot fails loud.

## Security boundary

The document is `0600` under a `0700` directory, which stops other OS users — **not** the model. Tool processes (bash, the filesystem tools) run as the same user, and the shipped `workspace-write` file policy confines mutations rather than reads, so they can read this file exactly like any other file the user owns; no sandbox mode singles it out. What the harness does hold to is narrower: it never hands the model a resolved path to the document, and never loads it into the process environment — unlike `$DSH_HOME/.env`, which is the user's ordinary environment layer (see [app-boot's Harness-home layers](../../boot/app-boot/README.md#profiles)) — so reaching the value takes a deliberate read of a path the agent was not given.

Automatic Agency Copilot lookup in macOS Keychain or Windows Credential Manager is convenience within the same UID, not a stronger security boundary. Another process running as the same user may invoke the same credential-store API. A deployment that must keep provider keys away from its own agent needs process or identity isolation beyond this provider.

## Model Experience

Indirectly, through the consuming LLM adapters: stored values authorize their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; credentials never enter a request prefix.

## Known Limitations and Deferred Work

- **Same-reference concurrent writes are last-write-wins** — the writer lock and the read-modify-write keep concurrent writers from dropping each other's entries, but two writers editing one reference still resolve to the later write; there is no revision check.
- **A same-UID process can reach local credentials**: see [Security boundary](#security-boundary): it can read the managed document or invoke the same macOS or Windows credential-store API used for Agency Copilot. Linux has no OS-store fallback.
- **Environment changes are invisible** — the snapshot is frozen at launch, so a variable exported after startup reaches neither resolution nor `describe`; changing an environment-sourced credential takes a restart.
- **Atomic, not crash-durable** — inherited from `dsh-atomic-write`; the store re-reads on boot.
