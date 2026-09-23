"""Fish Audio proxy with an MP3 cache.

Cache key is sha1(text | reference_id) — the same scheme Cognify used.
Repeated nav phrases ("In 200 meters, turn right") hit the cache and skip
the internet entirely.
"""

import hashlib
import os
from pathlib import Path

import httpx

FISH_TTS_URL = "https://api.fish.audio/v1/tts"


class FishError(Exception):
    pass


def has_key() -> bool:
    key = os.getenv("FISH_API_KEY", "").strip()
    return bool(key) and not key.startswith("PASTE_")


def synthesize(text: str, reference_id: str, cache_dir: Path) -> tuple[bytes, bool]:
    api_key = os.getenv("FISH_API_KEY", "").strip()
    if not api_key:
        raise FishError("FISH_API_KEY is not set in backend/.env")

    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(
        (text.strip() + "|" + reference_id).encode("utf-8")
    ).hexdigest()
    cache_file = cache_dir / f"{reference_id[:8]}_{digest}.mp3"
    if cache_file.exists() and cache_file.stat().st_size > 0:
        return cache_file.read_bytes(), True

    try:
        request_body: dict = {
            "text": text,
            "reference_id": reference_id,
            "format": "mp3",
        }
        # Fish reads the model from the `model` HTTP header — a `model` field
        # in the JSON body is silently ignored and billed as the default
        # (paid) model, which 402s on an empty API-credit wallet.
        headers = {"Authorization": f"Bearer {api_key}"}
        fish_model = os.getenv("FISH_MODEL", "").strip()
        if fish_model:
            headers["model"] = fish_model

        resp = httpx.post(
            FISH_TTS_URL,
            json=request_body,
            headers=headers,
            timeout=60,
        )
    except httpx.HTTPError as e:
        raise FishError(f"Fish Audio request failed: {e}") from e

    if resp.status_code != 200:
        raise FishError(f"Fish Audio HTTP {resp.status_code}: {resp.text[:300]}")

    audio = resp.content
    if not audio:
        raise FishError("Fish Audio returned an empty body")

    cache_file.write_bytes(audio)
    return audio, False
