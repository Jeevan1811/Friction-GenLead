"""LLM service using Llama via OpenRouter for user-facing responses."""

import os
import httpx
from typing import AsyncIterator

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct"


class LLMService:
    """Handles all LLM calls via OpenRouter."""

    def __init__(self):
        self.api_key = os.getenv("OPENROUTER_API_KEY", "")
        self.model = os.getenv("LLM_MODEL", DEFAULT_MODEL)
        self.base_url = OPENROUTER_API_URL

    async def chat(self, messages: list[dict], temperature: float = 0.3, max_tokens: int = 1024) -> str:
        """Send a chat completion request to OpenRouter.

        Returns the assistant's response text.
        Falls back to a helpful message if no API key is configured.
        """
        if not self.api_key:
            return self._mock_response(messages)

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "HTTP-Referer": "https://friction.au",
                    "X-Title": "Friction GenLead",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    async def chat_stream(self, messages: list[dict], temperature: float = 0.3, max_tokens: int = 1024) -> AsyncIterator[str]:
        """Stream a chat completion response token by token.

        Yields text chunks as they arrive from the API.
        """
        if not self.api_key:
            yield self._mock_response(messages)
            return

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "HTTP-Referer": "https://friction.au",
                    "X-Title": "Friction GenLead",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": True,
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        import json
                        chunk = json.loads(line[6:])
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        if content := delta.get("content"):
                            yield content

    def build_system_prompt(self, context: dict | None = None) -> str:
        """Build the system prompt for the GenLead assistant.

        Args:
            context: Optional dict with companies_count, contacts_count, etc.
                     to ground the assistant in current data.
        """
        base = (
            "You are the Friction GenLead assistant -- a helpful AI for Queensland industrial "
            "business prospecting. You help users understand their prospect data, suggest next "
            "steps, and answer questions about companies, contacts, and locations in their pipeline.\n\n"
            "Rules:\n"
            "- Be concise and direct. No fluff.\n"
            "- When discussing companies, reference their ABN, status, and location.\n"
            "- Never fabricate data -- if you don't know, say so.\n"
            "- Suggest actionable next steps (verify, approve, reject, research more).\n"
            "- Queensland industrial focus: mining, energy, heavy industry, construction, transport.\n"
            "- Amounts in AUD, dates in DD/MM/YYYY format.\n"
        )
        if context:
            base += f"\nCurrent pipeline: {context.get('companies_count', 0)} companies, "
            base += f"{context.get('contacts_count', 0)} contacts, "
            base += f"{context.get('locations_count', 0)} locations, "
            base += f"{context.get('pending_reviews', 0)} pending reviews.\n"
        return base

    def _mock_response(self, messages: list[dict]) -> str:
        """Return a helpful mock response when no API key is configured."""
        last_msg = messages[-1]["content"] if messages else ""
        return (
            f"I'd help with that, but no OpenRouter API key is configured. "
            f"Set the OPENROUTER_API_KEY environment variable to enable AI responses.\n\n"
            f"Your question: \"{last_msg[:100]}...\"\n\n"
            f"To configure: add OPENROUTER_API_KEY=your_key to your .env file."
        )
