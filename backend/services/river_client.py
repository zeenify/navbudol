"""River proxy — the PILOT brain. Forwards OpenAI-style chat payloads
({messages, tools}) to River and normalizes the response:

  {"text": "..." | null, "tool_calls": [{"name", "arguments"}] | None,
   "brain": "river"}

DeepSeek V4.1 Flash drives the NavBudol pilot; the Gemini pool stays the
fallback. The pilot LOOP runs on the device — this client is stateless.
NO streaming: CapacitorHttp can't stream reliably on device.
"""

import json
import os
import time

import httpx

BASE_URL = "https://api.river.ai/v1"
DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash"


class RiverError(Exception):
    pass


def has_key() -> bool:
    key = os.getenv("RIVER_API_KEY", "").strip()
    return bool(key) and not key.startswith("PASTE_")


def _split_concat_json(raw: str) -> list[dict]:
    """Split '{"a":1}{"b":2}' into [{'a':1},{'b':2}] — River can merge N
    parallel tool calls into one slot with the args concatenated."""
    decoder = json.JSONDecoder()
    parts: list = []
    idx = 0
    raw = (raw or "").strip()
    while idx < len(raw):
        while idx < len(raw) and raw[idx] in " \n\r\t":
            idx += 1
        if idx >= len(raw):
            break
        try:
            obj, end = decoder.raw_decode(raw, idx)
        except json.JSONDecodeError:
            return []
        parts.append(obj)
        idx = end
    return parts


def _parse_arguments(raw: str) -> dict:
    """The call's arguments: straightforward JSON when well-formed, otherwise
    salvage the FIRST call out of a merged-parallel-calls slot so the run
    keeps moving instead of failing the whole turn."""
    try:
        args = json.loads(raw or "{}")
        return args if isinstance(args, dict) else {}
    except json.JSONDecodeError:
        parts = _split_concat_json(raw)
        if parts and isinstance(parts[0], dict):
            print(f"[PILOT] salvaged merged tool-call slot (first of {len(parts)})")
            return parts[0]
        print(f"[PILOT] unparseable tool arguments: {raw[:200]!r}")
        return {}


def generate(messages: list[dict], tools: list[dict] | None) -> dict:
    api_key = os.getenv("RIVER_API_KEY", "").strip()
    if not api_key:
        raise RiverError("RIVER_API_KEY is not set in backend/.env")
    model = os.getenv("PILOT_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": 0.25,
        "max_tokens": 1400,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = f"{BASE_URL}/chat/completions"

    data = None
    try:
        for attempt in range(2):  # one retry for transient 5xx / network errors
            resp = httpx.post(url, json=payload, headers=headers, timeout=90)
            if resp.status_code >= 500 and attempt == 0:
                time.sleep(2)
                continue
            break
    except httpx.HTTPError as e:
        raise RiverError(f"River request failed: {e}") from e

    if resp.status_code != 200:
        raise RiverError(f"River HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RiverError(f"River returned no choices: {str(data)[:300]}")

    message = (choices[0] or {}).get("message") or {}
    text = (message.get("content") or "").strip()
    tool_calls = [
        {
            "name": (tc.get("function") or {}).get("name", ""),
            "arguments": _parse_arguments((tc.get("function") or {}).get("arguments") or "{}"),
        }
        for tc in message.get("tool_calls") or []
        if (tc.get("function") or {}).get("name")
    ]
    return {
        "text": text or None,
        "tool_calls": tool_calls or None,
        "brain": "river",
    }
