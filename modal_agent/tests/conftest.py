"""Test harness for agent.py: a real Anthropic client on a mock HTTP transport, fake Supabase.

No test makes a network call. The Anthropic SDK serializes every request exactly as it would
for the live API, so the assertions run against the JSON bodies the agent would send.
"""

import json
import os
import sys
import types
from dataclasses import dataclass, field
from types import SimpleNamespace
from unittest.mock import patch

import modal
import pytest

os.environ.setdefault("LOGFIRE_SEND_TO_LOGFIRE", "false")
os.environ.setdefault("LOGFIRE_CONSOLE", "false")
os.environ.setdefault("SUPABASE_URL", "https://supabase.test")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# run_agent imports supabase.create_client lazily; the real client needs a live project
_supabase_stub = types.ModuleType("supabase")
_supabase_stub.create_client = lambda url, key: FakeSupabase.current
sys.modules["supabase"] = _supabase_stub

# Deployment decorators are outside these local tests. Recent Modal releases reject
# the repo's legacy web_endpoint name; use its replacement only during test import.
with patch.object(modal, "web_endpoint", modal.fastapi_endpoint):
    import agent


class FakeQuery:
    def __init__(self, db: "FakeSupabase", table: str):
        self.db = db
        self.table = table
        self.op = None
        self.payload = None
        self.filters: list[tuple] = []

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def select(self, columns):
        self.op, self.payload = "select", columns
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def single(self):
        return self

    def execute(self):
        self.db.calls.append((self.table, self.op, self.payload, tuple(self.filters)))
        if self.op == "insert" and self.table == "artifacts":
            return SimpleNamespace(data=[{"id": "artifact-1"}])
        if self.op == "select" and self.table == "threads":
            return SimpleNamespace(data={"input_tokens": 0, "output_tokens": 0})
        return SimpleNamespace(data=[])


class FakeSupabase:
    current: "FakeSupabase | None" = None

    def __init__(self):
        self.calls: list[tuple] = []

    def table(self, name):
        return FakeQuery(self, name)

    def inserted(self, table):
        return [payload for (t, op, payload, _) in self.calls if t == table and op == "insert"]

    def updated(self, table):
        return [payload for (t, op, payload, _) in self.calls if t == table and op == "update"]

    @property
    def logs(self):
        return [row["message"] for row in self.inserted("agent_logs")]


def message(content, stop_reason="end_turn", model="claude-opus-5-5", stop_details=None):
    """A Messages API response body."""
    body = {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }
    if stop_details is not None:
        body["stop_details"] = stop_details
    return body


def thinking(text, signature="sig"):
    return {"type": "thinking", "thinking": text, "signature": signature}


def text(value):
    return {"type": "text", "text": value}


def tool_use(block_id, name, tool_input):
    return {"type": "tool_use", "id": block_id, "name": name, "input": tool_input}


@dataclass
class ScriptedAPI:
    """Answers each request by kind: agent turns in script order, then title and summary calls."""

    agent_turns: list
    title: object = field(default_factory=lambda: message([text("Personal allowance amount")], model="claude-sonnet-5-5"))
    summary: object = field(default_factory=lambda: message([text("SUMMARY")], model="claude-haiku-4-5"))
    requests: list = field(default_factory=list)

    def handler(self, request):
        import httpx2

        body = json.loads(request.content)
        self.requests.append(body)
        if "tools" in body:
            index = len(self.agent_requests) - 1
            reply = self.agent_turns[index]
        elif body["model"] == "claude-haiku-4-5":
            reply = self.summary
        else:
            reply = self.title
        if isinstance(reply, tuple):  # (status, body) for API errors
            return httpx2.Response(reply[0], json=reply[1])
        return httpx2.Response(200, json=reply)

    @property
    def agent_requests(self):
        return [r for r in self.requests if "tools" in r]

    @property
    def title_requests(self):
        return [r for r in self.requests if "tools" not in r and r["model"] != "claude-haiku-4-5"]

    @property
    def summary_requests(self):
        return [r for r in self.requests if "tools" not in r and r["model"] == "claude-haiku-4-5"]


OPENAPI_SPEC = {
    "paths": {
        "/parameters/": {
            "get": {
                "operationId": "list_parameters",
                "summary": "List parameters",
                "parameters": [
                    {"name": "search", "in": "query", "schema": {"type": "string"}},
                ],
            }
        }
    }
}


def run(api: ScriptedAPI, monkeypatch, api_result="short result", **kwargs):
    """Run run_agent against the scripted API; returns (result, fake supabase)."""
    import anthropic
    import httpx2
    import logfire

    db = FakeSupabase()
    FakeSupabase.current = db
    real_client = anthropic.Anthropic

    # Preserve the SDK's class interface: Logfire uses issubclass to select its
    # synchronous instrumentation, which cannot inspect a factory function.
    class OfflineAnthropic(real_client):
        def __init__(self, *args, **kwargs):
            super().__init__(
                api_key="test-key",
                http_client=httpx2.Client(transport=httpx2.MockTransport(api.handler)),
                max_retries=0,
            )

    monkeypatch.setattr(anthropic, "Anthropic", OfflineAnthropic)
    monkeypatch.setattr(logfire, "configure", lambda *a, **k: None)
    # Telemetry is outside these request/response tests. Logfire currently cannot
    # inspect the SDK's Omit sentinel and reraises that internal error under pytest.
    monkeypatch.setattr(logfire, "instrument_anthropic", lambda *a, **k: None)
    monkeypatch.setattr(agent, "fetch_openapi_spec", lambda url: OPENAPI_SPEC)
    monkeypatch.setattr(agent, "execute_api_tool", lambda tool, tool_input, url, log_fn: api_result)
    monkeypatch.setattr(agent.time, "sleep", lambda seconds: None)

    kwargs.setdefault("question", "What is the UK personal allowance?")
    kwargs.setdefault("thread_id", "thread-1")
    result = agent.run_agent.local(**kwargs)
    return result, db


@pytest.fixture
def run_agent(monkeypatch):
    return lambda api, **kwargs: run(api, monkeypatch, **kwargs)
