import json
import math
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["locations"])

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "user_locations.json"
LOCK = threading.RLock()
HOME_LAT = 15.3519
HOME_LNG = 121.0633
SERVICE_AREA_RADIUS_M = 20000
MAX_LOCATIONS = 500


class UserLocationRequest(BaseModel):
    name: str
    lat: float
    lng: float
    detail: str | None = None


def read_locations() -> list[dict]:
    if not DATA_PATH.exists():
        return []
    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def write_locations(locations: list[dict]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = DATA_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(locations, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, DATA_PATH)


def distance_from_home(lat: float, lng: float) -> float:
    earth_radius = 6371000
    lat1 = math.radians(HOME_LAT)
    lat2 = math.radians(lat)
    d_lat = lat2 - lat1
    d_lng = math.radians(lng - HOME_LNG)
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    return earth_radius * 2 * math.asin(min(1, math.sqrt(a)))


def normalized_name(value: str) -> str:
    return " ".join(value.casefold().split())


@router.get("/user-locations")
def list_user_locations() -> list[dict]:
    with LOCK:
        locations = read_locations()
    locations.sort(key=lambda item: str(item.get("createdAt", "")), reverse=True)
    return locations


@router.post("/user-locations", status_code=201)
def create_user_location(request: UserLocationRequest) -> dict:
    name = " ".join(request.name.split())
    detail = " ".join(request.detail.split()) if request.detail else ""
    if not name:
        raise HTTPException(status_code=422, detail="Give this location a name.")
    if len(name) > 80:
        raise HTTPException(status_code=422, detail="Location names must be 80 characters or fewer.")
    if len(detail) > 120:
        raise HTTPException(status_code=422, detail="Location notes must be 120 characters or fewer.")
    if not math.isfinite(request.lat) or not math.isfinite(request.lng):
        raise HTTPException(status_code=422, detail="That location has invalid coordinates.")
    if not -90 <= request.lat <= 90 or not -180 <= request.lng <= 180:
        raise HTTPException(status_code=422, detail="That location has invalid coordinates.")
    distance = distance_from_home(request.lat, request.lng)
    if distance > SERVICE_AREA_RADIUS_M:
        raise HTTPException(
            status_code=422,
            detail="That location is outside the General Tinio service area. Move closer to General Tinio and try again.",
        )

    with LOCK:
        locations = read_locations()
        if len(locations) >= MAX_LOCATIONS:
            raise HTTPException(status_code=409, detail="The shared location index is full.")
        if any(normalized_name(str(item.get("name", ""))) == normalized_name(name) for item in locations):
            raise HTTPException(status_code=409, detail="That location name is already in the shared index.")
        location = {
            "id": uuid.uuid4().hex,
            "name": name,
            "detail": detail or "Shared location",
            "lat": request.lat,
            "lng": request.lng,
            "type": "Shared location",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        locations.append(location)
        write_locations(locations)
    return location
