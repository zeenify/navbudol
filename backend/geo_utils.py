"""Haversine distance helpers (backend side).

Kept tiny on purpose — routing math lives in the client; the backend only
needs on-site checks (place creation geofence, visit proof).
"""

import math


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    """Great-circle distance in meters between two [lat, lng] points."""
    radius = 6_371_000.0
    phi1, phi2 = math.radians(a_lat), math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dlmb = math.radians(b_lng - a_lng)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))
