"""Exercise model migration through serialized requests without contacting providers."""

import socket

import pytest

import agent
from conftest import ScriptedAPI, message, text, thinking, tool_use


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def fail(*args, **kwargs):
        raise AssertionError("Tests must not open network connections")

    monkeypatch.setattr(socket.socket, "connect", fail)
    monkeypatch.setattr(socket, "create_connection", fail)


def assert_chat_request(request, model):
    assert request["model"] == model
    assert request["max_tokens"] == 16000
    assert request["output_config"] == {"effort": "medium"}
    assert request["thinking"] == {"type": "adaptive", "display": "summarized"}
    assert not {"temperature", "top_p", "top_k"} & request.keys()
    assert request.get("tool_choice", {"type": "auto"}) == {"type": "auto"}


@pytest.mark.parametrize(
    ("model", "expected_model"),
    [
        (None, "claude-opus-5-5"),
        ("request_default", "claude-sonnet-5-5"),
    ],
)
def test_chat_models_and_title_use_valid_requests(run_agent, model, expected_model):
    api = ScriptedAPI(
        [message([thinking("Checking the allowance."), text("The allowance is "), text("£12,570.")])],
        title=message([thinking("Choose a concise title."), text("Personal "), text("allowance")]),
    )
    kwargs = {}
    if model == "request_default":
        kwargs = agent.AgentRequest(question="What is the UK personal allowance?", thread_id="thread-1").model_dump()
    elif model is not None:
        kwargs["model"] = model

    result, db = run_agent(api, **kwargs)

    assert_chat_request(api.agent_requests[0], expected_model)
    assert result["answer"] == "The allowance is £12,570."
    assert db.inserted("messages")[0]["content"] == result["answer"]
    assert "[ASSISTANT] Checking the allowance." in db.logs
    title_request = api.title_requests[0]
    assert title_request["model"] == "claude-sonnet-5-5"
    assert title_request["output_config"] == {"effort": "low"}
    assert title_request["max_tokens"] == 4096
    assert not {"temperature", "top_p", "top_k", "thinking", "tool_choice"} & title_request.keys()
    assert title_request["messages"][-1]["role"] == "user"
    assert {"title": "Personal allowance"} in db.updated("threads")


def test_tool_history_preserves_thinking_and_full_artifact_input(run_agent):
    artifact_content = "<html>" + "A detailed policy comparison. " * 100 + "</html>"
    first_turn = [
        thinking("Building the comparison.", signature="signed-first-turn"),
        {"type": "redacted_thinking", "data": "opaque-redacted-data"},
        tool_use("artifact-call", "create_artifact", {
            "title": "Policy comparison", "type": "html", "content": artifact_content,
            "dependencies": [],
        }),
    ]
    second_turn = [
        thinking("", signature="signed-empty-note"),
        thinking("Checking the result.", signature="signed-second-turn"),
        text("The comparison is ready."),
        tool_use("sleep-call", "sleep", {"seconds": 1}),
    ]
    api = ScriptedAPI([
        message(first_turn, stop_reason="tool_use"),
        message(second_turn, stop_reason="tool_use"),
        message([thinking("Finished."), text("Here is "), text("your comparison.")]),
    ])
    history = [{"role": "user", "content": "Compare the policies."}, {"role": "assistant", "content": "I will compare them."}]

    result, db = run_agent(api, history=history)

    first, second, third = api.agent_requests
    for request in api.agent_requests:
        assert_chat_request(request, "claude-opus-5-5")
    assert first["messages"][:2] == history
    assert second["messages"][:-2] == first["messages"]
    assert second["messages"][-2] == {"role": "assistant", "content": first_turn}
    assert second["messages"][-1]["content"][0]["tool_use_id"] == "artifact-call"
    assert third["messages"][:-2] == second["messages"]
    assert third["messages"][-2] == {"role": "assistant", "content": second_turn}
    assert third["messages"][-1]["content"][0]["tool_use_id"] == "sleep-call"
    assert db.inserted("artifacts")[0]["content"] == artifact_content
    assert "[ASSISTANT] Building the comparison." in db.logs
    assert "[ASSISTANT] Checking the result." in db.logs
    assert "[ASSISTANT] " not in db.logs
    assert not any("opaque-redacted-data" in entry for entry in db.logs)
    assert result["answer"] == "Here is your comparison."
    assert result["turns"] == 3
    assert db.inserted("messages")[0]["content"] == result["answer"]


def test_explicit_other_model_keeps_compatible_request_shape(run_agent):
    api = ScriptedAPI([message([text("A useful answer.")])])

    result, _ = run_agent(api, model="claude-haiku-4-5")

    request = api.agent_requests[0]
    assert request["model"] == "claude-haiku-4-5"
    assert request["max_tokens"] == 4096
    assert not {"output_config", "thinking"} & request.keys()
    assert result["answer"] == "A useful answer."


def test_refusal_is_stored_before_processing_response_blocks(run_agent):
    api = ScriptedAPI([message([
        thinking("Do not show this partial reasoning."),
        text("Do not save this partial answer."),
        tool_use("refused-artifact", "create_artifact", {"title": "Refused", "content": "must not run"}),
    ], stop_reason="refusal")])

    result, db = run_agent(api)

    assert result["answer"] == agent.REFUSAL_MESSAGE
    assert db.inserted("messages")[0]["content"] == agent.REFUSAL_MESSAGE
    assert db.inserted("artifacts") == []
    assert not any(entry.startswith(("[TOOL_USE]", "[ASSISTANT]")) for entry in db.logs)
    assert api.title_requests[0]["messages"][1]["content"] == agent.REFUSAL_MESSAGE
    assert len(api.agent_requests) == 1


@pytest.mark.parametrize("title_reply", [
    message([text("Do not use this title")], stop_reason="refusal"),
    message([thinking("No title."), text("   ")]),
])
def test_invalid_title_keeps_existing_title_and_saves_answer(run_agent, title_reply):
    api = ScriptedAPI([message([text("A useful answer.")])], title=title_reply)

    result, db = run_agent(api)

    assert result["answer"] == "A useful answer."
    assert db.inserted("messages")[0]["content"] == "A useful answer."
    assert not any("title" in update for update in db.updated("threads"))


@pytest.mark.parametrize(("summary_reply", "expected_summary"), [
    (message([thinking("Inspecting the response."), text("Allowance: "), text("£12,570")]), "Allowance: £12,570"),
    (message([text("Do not use this summary")], stop_reason="refusal"), None),
    (message([thinking("No summary.")]), None),
    ((400, {"type": "error", "error": {"type": "invalid_request_error", "message": "Unavailable"}}), None),
])
def test_large_api_response_uses_haiku_and_falls_back_safely(run_agent, summary_reply, expected_summary):
    raw_result = "Policy parameter data. " * 150
    api = ScriptedAPI([
        message([tool_use("lookup", "list_parameters", {"search": "personal allowance"})], stop_reason="tool_use"),
        message([text("The allowance is £12,570.")]),
    ], summary=summary_reply)

    result, _ = run_agent(api, api_result=raw_result)

    assert len(api.summary_requests) == 1
    request = api.summary_requests[0]
    assert request["model"] == "claude-haiku-4-5"
    assert request["max_tokens"] == 1000
    assert not {"output_config", "thinking"} & request.keys()
    tool_result = api.agent_requests[1]["messages"][-1]["content"][0]
    assert tool_result["tool_use_id"] == "lookup"
    assert tool_result["content"] == (
        expected_summary if expected_summary is not None
        else raw_result[:2000] + f"\n...[truncated, {len(raw_result)} total chars]"
    )
    assert result["answer"] == "The allowance is £12,570."
