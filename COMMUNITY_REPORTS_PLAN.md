# NavBudol — Community Reports Plan

> **Status: implemented at case-study scope (2026-09-25).** All six build-order
> steps are live: the report store with kinds/expiry/presence-weighted confirms,
> the search-bar composer, map pins with confirm/dispute/retire, AI retrieval +
> prompt awareness, rerouting around presence-confirmed reports via ORS
> `avoid_polygons` (verified on driving **and** foot-walking), and the
> rain-triggered one-tap flood confirm.
>
> Still true by design: no accounts, no reputation/ban infrastructure, no
> comment threads, JSON-file store, one municipality. The "Out of scope" and
> "Deferred problems" sections remain the standing decision record — read them
> before "fixing" any of it.

---

## 1. The idea in three sentences

People attach **reports** to places and roads. Other people **confirm** them — and a
confirmation from someone who was physically *there* counts for more than a thumbs-up
from a stranger. The AI reads the reports relevant to your request and makes a call:
mention it, suggest something else, or route around it.

Report types are not fixed. Users invent them.

---

## 2. Why this is the differentiator

The map, the routing, and the model are all rented — ORS, Geoapify, Photon, OSM, Gemini
free tiers. Google rents the same brain. So the only defensible asset is **local
knowledge Google structurally cannot hold**, and the interface that gets it out of
people's heads.

Google's place policy rejects non-public places (a farm, a house, a waiting shed), and
their moderation is centralized, so the informal layer of a barangay will never be in
their index. `landmarks.ts` already contains the proof: NEUST Papaya is unmapped in OSM,
so no search engine can find it. That one line of local knowledge is the whole thesis.

**What is genuinely new is not "community reports."** Waze has shipped community hazard
reports with confirmations and automatic expiry since ~2010; OpenStreetMap Notes
(2013) are unstructured map annotations with comments; Yelp and Foursquare Tips are
crowdsourced place attributes. Assume a panel knows this. The defensible claims are
narrow and should be stated exactly:

1. **The AI decides, rather than placing a pin and leaving the decision to the driver.**
2. **Confirmations are weighted by physical presence**, not by popularity.
3. **Reports attach to places, not only to roads** — so "cheap, has aircon, sells
   imported ramen" is expressible. Filters are finite; conversation is infinite.

---

## 3. The data model: one record, two flavors

**A place is a noun. A report is a sentence with a timestamp.**

Both are the same record shape with the same add flow and the same search path. The
only differences are that a place has a name and lasts, while a report has a kind and
an expiry.

The existing record in `backend/routers/locations.py` is already most of the way there:

```jsonc
// today
{ "id", "name", "detail", "lat", "lng", "type", "createdAt" }

// proposed minimal extension
{
  "id": "...",
  "kind": "flood",                     // open vocabulary — users invent kinds
  "text": "This road floods after heavy rain",
  "lat": 15.352, "lng": 121.063,
  "placeId": null,                     // optional: attach to a named place
  "createdAt": "...",
  "expiresAt": "...",                  // shelf life — the only thing "report" means
  "author": "<pseudonymous device id>",
  "confirms": [{ "by": "...", "at": "...", "nearM": 180 }],
  "disputes": [{ "by": "...", "at": "..." }]
}
```

**Shelf life is a field, not a design decision.** A flood report is good for six hours;
"tricycle fare is ₱15" is good for six months. That single field is what lets one
record type cover hazards, conditions, prices, and character notes without a taxonomy.

`type` is currently hardcoded to `"Shared location"`. That is a real bug for this
feature: `nearbyLocal()` scores on name/type/detail, so a user-added carinderia cannot
answer "nearest food" today. Give added places a real kind.

---

## 4. Trust — deliberately simple

Four rules. Resist adding more.

1. **Presence beats popularity.** A confirmation counts for more when the confirmer's
   GPS put them within ~250 m recently. "I was there" > "I agree." The app already
   tracks position (`LocationService`) and distance (`haversineM`), so this is nearly
   free.
2. **Expiry is automatic.** Expired reports stop being displayed and stop being read by
   the AI. Anyone can renew one by confirming it again.
3. **Rank, never gate.** Order by freshness, then presence-confirms, then author track
   record. Weight a new contributor's report lower — never hide it. (Stack Overflow's
   reputation system is precisely what made it hostile to newcomers; do not repeat it.)
4. **The safety rule.** The AI may *mention* any unexpired report, but may only
   *reroute* on one that has at least one presence-confirmation. A single unverified
   note must never be able to send someone down a different road.

**Hard limit: no accusations about people.** "Cheap, has aircon, crowded on market day"
is fine. "The people there are bad" is not — it is defamation risk in a town where
everyone knows everyone's face, and if the AI repeats it, the app is the one making the
claim, out loud. Attributes *of a place* are open season; accusations *about people*
get a closed vocabulary or nothing.

---

## 5. What the AI does with reports

**Retrieval, then reasoning — never "knows all the data."** An LLM cannot hold the
corpus. Per request it retrieves the few reports that matter (near the user, along the
route, matching the request) ranked by trust, and reasons over those.

The consequence worth internalizing: **the AI is only as good as its retrieval.** Pick
the wrong ten reports and the answer is wrong regardless of model quality. Effort
belongs here, not in the prompt. It also keeps Gemini calls small, which keeps the free
tier viable.

Three escalating actions:

| Action | Trigger | Cost |
|---|---|---|
| **Mention** | Any unexpired report near the route | none |
| **Suggest alternative** | Report conflicts with the user's stated preference | none |
| **Reroute** | Report is presence-confirmed | ORS `avoid_polygons` |

The reroute hook already exists: `backend/routers/geo.py` posts to
`ORS_BASE/directions/{profile}/geojson`. ORS accepts `options.avoid_polygons` (a GeoJSON
MultiPolygon, coordinate order `[lng, lat]`) in that same body — buffer each report's
coordinates into a ~130 m square and the route genuinely goes around it. **Verified live
against ORS on both `driving-car` and `foot-walking`**, with a retry-without-the-option
fallback on HTTP 400.

Two rules learned in browser testing, enforced in `ReportsService.avoidPoints()`:

- **Never route around a pin at your own position or at the destination.** Avoid boxes
  at the origin threw a 3.4 km trip out to 12.6 km — you cannot avoid where you already
  are, so those reports are *mentioned* instead (250 m skip at the origin, 150 m at the
  destination).
- **"On the way" means within ~400 m of the straight origin→destination line**, not a
  bounding box — and ORS only detours when the box actually touches the road; a pin
  223 m off the road was accepted but ignored, which is the correct behavior.

New function declarations for `gemini.service.ts` (keep it to three):

- `add_report(kind, text)` — attach to the user's current location or a named place
- `confirm_report(report_id)` — "still true," stamped with the confirmer's distance
- `get_reports_here()` / reports along the active route — the retrieval function

---

## 6. Reporting supply: ask, don't wait

This is the real bottleneck, not the AI and not the trust model. Waze works because
drivers have the app open for an hour with the map up, so a report costs two taps.
NavBudol users open it for a ten-minute trip, so friction kills contribution.

**Ask instead of waiting.** OpenWeatherMap is already wired (`get_weather`,
`/api/weather`). When it is raining and the user passes a known flood-prone report
point, ask one question with one tap: *flooded here?* Reporting should be a **response**,
almost never an unprompted composition.

---

## 7. Humans must see the reports too

If the AI is the only reader, nobody contributes, because nobody sees their own
contribution land. Reports need to be visible on the map — pins with kind icons, a
freshness indicator, and a confirm/dispute action — plus the AI's spoken summary.

---

## 8. Where it plugs into the existing app

| Piece | File | Change |
|---|---|---|
| Report + place store | `backend/routers/locations.py` | add `kind`, `expiresAt`, `author`, `confirms`, `disputes`; `placeId` link |
| Service-area fence | `app/src/app/core/service-area.ts` | reuse as-is (20 km radius) |
| Local search pool | `places.service.ts` → `searchLocal()`, `nearbyLocal()` | rank reports in; stop hardcoding `type` |
| Retrieval for the AI | `gemini.service.ts` → `executeFunction()` | three new tools |
| Reroute | `backend/routers/geo.py` → `/api/directions` | pass `options.avoid_polygons` |
| Add/report UI | `map/components/search-bar/search-bar.component.ts` (existing add flow, line ~105) | add kind + text, and one-tap confirm prompts |
| Map pins | map page / markers | render reports with freshness state |

---

## 9. Build order

1. **Store**: extend the record; add `kind`, `expiresAt`, `confirms`; keep one endpoint.
2. **Add + display**: pick a kind, write text, see it on the map. Human-visible first —
   this is the loop that has to work before anything else matters.
3. **Confirm/dispute** with presence weighting (distance stamp at confirm time).
4. **Retrieval + AI mention** — the AI reads nearby reports and mentions them. No
   rerouting yet.
5. **Reroute** via `avoid_polygons` for presence-confirmed reports only.
6. **Weather-triggered one-tap prompts** for supply.

Stop after step 4 if time is short. Steps 1–4 are the case study.

---

## 10. Out of scope (deliberate)

Not to be built for this case study. Each one is either a scale problem or a moderation
problem, and neither exists without real users:

- accounts, login, or identity
- banning, flagging, or reputation infrastructure
- comment threads on reports (use structured confirm/dispute + one optional line)
- a category taxonomy / report-type picker hierarchy
- a moderation dashboard
- a real database — the JSON file + `RLock` is demo-grade and fine at this scale
- multi-town support (one municipality is the moat, not a limitation)
- offline map tiles, photo attachments, push notifications

---

## 11. Deferred problems (known, parked on purpose)

Recording these is a defense strength: it shows the edge cases were considered and
deliberately deferred, not missed.

| Problem | Why deferred |
|---|---|
| Downvote brigading — a shop owner's friends bury a true "flooded road" report | Needs real users and real abuse. Presence-weighting and expiry blunt it in the meantime. |
| Like-counts look authoritative at small N (40 users → every report shows 3 likes) | Arguing about it now is pointless; visibility counts are only misleading once there is a user base. |
| Two reports contradicting each other at the same spot | Resolve later by freshness + presence-confirms. Do not build conflict resolution yet. |
| Reports are stale at read time in no-signal areas | Accept it; show "last confirmed" and let the AI say how old it is. |
| Moderation is a human job, permanently, and it's you | Accepted cost of the feature. Revisit if it ever grows past one town. |
| Open vocabulary invites junk kinds | Let the AI read them; consolidate only if real usage shows duplicates. |
| `avoidedReports` counts the avoidances *requested*; whether ORS actually detoured isn't double-checked | Telling the difference costs a second ORS call per route. With pins on the corridor road the detour is real; noted honestly rather than faked. |
| One flaky UI click observed during automated testing (a pill button needed a second attempt) | Not reproducible; all bindings verified working via direct dispatch and subsequent runs. Real-device testing will confirm. |

---

## 12. What to claim, what not to claim

**Claim** (precise, defensible):

> Community knowledge about a place that expires, confirmed by people who were actually
> there, that the AI reasons over to recommend or reroute — for one municipality that
> no global map covers at this granularity.

**Do not claim**:

- that community reporting is new (Waze, OSM Notes, Yelp, Foursquare Tips)
- that AI navigation is new (Gemini ships inside Google Maps)
- that free infrastructure is an advantage (it is a constraint, and Google pays for
  neither our map nor our model)

---

## Related

- [NAVBUDOL_PLAN.md](./NAVBUDOL_PLAN.md) — full blueprint, §16 points here
- [README.md](./README.md) — how to run it
