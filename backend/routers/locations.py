import json
import math
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
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


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius = 6371000
    rlat1 = math.radians(lat1)
    rlat2 = math.radians(lat2)
    d_lat = rlat2 - rlat1
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(d_lng / 2) ** 2
    return earth_radius * 2 * math.asin(min(1, math.sqrt(a)))


def distance_from_home(lat: float, lng: float) -> float:
    return haversine_m(HOME_LAT, HOME_LNG, lat, lng)


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


# --- Community reports --------------------------------------------------------
#
# The second flavor of the same record family: a place is a noun, a report is
# a sentence with a timestamp. A report carries an open-vocabulary `kind`, a
# shelf life (expiry is what makes it honest), confirmations weighted by
# physical presence, disputes, and retirement by anyone who finds it stale.

REPORTS_PATH = Path(__file__).resolve().parents[1] / "data" / "user_reports.json"
PRESENCE_RADIUS_M = 250  # a confirm within this distance stamps "on site"
MAX_REPORTS = 500
RETIRED_KEEP_HOURS = 24 * 7  # retired reports linger briefly, then vanish

# Shelf life in hours per kind. The vocabulary is open — unknown kinds and the
# AI's free-form labels fall back to one week.
KIND_SHELF_LIFE_H = {
    "flood": 6,
    "checkpoint": 4,
    "hazard": 12,
    "fare": 24 * 180,
    "access": 24 * 30,
    "info": 24 * 7,
}
DEFAULT_SHELF_LIFE_H = 24 * 7
MIN_TTL_H = 1.0
MAX_TTL_H = 24 * 365


class ReportRequest(BaseModel):
    kind: str
    text: str
    lat: float
    lng: float
    placeId: str | None = None
    author: str | None = None
    ttlHours: float | None = None


class ConfirmRequest(BaseModel):
    author: str | None = None
    lat: float | None = None
    lng: float | None = None


class DisputeRequest(BaseModel):
    author: str | None = None


def read_reports() -> list[dict]:
    if not REPORTS_PATH.exists():
        return []
    try:
        data = json.loads(REPORTS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def write_reports(reports: list[dict]) -> None:
    REPORTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = REPORTS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, REPORTS_PATH)


def parse_ts(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def report_is_live(report: dict, now: datetime) -> bool:
    if report.get("retiredAt"):
        return False
    expires = parse_ts(report.get("expiresAt"))
    return expires is None or expires > now


def prune_reports(reports: list[dict], now: datetime) -> list[dict]:
    """Drop expired reports outright; keep fresh retirements briefly so the
    file cannot grow without bound."""
    kept = []
    for report in reports:
        if report_is_live(report, now):
            kept.append(report)
            continue
        retired = parse_ts(report.get("retiredAt"))
        if retired and now - retired < timedelta(hours=RETIRED_KEEP_HOURS):
            kept.append(report)
    return kept


def annotate_report(report: dict) -> dict:
    """Attach the trust totals the app and the AI read: confirms, how many of
    them were made "on site", and disputes."""
    confirms = [c for c in report.get("confirms", []) if isinstance(c, dict)]
    disputes = [d for d in report.get("disputes", []) if isinstance(d, dict)]
    presence = sum(
        1
        for c in confirms
        if isinstance(c.get("nearM"), (int, float)) and c["nearM"] <= PRESENCE_RADIUS_M
    )
    out = dict(report)
    out["confirmCount"] = len(confirms)
    out["presenceCount"] = presence
    out["disputeCount"] = len(disputes)
    return out


def clean_author(value: str | None) -> str:
    author = " ".join(value.split()) if value else ""
    return author[:64] or "anon"


def _find_live_report(reports: list[dict], report_id: str, now: datetime) -> dict:
    for report in reports:
        if report.get("id") == report_id:
            if not report_is_live(report, now):
                raise HTTPException(status_code=404, detail="That report has expired or was retired.")
            return report
    raise HTTPException(status_code=404, detail="That report no longer exists.")


@router.get("/reports")
def list_reports() -> list[dict]:
    now = datetime.now(timezone.utc)
    with LOCK:
        live = [r for r in read_reports() if report_is_live(r, now)]
    live.sort(key=lambda item: str(item.get("createdAt", "")), reverse=True)
    return [annotate_report(r) for r in live]


@router.post("/reports", status_code=201)
def create_report(request: ReportRequest) -> dict:
    now = datetime.now(timezone.utc)
    kind = " ".join(request.kind.split())
    text = " ".join(request.text.split())
    if not kind:
        raise HTTPException(status_code=422, detail="Pick a kind for this report.")
    if len(kind) > 40:
        raise HTTPException(status_code=422, detail="Report kinds must be 40 characters or fewer.")
    if not text:
        raise HTTPException(status_code=422, detail="Write a short description for this report.")
    if len(text) > 240:
        raise HTTPException(status_code=422, detail="Reports must be 240 characters or fewer.")
    if not math.isfinite(request.lat) or not math.isfinite(request.lng):
        raise HTTPException(status_code=422, detail="That report has invalid coordinates.")
    if not -90 <= request.lat <= 90 or not -180 <= request.lng <= 180:
        raise HTTPException(status_code=422, detail="That report has invalid coordinates.")
    if distance_from_home(request.lat, request.lng) > SERVICE_AREA_RADIUS_M:
        raise HTTPException(
            status_code=422,
            detail="That report is outside the General Tinio service area. Move closer to General Tinio and try again.",
        )
    if request.placeId:
        with LOCK:
            place_ids = {item.get("id") for item in read_locations()}
        if request.placeId not in place_ids:
            raise HTTPException(
                status_code=422,
                detail="That place no longer exists — pin the report where you are instead.",
            )

    ttl = KIND_SHELF_LIFE_H.get(kind.casefold(), DEFAULT_SHELF_LIFE_H)
    if request.ttlHours is not None and math.isfinite(request.ttlHours):
        ttl = min(max(request.ttlHours, MIN_TTL_H), MAX_TTL_H)

    with LOCK:
        reports = prune_reports(read_reports(), now)
        if sum(1 for r in reports if report_is_live(r, now)) >= MAX_REPORTS:
            raise HTTPException(status_code=409, detail="The community report index is full.")
        report = {
            "id": uuid.uuid4().hex,
            "kind": kind,
            "text": text,
            "lat": request.lat,
            "lng": request.lng,
            "placeId": request.placeId,
            "author": clean_author(request.author),
            "createdAt": now.isoformat(),
            "expiresAt": (now + timedelta(hours=ttl)).isoformat(),
            "retiredAt": None,
            "confirms": [],
            "disputes": [],
        }
        reports.append(report)
        write_reports(reports)
    return annotate_report(report)


@router.post("/reports/{report_id}/confirm")
def confirm_report(report_id: str, request: ConfirmRequest) -> dict:
    now = datetime.now(timezone.utc)
    author = clean_author(request.author)
    if request.lat is not None and request.lng is not None:
        if (
            not math.isfinite(request.lat)
            or not math.isfinite(request.lng)
            or not -90 <= request.lat <= 90
            or not -180 <= request.lng <= 180
        ):
            raise HTTPException(status_code=422, detail="Invalid coordinates.")
    with LOCK:
        reports = read_reports()
        report = _find_live_report(reports, report_id, now)
        stamp: dict = {"by": author, "at": now.isoformat()}
        if request.lat is not None and request.lng is not None:
            stamp["nearM"] = round(haversine_m(request.lat, request.lng, report["lat"], report["lng"]))
        # One stamp per person — a confirm replaces their earlier confirm.
        report["confirms"] = [c for c in report.get("confirms", []) if c.get("by") != author] + [stamp]
        # Confirming is a change of mind — drop this author's standing dispute.
        report["disputes"] = [d for d in report.get("disputes", []) if d.get("by") != author]
        write_reports(prune_reports(reports, now))
    return annotate_report(report)


@router.post("/reports/{report_id}/dispute")
def dispute_report(report_id: str, request: DisputeRequest) -> dict:
    now = datetime.now(timezone.utc)
    author = clean_author(request.author)
    with LOCK:
        reports = read_reports()
        report = _find_live_report(reports, report_id, now)
        stamp = {"by": author, "at": now.isoformat()}
        report["disputes"] = [d for d in report.get("disputes", []) if d.get("by") != author] + [stamp]
        report["confirms"] = [c for c in report.get("confirms", []) if c.get("by") != author]
        write_reports(prune_reports(reports, now))
    return annotate_report(report)


@router.post("/reports/{report_id}/retire")
def retire_report(report_id: str) -> dict:
    now = datetime.now(timezone.utc)
    with LOCK:
        reports = read_reports()
        report = _find_live_report(reports, report_id, now)
        report["retiredAt"] = now.isoformat()
        write_reports(reports)
    return {"retired": True, "id": report_id}
