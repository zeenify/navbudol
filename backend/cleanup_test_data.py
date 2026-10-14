"""Remove artifacts created by automated test runs (api_flow_check.py and
browser E2E). The real user account and their places are left untouched."""

from dotenv import load_dotenv

load_dotenv()
import db
from sqlalchemy import text

TEST_USERS = ("alice_", "bob_", "edricktest")


def _is_test_user(username: str) -> bool:
    return username == "edricktest" or username.startswith("alice_") or username.startswith("bob_")


def _in(column: str, values: list[str]) -> tuple[str, dict]:
    names = {f"p{i}": v for i, v in enumerate(values)}
    placeholders = ", ".join(f":{k}" for k in names)
    return f"{column} IN ({placeholders})", names


def main() -> None:
    with db.engine.begin() as conn:
        users = conn.execute(text("SELECT id, username FROM users")).all()
        ids = [uid for uid, name in users if _is_test_user(name)]
        if not ids:
            print("nothing to clean")
            return
        sql, params = _in("creator_id", ids)
        place_ids = [pid for (pid,) in conn.execute(text(f"SELECT id FROM places WHERE {sql}"), params).all()]

        for table, columns in [
            ("comments", ["author_id", "place_id"]),
            ("place_photos", ["uploader_id", "place_id"]),
            ("ratings", ["user_id", "place_id"]),
            ("votes", ["user_id", "place_id"]),
            ("visits", ["user_id", "place_id"]),
        ]:
            clauses = []
            allparams = {}
            for col in columns:
                values = ids if col not in ("place_id",) else place_ids
                if not values:
                    continue
                sql, params = _in(col, values)
                clauses.append(sql)
                allparams.update(params)
            if clauses:
                conn.execute(text(f"DELETE FROM {table} WHERE {' OR '.join(clauses)}"), allparams)

        if place_ids:
            sql, params = _in("id", place_ids)
            conn.execute(text(f"DELETE FROM places WHERE {sql}"), params)
        for table in ("sessions", "users"):
            sql, params = _in("user_id" if table == "sessions" else "id", ids)
            conn.execute(text(f"DELETE FROM {table} WHERE {sql}"), params)

        remaining = {t: conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() for t in ["users", "places", "comments"]}
        print("cleaned test artifacts; remaining:", remaining)
        print("users kept:", [u for (u,) in conn.execute(text("SELECT username FROM users")).all()])


if __name__ == "__main__":
    main()
