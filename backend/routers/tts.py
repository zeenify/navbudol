import base64
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import fish_client

router = APIRouter(tags=["tts"])

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"


class TtsRequest(BaseModel):
    text: str
    reference_id: str


@router.post("/tts")
def tts(req: TtsRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    if not req.reference_id.strip():
        raise HTTPException(
            status_code=400,
            detail="reference_id is empty — this character has no Fish voice; "
            "the app should fall back to system TTS instead of calling this",
        )
    try:
        audio, cached = fish_client.synthesize(req.text, req.reference_id, CACHE_DIR)
    except fish_client.FishError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "audioBase64": base64.b64encode(audio).decode("ascii"),
        "cached": cached,
    }
