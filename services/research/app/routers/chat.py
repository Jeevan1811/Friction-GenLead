"""Chat router for the GenLead assistant."""

import logging

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.services import assistant
from app.services.auth import require_auth
from app.services.llm import LLMService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/chat", tags=["chat"], dependencies=[Depends(require_auth)]
)

llm = LLMService()

# Only the recent turns go to the model: it keeps prompts small (free-tier
# limits) and the knowledge base + live data are re-attached every turn anyway.
MAX_HISTORY_MESSAGES = 10


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: dict | None = None  # {"page": "/companies"}
    stream: bool = False


class ChatResponse(BaseModel):
    response: str
    model: str


@router.post("")
async def chat(request: ChatRequest):
    """Answer a question about the app or the client's data.

    Grounded in the knowledge base and live Sheet data (see
    ``app.services.assistant``). If the AI provider is unreachable, out of
    credit or rate-limited, falls back to the built-in guide instead of
    showing the user an error.
    """
    history = [
        {"role": m.role, "content": m.content}
        for m in request.messages
        if m.role in ("user", "assistant")
    ][-MAX_HISTORY_MESSAGES:]
    question = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    page = (request.context or {}).get("page")
    if not isinstance(page, str):
        page = None

    ctx = await assistant.build_context(question, page)
    messages = [{"role": "system", "content": assistant.system_prompt(ctx)}, *history]

    if request.stream and llm.api_key:
        async def generate():
            async for chunk in llm.chat_stream(messages):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    if not llm.api_key:
        return ChatResponse(
            response=assistant.fallback_answer(question, ctx, ai_down=False),
            model="built-in-guide",
        )

    try:
        text = await llm.chat(messages, temperature=0.2, max_tokens=700)
        return ChatResponse(response=assistant.sanitize(text), model=llm.model)
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        logger.warning("LLM unavailable (%s: status=%s); using built-in guide", type(exc).__name__, status)
        return ChatResponse(
            response=assistant.fallback_answer(question, ctx, ai_down=True),
            model="built-in-guide",
        )
