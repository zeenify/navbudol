"""Gemini proxy — forwards contents/tools to AI Studio and normalizes the
response down to what the app needs:

  {"text": "..." | null, "functionCalls": [{"name", "args"}] | null}

The function-calling LOOP stays on the device; this client is stateless.
"""

import os

import httpx

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-3.5-flash-lite"


class GeminiError(Exception):
    pass


def has_key() -> bool:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    return bool(key) and not key.startswith("PASTE_")


def generate(system: str | None, contents: list[dict], tools: list[dict] | None) -> dict:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise GeminiError("GEMINI_API_KEY is not set in backend/.env")
    model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    payload: dict = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.8,
            "maxOutputTokens": 2048,
            "topP": 0.95,
        },
    }
    if system:
        payload["system_instruction"] = {"parts": [{"text": system}]}
    if tools:
        payload["tools"] = tools

    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    url = f"{BASE_URL}/models/{model}:generateContent"

    data = None
    try:
        for attempt in range(2):  # one retry for transient 503s (high demand)
            resp = httpx.post(url, json=payload, headers=headers, timeout=60)
            if resp.status_code == 503 and attempt == 0:
                import time

                time.sleep(2)
                continue
            break
    except httpx.HTTPError as e:
        raise GeminiError(f"Gemini request failed: {e}") from e

    if resp.status_code != 200:
        raise GeminiError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise GeminiError(f"Gemini returned no candidates: {str(data)[:300]}")

    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if "text" in p).strip()
    function_calls = [
        {
            "name": p["functionCall"].get("name", ""),
            "args": p["functionCall"].get("args") or {},
        }
        for p in parts
        if "functionCall" in p
    ]
    # `parts` is the RAW part list (incl. thoughtSignature / ids) — the app
    # echoes these back verbatim so Gemini 3.x signatures round-trip.
    return {"text": text or None, "functionCalls": function_calls or None, "parts": parts}
