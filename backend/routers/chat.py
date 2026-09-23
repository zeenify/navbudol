from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import gemini_client

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    # `system` is the full system prompt; `contents` is Gemini's native
    # contents array (role user/model + text/functionCall/functionResponse
    # parts) passed through verbatim; `tools` is the function declarations.
    system: str | None = None
    contents: list[dict]
    tools: list[dict] | None = None


@router.post("/chat")
def chat(req: ChatRequest):
    try:
        return gemini_client.generate(req.system, req.contents, req.tools)
    except gemini_client.GeminiError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # noqa: BLE001 — surface anything as a 500 detail
        raise HTTPException(status_code=500, detail=f"chat failed: {e}")
