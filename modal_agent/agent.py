"""Modal agent using Claude API with tools auto-generated from OpenAPI spec.

Stores logs and results directly in Supabase.
"""

import json
import os
import re
import time
from typing import Callable

import anthropic
import modal
import requests
from supabase import create_client

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "anthropic", "requests", "supabase", "fastapi", "logfire"
)

app = modal.App("policyengine-chat-agent")
anthropic_secret = modal.Secret.from_name("anthropic-api-key")
supabase_secret = modal.Secret.from_name("policyengine-chat-supabase")
logfire_secret = modal.Secret.from_name("logfire")


SYSTEM_PROMPT = """You are a PolicyEngine assistant that helps users understand tax and benefit policies.

You have access to the full PolicyEngine API.

## CRITICAL: Always filter by country

When searching for parameters or datasets, ALWAYS include tax_benefit_model_name:
- "policyengine-uk" for UK questions
- "policyengine-us" for US questions

Parameters and datasets from both countries are in the same database. Without the filter, you'll get mixed results and waste turns finding the right ones.

## Key workflows

1. **Household calculations**:
   - POST /household/calculate with model_name and people array
   - Poll GET /household/calculate/{job_id} until completed

2. **Parameter lookup**:
   - GET /parameters/?search=...&tax_benefit_model_name=policyengine-uk (ALWAYS include country filter)
   - GET /parameter-values/?parameter_id=...&current=true for the current value
   - IMPORTANT: Parameter values are returned in REVERSE chronological order (most recent FIRST). The first value in the list is the current/active value.

3. **Economic impact analysis** (budget impact, decile impacts):
   - GET /parameters/?search=...&tax_benefit_model_name=policyengine-uk to find parameter_id
   - POST /policies/ to create reform with parameter_values
   - GET /datasets/?tax_benefit_model_name=policyengine-uk to find dataset_id
   - POST /analysis/economic-impact with tax_benefit_model_name, policy_id and dataset_id
   - GET /analysis/economic-impact/{report_id} for results (includes decile_impacts and program_statistics)

## PolicyEngine writing style

Follow these principles strictly:

### 1. Active voice
Use active constructions, not passive.
- ✓ "The reform reduces poverty by 3.2%"
- ✗ "Poverty is reduced by 3.2% by the reform"

### 2. Quantitative precision
Use specific numbers. Never use vague modifiers.
- ✓ "Costs the state $245 million"
- ✓ "Benefits 77% of Montana residents"
- ✓ "Lowers poverty by 0.8 percentage points"
- ✗ "Significantly costs the state"
- ✗ "Benefits most residents"
- ✗ "Greatly lowers poverty"

### 3. Sentence case for headings
Capitalise only the first word and proper nouns.
- ✓ "Tax breakdown"
- ✓ "Household impacts"
- ✗ "Tax Breakdown"
- ✗ "Household Impacts"

### 4. Neutral, objective tone (CRITICAL)
Describe what policies do without value judgments. Let users draw their own conclusions.
- ✓ "The reform reduces poverty by 3.2% and raises inequality by 0.16%"
- ✓ "The top income decile receives 42% of total benefits"
- ✗ "The reform successfully reduces poverty"
- ✗ "Unfortunately, inequality rises"
- ✗ "The wealthiest households receive a disproportionate share"

Never use words like: unfortunately, fortunately, successful, failed, good, bad, fair, unfair, disproportionate, deserving, concerning, alarming, encouraging, disappointing

### 5. Precise verbs over adverbs
- ✓ "The bill lowers the top rate from 5.9% to 5.4%"
- ✗ "The bill significantly changes the top rate"

### 6. Tables for data
Present breakdowns and comparisons in markdown tables:

| Item | Amount |
|------|--------|
| Income tax | £7,486 |
| National Insurance | £2,994 |
| **Total tax** | **£10,480** |

### 7. Concrete examples with specific numbers
- ✓ "A single parent of two with £50,000 income sees a £252 increase"
- ✗ "Families with children benefit substantially"

## Response format

Lead with key numbers, then provide detail:

**Summary**: Net income of £39,520 after £10,480 in taxes (21.0% effective rate)

| Component | Amount |
|-----------|--------|
| Gross income | £50,000 |
| Income tax | -£7,486 |
| National Insurance | -£2,994 |
| **Net income** | **£39,520** |

## CRITICAL: Never hallucinate IDs or values

**NEVER make up or guess IDs.** You must ALWAYS call the API to get real IDs:
- Before using a simulation_id, call GET /simulations/ to list them
- Before using a policy_id, call GET /policies/ or create one with POST /policies/
- Before using a dataset_id, call GET /datasets/ to find it
- Before using a parameter_id, call GET /parameters/ to search for it

If you don't have an ID, you MUST call the relevant list/search endpoint first. Making up UUIDs will cause errors and waste the user's time.

## Guidelines

1. Use the API tools to get accurate, current data - NEVER guess or make up values
2. Be concise - lead with key numbers
3. For UK, amounts are in GBP (£). For US, amounts are in USD ($)
4. When polling async endpoints, use the sleep tool to wait 5-10 seconds between requests
5. ALWAYS maintain policy neutrality - describe impacts, never evaluate them
"""

SLEEP_TOOL = {
    "name": "sleep",
    "description": "Wait for a specified number of seconds. Use this between polling requests to avoid hammering the API.",
    "input_schema": {
        "type": "object",
        "properties": {
            "seconds": {
                "type": "number",
                "description": "Number of seconds to sleep (1-60)",
            }
        },
        "required": ["seconds"],
    },
}


def fetch_openapi_spec(api_base_url: str) -> dict:
    """Fetch and cache OpenAPI spec."""
    resp = requests.get(f"{api_base_url}/openapi.json", timeout=30)
    resp.raise_for_status()
    return resp.json()


def resolve_ref(spec: dict, ref: str) -> dict:
    """Resolve a $ref pointer in the OpenAPI spec."""
    if not ref.startswith("#/"):
        return {}
    parts = ref[2:].split("/")
    result = spec
    for part in parts:
        result = result.get(part, {})
    return result


def schema_to_json_schema(spec: dict, schema: dict) -> dict:
    """Convert OpenAPI schema to JSON Schema for Claude tools."""
    if "$ref" in schema:
        schema = resolve_ref(spec, schema["$ref"])

    result = {}

    if "type" in schema:
        result["type"] = schema["type"]
    if "description" in schema:
        result["description"] = schema["description"]
    if "enum" in schema:
        result["enum"] = schema["enum"]
    if "default" in schema:
        result["default"] = schema["default"]
    if "format" in schema:
        fmt = schema["format"]
        if "description" in result:
            result["description"] += f" (format: {fmt})"
        else:
            result["description"] = f"Format: {fmt}"

    if "anyOf" in schema:
        non_null = [s for s in schema["anyOf"] if s.get("type") != "null"]
        if len(non_null) == 1:
            result.update(schema_to_json_schema(spec, non_null[0]))
        elif non_null:
            result.update(schema_to_json_schema(spec, non_null[0]))

    if "allOf" in schema:
        for sub in schema["allOf"]:
            result.update(schema_to_json_schema(spec, sub))

    if schema.get("type") == "object" or "properties" in schema:
        result["type"] = "object"
        if "properties" in schema:
            result["properties"] = {}
            for prop_name, prop_schema in schema["properties"].items():
                result["properties"][prop_name] = schema_to_json_schema(
                    spec, prop_schema
                )
        if "required" in schema:
            result["required"] = schema["required"]

    if schema.get("type") == "array" and "items" in schema:
        result["items"] = schema_to_json_schema(spec, schema["items"])

    return result


def openapi_to_claude_tools(spec: dict) -> list[dict]:
    """Convert OpenAPI spec to Claude tool definitions."""
    tools = []

    for path, methods in spec.get("paths", {}).items():
        for method, operation in methods.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue

            op_id = operation.get("operationId", f"{method}_{path}")
            tool_name = re.sub(r"[^a-zA-Z0-9_]", "_", op_id)
            tool_name = re.sub(r"_+", "_", tool_name).strip("_")

            summary = operation.get("summary", "")
            description = operation.get("description", "")
            full_desc = f"{method.upper()} {path}"
            if summary:
                full_desc += f"\n\n{summary}"
            if description:
                full_desc += f"\n\n{description}"

            properties = {}
            required = []

            for param in operation.get("parameters", []):
                param_name = param.get("name")
                param_in = param.get("in")
                param_schema = param.get("schema", {})
                param_required = param.get("required", False)

                prop = schema_to_json_schema(spec, param_schema)
                prop["description"] = (
                    param.get("description", "")
                    + f" (in: {param_in})"
                )
                properties[param_name] = prop

                if param_required:
                    required.append(param_name)

            request_body = operation.get("requestBody", {})
            if request_body:
                content = request_body.get("content", {})
                json_content = content.get("application/json", {})
                body_schema = json_content.get("schema", {})

                if body_schema:
                    resolved = schema_to_json_schema(spec, body_schema)
                    if "properties" in resolved:
                        for prop_name, prop_schema in resolved["properties"].items():
                            properties[prop_name] = prop_schema
                        if "required" in resolved:
                            required.extend(resolved["required"])
                    else:
                        properties["body"] = resolved
                        if request_body.get("required"):
                            required.append("body")

            input_schema = {"type": "object", "properties": properties}
            if required:
                input_schema["required"] = list(set(required))

            tools.append({
                "name": tool_name,
                "description": full_desc[:1024],
                "input_schema": input_schema,
                "_meta": {
                    "path": path,
                    "method": method,
                    "parameters": operation.get("parameters", []),
                },
            })

    return tools


def execute_api_tool(
    tool: dict,
    tool_input: dict,
    api_base_url: str,
    log_fn: Callable,
) -> str:
    """Execute an API tool by making the HTTP request."""
    meta = tool.get("_meta", {})
    path = meta.get("path", "")
    method = meta.get("method", "get")
    parameters = meta.get("parameters", [])

    url = f"{api_base_url}{path}"
    query_params = {}
    headers = {"Content-Type": "application/json"}

    body_data = {}
    for param in parameters:
        param_name = param.get("name")
        param_in = param.get("in")
        value = tool_input.get(param_name)

        if value is None:
            continue

        if param_in == "path":
            url = url.replace(f"{{{param_name}}}", str(value))
        elif param_in == "query":
            query_params[param_name] = value
        elif param_in == "header":
            headers[param_name] = str(value)

    param_names = {p.get("name") for p in parameters}
    for key, value in tool_input.items():
        if key not in param_names:
            body_data[key] = value

    # If body_data only has a "body" key with a list, send just the list
    if list(body_data.keys()) == ["body"] and isinstance(body_data["body"], list):
        body_data = body_data["body"]

    try:
        log_fn(f"[API] {method.upper()} {url}")
        if query_params:
            log_fn(f"[API] Query: {json.dumps(query_params)[:200]}")
        if body_data:
            log_fn(f"[API] Body: {json.dumps(body_data)[:200]}")

        if method == "get":
            resp = requests.get(url, params=query_params, headers=headers, timeout=60)
        elif method == "post":
            resp = requests.post(
                url, params=query_params, json=body_data, headers=headers, timeout=60
            )
        elif method == "put":
            resp = requests.put(
                url, params=query_params, json=body_data, headers=headers, timeout=60
            )
        elif method == "patch":
            resp = requests.patch(
                url, params=query_params, json=body_data, headers=headers, timeout=60
            )
        elif method == "delete":
            resp = requests.delete(url, params=query_params, headers=headers, timeout=60)
        else:
            return f"Unsupported method: {method}"

        log_fn(f"[API] Response: {resp.status_code}")

        if resp.status_code >= 400:
            return f"Error {resp.status_code}: {resp.text[:500]}"

        try:
            data = resp.json()
            if isinstance(data, list) and len(data) > 50:
                result = json.dumps(data[:50], indent=2)
                result += f"\n... ({len(data) - 50} more items)"
            else:
                result = json.dumps(data, indent=2)
            return result
        except json.JSONDecodeError:
            return resp.text[:1000]

    except requests.RequestException as e:
        return f"Request error: {str(e)}"


@app.function(image=image, secrets=[anthropic_secret, supabase_secret, logfire_secret], timeout=600)
def run_agent(
    question: str,
    thread_id: str,
    api_base_url: str = "https://v2.api.policyengine.org",
    history: list[dict] | None = None,
    max_turns: int = 30,
    user_id: str | None = None,
) -> dict:
    """Run agentic loop to answer a policy question.

    Stores logs in Supabase agent_logs table and final result as a message.
    """
    import logfire

    # Configure logfire for token tracking
    logfire.configure()

    # Connect to Supabase
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_KEY"]
    supabase = create_client(supabase_url, supabase_key)

    def log(msg: str) -> None:
        print(msg)
        try:
            supabase.table("agent_logs").insert({
                "thread_id": thread_id,
                "message": msg,
            }).execute()
        except Exception as e:
            print(f"Failed to log to Supabase: {e}")

    log(f"[AGENT] Starting: {question[:200]}")

    # Fetch and convert OpenAPI spec to tools
    log("[AGENT] Fetching OpenAPI spec...")
    spec = fetch_openapi_spec(api_base_url)
    tools = openapi_to_claude_tools(spec)
    log(f"[AGENT] Loaded {len(tools)} API tools")

    tool_lookup = {t["name"]: t for t in tools}

    claude_tools = [
        {k: v for k, v in t.items() if k != "_meta"} for t in tools
    ]
    claude_tools.append(SLEEP_TOOL)

    client = anthropic.Anthropic()
    logfire.instrument_anthropic(client)

    messages = []
    if history:
        for msg in history:
            messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": question})

    final_response = None
    turns = 0
    total_input_tokens = 0
    total_output_tokens = 0

    with logfire.span("agent_conversation", thread_id=thread_id, user_id=user_id or "anonymous"):
        while turns < max_turns:
            turns += 1
            log(f"[AGENT] Turn {turns}")

            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=claude_tools,
                messages=messages,
            )

            # Track token usage
            total_input_tokens += response.usage.input_tokens
            total_output_tokens += response.usage.output_tokens

            log(f"[AGENT] Stop reason: {response.stop_reason}")

            assistant_content = []
            tool_results = []

            for block in response.content:
                if block.type == "text":
                    log(f"[ASSISTANT] {block.text[:500]}")
                    assistant_content.append(block)
                    final_response = block.text
                elif block.type == "tool_use":
                    log(f"[TOOL_USE] {block.name}: {json.dumps(block.input)[:200]}")
                    assistant_content.append(block)

                    if block.name == "sleep":
                        seconds = min(max(block.input.get("seconds", 5), 1), 60)
                        log(f"[SLEEP] Waiting {seconds} seconds...")
                        time.sleep(seconds)
                        result = f"Slept for {seconds} seconds"
                    else:
                        tool = tool_lookup.get(block.name)
                        if tool:
                            result = execute_api_tool(tool, block.input, api_base_url, log)
                        else:
                            result = f"Unknown tool: {block.name}"

                    log(f"[TOOL_RESULT] {result[:5000]}")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            messages.append({"role": "assistant", "content": assistant_content})

            if tool_results:
                messages.append({"role": "user", "content": tool_results})
            else:
                break

    log(f"[AGENT] Completed in {turns} turns, {total_input_tokens} input tokens, {total_output_tokens} output tokens")

    # Calculate cost (Claude Sonnet pricing: $3/1M input, $15/1M output)
    input_cost = (total_input_tokens / 1_000_000) * 3
    output_cost = (total_output_tokens / 1_000_000) * 15
    total_cost = input_cost + output_cost

    # Update thread with token usage
    try:
        # Get current token counts
        thread_data = supabase.table("threads").select("input_tokens, output_tokens").eq("id", thread_id).single().execute()
        current_input = thread_data.data.get("input_tokens") or 0
        current_output = thread_data.data.get("output_tokens") or 0

        supabase.table("threads").update({
            "input_tokens": current_input + total_input_tokens,
            "output_tokens": current_output + total_output_tokens,
        }).eq("id", thread_id).execute()
    except Exception as e:
        print(f"Failed to update token counts: {e}")

    # Save the assistant message to Supabase
    if final_response:
        try:
            supabase.table("messages").insert({
                "thread_id": thread_id,
                "role": "assistant",
                "content": final_response,
            }).execute()
        except Exception as e:
            print(f"Failed to save message: {e}")

        # Generate a title for the thread
        try:
            title_response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=50,
                messages=[
                    {"role": "user", "content": question},
                    {"role": "assistant", "content": final_response},
                    {"role": "user", "content": "Generate a short title (max 6 words) for this conversation in sentence case (only capitalise first word and proper nouns). Reply with just the title, no quotes or punctuation."},
                ],
            )
            title = title_response.content[0].text.strip()[:60]
            supabase.table("threads").update({"title": title}).eq("id", thread_id).execute()
            log(f"[AGENT] Set title: {title}")
        except Exception as e:
            print(f"Failed to set title: {e}")

    return {
        "status": "completed",
        "answer": final_response,
        "turns": turns,
    }


from fastapi import Request
from pydantic import BaseModel


class AgentRequest(BaseModel):
    question: str
    thread_id: str
    api_base_url: str = "https://v2.api.policyengine.org"
    history: list[dict] | None = None
    user_id: str | None = None


@app.function(image=image, secrets=[anthropic_secret, supabase_secret, logfire_secret], timeout=600)
@modal.web_endpoint(method="POST")
def run_agent_web(request: AgentRequest) -> dict:
    """Web endpoint wrapper for run_agent."""
    return run_agent.local(
        question=request.question,
        thread_id=request.thread_id,
        api_base_url=request.api_base_url,
        history=request.history,
        user_id=request.user_id,
    )


if __name__ == "__main__":
    import sys

    question = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "What is the UK personal allowance amount?"
    )
    print(f"Question: {question}\n")
    # For local testing, set env vars
    result = run_agent.local(question, thread_id="test")
    print(f"\nResult: {result}")
