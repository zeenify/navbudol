"""Database foundation for the community platform.

SQLite in development (backend/data/navbudol.db); deploying to Postgres is a
DATABASE_URL env swap — the schema uses portable column types only.
"""

import os
import secrets
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
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

# Pinned to this file's directory — the backend must find its .env no matter
# which working directory it was launched from.
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

DATABASE_URL = os.getenv(
    "DATABASE_URL", f"sqlite:///{os.path.join(DATA_DIR, 'navbudol.db')}"
).strip().strip('"').strip("'")
# requirements.txt ships psycopg2 — point plain postgresql:// URLs at it
# (SQLAlchemy would otherwise look for the uninstalled psycopg v3).
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

_connect_args: dict = {}
if DATABASE_URL.startswith("sqlite"):
    _connect_args["check_same_thread"] = False
else:
    # Fail fast when the database host is unreachable: a hung connect at
    # import time must never stop the service from booting (Render would
    # report "no open ports" and crash-loop the deploy).
    _connect_args["connect_timeout"] = 10

engine = create_engine(
    DATABASE_URL,
    connect_args=_connect_args,
    # Neon suspends idle databases; pre-ping replaces dead pooled connections
    # instead of failing the first request after a wake.
    pool_pre_ping=True,
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
    icon: Mapped[str] = mapped_column(String(48), default="location_on")
    # Set when the contributor uploaded a custom icon image instead of picking
    # a library key; the frontend renders this image inside the pin.
    custom_icon_url: Mapped[str | None] = mapped_column(String(255), default=None)
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
    # Optional photo attached to the comment (full CDN URL or /uploads path).
    image_url: Mapped[str | None] = mapped_column(String(255), default=None)
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


def _ensure_columns() -> None:
    """create_all never adds columns to tables that already exist (dev SQLite
    and the deployed Neon database both predate later schema tweaks) — add any
    missing ones with portable ALTER TABLE statements."""
    from sqlalchemy import inspect, text

    wanted = {
        "comments": {"image_url": "VARCHAR(255)"},
    }
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in wanted.items():
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def _init_schema() -> None:
    """Create tables + apply lightweight migrations. Wrapped so a transient
    database outage at boot can NEVER stop the service from starting — the
    /api/health endpoint stays answerable for diagnosis, and DB-backed routes
    surface their own errors until the database is reachable again."""
    try:
        Base.metadata.create_all(engine)
        _ensure_columns()
    except Exception as e:  # noqa: BLE001 — boot must survive an unreachable DB
        print(f"WARNING: database schema init failed: {e}", flush=True)


_init_schema()
