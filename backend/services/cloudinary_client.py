"""Cloudinary signed uploads — activated by setting CLOUDINARY_URL.

Format: cloudinary://<api_key>:<api_secret>@<cloud_name>
When unset, the app stores photos on local disk under /uploads instead.
"""

import hashlib
import os
import time
from urllib.parse import urlparse

import httpx

UPLOAD_ENDPOINT = "https://api.cloudinary.com/v1_1/{cloud}/image/upload"


class CloudinaryError(Exception):
    pass


def _credentials() -> tuple[str, str, str] | None:
    url = os.getenv("CLOUDINARY_URL", "").strip()
    if not url.startswith("cloudinary://"):
        return None
    rest = url[len("cloudinary://") :]
    head, _, cloud = rest.rpartition("@")
    key, _, secret = head.partition(":")
    if not (key and secret and cloud):
        return None
    return key, secret, cloud


def cloud_name() -> str | None:
    creds = _credentials()
    return creds[2] if creds else None


def is_configured() -> bool:
    return _credentials() is not None


def upload_image(image_bytes: bytes, folder: str, public_id: str) -> str:
    """Signed upload of raw image bytes; returns the secure CDN URL."""
    creds = _credentials()
    if creds is None:
        raise CloudinaryError("CLOUDINARY_URL is not configured")
    api_key, api_secret, cloud = creds

    timestamp = str(int(time.time()))
    # Cloudinary signs every param except file, api_key, and resource_type,
    # in alphabetical order, with the secret appended.
    params = {"folder": folder, "public_id": public_id, "timestamp": timestamp}
    to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params)) + api_secret
    signature = hashlib.sha1(to_sign.encode("utf-8")).hexdigest()

    endpoint = UPLOAD_ENDPOINT.format(cloud=cloud)
    try:
        res = httpx.post(
            endpoint,
            data={"api_key": api_key, "timestamp": timestamp, "signature": signature, **params},
            files={"file": ("image", image_bytes)},
            timeout=45,
        )
    except httpx.HTTPError as e:
        raise CloudinaryError(f"Cloudinary request failed: {e}") from e

    if res.status_code != 200:
        raise CloudinaryError(f"Cloudinary HTTP {res.status_code}: {res.text[:200]}")
    data = res.json()
    url = data.get("secure_url")
    if not url:
        raise CloudinaryError("Cloudinary returned no URL")
    return url


def owns_url(url: str) -> bool:
    """True when a URL was produced by our Cloudinary cloud (for input checks)."""
    creds = _credentials()
    if creds is None:
        return False
    parsed = urlparse(url)
    return parsed.scheme == "https" and parsed.hostname == "res.cloudinary.com" and (
        f"/{creds[2]}/" in parsed.path
    )
