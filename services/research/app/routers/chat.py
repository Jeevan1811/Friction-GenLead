"""Chat router for the Llama-powered assistant."""

from pydantic import BaseModel
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.llm import LLMService

router = APIRouter(prefix="/internal/chat", tags=["chat"])

llm = LLMService()


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: dict | None = None
    stream: bool = False


class ChatResponse(BaseModel):
    response: str
    model: str


@router.post("")
async def chat(request: ChatRequest):
    """Send a message to the GenLead assistant.

    Uses Llama via OpenRouter for responses. Supports streaming.
    """
    system_prompt = llm.build_system_prompt(request.context)
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend([{"role": m.role, "content": m.content} for m in request.messages])

    if request.stream:
        async def generate():
            async for chunk in llm.chat_stream(messages):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    response_text = await llm.chat(messages)
    return ChatResponse(response=response_text, model=llm.model)
