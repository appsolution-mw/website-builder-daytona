#!/usr/bin/env python3
"""JSONL bridge between the TypeScript broker and OpenHands SDK."""

from __future__ import annotations

import argparse
import inspect
import json
import os
import sys
import time
import warnings
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from typing import Any

os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")
warnings.filterwarnings("ignore", message=r".*authlib\.jose module is deprecated.*")
try:
    from authlib.common.errors import AuthlibDeprecationWarning

    warnings.filterwarnings("ignore", category=AuthlibDeprecationWarning)
except Exception:
    pass

ORIGINAL_STDOUT = sys.stdout


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), file=ORIGINAL_STDOUT, flush=True)


def load_openhands() -> SimpleNamespace:
    from openhands.sdk import Agent, AgentContext, Conversation, LLM, Tool

    try:
        from openhands.sdk.llm import ImageContent, Message, TextContent
    except Exception:
        ImageContent = None
        Message = None
        TextContent = None

    try:
        from openhands.sdk.conversation import ConversationVisualizerBase
    except Exception:
        ConversationVisualizerBase = object

    try:
        from openhands.sdk.skills import load_project_skills, load_skills_from_dir
    except Exception:
        load_project_skills = None
        load_skills_from_dir = None

    try:
        from openhands.sdk.skills import load_installed_skills
    except Exception:
        load_installed_skills = None

    try:
        from openhands.sdk.subagent import register_file_agents
    except Exception:
        register_file_agents = None

    try:
        from openhands.sdk.tool import register_tool
    except Exception:
        register_tool = None

    try:
        from openhands.tools.delegate import DelegateTool
    except Exception:
        DelegateTool = None

    try:
        from openhands.tools.file_editor import FileEditorTool
    except Exception:
        FileEditorTool = None

    try:
        from openhands.tools.preset.default import register_builtins_agents
    except Exception:
        register_builtins_agents = None

    try:
        from openhands.tools.task_tracker import TaskTrackerTool
    except Exception:
        TaskTrackerTool = None

    try:
        from openhands.tools.terminal import TerminalTool
    except Exception:
        TerminalTool = None

    return SimpleNamespace(
        Agent=Agent,
        AgentContext=AgentContext,
        Conversation=Conversation,
        ConversationVisualizerBase=ConversationVisualizerBase,
        DelegateTool=DelegateTool,
        FileEditorTool=FileEditorTool,
        LLM=LLM,
        ImageContent=ImageContent,
        Message=Message,
        TaskTrackerTool=TaskTrackerTool,
        TextContent=TextContent,
        TerminalTool=TerminalTool,
        Tool=Tool,
        load_installed_skills=load_installed_skills,
        load_project_skills=load_project_skills,
        load_skills_from_dir=load_skills_from_dir,
        register_builtins_agents=register_builtins_agents,
        register_file_agents=register_file_agents,
        register_tool=register_tool,
    )


def compact_string(value: Any, limit: int = 1200) -> str:
    text = value if isinstance(value, str) else str(value)
    return text if len(text) <= limit else f"{text[:limit]}..."


def compact_payload(value: Any, depth: int = 0, limit: int = 1200) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return compact_string(value, limit)
    if depth >= 4:
        return compact_string(value, limit)
    if isinstance(value, dict):
        compacted: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= 24:
                compacted["..."] = f"{len(value) - index} more keys"
                break
            compacted[compact_string(key, 120)] = compact_payload(item, depth + 1, limit)
        return compacted
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        compacted_items = [compact_payload(item, depth + 1, limit) for item in items[:16]]
        if len(items) > 16:
            compacted_items.append(f"{len(items) - 16} more items")
        return compacted_items
    return compact_string(value, limit)


def public_attr(obj: Any, name: str) -> Any:
    try:
        return getattr(obj, name)
    except Exception:
        return None


def text_content(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value
    if isinstance(value, dict):
        for key in ("text", "content", "message"):
            text = text_content(value.get(key))
            if text:
                return text
        return ""
    if isinstance(value, (list, tuple)):
        parts = [text_content(item) for item in value]
        return "\n\n".join(part for part in parts if part)
    return ""


def event_dict(event: Any) -> dict[str, Any]:
    for method_name in ("model_dump", "dict"):
        method = public_attr(event, method_name)
        if callable(method):
            try:
                value = method()
                return value if isinstance(value, dict) else {}
            except Exception:
                pass
    return {}


def maybe_await(value: Any) -> Any:
    if not inspect.isawaitable(value):
        return value

    import asyncio

    return asyncio.run(value)


def instantiate(cls: Any, **kwargs: Any) -> Any:
    usable = {key: value for key, value in kwargs.items() if value is not None}
    try:
        signature = inspect.signature(cls)
    except (TypeError, ValueError):
        signature = None

    if signature is not None and not any(
        param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values()
    ):
        usable = {key: value for key, value in usable.items() if key in signature.parameters}

    try:
        return cls(**usable)
    except TypeError:
        minimal = {key: value for key, value in usable.items() if key in {"llm", "tools"}}
        return cls(**minimal)


class JsonlVisualizer:
    def __init__(self, name: str | None = None, agent_id: str | None = None) -> None:
        self.name = name
        self.agent_id = agent_id
        self._seen_chunks: set[str] = set()

    def initialize(self, state: Any) -> None:
        try:
            super().initialize(state)
            return
        except AttributeError:
            pass
        except Exception:
            pass
        self._state = state

    def create_sub_visualizer(self, agent_id: str) -> "JsonlVisualizer":
        return self.__class__(name=agent_id, agent_id=agent_id)

    def on_event(self, event: Any) -> None:
        record = compact_payload(event_dict(event))
        if not isinstance(record, dict):
            record = {}
        event_name = type(event).__name__

        if "Action" in event_name or public_attr(event, "tool_name") or record.get("tool_name"):
            tool_name = (
                public_attr(event, "tool_name")
                or record.get("tool_name")
                or record.get("tool")
                or record.get("action")
                or event_name
            )
            emit(
                {
                    "type": "tool",
                    "tool": compact_string(tool_name, 160),
                    "input": compact_payload(record or event),
                    **self._agent_fields(),
                }
            )
            return

        if "Error" in event_name:
            message = (
                public_attr(event, "error")
                or public_attr(event, "message")
                or record.get("error")
                or record.get("message")
                or compact_string(event)
            )
            emit({"type": "error", "message": compact_string(message), **self._agent_fields()})
            return

        text = self._extract_text(event, record)
        if text:
            key = f"{event_name}:{text}"
            if key not in self._seen_chunks:
                self._seen_chunks.add(key)
                emit({"type": "chunk", "delta": text, **self._agent_fields()})

    def _agent_fields(self) -> dict[str, str]:
        return {"agentId": self.agent_id} if self.agent_id else {}

    def _extract_text(self, event: Any, record: dict[str, Any]) -> str:
        for key in ("delta", "text", "content", "message", "thought"):
            value = record.get(key)
            if isinstance(value, str) and value.strip():
                return compact_string(value)
        for key in ("delta", "text", "content", "message", "thought"):
            value = public_attr(event, key)
            if isinstance(value, str) and value.strip():
                return compact_string(value)
        source = record.get("source")
        llm_message = record.get("llm_message")
        if isinstance(llm_message, dict):
            role = llm_message.get("role")
            if source == "agent" or role == "assistant":
                text = text_content(llm_message.get("content"))
                if text:
                    return compact_string(text)
        return ""


def append_skills(skills: list[Any], value: Any) -> None:
    if value is None:
        return
    if isinstance(value, dict):
        skills.extend(value.values())
        return
    if isinstance(value, (list, tuple, set)):
        skills.extend(value)
        return
    skills.append(value)


def load_project_skills_compat(loader: Any, workspace: Path) -> Any:
    for kwargs in ({"work_dir": str(workspace)}, None, {"workspace_dir": str(workspace)}):
        try:
            if kwargs is None:
                return loader(str(workspace))
            return loader(**kwargs)
        except TypeError:
            continue
    return None


def load_agent_context(mod: SimpleNamespace, workspace: Path) -> Any | None:
    skills: list[Any] = []

    if mod.load_project_skills is not None:
        try:
            append_skills(skills, load_project_skills_compat(mod.load_project_skills, workspace))
        except Exception:
            pass

    local_skills = workspace / ".openhands" / "skills"
    if local_skills.is_dir() and mod.load_skills_from_dir is not None:
        try:
            loaded = mod.load_skills_from_dir(str(local_skills))
            if isinstance(loaded, tuple):
                for group in loaded:
                    append_skills(skills, group)
            else:
                append_skills(skills, loaded)
        except Exception:
            pass

    if os.getenv("OPENHANDS_ENABLE_PUBLIC_SKILLS") == "1" and mod.load_installed_skills is not None:
        try:
            append_skills(skills, mod.load_installed_skills())
        except Exception:
            pass

    if not skills:
        return None

    try:
        return mod.AgentContext(skills=skills)
    except Exception:
        return None


def tool_name(tool_cls: Any, fallback: str) -> str:
    value = public_attr(tool_cls, "name")
    return value if isinstance(value, str) and value else fallback


def register_optional_agents(mod: SimpleNamespace, workspace: Path) -> None:
    if mod.register_file_agents is not None:
        try:
            mod.register_file_agents(str(workspace))
        except Exception:
            pass

    if mod.register_builtins_agents is not None:
        try:
            mod.register_builtins_agents(cli_mode=True)
        except TypeError:
            try:
                mod.register_builtins_agents()
            except Exception:
                pass
        except Exception:
            pass

    if mod.DelegateTool is not None and mod.register_tool is not None:
        try:
            mod.register_tool("DelegateTool", mod.DelegateTool)
        except Exception:
            try:
                mod.register_tool(tool_name(mod.DelegateTool, "DelegateTool"), mod.DelegateTool)
            except Exception:
                pass


def build_agent(mod: SimpleNamespace, llm: Any, workspace: Path) -> Any:
    register_optional_agents(mod, workspace)

    tools = [
        mod.Tool(name=tool_name(mod.TerminalTool, "TerminalTool")),
        mod.Tool(name=tool_name(mod.FileEditorTool, "FileEditorTool")),
        mod.Tool(name=tool_name(mod.TaskTrackerTool, "TaskTrackerTool")),
    ]
    if mod.DelegateTool is not None:
        tools.append(mod.Tool(name=tool_name(mod.DelegateTool, "DelegateTool")))

    return instantiate(
        mod.Agent,
        llm=llm,
        tools=tools,
        agent_context=load_agent_context(mod, workspace),
        max_iteration_per_run=positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
        max_iterations=positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
    )


def create_visualizer(mod: SimpleNamespace, name: str) -> JsonlVisualizer:
    base = mod.ConversationVisualizerBase
    if isinstance(base, type) and base is not object:
        try:
            class SdkJsonlVisualizer(JsonlVisualizer, base):
                pass

            return SdkJsonlVisualizer(name=name)
        except TypeError:
            pass
    return JsonlVisualizer(name=name)


def positive_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def metric_number(obj: Any, *names: str) -> float:
    for name in names:
        value = public_attr(obj, name)
        if isinstance(value, (int, float)):
            return float(value)
    return 0.0


def usage_payload(llm: Any, conversation: Any) -> dict[str, Any]:
    usage: dict[str, Any] = {}
    for source_name, source in (
        ("llm_metrics", public_attr(llm, "metrics")),
        ("conversation_stats", public_attr(conversation, "conversation_stats")),
    ):
        if source is None:
            continue
        dumped = event_dict(source)
        usage[source_name] = dumped if dumped else compact_string(source)
    return usage


def done_event(started_at: float, llm: Any, conversation: Any) -> dict[str, Any]:
    metrics = public_attr(llm, "metrics")
    stats = public_attr(conversation, "conversation_stats")
    combined = None
    get_combined = public_attr(stats, "get_combined_metrics")
    if callable(get_combined):
        try:
            combined = get_combined()
        except Exception:
            combined = None

    usage = usage_payload(llm, conversation)
    token_source = combined or metrics or stats
    tokens_in = int(metric_number(token_source, "prompt_tokens", "input_tokens", "tokens_in"))
    tokens_out = int(metric_number(token_source, "completion_tokens", "output_tokens", "tokens_out"))
    cost = metric_number(combined or metrics, "accumulated_cost", "cost", "cost_usd")

    return {
        "type": "done",
        "durationMs": int((time.monotonic() - started_at) * 1000),
        "tokensIn": tokens_in,
        "tokensOut": tokens_out,
        "costUsd": cost,
        **({"usage": usage} if usage else {}),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run an OpenHands turn and emit broker JSONL.")
    parser.add_argument("--session", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--attachments-manifest")
    return parser.parse_args()


def load_attachment_image_urls(path: str | None) -> list[str]:
    if not path:
        return []

    with Path(path).open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    image_urls = payload.get("imageUrls") if isinstance(payload, dict) else None
    if not isinstance(image_urls, list) or not all(isinstance(url, str) and url for url in image_urls):
        raise RuntimeError("OpenHands image attachment manifest is invalid.")
    return image_urls


def ensure_vision_enabled(llm: Any) -> None:
    vision_is_active = getattr(llm, "vision_is_active", None)
    if not callable(vision_is_active):
        raise RuntimeError(
            "Selected OpenHands model cannot confirm vision support for image attachments."
        )
    if not bool(maybe_await(vision_is_active())):
        raise RuntimeError(
            "Selected OpenHands model does not support vision; choose a vision-capable model for image attachments."
        )


def send_user_message(mod: SimpleNamespace, conversation: Any, llm: Any, prompt: str, image_urls: list[str]) -> None:
    if not image_urls:
        maybe_await(conversation.send_message(prompt))
        return

    if mod.Message is None or mod.TextContent is None or mod.ImageContent is None:
        raise RuntimeError("Installed OpenHands SDK does not support image input messages.")

    ensure_vision_enabled(llm)
    message = instantiate(
        mod.Message,
        role="user",
        content=[
            instantiate(mod.TextContent, text=prompt),
            instantiate(mod.ImageContent, image_urls=image_urls),
        ],
    )
    maybe_await(conversation.send_message(message))


def main() -> int:
    args = parse_args()
    started_at = time.monotonic()
    os.environ["LLM_MODEL"] = args.model

    try:
        emit({"type": "status", "phase": "starting", "detail": f"session {args.session}"})
        with redirect_stdout(sys.stderr):
            mod = load_openhands()
            workspace = Path(args.workspace)
            emit({"type": "status", "phase": "thinking", "detail": "initializing OpenHands"})

            llm = instantiate(
                mod.LLM,
                model=args.model,
                api_key=os.getenv("LLM_API_KEY"),
                base_url=os.getenv("LLM_BASE_URL") or None,
                usage_id=args.session,
            )
            agent = build_agent(mod, llm, workspace)
            conversation = instantiate(
                mod.Conversation,
                agent=agent,
                workspace=str(workspace),
                visualizer=create_visualizer(mod, "OpenHands"),
                max_iteration_per_run=positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
                max_iterations=positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
            )

            emit({"type": "status", "phase": "thinking", "detail": "running agent"})
            image_urls = load_attachment_image_urls(args.attachments_manifest)
            send_user_message(mod, conversation, llm, args.prompt, image_urls)
            maybe_await(conversation.run())
            emit(done_event(started_at, llm, conversation))
        return 0
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
