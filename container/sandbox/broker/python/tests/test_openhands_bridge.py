from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import openhands_bridge


class MessageEvent:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def model_dump(self) -> dict[str, object]:
        return self._payload


class JsonlVisualizerTests(unittest.TestCase):
    def test_emits_chunk_for_nested_agent_message_text(self) -> None:
        output = io.StringIO()
        original_stdout = openhands_bridge.ORIGINAL_STDOUT
        openhands_bridge.ORIGINAL_STDOUT = output
        try:
            visualizer = openhands_bridge.JsonlVisualizer()
            visualizer.on_event(
                MessageEvent(
                    {
                        "source": "agent",
                        "llm_message": {
                            "role": "assistant",
                            "content": [
                                {"type": "text", "text": "The headline uses Inter."},
                            ],
                        },
                    }
                )
            )
        finally:
            openhands_bridge.ORIGINAL_STDOUT = original_stdout

        line = output.getvalue()
        self.assertTrue(line)
        self.assertEqual(
            json.loads(line),
            {"type": "chunk", "delta": "The headline uses Inter."},
        )


class AgentContextTests(unittest.TestCase):
    def test_loads_agents_skills_before_legacy_openhands_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)
            modern_dir = workspace / ".agents" / "skills" / "modern"
            legacy_dir = workspace / ".openhands" / "skills"
            modern_dir.mkdir(parents=True)
            legacy_dir.mkdir(parents=True)
            (modern_dir / "SKILL.md").write_text("---\nname: modern\n---\n", encoding="utf-8")
            (legacy_dir / "legacy.md").write_text("# Legacy\n", encoding="utf-8")
            visited: list[str] = []

            class AgentContext:
                def __init__(self, skills: list[str]) -> None:
                    self.skills = skills

            def load_skills_from_dir(path: str) -> list[str]:
                relative_path = str(Path(path).relative_to(workspace))
                visited.append(relative_path)
                return [relative_path]

            mod = SimpleNamespace(
                AgentContext=AgentContext,
                load_installed_skills=None,
                load_project_skills=None,
                load_skills_from_dir=load_skills_from_dir,
            )

            context = openhands_bridge.load_agent_context(mod, workspace)

            self.assertIsNotNone(context)
            self.assertEqual(visited, [".agents/skills", ".openhands/skills"])
            self.assertEqual(context.skills, [".agents/skills", ".openhands/skills"])


if __name__ == "__main__":
    unittest.main()
