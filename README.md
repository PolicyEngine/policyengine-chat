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
