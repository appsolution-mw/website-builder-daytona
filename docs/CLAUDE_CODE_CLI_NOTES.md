# Claude Code CLI Notes

Captured 2026-04-22. Reference for Phase 1.2 Tasks 5-7.

---

## 1. Package + Version

| Field | Value |
|-------|-------|
| npm package name | `@anthropic-ai/claude-code` |
| Installed version (binary) | `2.1.116` |
| Latest on npm registry | `2.1.117` (at time of capture) |
| Binary path | `/Users/michaelwalter/.local/bin/claude` → symlink to `/Users/michaelwalter/.local/share/claude/versions/2.1.116` |

The CLI self-updates independently of npm; versions may differ between npm registry and local install.

---

## 2. Install Command

```bash
npm install -g @anthropic-ai/claude-code
```

**Authentication note**: This user's installation authenticates via Claude.ai OAuth (Claude Max subscription), NOT via `ANTHROPIC_API_KEY`. The credentials live in `~/.claude/.credentials.json` under the `claudeAiOauth` key. For container/sandbox use, `ANTHROPIC_API_KEY` in `--bare` mode is the correct approach (see section 7).

The project `.env` file does **not** contain `ANTHROPIC_API_KEY`. The CLI works because of OAuth credentials established interactively.

---

## 3. Verified Flags

All flags verified against `claude --help` output from v2.1.116:

| Flag | Purpose | Plan Expected? | Status |
|------|---------|---------------|--------|
| `--print` / `-p` | Non-interactive mode, print and exit | Yes | PRESENT |
| `--output-format <format>` | Output format: `text`, `json`, `stream-json` | Yes | PRESENT |
| `--session-id <uuid>` | Use a specific session UUID | Yes | PRESENT — must be valid UUID format |
| `--max-turns <n>` | Limit conversation turns | Yes | **ABSENT** — not a flag in v2.1.116 |
| `--model <model>` | Set model (alias or full name) | Yes | PRESENT — accepts `sonnet`, `opus`, or full ID |
| `--dangerously-skip-permissions` | Bypass all permission checks | Yes | PRESENT |

**Key deviation**: `--max-turns` does not exist. There is no direct equivalent. Use `--max-budget-usd` to bound cost instead, or rely on `--print` mode which naturally terminates after one exchange (though the agent may do multi-turn internally via agentic loops).

Additional flags of note for Tasks 5-7:
- `--bare`: Strips hooks, LSP, plugins. Auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper`. Correct for container use.
- `--no-session-persistence`: Sessions not saved to disk. Useful for isolated runs.
- `--verbose`: Verbose output (required to get full stream including `system` events in our capture).
- `--include-hook-events`: Include hook lifecycle events in stream-json output.
- `--input-format stream-json`: Accept streaming NDJSON on stdin.

---

## 4. NDJSON Event Shapes

19 lines captured from a 3-turn "change hello to hi" task. Distinct `type` values observed:

### `system` (subtype: `hook_started`)
Fired before hooks run. Multiple per session start.
```json
{
  "type": "system",
  "subtype": "hook_started",
  "hook_id": "57645431-ada0-4617-8ab6-6a88a5861bae",
  "hook_name": "SessionStart:startup",
  "hook_event": "SessionStart",
  "uuid": "e6cb7523-fdc2-4da2-9fa9-37bc554e784a",
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba"
}
```

### `system` (subtype: `hook_response`)
Fired after each hook completes. Contains stdout/stderr/exit_code.
```json
{
  "type": "system",
  "subtype": "hook_response",
  "hook_id": "3577feae-20d8-4b80-b7d3-85f9f874d9c2",
  "hook_name": "SessionStart:startup",
  "hook_event": "SessionStart",
  "output": "",
  "stdout": "",
  "stderr": "",
  "exit_code": 0,
  "outcome": "success",
  "uuid": "b11f81c2-bb60-4d6f-9dcb-2f14d62ab359",
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba"
}
```

### `system` (subtype: `init`)
**One per session**. Contains full session metadata: cwd, tools list, MCP servers, model, permissionMode, slash_commands, agents, skills, plugins, version.
```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/workspace/project",
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba",
  "tools": ["Task", "Bash", "Edit", "Read", "Write", "..."],
  "mcp_servers": [{"name": "plugin:context7:context7", "status": "connected"}],
  "model": "claude-opus-4-7[1m]",
  "permissionMode": "bypassPermissions",
  "slash_commands": ["..."],
  "apiKeySource": "none",
  "claude_code_version": "2.1.116",
  "output_style": "default",
  "agents": ["..."],
  "uuid": "fefba003-330f-49af-b2fa-ca1a0eb5819e"
}
```

### `assistant` (with `thinking` content)
Extended thinking block. Observed before tool use decisions.
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-7",
    "id": "msg_01DnAynQ8QrKfjTfVoSq2osz",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "thinking",
        "thinking": "",
        "signature": "EvoBClkIDBgC..."
      }
    ],
    "stop_reason": null,
    "stop_sequence": null,
    "stop_details": null,
    "usage": {
      "input_tokens": 6,
      "cache_creation_input_tokens": 45146,
      "cache_read_input_tokens": 0,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 45146
      },
      "output_tokens": 0,
      "service_tier": "standard",
      "inference_geo": "not_available"
    },
    "context_management": null
  },
  "parent_tool_use_id": null,
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba",
  "uuid": "da8533be-958e-4d32-ae2f-e92fe145fe1f"
}
```

### `assistant` (with `tool_use` content)
Tool call request. `content[0].type === "tool_use"`.
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-7",
    "id": "msg_01DnAynQ8QrKfjTfVoSq2osz",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01WGxMuj5Rm1DhR38BnvrUBh",
        "name": "Read",
        "input": {"file_path": "/workspace/project/hello.txt"},
        "caller": {"type": "direct"}
      }
    ],
    "stop_reason": null,
    "usage": {"input_tokens": 6, "cache_creation_input_tokens": 45146, "output_tokens": 0}
  },
  "parent_tool_use_id": null,
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba",
  "uuid": "26d68c6f-bce6-477f-87c7-efd897f4abde"
}
```

### `assistant` (with `text` content)
Final text response. `content[0].type === "text"`.
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-7",
    "id": "msg_01644rooqt1DDDWS2JwogSgW",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "Changed `hello` to `hi` in hello.txt."
      }
    ],
    "stop_reason": null,
    "usage": {"input_tokens": 1, "cache_creation_input_tokens": 817, "cache_read_input_tokens": 45293, "output_tokens": 2}
  },
  "parent_tool_use_id": null,
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba",
  "uuid": "9b0b75ac-c5fd-4c6d-bf98-77fee943d636"
}
```

### `user` (tool result)
Tool execution result returned to model.
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_01WGxMuj5Rm1DhR38BnvrUBh",
        "type": "tool_result",
        "content": "1\thello\n2\t"
      }
    ]
  },
  "parent_tool_use_id": null,
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba",
  "uuid": "aa1b15c0-5d48-4251-967a-d86ff65dd428",
  "timestamp": "2026-04-22T08:40:36.481Z",
  "tool_use_result": {
    "type": "text",
    "file": {
      "filePath": "/workspace/project/hello.txt",
      "content": "hello\n",
      "numLines": 2,
      "startLine": 1,
      "totalLines": 2
    }
  }
}
```

### `rate_limit_event`
Rate limit status event. Appears mid-stream.
```json
{
  "type": "rate_limit_event",
  "rate_limit_info": {
    "status": "allowed",
    "resetsAt": 1776862800,
    "rateLimitType": "five_hour",
    "overageStatus": "rejected",
    "overageDisabledReason": "org_level_disabled",
    "isUsingOverage": false
  },
  "uuid": "7e11cebf-9ca8-4074-b5d2-4fa921b9817e",
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba"
}
```

### `result` (final event)
**Always the last line**. Contains full run summary.
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "api_error_status": null,
  "duration_ms": 7764,
  "duration_api_ms": 7078,
  "num_turns": 3,
  "result": "Changed `hello` to `hi` in hello.txt.",
  "stop_reason": "end_turn",
  "session_id": "846f31a4-52b3-4925-b729-c2fc43530cba",
  "total_cost_usd": 0.340447,
  "usage": {
    "input_tokens": 8,
    "cache_creation_input_tokens": 46110,
    "cache_read_input_tokens": 90439,
    "output_tokens": 280,
    "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0},
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 46110,
      "ephemeral_5m_input_tokens": 0
    }
  },
  "modelUsage": {
    "claude-opus-4-7[1m]": {
      "inputTokens": 8,
      "outputTokens": 280,
      "cacheReadInputTokens": 90439,
      "cacheCreationInputTokens": 46110,
      "webSearchRequests": 0,
      "costUSD": 0.340447,
      "contextWindow": 1000000,
      "maxOutputTokens": 64000
    }
  },
  "permission_denials": [],
  "terminal_reason": "completed",
  "fast_mode_state": "off",
  "uuid": "b1fff429-da02-4865-843d-48a019592ebe"
}
```

---

## 5. Model Identifier for Sonnet 4.6

This capture used **Opus 4.7** (OAuth default picks the most capable model in the subscription). The model is reported as `"claude-opus-4-7"` in `assistant.message.model`, and as `"claude-opus-4-7[1m]"` in the `init` event and `result.modelUsage` key (the `[1m]` suffix denotes the 1M-context variant).

To target Sonnet 4.6 specifically:
```bash
claude --model claude-sonnet-4-6 --print "..." --output-format stream-json ...
```

The `--model` flag accepts:
- Short alias: `sonnet`, `opus`, `haiku`
- Full model ID: `claude-sonnet-4-6`, `claude-opus-4-7`, etc.

The model string in NDJSON `assistant` events will be the resolved full ID (e.g. `claude-sonnet-4-6`), not the alias.

---

## 6. Deviations from Spec Assumptions

### `assistant` event content array shape

**CONFIRMED** with one deviation:

- `[{type:"text", text}]` — YES, observed in final reply event
- `[{type:"tool_use", name, input}]` — YES, observed (also has `id` and `caller` fields)
- `[{type:"thinking", thinking, signature}]` — **EXTRA, NOT IN SPEC** — extended thinking blocks appear as a separate assistant event before the tool_use event. The `thinking` string is empty in the stream (redacted), but the `signature` is present.

**Important**: Multiple `assistant` events are emitted per LLM call. The same `message.id` may appear across consecutive events (e.g. first a thinking event, then a tool_use event with the same `msg_*` ID). Tasks 5-7 must handle this: group by `message.id` or treat each event independently.

### `result` event fields

| Field | In spec? | Observed? | Notes |
|-------|---------|----------|-------|
| `duration_ms` | Yes | YES | 7764 in sample |
| `subtype` | Yes | YES | `"success"` |
| `usage.input_tokens` | Yes | YES | `8` (total) |
| `usage.output_tokens` | Yes | YES | `280` (total) |
| `total_cost_usd` | Yes | YES | `0.340447` |
| `duration_api_ms` | No | YES | API-only time |
| `num_turns` | No | YES | `3` |
| `modelUsage` | No | YES | Per-model breakdown |
| `permission_denials` | No | YES | Array, empty if none |
| `terminal_reason` | No | YES | `"completed"` |

### `system` event with `subtype: "init"`

**CONFIRMED** — exists at line 11 in fixture. Contains `cwd`, `tools`, `mcp_servers`, `model`, `permissionMode`, `claude_code_version`, etc.

**Important**: In production (with `--bare` and no hooks), the hook_started/hook_response events will be absent. The `init` event will remain. When running with `--bare`, `mcp_servers` will be empty and `apiKeySource` will be `"anthropic_api_key"` (not `"none"`).

### `--session-id` flag

**CONFIRMED** — exists. Must be a valid UUID v4 format (e.g. `846f31a4-52b3-4925-b729-c2fc43530cba`). The CLI validates format; passing a non-UUID will error.

### Hook events in stream

When running without `--include-hook-events`, hook events (`hook_started`, `hook_response`) still appear in the `stream-json` output if `--verbose` is set. This fixture was captured with `--verbose`. Without `--verbose`, behavior may differ.

For container use with `--bare`, hooks are skipped entirely — no hook events in stream.

---

## 7. Model Flag Status

`--model <name>` **WORKS**. Verified in help output:

```
--model <model>   Model for the current session. Provide an alias for the latest model
                  (e.g. 'sonnet' or 'opus') or a model's full name (e.g. 'claude-sonnet-4-6').
```

Usage for Tasks 5-7:
```bash
claude \
  --print "your prompt here" \
  --output-format stream-json \
  --model claude-sonnet-4-6 \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --bare
```

Note: `--bare` disables OAuth; requires `ANTHROPIC_API_KEY` env var in container context.

---

## Summary for Tasks 5-7

1. **No `--max-turns`** — remove from any code that assumes it exists
2. **Multiple assistant events per LLM call** — same `message.id`, different content blocks (thinking → tool_use, or thinking → text)
3. **`assistant.message.stop_reason` is `null` mid-stream** — only the final text event will have `stop_reason: "end_turn"` (or similar)
4. **Rate limit events** (`rate_limit_event`) may appear mid-stream — parsers must handle unknown types gracefully
5. **`result.usage` is aggregate** — per-iteration breakdown is in `result.usage.iterations[]`
6. **Model string format**: `"claude-opus-4-7"` in `assistant.message.model`, `"claude-opus-4-7[1m]"` as `modelUsage` key
7. **Auth for containers**: use `ANTHROPIC_API_KEY` + `--bare` flag, not OAuth
8. **`system.init` always present** — good sentinel to detect session start in stream parsers
