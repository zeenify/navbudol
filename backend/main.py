"""NavBudol backend — FastAPI.

The community platform:
  /api/auth/*      → register / login / sessions (bcrypt + opaque tokens)
  /api/places/*    → community places: photos, comments, ratings, votes
  /api/users/*     → public profiles
  POST /api/chat   → Gemini 3.5 Flash Lite proxy (key stays server-side)
  POST /api/tts    → Fish Audio proxy with an MP3 cache keyed on (text, voice)
  GET  /api/health → liveness probe the app shows a banner from
  /uploads/*       → place photos (swap to Cloudinary when keys arrive)

Run:  uvicorn main:app --port 8010
"""

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from db import UPLOADS_DIR
from routers import chat, geo, places, tts, users

load_dotenv()

app = FastAPI(title="NavBudol Backend", version="2.0.0")

# Local dev tool — the "auth" boundary is the demo laptop itself.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/api")
app.include_router(places.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(tts.router, prefix="/api")
app.include_router(geo.router, prefix="/api")

# Place photos. Local disk for now; the Cloudinary swap only touches
# routers/places.py, the URLs keep working via this mount.
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


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
