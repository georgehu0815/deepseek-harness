# Configure models

English | [中文](providers.zh.md)

This guide assumes you started the Web UI through the [root README](../../../README.md#run). Model changes take effect on the next request without restarting the server.

## Start with Agency Copilot

A fresh profile uses **Agency Copilot** with **Claude Opus 4.8**. First launch shows only the existing internal-testing welcome notice and never asks you to paste an Agency token.

The shipped local credentials provider resolves the exact `CLAUDE_CODE_COPILOT_TOKEN` reference from the process environment, `$DSH_HOME/.credentials.yaml`, the project `.env`, then the user `.env`. Only when all four exact-reference sources miss does it check process aliases in this order: `GH_COPILOT_TOKEN`, `GITHUB_COPILOT_TOKEN`, `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`. Its last fallback is the signed-in `copilot-cli` credential from macOS Keychain service `copilot-cli` or a matching Windows Credential Manager entry; Linux has no OS-store fallback.

You may open **Settings > Models**, edit the Agency Copilot row, and enter a replacement. The value is stored write-only under the exact `CLAUDE_CODE_COPILOT_TOKEN` reference, which overrides an alias or `copilot-cli` fallback. An exact value inherited from the process environment remains read-only. Settings and browser responses contain only redacted configured/source/writable facts, never the secret value.

The default applies to new sessions. A model selected in the composer becomes the default for later new sessions, and an existing session continues using the provider and model recorded in its log.

## Configure DeepSeek as an alternative

Open **Settings → Models**. The DeepSeek card exposes one API-key field; enter the key and save it.

![The Models page: the DeepSeek card, with Add provider and Add a custom provider below it](providers-models-page.png)

DeepSeek keys use the same write-only credential storage as the Agency Copilot token.

## Add a catalog provider

Choose **Add provider**, select a provider such as Anthropic or OpenAI, enter its API key, and save. The installed catalog supplies the endpoint, protocol, and model list.

Providers with native authentication need their native credentials instead. Bedrock, Vertex, Azure, and Codex use AWS credentials and a region, an ADC project, an `api-version`, and OAuth respectively; filling only the API-key field does not configure them.

## Add a custom provider

Choose **Add a custom provider** for a company gateway, self-hosted server, or provider absent from the installed catalog. Supply a lowercase Provider ID, base URL, API protocol, credential, and at least one model.

![The custom provider form: Provider ID, display name, base URL, API protocol, and API key](providers-custom-form.png)

The Provider ID is permanent because requests, saved sessions, model defaults, and credential references use it. To rename a provider, add a new provider and delete the old one. The display name, base URL, protocol, credential, and models remain editable.

Under **Model catalog**, choose **Fetch available models** to query the base URL and credential currently shown in the form. Selecting candidates updates the draft; the provider is not stored until you save. Catalog providers use their installed catalog without a network request.

### Image input

A model you enter by hand is treated as text-only until it says otherwise, because nothing can ask an endpoint which modalities it accepts. Attaching an image to such a model is refused before it is sent, naming the model.

A vision model on a custom provider therefore needs one line. The form has no field for it; add `input` to the model in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` accepts `text` and `image`, and applies to that model alone, so one route can serve both kinds. Omitting it — or writing an empty list, which means the same thing — keeps whatever the installed catalog records for that model, and falls back to the route's `defaultInput` for a model the catalog does not describe.

If every model you entered by hand takes images, set the fallback once on the route instead of on each of them:

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` is a fallback, not an override, and defaults to `[text]`: on a catalog provider it answers only for models the catalog does not describe, so it never removes images from a catalog model that has them. Narrow one of those with that model's own `input`. A catalog provider has no `models` list to put it in, so write it under `modelOverrides`, keyed by model id:

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

Every list must name at least one modality except a model's own, where an empty list means the same as omitting it. An unknown modality is refused wherever it is written.

Both fields state a claim about your endpoint rather than checking it. A model that declares images its endpoint does not serve is not caught here; the provider rejects the request instead.

### Request compatibility

A gateway can hold a working key at a reachable address and still refuse every request. pi-ai decides the shape of a request — which role carries the system prompt, which field caps the output, how a thinking level travels — from the endpoint's URL, and an address it does not recognize is addressed as though it were OpenAI itself. Most OpenAI-compatible gateways refuse at least one thing OpenAI accepts.

Two account for most of it. A model that declares reasoning has its system prompt sent as `role: "developer"`, which many gateways reject outright, and the output cap is sent as `max_completion_tokens`, which a server that only knows `max_tokens` refuses. The form has no field for either; correct them on the route in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
      models:
        - id: my-model
```

A route's `compat` is the default for its models, and a model's own wins field by field, so one model can be corrected without restating the route:

```yaml
      models:
        - id: my-model
        - id: my-reasoner
          compat:
            thinkingFormat: deepseek
```

What neither sets keeps the installed catalog's value for that model, and what the catalog does not describe falls to pi-ai's detection. Give every switch you name a value: a key left empty (`supportsDeveloperRole:`) is refused rather than ignored, because an empty value would erase what the catalog knows while saying nothing in its place. A name no protocol accepts is refused too, and the message lists the ones that are available.

Each switch belongs to the protocols that declare it, so a switch valid on one `api` may be refused on another — the message names what that protocol does offer. Like `input` above, a switch states a claim about your endpoint rather than checking it: setting one your gateway does not actually need simply sends a different request.

Every switch, its accepted values, and the protocols that take it are listed under `PiAiCompatProfile` in the [generated `dsh-llm-pi-ai` configuration reference](../../config-catalog.md#deepseek-aidsh-llm-pi-ai) — which is derived from the source, so it cannot fall behind what the adapter accepts.

## Select a model

Configured providers appear in the model picker. Selecting a model also makes it the default for new sessions. A session that has already sent a request retains the model recorded in its own log.

If a saved default names a provider that was deleted, the composer displays **Select model** and blocks input until another model is selected.

## Troubleshooting

- **`MISSING_CREDENTIAL`** — Store the provider key through the Models page or supply the referenced environment variable.
- **`UNKNOWN_MODEL`** — Select a configured model or add the missing model to the custom provider.
- **Fetching available models returns 401** — Check the key. Model discovery calls the OpenAI-compatible `GET /models` endpoint; enter models manually for endpoints that do not provide it.
- **The gateway refuses every request although the key and URL are right** — Its request shape differs from OpenAI's. Start with `compat.supportsDeveloperRole: false` and `compat.maxTokensField: max_tokens` on the route.
- **Agency Copilot returns `MISSING_CREDENTIAL`**: Sign in with `copilot-cli`, provide one of the supported process aliases (`GH_COPILOT_TOKEN`, `GITHUB_COPILOT_TOKEN`, `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`), or store a replacement in **Settings > Models**. Linux requires an environment source or the manual Models entry because it has no OS-store fallback.
- **Agency Copilot is configured but a new session selects another model** — The saved composer selection overrides the shipped default. Select **Claude Opus 4.8** from Agency Copilot to replace it.
- **An existing session stays on its previous provider** — Start a new session. Sent sessions retain the provider and model recorded in their logs.
- **Only reasoning models fail** — pi-ai sends their system prompt as the `developer` role, which the gateway rejects. Set `compat.supportsDeveloperRole: false`.
- **A compat switch is refused as having no value** — A key written with nothing after the colon. Give it a value, or remove the key to keep the installed catalog's.
- **An image is refused before sending** — The model declares no image modality. Give a custom provider's model `input: [text, image]`; DeepSeek's own chat-completions route is text-only and cannot be configured otherwise.
- **The provider rejects a request carrying an image** — The model declares images its endpoint does not actually serve. Remove `image` from whichever list granted it — the model's `input`, or the route's `defaultInput` — then start a new session: the attached image stays in the session log, so the same request repeats until the session moves off it.

## Advanced configuration

The generated [plugin configuration catalog](../../config-catalog.md) lists every supported field and default for every plugin; [`dsh-llm-pi-ai`](../../config-catalog.md#deepseek-aidsh-llm-pi-ai) is the provider section this page configures. The [`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) and [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md) references own direct `settings.yaml` configuration, catalog resolution, reasoning controls, credentials, and adapter errors.
