"""Pilot brain endpoint — DeepSeek V4.1 Flash via River, Gemini fallback.

Stateless: the client sends {messages, tools} as OpenAI-style chat payloads
and gets back {text, tool_calls, brain}. NO app logic lives here — the
function-calling loop runs on the device (only the device knows the GPS and
screen state). The Gemini pool is the fallback when River is unavailable:
the same messages convert to Gemini contents, the same tool set converts to
Gemini declarations, so the UI behaves identically either way.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import gemini_client, river_client

router = APIRouter(tags=["pilot"])


class BrainRequest(BaseModel):
    # OpenAI-style chat payloads, passed through verbatim. `messages[0]` is
    # conventionally the system turn; the rest are plain user/assistant text.
    messages: list[dict]
    tools: list[dict] | None = None


def _tools_for_gemini(tools: list[dict]) -> list[dict]:
    """Unwrap OpenAI tool format {type:'function', function:{...}} into
    Gemini's {name, description, parameters} declarations."""
    declarations = []
    for tool in tools or []:
        fn = tool.get("function") if isinstance(tool, dict) else None
        if fn and fn.get("name"):
            declarations.append(
                {
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
                }
            )
    return [{"function_declarations": declarations}] if declarations else None


def _contents_for_gemini(messages: list[dict]) -> list[dict]:
    contents = []
    for msg in messages:
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue  # system rides separately in system_instruction
        contents.append(
            {"role": "model" if role == "assistant" else "user", "parts": [{"text": str(msg.get("content") or "")}]}
        )
    return contents


@router.post("/pilot/brain")
def pilot_brain(req: BrainRequest):
    if river_client.has_key():
        try:
            return river_client.generate(req.messages, req.tools)
        except river_client.RiverError as e:
            print(f"[PILOT] River unavailable ({e}) — Gemini pool fallback")
    else:
        print("[PILOT] RIVER_API_KEY not set — Gemini pool fallback")

    system = next((m.get("content") for m in req.messages if m.get("role") == "system"), None)
    try:
        result = gemini_client.generate(system, _contents_for_gemini(req.messages), _tools_for_gemini(req.tools or []))
    except gemini_client.GeminiError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # noqa: BLE001 — surface anything as a 500 detail
        raise HTTPException(status_code=500, detail=f"pilot brain failed: {e}")

    calls = [{"name": c["name"], "arguments": c.get("args") or {}} for c in result.get("functionCalls") or []]
    return {"text": result.get("text"), "tool_calls": calls or None, "brain": "gemini"}
