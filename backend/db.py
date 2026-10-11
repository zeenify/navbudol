"""Database foundation for the community platform.

SQLite in development (backend/data/navbudol.db); deploying to Postgres is a
DATABASE_URL env swap — the schema uses portable column types only.
"""

import os
import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(DATA_DIR, 'navbudol.db')}")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def uid() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(48))
    password_hash: Mapped[str] = mapped_column(String(128))
    avatar: Mapped[str] = mapped_column(String(16), default="🙂")
    bio: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SessionToken(Base):
    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_token)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Place(Base):
    __tablename__ = "places"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    creator_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(48), default="location-on")
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    retired: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class PlacePhoto(Base):
    __tablename__ = "place_photos"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    place_id: Mapped[str] = mapped_column(ForeignKey("places.id"), index=True)
    uploader_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    filename: Mapped[str] = mapped_column(String(160))
    caption: Mapped[str] = mapped_column(String(200), default="")
    # Only the creator can promote community photos into the curated gallery.
    in_gallery: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    place_id: Mapped[str] = mapped_column(ForeignKey("places.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    # True when we have GPS proof this author was actually at the place.
    verified_visit: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Rating(Base):
    __tablename__ = "ratings"

    place_id: Mapped[str] = mapped_column(
        ForeignKey("places.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    stars: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class Vote(Base):
    """Like (+1) / dislike (−1) on a place; one per user per place."""

    __tablename__ = "votes"

    place_id: Mapped[str] = mapped_column(
        ForeignKey("places.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    value: Mapped[int] = mapped_column(Integer)  # 1 | -1
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class Visit(Base):
    """GPS proof someone was at a place — from navigation arrival or an
    on-site photo upload. One row per user+place."""

    __tablename__ = "visits"
    __table_args__ = (UniqueConstraint("place_id", "user_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    place_id: Mapped[str] = mapped_column(ForeignKey("places.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(16), default="navigation")  # navigation | photo
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


Base.metadata.create_all(engine)
