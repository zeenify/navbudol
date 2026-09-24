"""NavBudol backend — FastAPI.

Three jobs, nothing more:
  POST /api/chat   → Gemini 3.5 Flash Lite proxy (key stays server-side)
  POST /api/tts    → Fish Audio proxy with an MP3 cache keyed on (text, voice)
  GET  /api/health → liveness probe the app shows a banner from

Run:  uvicorn main:app --port 8000
"""

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import chat, geo, locations, tts

load_dotenv()

app = FastAPI(title="NavBudol Backend", version="1.0.0")

# Local dev tool — the "auth" boundary is the demo laptop itself.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(tts.router, prefix="/api")
app.include_router(geo.router, prefix="/api")
app.include_router(locations.router, prefix="/api")


@app.get("/api/health")
def health():
    gemini_ready = bool(chat.gemini_client.has_key())
    fish_ready = bool(tts.fish_client.has_key())
    return {
        "ok": True,
        "service": "navbudol-backend",
        "gemini_key_set": gemini_ready,
        "fish_key_set": fish_ready,
    }
