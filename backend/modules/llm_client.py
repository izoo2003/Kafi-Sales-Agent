"""LLM client — Google Gemini via the google-genai SDK.

Set GEMINI_API_KEY in backend/.env to enable. Falls back gracefully to
rule-based outputs when the key is absent or the SDK is unavailable.

Cost controls:
- Defaults to gemini-2.5-flash-lite (cheapest current text model).
- On rate-limit (429), tries cheaper fallback models on the SAME key.
- Caps max output tokens to keep responses short.

Model switching vs extra keys:
- Switching models: same key, often works when limits are per-model.
- Extra keys in the SAME project: do NOT add quota.
- Extra keys from DIFFERENT projects: can add quota, but use only for
  legitimate dev/prod separation — not to bypass free-tier limits.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"

# Cheapest → slightly more capable. All Flash-family, low cost.
DEFAULT_MODEL = "gemini-2.5-flash-lite"
DEFAULT_FALLBACK_MODELS = (
    "gemini-2.0-flash",
    "gemini-2.5-flash",
)


def _load_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def _parse_csv_env(name: str) -> list[str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _is_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "429",
            "resource_exhausted",
            "rate limit",
            "rate_limit",
            "quota",
            "too many requests",
        )
    )


class LLMClient:
    """Centralized LLM interface — cheapest model first, fallback on 429."""

    def __init__(self) -> None:
        self._clients: list[Any] = []
        self._model_chain: list[str] = []
        self._max_output_tokens: int = 512
        self._initialised = False

    def _get_clients(self) -> list[Any]:
        if self._initialised:
            return self._clients
        self._initialised = True

        keys = _parse_csv_env("GEMINI_API_KEYS")
        primary = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY")
        if primary and primary not in keys:
            keys.insert(0, primary)

        if not keys:
            return []

        try:
            from google import genai  # type: ignore[import]

            self._clients = [genai.Client(api_key=key) for key in keys]
        except Exception:
            self._clients = []

        primary_model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        fallbacks = _parse_csv_env("GEMINI_FALLBACK_MODELS") or list(DEFAULT_FALLBACK_MODELS)
        chain: list[str] = []
        for model in [primary_model, *fallbacks]:
            if model and model not in chain:
                chain.append(model)
        self._model_chain = chain

        try:
            self._max_output_tokens = max(128, int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "512")))
        except ValueError:
            self._max_output_tokens = 512

        return self._clients

    @property
    def enabled(self) -> bool:
        """True when a Gemini API key is configured and the SDK is available."""
        return bool(self._get_clients())

    @property
    def active_model(self) -> str:
        """Primary (cheapest) model configured for this client."""
        self._get_clients()
        return self._model_chain[0] if self._model_chain else DEFAULT_MODEL

    # ------------------------------------------------------------------
    # Core generation
    # ------------------------------------------------------------------

    def _generate_with_model(
        self,
        client: Any,
        model: str,
        prompt: str,
        *,
        system: str | None = None,
    ) -> str:
        from google.genai import types as genai_types  # type: ignore[import]

        config_kwargs: dict[str, Any] = {
            "max_output_tokens": self._max_output_tokens,
        }
        if system:
            config_kwargs["system_instruction"] = system
        config = genai_types.GenerateContentConfig(**config_kwargs)

        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        return response.text or ""

    def generate(self, prompt: str, *, system: str | None = None) -> str:
        """Return raw text. Tries cheapest model first, then fallbacks on 429."""
        clients = self._get_clients()
        if not clients:
            raise NotImplementedError(
                "LLM is not configured. Add GEMINI_API_KEY to backend/.env to enable Gemini."
            )

        last_error: Exception | None = None
        rate_limited = False

        for client in clients:
            for model in self._model_chain:
                try:
                    return self._generate_with_model(client, model, prompt, system=system)
                except Exception as exc:
                    last_error = exc
                    if _is_rate_limit_error(exc):
                        rate_limited = True
                        continue
                    raise RuntimeError(f"Gemini generation failed ({model}): {exc}") from exc

        if rate_limited:
            raise RuntimeError(
                "Gemini rate limit reached on all configured models. "
                "Wait for quota reset or enable billing on your Google AI project."
            ) from last_error
        raise RuntimeError(f"Gemini generation failed: {last_error}") from last_error

    def generate_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        """Return a parsed JSON dict. Strips markdown fences if present."""
        raw = self.generate(
            prompt + "\n\nRespond with ONLY valid JSON. No markdown, no code fences.",
            system=system,
        )
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            end = -1 if lines[-1].startswith("```") else len(lines)
            text = "\n".join(lines[1:end])
        # Grab first JSON object if model adds extra prose
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            text = match.group(0)
        return json.loads(text)

    # ------------------------------------------------------------------
    # Domain-specific helpers (used by research / scoring / comms)
    # ------------------------------------------------------------------

    def enhance_website_summary(
        self,
        *,
        company_name: str,
        website_text: str,
        current_summary: str,
    ) -> str:
        """Return a richer 2-3 sentence business summary from raw website text."""
        if not self.enabled:
            return current_summary
        prompt = (
            "You are a B2B sales analyst for Kafi Commodities, a Pakistani food exporter.\n\n"
            f"Company: {company_name}\n"
            f"Website excerpt:\n{website_text[:2000]}\n\n"
            "Write 2-3 concise sentences on: what they sell/import, target markets, "
            "and fit for Pakistani food exports (rice, chutneys, sauces, pickles, salt, spices).\n"
            "Return only the summary."
        )
        try:
            return self.generate(prompt)
        except Exception:
            return current_summary

    def score_lead(
        self,
        *,
        buyer_profile: str,
        interactions: str,
        export_history: str,
        fallback_label: str,
        fallback_reasoning: str,
    ) -> dict[str, Any]:
        """Return {score, reasoning, key_factors} using the lead-scoring prompt."""
        if not self.enabled:
            return {
                "score": fallback_label,
                "reasoning": fallback_reasoning,
                "key_factors": [],
            }
        template = _load_prompt("lead_scoring_prompt.md")
        prompt = template.format(
            buyer_profile=buyer_profile[:2500],
            interactions=interactions[:1500],
            export_history=export_history[:1000],
        )
        try:
            result = self.generate_json(prompt)
            score = str(result.get("score", fallback_label)).upper()
            if score not in ("HOT", "WARM", "COLD"):
                score = fallback_label
            return {
                "score": score,
                "reasoning": result.get("reasoning", fallback_reasoning),
                "key_factors": result.get("key_factors", []),
            }
        except Exception:
            return {
                "score": fallback_label,
                "reasoning": fallback_reasoning,
                "key_factors": [],
            }

    def draft_email(
        self,
        *,
        buyer_country: str,
        target_language: str,
        buyer_context: str,
        goal: str,
        product_specs: str,
        fallback_body: str,
    ) -> str:
        """Return an LLM-written email body using the email-draft prompt."""
        if not self.enabled:
            return fallback_body
        template = _load_prompt("email_draft_prompt.md")
        prompt = template.format(
            buyer_country=buyer_country or "International",
            target_language=target_language or "English",
            buyer_context=buyer_context[:1200],
            goal=goal,
            product_specs=product_specs[:800],
        )
        try:
            return self.generate(prompt)
        except Exception:
            return fallback_body


llm_client = LLMClient()
