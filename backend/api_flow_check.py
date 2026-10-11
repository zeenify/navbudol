"""End-to-end check of the community platform API (run against a live server).

Usage: ./venv/Scripts/python.exe api_flow_check.py
"""

import base64
import json
import secrets

import httpx

BASE = "http://localhost:8010/api"
c = httpx.Client(base_url=BASE, timeout=30)
failures = 0


def check(name: str, cond: bool, extra: str = "") -> None:
    global failures
    print(("PASS  " if cond else "FAIL  ") + name + (f"  | {extra}" if not cond and extra else ""))
    if not cond:
        failures += 1


# 1x1 transparent PNG
PNG = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d4944415478da63f8ffff3f0300050201f34d3f2f0000000049454e44ae426082"
    )
).decode()

suffix = secrets.token_hex(3)
alice_user, alice_pw = f"alice_{suffix}", "hunter22"

r = c.post("/auth/register", json={"username": alice_user, "password": alice_pw, "display_name": "Alice the Mapper"})
check("register alice", r.status_code == 200, r.text)
alice_token = r.json()["token"]
alice_id = r.json()["user"]["id"]
ah = {"Authorization": f"Bearer {alice_token}"}

r = c.post("/auth/register", json={"username": alice_user, "password": "xxxxxx"})
check("duplicate username rejected (409)", r.status_code == 409, r.text)

r = c.post("/auth/login", json={"username": alice_user, "password": "wrong-pass"})
check("wrong password rejected (401)", r.status_code == 401)

r = c.get("/auth/me", headers=ah)
check("me returns alice", r.status_code == 200 and r.json()["username"] == alice_user)

lat, lng = 15.3519, 121.0633
r = c.post(
    "/places",
    headers=ah,
    json={
        "name": "Kuya Jun's Milk Tea",
        "icon": "local_cafe",
        "description": "Best salted caramel in town.",
        "lat": lat,
        "lng": lng,
        "at": {"lat": lat, "lng": lng},
    },
)
check("create place while on site", r.status_code == 200, r.text)
place = r.json()
pid = place["id"]
check("creator flag set", place["isCreator"] is True)
check("creation counts as verified visit", place["hasVisited"] is True)

# custom icon upload
r = c.post("/place-icons", headers=ah, json={"imageBase64": PNG, "mimeType": "image/png"})
check("upload custom icon", r.status_code == 200, r.text)
icon_url = r.json()["url"]
r = c.patch(f"/places/{pid}", headers=ah, json={"custom_icon_url": icon_url})
check("attach custom icon", r.status_code == 200 and r.json()["customIconUrl"] == icon_url, r.text)
r = c.patch(f"/places/{pid}", headers=ah, json={"custom_icon_url": "https://evil.example/x.png"})
check("foreign icon URL rejected", r.status_code == 400)

r = c.post(
    "/places",
    headers=ah,
    json={"name": "Far place", "lat": lat + 0.5, "lng": lng + 0.5, "at": {"lat": lat, "lng": lng}},
)
check("geofence blocks off-site creation (403)", r.status_code == 403)

r = c.get("/places/nearby", params={"lat": lat, "lng": lng})
check("nearby lists the place", r.status_code == 200 and any(p["id"] == pid for p in r.json()))

r = c.post(
    f"/places/{pid}/photos",
    headers=ah,
    json={"imageBase64": PNG, "mimeType": "image/png", "caption": "Front counter", "at": {"lat": lat, "lng": lng}},
)
check("upload photo", r.status_code == 200, r.text)
photo_url = r.json()["url"]

r = c.get(f"http://localhost:8010{photo_url}")
check("photo served from /uploads", r.status_code == 200)

r = c.post(f"/places/{pid}/comments", headers=ah, json={"text": "Salted caramel is elite."})
check("creator comment is visit-verified", r.status_code == 200 and r.json()["verifiedVisit"] is True, r.text)

r = c.put(f"/places/{pid}/rating", headers=ah, json={"stars": 5})
check("rate 5 -> average 5.0", r.status_code == 200 and r.json()["average"] == 5.0, r.text)

r = c.put(f"/places/{pid}/vote", headers=ah, json={"value": 1})
check("like counted", r.status_code == 200 and r.json()["likes"] == 1)

bob_user = f"bob_{suffix}"
r = c.post("/auth/register", json={"username": bob_user, "password": "hunter23"})
bob_token = r.json()["token"]
bob_id = r.json()["user"]["id"]
bh = {"Authorization": f"Bearer {bob_token}"}

r = c.patch(f"/places/{pid}", headers=bh, json={"name": "Hacked"})
check("non-creator cannot edit (403)", r.status_code == 403)

r = c.post(f"/places/{pid}/comments", headers=bh, json={"text": "Is this place real?"})
check("bob comment unverified (never visited)", r.status_code == 200 and r.json()["verifiedVisit"] is False)
bob_first_comment = r.json()["id"]

r = c.put(f"/places/{pid}/rating", headers=bh, json={"stars": 4})
check("bob rates 4 -> average 4.5", r.status_code == 200 and r.json()["average"] == 4.5, r.text)

r = c.put(f"/places/{pid}/vote", headers=bh, json={"value": -1})
check("dislike counted", r.status_code == 200 and r.json()["dislikes"] == 1)

r = c.post(
    f"/places/{pid}/photos",
    headers=bh,
    json={"imageBase64": PNG, "mimeType": "image/png", "at": {"lat": lat, "lng": lng}},
)
check("bob uploads photo on site", r.status_code == 200, r.text)
bob_photo = r.json()["id"]

r = c.post(f"/places/{pid}/comments", headers=bh, json={"text": "Okay I was actually here."})
check("bob comment verified after on-site photo", r.status_code == 200 and r.json()["verifiedVisit"] is True)

r = c.post(f"/places/{pid}/photos/{bob_photo}/gallery", headers=bh, json={"in_gallery": True})
check("non-creator cannot curate gallery (403)", r.status_code == 403)

r = c.post(f"/places/{pid}/photos/{bob_photo}/gallery", headers=ah, json={"in_gallery": True})
check("creator promotes community photo", r.status_code == 200 and r.json()["inGallery"] is True)

r = c.get(f"/places/{pid}", headers=bh)
d = r.json()
check(
    "detail shape (gallery, comments, myVote)",
    r.status_code == 200
    and len(d["gallery"]) == 1
    and len(d["communityPhotos"]) == 1
    and len(d["comments"]) == 3
    and d["myVote"] == -1
    and d["rating"]["average"] == 4.5,
    json.dumps(d)[:300],
)

r = c.post(f"/places/{pid}/visit", headers=bh, json={"at": {"lat": lat + 0.1, "lng": lng}})
check("far visit rejected (403)", r.status_code == 403)

r = c.get(f"/users/{alice_id}")
check(
    "profile aggregates contributions",
    r.status_code == 200
    and r.json()["stats"]["places"] == 1
    and r.json()["stats"]["photos"] == 1
    and r.json()["stats"]["comments"] == 1,
    r.text,
)

r = c.delete(f"/places/{pid}/comments/{bob_first_comment}", headers=bh)
check("author deletes own comment", r.status_code == 200)

r = c.post(f"/places/{pid}/comments", headers=bh, json={"text": "temp"})
temp_comment = r.json()["id"]
r = c.delete(f"/places/{pid}/comments/{temp_comment}", headers=ah)
check("cannot delete someone else's comment (403)", r.status_code == 403)

print()
if failures:
    print(f"{failures} FAILURE(S)")
    raise SystemExit(1)
print("ALL PASS")
