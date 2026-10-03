# PolicyEngine Chat

A chat interface for the PolicyEngine agent. Ask questions about UK or US tax and benefit policy, calculate household impacts, and analyse economy-wide reforms.

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Modal](https://modal.com) account (for the agent)
- Supabase project (already deployed at `xieouadfboiipmwqrhyg`)

### Local development

1. Install dependencies:
```bash
bun install
```

2. Create `.env.local` (or use the existing one):
```bash
cp .env.local.example .env.local
```

3. Start the dev server:
```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to use the chat.

### Deploying the Modal agent

The agent runs on Modal and stores logs in Supabase. To redeploy:

```bash
cd modal_agent
modal deploy agent.py
```

The Modal function needs two secrets:
- `anthropic-api-key` - your Anthropic API key
- `policyengine-chat-supabase` - Supabase URL and service key

### Model defaults

Both Next.js routes and direct agent calls default to `claude-opus-5-5`. Modal
endpoint requests that omit `model` default to `claude-sonnet-5-5`. Agent turns
use medium effort with summarized thinking shown in the existing activity feed;
titles use low effort. Large API responses use Haiku without adaptive thinking.

For budgeting new runs, rates per million input/output tokens as of 2026-09-28:

| Role | Model | Input | Output |
|------|-------|-------|--------|
| Chat agent | `claude-opus-5-5` | $4 | $20 |
| Titles and Modal endpoint default | `claude-sonnet-5-5` | $2 | $10 |
| API-response summarizer | `claude-haiku-4-5` | $1 | $5 |

Thinking counts toward the output token budget. Tool history retains complete
responses, including thinking blocks and artifact inputs. Existing thread cost
displays still use the legacy estimate over cumulative tokens; these totals do
not identify the model and cannot be repriced accurately as historical usage.
No environment variable overrides the model defaults; direct Modal callers can
set the request's `model` field.

### Checks

```bash
bun run lint
bun run build
python -m pip install -r modal_agent/tests/requirements.txt
python -m pytest modal_agent/tests -q
```

The Python tests run the agent locally with a real Anthropic SDK and a mock HTTP
transport, stub Supabase, PolicyEngine, and telemetry integrations, and block network access.
They require no API keys or deployed services. The Modal image requires
`anthropic>=1.9.0,<2` for `output_config` and summarized thinking support.

## Environment variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (server-side only) |
| `NEXT_PUBLIC_API_BASE_URL` | PolicyEngine API URL (default: https://v2.api.policyengine.org) |

## Database schema

Three tables:
- **threads**: Chat sessions with title and timestamps
- **messages**: User and assistant messages
- **agent_logs**: Streaming logs during agent execution

See `supabase/migrations/001_initial.sql` for the full schema.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Next.js   │────▶│    Modal     │────▶│  Supabase   │
│   Frontend  │     │    Agent     │     │   Database  │
└─────────────┘     └──────────────┘     └─────────────┘
       │                   │                    │
       │                   ▼                    │
       │           ┌──────────────┐             │
       │           │ PolicyEngine │             │
       │           │    API v2    │             │
       │           └──────────────┘             │
       │                                        │
       └────────────────────────────────────────┘
                    (realtime updates)
```

1. User sends message → saved to Supabase
2. Next.js API spawns Modal agent
3. Agent calls PolicyEngine API, streams logs to Supabase
4. Agent saves final response to Supabase
5. Frontend receives updates via Supabase realtime
