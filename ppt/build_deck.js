const pptxgen = require("pptxgenjs");

// palette — night-navigation: deep ink map, route blue, signal amber
const BG = "0D1B2A", PANEL = "14283E", PRIMARY = "2F80ED", ACCENT = "F5A524";
const TEXT = "EAF2FB", MUTED = "8FA6BD", HAIR = "23405F";
const KIND = { flood: "2F80ED", checkpoint: "E5484D", hazard: "F08C00", fare: "2F9E44" };
const F = "Segoe UI";
const W = 13.33, H = 7.5, M = 0.65;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Martin, Aberin, Quijano";
pres.title = "NavBudol - Title Defense";

const kicker = (s, txt) => s.addText(txt, { x: M, y: 0.52, w: 9, h: 0.3, fontFace: F, fontSize: 12, color: MUTED, charSpacing: 4, bold: true, margin: 0 });
const headline = (s, txt, w) => s.addText(txt, { x: M, y: 0.88, w: w || (W - 2 * M), h: 0.75, fontFace: F, fontSize: 30, color: TEXT, bold: true, margin: 0 });
const pageNo = (s, n) => s.addText(`NavBudol  ·  ${n} / 8`, { x: W - 3.2, y: H - 0.48, w: 2.55, h: 0.3, fontFace: F, fontSize: 12, color: MUTED, align: "right", margin: 0 });
const dot = (s, x, y, color, d) => s.addShape(pres.shapes.OVAL, { x, y, w: d || 0.14, h: d || 0.14, fill: { color }, line: { type: "none" } });
const hair = (s, x, y, w) => s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: HAIR, width: 0.75 } });

// ---------- 1 · cover ----------
let s = pres.addSlide();
s.background = { color: BG };
s.addText("NEUST  ·  PAPAYA OFF-CAMPUS  ·  TITLE DEFENSE", { x: M, y: 1.0, w: 9.5, h: 0.32, fontFace: F, fontSize: 12.5, color: MUTED, charSpacing: 4, bold: true, margin: 0 });
s.addText("NavBudol", { x: M, y: 1.5, w: 11, h: 1.35, fontFace: F, fontSize: 66, color: TEXT, bold: true, margin: 0 });
s.addText("A voice-first, AI-powered navigation companion with community road intelligence and probe traffic detection for General Tinio, Nueva Ecija.", { x: M, y: 3.05, w: 10.6, h: 1.0, fontFace: F, fontSize: 17, color: MUTED, margin: 0 });
// route-line motif: the road from question to destination
s.addShape(pres.shapes.LINE, { x: M, y: 5.0, w: W - 2 * M, h: 0, line: { color: PRIMARY, width: 2.25 } });
dot(s, 2.1, 4.93, PRIMARY, 0.16);
dot(s, 7.3, 4.93, PRIMARY, 0.16);
dot(s, 11.85, 4.87, ACCENT, 0.28);
s.addText("the question", { x: 1.45, y: 5.2, w: 1.8, h: 0.28, fontFace: F, fontSize: 12, color: MUTED, margin: 0 });
s.addText("the road", { x: 6.6, y: 5.2, w: 1.6, h: 0.28, fontFace: F, fontSize: 12, color: MUTED, margin: 0 });
s.addText("General Tinio", { x: 11.15, y: 5.28, w: 1.7, h: 0.28, fontFace: F, fontSize: 12, color: ACCENT, margin: 0 });
s.addText([
  { text: "Edrick V. Martin      John Cedrick G. Aberin      Justine Quijano", options: { breakLine: true } },
  { text: "Nueva Ecija University of Science and Technology - Papaya Off-Campus", options: {} },
], { x: M, y: 6.25, w: 11.5, h: 0.85, fontFace: F, fontSize: 14, color: TEXT, paraSpaceAfter: 6, margin: 0 });

// ---------- 2 · intro: the problem ----------
s = pres.addSlide();
s.background = { color: BG };
kicker(s, "INTRODUCTION");
headline(s, "Global maps index businesses - not barangays.");
s.addText("Getting around a small town like General Tinio relies on knowledge that no global map holds. Navigation apps are built for the world's average place: they rank restaurants, not rice fields; they verify businesses over weeks, not neighbors in seconds. What actually gets you there is word of mouth - and it disappears the moment the person who knows it goes home.", { x: M, y: 2.05, w: 6.1, h: 3.4, fontFace: F, fontSize: 15.5, color: TEXT, margin: 0 });
const miss = [
  ["Unmarked farms and houses", KIND.flood],
  ["Waiting sheds and informal landmarks", KIND.checkpoint],
  ["Streets that flood after heavy rain", KIND.hazard],
  ["Fares that live only in residents' heads", KIND.fare],
];
miss.forEach(([t, c], i) => {
  dot(s, 7.35, 2.32 + i * 0.92, c, 0.16);
  s.addText(t, { x: 7.68, y: 2.18 + i * 0.92, w: 5.0, h: 0.45, fontFace: F, fontSize: 15.5, color: TEXT, bold: true, margin: 0 });
});
s.addText("Invisible to every global map - known to every resident.", { x: 7.35, y: 5.95, w: 5.3, h: 0.55, fontFace: F, fontSize: 12.5, color: MUTED, margin: 0 });
s.addText("Rural travelers navigate by word of mouth - and there is no map for it.", { x: M, y: 6.35, w: 6.4, h: 0.75, fontFace: F, fontSize: 15.5, color: ACCENT, bold: true, margin: 0 });
pageNo(s, 2);

// ---------- 3 · intro: what NavBudol is ----------
s = pres.addSlide();
s.background = { color: BG };
kicker(s, "INTRODUCTION");
headline(s, "A co-pilot that reads the town - and decides.");
// inputs (left column)
const inputs = [
  ["Places & routes", "OSRM/ORS routing, elevation, honest travel times"],
  ["Community reports", "expiring, presence-weighted, confirmed on site"],
  ["Probe traffic signals", "measured speed vs expected speed"],
];
inputs.forEach(([t, d], i) => {
  const y = 2.2 + i * 1.16;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y, w: 3.45, h: 0.98, fill: { color: PANEL }, line: { type: "none" }, rectRadius: 0.06 });
  s.addText([
    { text: t, options: { bold: true, fontSize: 14.5, color: TEXT, breakLine: true } },
    { text: d, options: { fontSize: 11.5, color: MUTED } },
  ], { x: M + 0.18, y: y + 0.12, w: 3.12, h: 0.78, fontFace: F, margin: 0 });
});
// co-pilot (center, focal)
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.95, y: 2.95, w: 3.35, h: 1.6, fill: { color: PRIMARY }, line: { type: "none" }, rectRadius: 0.08, shadow: { type: "outer", color: "000000", blur: 8, offset: 3, angle: 90, opacity: 0.3 } });
s.addText([
  { text: "NavBudol co-pilot", options: { bold: true, fontSize: 17, color: "FFFFFF", breakLine: true } },
  { text: "character personas, real TTS voices", options: { fontSize: 11.5, color: "D7E6FA" } },
], { x: 5.15, y: 3.2, w: 3.0, h: 1.1, fontFace: F, margin: 0 });
// decisions (right, accent)
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.1, y: 2.95, w: 3.55, h: 1.6, fill: { color: ACCENT }, line: { type: "none" }, rectRadius: 0.08 });
s.addText([
  { text: "Mention · Suggest · Reroute", options: { bold: true, fontSize: 14.5, color: BG, breakLine: true } },
  { text: "the AI decides, on the route ahead", options: { fontSize: 11.5, color: "5C430E" } },
], { x: 9.3, y: 3.2, w: 3.2, h: 1.1, fontFace: F, margin: 0 });
// connectors: inputs converge on the co-pilot, co-pilot points to decisions
s.addShape(pres.shapes.LINE, { x: 4.12, y: 2.71, w: 0.82, h: 1.0, line: { color: PRIMARY, width: 1.75 } });
s.addShape(pres.shapes.LINE, { x: 4.12, y: 3.78, w: 0.82, h: 0, line: { color: PRIMARY, width: 1.75 } });
s.addShape(pres.shapes.LINE, { x: 4.12, y: 3.78, w: 0.82, h: 1.22, flipV: true, line: { color: PRIMARY, width: 1.75 } });
s.addShape(pres.shapes.LINE, { x: 8.36, y: 3.75, w: 0.68, h: 0, line: { color: ACCENT, width: 2, endArrowType: "triangle" } });
s.addText("The traveler speaks; the co-pilot answers aloud - in character, on the map, on the route.", { x: M, y: 5.75, w: 11.0, h: 0.5, fontFace: F, fontSize: 14.5, color: TEXT, margin: 0 });
s.addText("Free-tier stack: OpenStreetMap data, OpenRouteService routing, Gemini AI, Fish Audio voices, Neon PostgreSQL accounts.", { x: M, y: 6.45, w: 11.5, h: 0.4, fontFace: F, fontSize: 12, color: MUTED, margin: 0 });
pageNo(s, 3);

// ---------- 4 · scope at a glance ----------
s = pres.addSlide();
s.background = { color: BG };
kicker(s, "SCOPE AND DELIMITATION");
headline(s, "Five parts, one town.");
const parts = [
  ["Core navigation & AI co-pilot", "voice search, route plotting, turn-by-turn guidance - driving and walking, with elevation and honest travel times"],
  ["Community knowledge layer", "shared places, expiring reports, presence-weighted confirmations"],
  ["Probe-based traffic detection", "measured speed vs expected speed per road segment, aggregated into expiring signals"],
  ["AI decisions & trip tools", "route-aware mentions, trip history, saved places, shareable ETA"],
  ["Platform & delivery", "Android (Capacitor) + browsers, 20 km service fence around General Tinio, English, zero-cost free tiers"],
];
parts.forEach(([t, d], i) => {
  const y = 2.0 + i * 1.02;
  s.addText(`0${i + 1}`, { x: M, y: y + 0.04, w: 0.95, h: 0.62, fontFace: F, fontSize: 28, color: PRIMARY, bold: true, margin: 0 });
  s.addText([
    { text: t, options: { bold: true, fontSize: 16.5, color: TEXT, breakLine: true } },
    { text: d, options: { fontSize: 12.5, color: MUTED } },
  ], { x: 1.75, y, w: 10.9, h: 0.94, fontFace: F, margin: 0 });
  if (i < 4) hair(s, 1.75, y + 0.96, 10.9);
});
pageNo(s, 4);

// ---------- 5 · scope: community knowledge layer ----------
s = pres.addSlide();
s.background = { color: BG };
kicker(s, "SCOPE AND DELIMITATION");
headline(s, "The town's memory - with a trust model.");
const comm = [
  ["Shared locations", "any resident drops a pin and names it - a house, a farm, a waiting shed - and it appears in everyone's search instantly"],
  ["Expiring reports", "floods, checkpoints, hazards, fares - each kind has a shelf life, after which the report retires itself"],
  ["Presence-weighted trust", "confirmations are stamped with distance: on-site neighbors outrank strangers; disputes and retirement keep data honest"],
  ["Accounts on PostgreSQL", "identities and contributions served from a Neon cloud database - attribution for every report"],
];
comm.forEach(([t, d], i) => {
  const y = 1.98 + i * 1.0;
  dot(s, M + 0.02, y + 0.13, ACCENT, 0.15);
  s.addText([
    { text: t + "  -  ", options: { bold: true, fontSize: 16, color: TEXT } },
    { text: d, options: { fontSize: 13.5, color: MUTED } },
  ], { x: 1.05, y, w: 11.5, h: 0.92, fontFace: F, margin: 0 });
  if (i < 3) hair(s, 1.05, y + 0.9, 11.5);
});
s.addText("REPORT KINDS", { x: M, y: 6.18, w: 2.2, h: 0.3, fontFace: F, fontSize: 12, color: MUTED, charSpacing: 3, bold: true, margin: 0 });
Object.entries(KIND).forEach(([k, c], i) => {
  const x = 2.9 + i * 2.35;
  dot(s, x, 6.24, c, 0.16);
  s.addText(k[0].toUpperCase() + k.slice(1), { x: x + 0.26, y: 6.14, w: 1.9, h: 0.32, fontFace: F, fontSize: 13, color: TEXT, margin: 0 });
});
pageNo(s, 5);

// ---------- 6 · scope: probe traffic detection ----------
s = pres.addSlide();
s.background = { color: BG };
kicker(s, "SCOPE AND DELIMITATION");
headline(s, "Every trip is a traffic sensor.");
const steps = [
  ["Measure", "while navigating, the app times each road segment against its known length"],
  ["Compare", "actual speed vs the routing engine's expected speed, per segment"],
  ["Aggregate", "sustained slowdowns become live signals that expire within the hour"],
  ["Reroute", "confirmed congestion steers routes away - like floods and checkpoints"],
];
steps.forEach(([t, d], i) => {
  const x = M + i * 3.12;
  s.addShape(pres.shapes.OVAL, { x, y: 2.15, w: 0.56, h: 0.56, fill: { color: i === 3 ? ACCENT : PRIMARY }, line: { type: "none" } });
  s.addText(String(i + 1), { x, y: 2.15, w: 0.56, h: 0.56, fontFace: F, fontSize: 18, color: i === 3 ? BG : "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0 });
  s.addText(t, { x, y: 2.92, w: 2.75, h: 0.4, fontFace: F, fontSize: 16.5, color: TEXT, bold: true, margin: 0 });
  s.addText(d, { x, y: 3.36, w: 2.75, h: 1.5, fontFace: F, fontSize: 12.5, color: MUTED, margin: 0 });
  if (i < 3) s.addShape(pres.shapes.LINE, { x: x + 0.72, y: 2.43, w: 2.22, h: 0, line: { color: HAIR, width: 1.5, endArrowType: "triangle" } });
});
s.addText("On Nueva Ecija's barangay roads, our users' phones are the only traffic sensors that exist.", { x: M, y: 5.35, w: 11.5, h: 0.6, fontFace: F, fontSize: 15.5, color: ACCENT, bold: true, margin: 0 });
s.addText("Evidence gates the response: weak signals are mentioned by the AI, confirmed congestion is routed around - and everything expires.", { x: M, y: 6.15, w: 11.5, h: 0.45, fontFace: F, fontSize: 12.5, color: MUTED, margin: 0 });
pageNo(s, 6);

// ---------- 7 · limitations ----------
s = pres.addSlide();
s.background = { color: BG };
kicker(s, "LIMITATIONS");
headline(s, "Honest limits, by design.");
const lims = [
  ["User-dependent traffic evidence", "probe signals need active riders on the road; with few users, congestion data is sparse, and demonstration relies on the built-in simulated travel mode."],
  ["Internet dependency", "AI conversation, routing, community reports, and traffic detection all require a stable Wi-Fi or data connection - there is no offline mode."],
  ["Single-town focus", "datasets and evaluation center on General Tinio; the free-tier AI adds 10-60 second response times, and third-party traffic APIs were evaluated and rejected for lacking barangay-road coverage."],
];
lims.forEach(([t, d], i) => {
  const y = 2.15 + i * 1.55;
  dot(s, M + 0.02, y + 0.14, ACCENT, 0.15);
  s.addText([
    { text: t, options: { bold: true, fontSize: 17.5, color: TEXT, breakLine: true } },
    { text: d, options: { fontSize: 13.5, color: MUTED } },
  ], { x: 1.05, y, w: 11.5, h: 1.35, fontFace: F, margin: 0 });
  if (i < 2) hair(s, 1.05, y + 1.4, 11.5);
});
pageNo(s, 7);

// ---------- 8 · closing ----------
s = pres.addSlide();
s.background = { color: BG };
s.addText("Thank you.", { x: M, y: 2.3, w: 11, h: 1.1, fontFace: F, fontSize: 54, color: TEXT, bold: true, margin: 0 });
s.addText("NavBudol - the town's live map.", { x: M, y: 3.55, w: 10, h: 0.5, fontFace: F, fontSize: 16, color: ACCENT, bold: true, margin: 0 });
s.addShape(pres.shapes.LINE, { x: M, y: 4.75, w: W - 2 * M, h: 0, line: { color: PRIMARY, width: 2.25 } });
dot(s, 2.1, 4.68, PRIMARY, 0.16);
dot(s, 7.3, 4.68, PRIMARY, 0.16);
dot(s, 11.85, 4.62, ACCENT, 0.28);
s.addText([
  { text: "Edrick V. Martin      John Cedrick G. Aberin      Justine Quijano", options: { breakLine: true } },
  { text: "Nueva Ecija University of Science and Technology - Papaya Off-Campus", options: {} },
], { x: M, y: 5.9, w: 11.5, h: 0.85, fontFace: F, fontSize: 14, color: TEXT, paraSpaceAfter: 6, margin: 0 });

pres.writeFile({ fileName: "NavBudol_Defense.pptx" }).then(() => console.log("WROTE NavBudol_Defense.pptx"));
