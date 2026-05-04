from __future__ import annotations

import io
import json
import unittest

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


if __name__ == "__main__":
    unittest.main()
