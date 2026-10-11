"""User accounts + public profiles.

Registration is deliberately lightweight (username + password, no email) but
real: bcrypt-hashed passwords, server-side sessions, and a public profile that
aggregates everything a user contributed to the map.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import auth
from db import Comment, Place, PlacePhoto, SessionToken, User, Visit, get_db

router = APIRouter(tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,24}$")


class RegisterBody(BaseModel):
    username: str
    password: str = Field(min_length=6, max_length=72)
    display_name: str | None = Field(default=None, max_length=48)


class LoginBody(BaseModel):
    username: str
    password: str


class ProfileUpdateBody(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=48)
    avatar: str | None = Field(default=None, max_length=16)
    bio: str | None = Field(default=None, max_length=280)


@router.post("/auth/register")
def register(body: RegisterBody, db: Session = Depends(get_db)) -> dict:
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Usernames are 3–24 characters: lowercase letters, numbers, underscores.",
        )
    if db.scalar(select(func.count()).select_from(User).where(User.username == username)):
        raise HTTPException(status_code=409, detail="That username is already taken.")
    user = User(
        username=username,
        display_name=(body.display_name or username).strip(),
        password_hash=auth.hash_password(body.password),
    )
    db.add(user)
    db.commit()
    return {"token": auth.start_session(db, user), "user": auth.public_user(user)}


@router.post("/auth/login")
def login(body: LoginBody, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(User).where(User.username == body.username.strip().lower()))
    if user is None or not auth.verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Wrong username or password.")
    return {"token": auth.start_session(db, user), "user": auth.public_user(user)}


@router.post("/auth/logout")
def logout(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> dict:
    if creds is not None and creds.credentials:
        session = db.get(SessionToken, creds.credentials)
        if session is not None:
            db.delete(session)
            db.commit()
    return {"ok": True}


@router.get("/auth/me")
def me(user: User = Depends(auth.require_user)) -> dict:
    return auth.public_user(user)


@router.patch("/auth/me")
def update_me(
    body: ProfileUpdateBody,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
) -> dict:
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.avatar is not None:
        user.avatar = body.avatar
    if body.bio is not None:
        user.bio = body.bio.strip()
    db.commit()
    return auth.public_user(user)


@router.get("/users/{user_id}")
def public_profile(user_id: str, db: Session = Depends(get_db)) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such neighbor.")
    places = db.scalars(
        select(Place)
        .where(Place.creator_id == user_id, Place.retired.is_(False))
        .order_by(Place.created_at.desc())
    ).all()
    photo_count = db.scalar(
        select(func.count()).select_from(PlacePhoto).where(PlacePhoto.uploader_id == user_id)
    )
    comment_count = db.scalar(
        select(func.count()).select_from(Comment).where(Comment.author_id == user_id)
    )
    visit_count = db.scalar(select(func.count()).select_from(Visit).where(Visit.user_id == user_id))
    return {
        "user": auth.public_user(user),
        "stats": {
            "places": len(places),
            "photos": photo_count or 0,
            "comments": comment_count or 0,
            "placesVisited": visit_count or 0,
        },
        "places": [
            {
                "id": p.id,
                "name": p.name,
                "icon": p.icon,
                "lat": p.lat,
                "lng": p.lng,
                "createdAt": p.created_at.isoformat(),
            }
            for p in places
        ],
    }
