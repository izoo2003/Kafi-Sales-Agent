"""LLM client stub — replace with Gemini/Claude/etc. when ready."""

from typing import Any


class LLMClient:
    """Centralized LLM interface. Not wired up yet."""

    def generate(self, prompt: str, *, system: str | None = None) -> str:
        raise NotImplementedError(
            "LLM is not configured. Use rule-based module outputs or enable an LLM provider."
        )

    def generate_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        raise NotImplementedError("LLM is not configured.")


llm_client = LLMClient()
