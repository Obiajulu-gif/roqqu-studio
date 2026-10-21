# Architecture

Roqqu Studio is a two-service app: a **Next.js canvas** (`apps/web`) and a **FastAPI backend** (`apps/api`, Python package `roqqu_studio`). There is no database; all state is in memory in the API process.

## Request flow

```
Browser (React Flow canvas)
  └─ fetch  /studio-backend/*            (same-origin, keeps the session cookie first-party)
       └─ Next.js rewrite (next.config.ts) ──► FastAPI  (STUDIO_API_ORIGIN, default http://127.0.0.1:8010)
            ├─ /assistant/*      Moni (AI) ─► ai/composer ─► ai/providers (Anthropic | OpenAI | Google | keyword fallback)
            │                                  └─ output is validated by analysis/ and remediation/ before being returned
            ├─ /workflows, /analyze, /remediate   ─► store.py (in-memory versions) + analysis/ (deterministic rules)
            ├─ /executions       ─► executor/engine.py ─► adapter (MockAdapter | SandboxAdapter) ─► integrations/roqqu/client.py ─► sandbox.roqqu.com
            ├─ /preview/{id}/*   ─► artifacts/generator.py (Jinja2 shop, invoice, dashboard pages), orders/service.py, ajo.py
            └─ /roqqu/webhook  ─► HMAC-SHA512 check ─► orders_service.verify() (re-queries Roqqu; payload is only a trigger)
```

In production the web and API are separate Cloud Run services. The browser then calls the API origin directly (`NEXT_PUBLIC_API_URL`) and the session cookie switches to `SameSite=None; Secure` (`api/main.py:_session_id`).

## Key idea: provider-neutral IR

- `ir/types.py` defines `CapabilityTag`s (e.g. `AUTHORITATIVE_VERIFICATION`, `SIGNATURE_CHECK`, `MONEY_MOVEMENT`) and `DomainType`s. It never mentions a provider.
- `providers/roqqu.py` maps each Roqqu endpoint to a `NodeTypeDef` (type string `roqqu.*`, tags, ports, `when_to_use` text, doc URL). `providers/core.py` holds provider-neutral nodes (events, safety steps, control flow, `app.*`).
- `analysis/rules.py` reasons only over tags, never node type strings. Rules: MON001, 002, 003, 004, 009, 011, 012.
- `remediation/` rewrites a flawed graph into a clean one (Apply-Fix).
- `ai/composer.py` is a generate → verify → refine → refuse loop. The model proposes, the analyzer decides.

## Backend module map (`apps/api/roqqu_studio`)

| Module | Role |
|---|---|
| `api/main.py` (1667 lines) | All HTTP routes, session cookie, CORS, webhook, SSE trace stream |
| `api/seed.py` | Seeds the demo business when `STUDIO_SEED_DEMO=1` |
| `config.py` | `Settings` (pydantic-settings); sandbox-only guard (`assert_sandbox`) |
| `credentials.py` | Per-workflow Roqqu keys, write-only, registered with the log redactor |
| `store.py` | In-memory versioned workflow store, seeded with the two hero fixtures |
| `ir/` | `Workflow`, `Node`, `Edge` models, types, port type-checking |
| `providers/` | Node catalog (`base.py`, `core.py`, `roqqu.py`) |
| `analysis/` | Rule engine and rules |
| `remediation/` | Apply-Fix graph operations |
| `ai/` | Moni: `providers.py` (LLM adapters + failover), `composer.py`, `explain.py`, `moni.py` (intent), `fidelity.py`, `schema.py` |
| `executor/` | `engine.py` (interpreter), `adapter.py` (`MockAdapter`, `SandboxAdapter`), `sandbox.py` (custom code node), `events.py`, `store.py` |
| `integrations/roqqu/client.py` | `RoqquSandboxClient`: authenticate, initialize_transaction, initiate_transfer, create_reserved_account, query_transaction |
| `integrations/email.py`, `whatsapp.py`, `notifications.py` | ZeptoMail email and Evolution API WhatsApp |
| `orders/service.py` | Order store; pending, verified, rejected transitions driven only by provider truth |
| `ajo.py`, `onboarding.py`, `money.py` | Savings-circle logic, onboarding profile, exact `Decimal` money |
| `artifacts/` | Jinja2 templates for shop, invoice, payment page, dashboard |
| `templates/` | Starter workflows: ajo, invoice, payroll, sell_online |
| `codegen/python.py` | Generates runnable Python from a workflow |
| `observability/` | structlog, redaction, OpenTelemetry tracing |

## Frontend module map (`apps/web/src`)

| Path | Role |
|---|---|
| `app/layout.tsx`, `app/page.tsx` | Root layout (title "Roqqu Studio") and single page rendering `<StudioApp />` |
| `components/StudioApp.tsx` | Top-level container: onboarding path, canvas, panels |
| `components/WorkflowCanvas.tsx`, `StudioNode.tsx`, `NodePalette.tsx` | React Flow canvas and palette |
| `components/ChatPanel.tsx` | Moni chat |
| `components/ReviewPanel.tsx`, `TracePanel.tsx` | Analyzer findings and execution trace |
| `components/BusinessDashboard.tsx`, `AjoPanel.tsx`, `PreviewArtifactPanel.tsx` | Business-owner outputs |
| `components/PathGate.tsx`, `TemplatePicker.tsx`, `ProductsStep.tsx`, `OnboardingTour.tsx` | Onboarding |
| `components/CredentialsForm.tsx`, `RunSettingsPanel.tsx`, `ConfigPanel.tsx` | Keys and run settings |
| `hooks/` | `useStudioGraph`, `useStudioSession`, `useExecutionTrace`, `useOnboardingTour` |
| `lib/api.ts`, `lib/http.ts` | API client (axios) and base-URL resolution |
| `types/` | TypeScript mirrors of backend models |
| `data/*.json` | Offline fixtures for the two hero workflows |
| `public/figma/` | Static icons and images, including `roqqu-logo*.svg` |

State management: React hooks only (`useStudioGraph` for the React Flow graph, `useStudioSession` for the profile). No Redux or Zustand.

## Data model

- **Workflow**: `id`, `name`, `version`, `nodes[]` (`type`, `config`, tags), `edges[]` (`source`, `target`, `kind`).
- **Order**: `reference`, `artifact_id`, `workflow_id`, line items, total (`Decimal`), `status` (pending, verified, rejected).
- **StudioProfile**: `session_id`, `path` (business or developer), `step`, `goal`, `products[]`, `workflow_id`.
- **ExecutionRun / ExecutionEvent**: buffered, redacted trace, streamed over SSE.

All of it is lost on API restart.

## External services

| Service | Used for | Env |
|---|---|---|
| Roqqu sandbox | Checkout, verify, transfer, reserved accounts | `ROQQU_API_KEY`, `ROQQU_SECRET_KEY`, `ROQQU_CONTRACT_CODE`, `ROQQU_WALLET_ACCOUNT`, `ROQQU_BASE_URL` |
| Anthropic / OpenAI / Google | Moni | `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, plus `*_MODEL`, `AI_TIMEOUT_S`, `MONI_COMPOSE_ROUNDS` |
| ZeptoMail | Email receipts | `ZEPTOMAIL_API_KEY`, `ZEPTOMAIL_SENDER`, `ZEPTOMAIL_REPLY_TO` |
| Evolution API | WhatsApp | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` |
| OTLP collector (optional) | Tracing | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Google Cloud Run | Deploy | `scripts/deploy-cloud-run.sh`, `.github/workflows/deploy.yml` |

Web env: `NEXT_PUBLIC_API_URL` (browser base URL, empty means use `/studio-backend`), `STUDIO_API_ORIGIN` (build-time rewrite target).

## Where each page's code lives

The app has one route (`/`). Screens are states of `StudioApp.tsx`:

| Screen | Frontend | Backend |
|---|---|---|
| Path gate (developer or business) | `PathGate.tsx` | `/studio/profile` (`onboarding.py`) |
| Template picker | `TemplatePicker.tsx` | `/templates`, `/workflows/from-template/{id}` (`templates/`) |
| Canvas, palette, chat | `WorkflowCanvas.tsx`, `NodePalette.tsx`, `ChatPanel.tsx` | `/catalog`, `/assistant/*` |
| Review | `ReviewPanel.tsx` | `/analyze`, `/remediate` |
| Run and trace | `TracePanel.tsx`, `useExecutionTrace.ts` | `/executions`, `/executions/{id}/events/stream` |
| Code tab | `StudioApp.tsx` | `/workflows/{id}/code` (`codegen/python.py`) |
| Business dashboard | `BusinessDashboard.tsx` | `/workflows/{id}/dashboard`, `/preview/{id}/totals` |
| Shop, invoice, contribute pages | server-rendered HTML | `/preview/{id}/shop`, `/invoice/{ref}`, `/contribute` (`artifacts/templates/*.j2`) |

## Known gaps in the repo's own story

- The Windows `preexec_fn` in `executor/sandbox.py` makes 4 tests fail on Windows (they pass on Linux CI).
- Live `NEXT_PUBLIC` calls and Cloud Run config are documented but the deployed service's backend URL is not in the repo.

## Roqqu status

The code was rebranded from Monnify to Roqqu. Roqqu publishes no public developer API, so `integrations/roqqu/client.py` keeps the original endpoint paths and payload shapes as **placeholders**, and `ROQQU_BASE_URL` defaults to a placeholder host. Zero-key mode (the in-memory `MockAdapter`) is the working path. For live mode, replace the paths and field mappings in `client.py` once Roqqu supplies API docs and keys.

AI providers: `anthropic | openai | google | nvidia`. `nvidia` uses NVIDIA NIM through the OpenAI SDK (`NVIDIA_API_KEY`, optional `NVIDIA_MODEL`, `NVIDIA_BASE_URL`).
