"""Community places: creation, curation, and social proof.

Rules that define the product:
- You can only ADD a place while physically at it (GPS geofence).
- The creator owns the place's core details and curates its photo gallery.
- Everyone else contributes photos, comments, ratings, and likes/dislikes.
- Comments can carry a "verified visit" badge backed by GPS proof (visits).
"""

import base64
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import auth
from db import (
    UPLOADS_DIR,
    Comment,
    Place,
    PlacePhoto,
    Rating,
    User,
    Visit,
    Vote,
    get_db,
    uid,
)
from geo_utils import haversine_m

router = APIRouter(tags=["places"])

# GPS accuracy on phones is noisy; 75 m is generous enough to never block
# someone standing at the place, tight enough to mean something.
ON_SITE_RADIUS_M = 75
NEARBY_DEFAULT_M = 5000
NEARBY_MAX_M = 25000

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_PHOTO_BYTES = 8 * 1024 * 1024


class LatLngBody(BaseModel):
    lat: float
    lng: float


class PlaceCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    icon: str = Field(default="location_on", max_length=48)
    custom_icon_url: str | None = Field(default=None, max_length=255)
    description: str = Field(default="", max_length=2000)
    lat: float
    lng: float
    # The user's CURRENT GPS fix — proof they are standing at the place.
    at: LatLngBody


class PlaceUpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    icon: str | None = Field(default=None, max_length=48)
    custom_icon_url: str | None = Field(default=None, max_length=255)


class IconUploadBody(BaseModel):
    imageBase64: str
    mimeType: str


class CommentBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class RatingBody(BaseModel):
    stars: int = Field(ge=1, le=5)


class VoteBody(BaseModel):
    value: int = Field(ge=-1, le=1)


class PhotoUploadBody(BaseModel):
    imageBase64: str
    mimeType: str
    caption: str = Field(default="", max_length=200)
    at: LatLngBody | None = None


class GalleryBody(BaseModel):
    in_gallery: bool


class VisitBody(BaseModel):
    at: LatLngBody


# --- lookups -----------------------------------------------------------------


def _place_or_404(db: Session, place_id: str) -> Place:
    place = db.get(Place, place_id)
    if place is None or place.retired:
        raise HTTPException(status_code=404, detail="That place no longer exists.")
    return place


def _visit_exists(db: Session, place_id: str, user_id: str) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(Visit)
            .where(Visit.place_id == place_id, Visit.user_id == user_id)
        )
        > 0
    )


def _log_visit(db: Session, place: Place, user: User, source: str, at: LatLngBody | None) -> bool:
    """Record GPS-backed presence. Returns True when a visit was recorded."""
    if at is None:
        return False
    if haversine_m(at.lat, at.lng, place.lat, place.lng) > ON_SITE_RADIUS_M:
        return False
    if _visit_exists(db, place.id, user.id):
        return True
    db.add(Visit(place_id=place.id, user_id=user.id, source=source))
    db.commit()
    return True


def _rating_summary(db: Session, place_id: str) -> dict:
    rows = db.execute(
        select(Rating.stars, func.count()).where(Rating.place_id == place_id).group_by(Rating.stars)
    ).all()
    distribution = {str(stars): 0 for stars in range(1, 6)}
    total, count = 0, 0
    for stars, n in rows:
        distribution[str(stars)] = n
        total += stars * n
        count += n
    return {
        "average": round(total / count, 1) if count else None,
        "count": count,
        "distribution": distribution,
    }


def _counts(db: Session, place_id: str) -> dict:
    photos = db.scalar(
        select(func.count()).select_from(PlacePhoto).where(PlacePhoto.place_id == place_id)
    )
    comments = db.scalar(
        select(func.count()).select_from(Comment).where(Comment.place_id == place_id)
    )
    likes = db.scalar(
        select(func.count()).select_from(Vote).where(Vote.place_id == place_id, Vote.value == 1)
    )
    dislikes = db.scalar(
        select(func.count()).select_from(Vote).where(Vote.place_id == place_id, Vote.value == -1)
    )
    return {
        "photoCount": photos or 0,
        "commentCount": comments or 0,
        "likes": likes or 0,
        "dislikes": dislikes or 0,
    }


def _photo_url(photo: PlacePhoto) -> str:
    return f"/uploads/places/{photo.place_id}/{photo.filename}"


def _place_summary(db: Session, place: Place, user: User | None) -> dict:
    creator = db.get(User, place.creator_id)
    mine: dict = {}
    if user is not None:
        rating = db.get(Rating, (place.id, user.id))
        vote = db.get(Vote, (place.id, user.id))
        mine = {
            "myRating": rating.stars if rating else None,
            "myVote": vote.value if vote else 0,
            "hasVisited": _visit_exists(db, place.id, user.id),
            "isCreator": user.id == place.creator_id,
        }
    return {
        "id": place.id,
        "name": place.name,
        "icon": place.icon,
        "customIconUrl": place.custom_icon_url,
        "lat": place.lat,
        "lng": place.lng,
        "creator": {
            "id": creator.id,
            "displayName": creator.display_name,
            "avatar": creator.avatar,
        }
        if creator
        else None,
        "rating": _rating_summary(db, place.id),
        "createdAt": place.created_at.isoformat(),
        **_counts(db, place.id),
        **mine,
    }


def _photo_dto(db: Session, photo: PlacePhoto) -> dict:
    uploader = db.get(User, photo.uploader_id)
    return {
        "id": photo.id,
        "url": _photo_url(photo),
        "caption": photo.caption,
        "inGallery": photo.in_gallery,
        "createdAt": photo.created_at.isoformat(),
        "uploader": {
            "id": uploader.id,
            "displayName": uploader.display_name,
            "avatar": uploader.avatar,
        }
        if uploader
        else None,
    }


# --- places ------------------------------------------------------------------


@router.post("/places")
def create_place(
    body: PlaceCreateBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    distance = haversine_m(body.at.lat, body.at.lng, body.lat, body.lng)
    if distance > ON_SITE_RADIUS_M:
        raise HTTPException(
            status_code=403,
            detail="You can only add a place while you are physically there.",
        )
    place = Place(
        creator_id=user.id,
        name=body.name.strip(),
        description=body.description.strip(),
        icon=body.icon,
        custom_icon_url=_safe_icon_url(body.custom_icon_url),
        lat=body.lat,
        lng=body.lng,
    )
    db.add(place)
    db.commit()
    # Creating it while standing there IS the first verified visit.
    _log_visit(db, place, user, "navigation", body.at)
    return _place_summary(db, place, user)


@router.get("/places/nearby")
def nearby_places(
    lat: float,
    lng: float,
    radius_m: int = NEARBY_DEFAULT_M,
    user: User | None = Depends(auth.optional_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    radius = min(max(radius_m, 50), NEARBY_MAX_M)
    places = db.scalars(select(Place).where(Place.retired.is_(False))).all()
    out = []
    for place in places:
        distance = haversine_m(lat, lng, place.lat, place.lng)
        if distance <= radius:
            out.append({**_place_summary(db, place, user), "distanceM": round(distance)})
    out.sort(key=lambda p: p["distanceM"])
    return out


@router.get("/places/{place_id}")
def place_detail(
    place_id: str,
    user: User | None = Depends(auth.optional_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    photos = db.scalars(
        select(PlacePhoto)
        .where(PlacePhoto.place_id == place.id)
        .order_by(PlacePhoto.created_at.desc())
    ).all()
    comments = db.scalars(
        select(Comment)
        .where(Comment.place_id == place.id)
        .order_by(Comment.created_at.desc())
        .limit(100)
    ).all()

    detail = _place_summary(db, place, user)
    detail["description"] = place.description
    detail["gallery"] = [_photo_dto(db, p) for p in photos if p.in_gallery]
    detail["communityPhotos"] = [_photo_dto(db, p) for p in photos if not p.in_gallery]
    detail["comments"] = [
        {
            "id": c.id,
            "text": c.text,
            "verifiedVisit": c.verified_visit,
            "createdAt": c.created_at.isoformat(),
            "author": _user_ref(db, c.author_id),
        }
        for c in comments
    ]
    return detail


def _user_ref(db: Session, user_id: str) -> dict | None:
    user = db.get(User, user_id)
    if user is None:
        return None
    return {"id": user.id, "displayName": user.display_name, "avatar": user.avatar}


@router.patch("/places/{place_id}")
def update_place(
    place_id: str,
    body: PlaceUpdateBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    if place.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Only the creator can edit this place.")
    if body.name is not None:
        place.name = body.name.strip()
    if body.description is not None:
        place.description = body.description.strip()
    if body.icon is not None:
        place.icon = body.icon
    if body.custom_icon_url is not None:
        place.custom_icon_url = _safe_icon_url(body.custom_icon_url)
    db.commit()
    detail = _place_summary(db, place, user)
    detail["description"] = place.description
    return detail


@router.delete("/places/{place_id}")
def retire_place(
    place_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    if place.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Only the creator can remove this place.")
    place.retired = True
    db.commit()
    return {"ok": True}


# --- custom icons ---------------------------------------------------------------


def _safe_icon_url(url: str | None) -> str | None:
    """Only serve icon URLs that point at our own uploads mount."""
    if url is None:
        return None
    url = url.strip()
    if not url.startswith("/uploads/icons/"):
        raise HTTPException(status_code=400, detail="Invalid custom icon.")
    return url


@router.post("/place-icons")
def upload_custom_icon(
    body: IconUploadBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    extension = ALLOWED_IMAGE_TYPES.get(body.mimeType.lower())
    if extension is None:
        raise HTTPException(status_code=400, detail="Icons must be JPEG, PNG, or WebP.")
    try:
        raw = base64.b64decode(body.imageBase64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode that image.")
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="That image is empty.")
    if len(raw) > 1024 * 1024:
        raise HTTPException(status_code=413, detail="Icons must be under 1 MB.")

    icons_dir = os.path.join(UPLOADS_DIR, "icons")
    os.makedirs(icons_dir, exist_ok=True)
    filename = f"{uid()}{extension}"
    with open(os.path.join(icons_dir, filename), "wb") as fh:
        fh.write(raw)
    return {"url": f"/uploads/icons/{filename}"}


# --- photos ------------------------------------------------------------------


@router.post("/places/{place_id}/photos")
def upload_photo(
    place_id: str,
    body: PhotoUploadBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    extension = ALLOWED_IMAGE_TYPES.get(body.mimeType.lower())
    if extension is None:
        raise HTTPException(status_code=400, detail="Photos must be JPEG, PNG, or WebP.")
    try:
        raw = base64.b64decode(body.imageBase64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode that image.")
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="That image is empty.")
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photos must be under 8 MB.")

    place_dir = os.path.join(UPLOADS_DIR, "places", place.id)
    os.makedirs(place_dir, exist_ok=True)
    filename = f"{uid()}{extension}"
    with open(os.path.join(place_dir, filename), "wb") as fh:
        fh.write(raw)

    photo = PlacePhoto(
        place_id=place.id,
        uploader_id=user.id,
        filename=filename,
        caption=body.caption.strip(),
    )
    db.add(photo)
    db.commit()
    # Uploading a photo while standing at the place proves the visit.
    if body.at is not None:
        _log_visit(db, place, user, "photo", body.at)
    dto = _photo_dto(db, photo)
    dto["verifiedVisit"] = _visit_exists(db, place.id, user.id)
    return dto


@router.delete("/places/{place_id}/photos/{photo_id}")
def delete_photo(
    place_id: str,
    photo_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    photo = db.get(PlacePhoto, photo_id)
    if photo is None or photo.place_id != place.id:
        raise HTTPException(status_code=404, detail="No such photo.")
    if photo.uploader_id != user.id and place.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Only the uploader or the creator can remove a photo.")
    path = os.path.join(UPLOADS_DIR, "places", place.id, photo.filename)
    if os.path.exists(path):
        os.remove(path)
    db.delete(photo)
    db.commit()
    return {"ok": True}


@router.post("/places/{place_id}/photos/{photo_id}/gallery")
def set_photo_gallery(
    place_id: str,
    photo_id: str,
    body: GalleryBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    if place.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Only the creator curates the gallery.")
    photo = db.get(PlacePhoto, photo_id)
    if photo is None or photo.place_id != place.id:
        raise HTTPException(status_code=404, detail="No such photo.")
    photo.in_gallery = body.in_gallery
    db.commit()
    return _photo_dto(db, photo)


# --- comments ----------------------------------------------------------------


@router.post("/places/{place_id}/comments")
def add_comment(
    place_id: str,
    body: CommentBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    comment = Comment(
        place_id=place.id,
        author_id=user.id,
        text=body.text.strip(),
        verified_visit=_visit_exists(db, place.id, user.id),
    )
    db.add(comment)
    db.commit()
    return {
        "id": comment.id,
        "text": comment.text,
        "verifiedVisit": comment.verified_visit,
        "createdAt": comment.created_at.isoformat(),
        "author": {"id": user.id, "displayName": user.display_name, "avatar": user.avatar},
    }


@router.delete("/places/{place_id}/comments/{comment_id}")
def delete_comment(
    place_id: str,
    comment_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    comment = db.get(Comment, comment_id)
    if comment is None or comment.place_id != place.id:
        raise HTTPException(status_code=404, detail="No such comment.")
    if comment.author_id != user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own comments.")
    db.delete(comment)
    db.commit()
    return {"ok": True}


# --- ratings + votes -----------------------------------------------------------


@router.put("/places/{place_id}/rating")
def set_rating(
    place_id: str,
    body: RatingBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    rating = db.get(Rating, (place.id, user.id))
    if rating is None:
        rating = Rating(place_id=place.id, user_id=user.id, stars=body.stars)
        db.add(rating)
    else:
        rating.stars = body.stars
    db.commit()
    return _rating_summary(db, place.id)


@router.put("/places/{place_id}/vote")
def set_vote(
    place_id: str,
    body: VoteBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    vote = db.get(Vote, (place.id, user.id))
    if body.value == 0:
        if vote is not None:
            db.delete(vote)
            db.commit()
    elif vote is None:
        db.add(Vote(place_id=place.id, user_id=user.id, value=body.value))
        db.commit()
    elif vote.value != body.value:
        vote.value = body.value
        db.commit()
    counts = _counts(db, place.id)
    return {"likes": counts["likes"], "dislikes": counts["dislikes"], "myVote": body.value}


# --- visits ------------------------------------------------------------------


@router.post("/places/{place_id}/visit")
def record_visit(
    place_id: str,
    body: VisitBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    place = _place_or_404(db, place_id)
    recorded = _log_visit(db, place, user, "navigation", body.at)
    if not recorded:
        raise HTTPException(
            status_code=403,
            detail="Visits are recorded by actually being at the place.",
        )
    return {"ok": True, "verifiedVisit": True}
