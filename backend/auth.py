"""Authentication: bcrypt password hashing + opaque session tokens.

No JWT config to babysit — a session is a random 32-byte token stored in the
sessions table (revocable, no expiry secrets to leak). The client sends
`Authorization: Bearer <token>`.
"""

from typing import Callable

import bcrypt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from db import SessionToken, User, get_db, new_token

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        return False


def _current_user(required: bool) -> Callable[..., User | None]:
    def dep(
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
        db: Session = Depends(get_db),
    ) -> User | None:
        if creds is None or not creds.credentials:
            if required:
                raise HTTPException(status_code=401, detail="Sign in to do that.")
            return None
        session = db.get(SessionToken, creds.credentials)
        if session is None:
            if required:
                raise HTTPException(status_code=401, detail="Session expired — sign in again.")
            return None
        user = db.get(User, session.user_id)
        if user is None and required:
            raise HTTPException(status_code=401, detail="Account no longer exists.")
        return user

    return dep


require_user = _current_user(required=True)
optional_user = _current_user(required=False)


def start_session(db: Session, user: User) -> str:
    token = new_token()
    db.add(SessionToken(token=token, user_id=user.id))
    db.commit()
    return token


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "displayName": user.display_name,
        "avatar": user.avatar,
        "bio": user.bio,
        "createdAt": user.created_at.isoformat(),
    }
