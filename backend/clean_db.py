from dotenv import load_dotenv
load_dotenv()
import db
from sqlalchemy import text

with db.engine.connect() as conn:
    for table in ["visits", "votes", "ratings", "comments", "place_photos", "places", "sessions", "users"]:
        conn.execute(text(f"DELETE FROM {table}"))
    conn.commit()
    counts = {t: conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() for t in ["users", "places", "comments"]}
print("Neon cleaned:", counts)
