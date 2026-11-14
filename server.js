// EventraX CME Attendance Portal — zero-dependency Node.js server
// Run:  ADMIN_PASSWORD=yourpass PORT=3000 node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin@123";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILES_DIR = path.join(DATA_DIR, "files");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
fs.mkdirSync(FILES_DIR, { recursive: true });

/* ---------------- storage ---------------- */
const DEFAULT = {
  settings: {
    org: "INDIAN ACADEMY OF PEDIATRICS",
    name: "ACT ALLERGY WORKSHOP",
    date: "2026-11-14",
    credits: 2,
    tnmcRef: "",
    venue: "",
    lat: null, lng: null, radius: 200,
    accLimit: 150,            // reject if GPS accuracy worse than this (m); 0 = off
    deskSkipLocation: false,  // tech-team desk link skips location check
    open: true,               // accepting applications
    paid: false, fee: 0, upi: "", payee: "",
    autoApproveFree: true,
    deskKey: crypto.randomBytes(5).toString("hex"),
  },
  attendees: [], apps: [], blocked: [], seq: 1000,
};
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); db.settings = { ...DEFAULT.settings, ...db.settings }; }
catch { db = JSON.parse(JSON.stringify(DEFAULT)); }
function save() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
save();

/* ---------------- helpers ---------------- */
const tokens = new Set();
const norm = m => String(m || "").replace(/\D/g, "").slice(-10);
function hav(a, b, c, d) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((ok, bad) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > 15e6) { bad(new Error("Payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { bad(e); } });
  });
}
function saveImage(dataUrl, prefix) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const name = `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(FILES_DIR, name), Buffer.from(m[2], "base64"));
  return name;
}
function isDesk(key) { return key && key === db.settings.deskKey; }
function stamp() { return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }); }
function logBlock(mobile, reason, via) { db.blocked.push({ t: stamp(), mobile: mobile || "", reason, via }); save(); }
function publicAtt(a) {
  const applied = db.apps.find(x => x.attId === a.id && x.status !== "rejected");
  return { id: a.id, name: a.name, role: a.role, email: a.email, mci: a.mci, regid: a.regid, institution: a.institution,
           mobileMasked: a.mobile ? a.mobile.replace(/^(\d{2})\d{5}(\d{3})$/, "$1•••••$2") : "", hasMobile: !!a.mobile,
           applied: applied ? applied.id : null };
}
function liveApps() { return db.apps.filter(a => a.status !== "rejected"); }

/* ---------------- static ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveStatic(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---------------- routes ---------------- */
async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const S = db.settings;

  // pages
  if (req.method === "GET" && (p === "/" || p === "/apply")) return serveStatic(res, path.join(PUBLIC_DIR, "apply.html"));
  if (req.method === "GET" && p === "/desk") return serveStatic(res, path.join(PUBLIC_DIR, "apply.html"));
  if (req.method === "GET" && p === "/admin") return serveStatic(res, path.join(PUBLIC_DIR, "admin.html"));
  if (req.method === "GET" && p.startsWith("/static/")) return serveStatic(res, path.join(PUBLIC_DIR, path.basename(p)));

  /* ---- public API ---- */
  if (p === "/api/event" && req.method === "GET") {
    const desk = url.searchParams.get("desk");
    if (desk != null && !isDesk(desk)) return send(res, 403, { error: "This help-desk link is invalid or has been reset. Ask the organiser for the new link." });
    return send(res, 200, {
      org: S.org, name: S.name, date: S.date, credits: S.credits, venue: S.venue, radius: S.radius, accLimit: S.accLimit,
      open: S.open, paid: S.paid, fee: S.fee, upi: S.upi, payee: S.payee, locationSet: S.lat != null && S.lng != null,
      desk: isDesk(desk), skipLocation: isDesk(desk) && S.deskSkipLocation,
    });
  }

  if (p === "/api/lookup" && req.method === "POST") {
    const b = await body(req);
    const desk = isDesk(b.desk), via = desk ? "desk" : "self";
    if (!S.open) return send(res, 400, { error: "CME applications are closed." });
    if (desk) {
      const q = String(b.q || "").trim().toLowerCase(); if (q.length < 2) return send(res, 200, { results: [] });
      const qd = q.replace(/\D/g, "");
      const results = db.attendees.filter(a => a.name.toLowerCase().includes(q) || (qd.length >= 4 && a.mobile.includes(qd)) || (a.mci || "").toLowerCase().includes(q)).slice(0, 15).map(publicAtt);
      return send(res, 200, { results });
    }
    const mobile = norm(b.mobile);
    if (mobile.length !== 10) return send(res, 400, { error: "Enter a valid 10-digit mobile number." });
    const matches = db.attendees.filter(a => a.mobile === mobile);
    if (!matches.length) { logBlock(mobile, "Not in registered attendee list", via); return send(res, 400, { error: "This mobile number is <b>not in the conference registration list</b>. Only registered delegates can apply. Please contact the registration / help desk." }); }
    const prev = liveApps().find(a => a.mobile === mobile);
    if (prev) { logBlock(mobile, `Duplicate mobile (already ${prev.id})`, via); return send(res, 400, { error: `An application has <b>already been submitted</b> from this mobile number (${prev.id}). Only one application per mobile is allowed.` }); }
    const dev = b.device && liveApps().find(a => a.via === "self" && a.device === b.device);
    if (dev) { logBlock(mobile, `Device already used for ${dev.name}`, via); return send(res, 400, { error: `This phone has <b>already been used to apply for ${dev.name}</b>. Each delegate must apply from their own phone, or go to the CME help desk.` }); }
    return send(res, 200, { results: matches.map(publicAtt) });
  }

  if (p === "/api/apply" && req.method === "POST") {
    const b = await body(req);
    const desk = isDesk(b.desk), via = desk ? "desk" : "self";
    if (!S.open) return send(res, 400, { error: "CME applications are closed." });
    const att = db.attendees.find(a => a.id === b.attId);
    if (!att) return send(res, 400, { error: "Attendee not found in the registration list." });
    const mobile = att.mobile || (desk ? norm(b.mobile) : "");
    if (mobile.length !== 10) return send(res, 400, { error: "A valid 10-digit mobile number is required." });
    if (!desk && norm(b.mobile) !== att.mobile) return send(res, 400, { error: "Mobile number mismatch." });
    if (liveApps().find(a => a.attId === att.id)) { logBlock(mobile, "Duplicate attendee", via); return send(res, 400, { error: "This delegate has already applied." }); }
    if (liveApps().find(a => a.mobile === mobile)) { logBlock(mobile, "Duplicate mobile", via); return send(res, 400, { error: "An application already exists for this mobile number." }); }
    if (!desk) {
      if (!b.device) return send(res, 400, { error: "Device not identified. Please reload the page." });
      const dev = liveApps().find(a => a.via === "self" && a.device === b.device);
      if (dev) { logBlock(mobile, `Device already used for ${dev.name}`, via); return send(res, 400, { error: `This phone was already used to apply for ${dev.name}.` }); }
    }
    // location
    let distance = null;
    const needLoc = !(desk && S.deskSkipLocation);
    if (needLoc) {
      if (S.lat == null || S.lng == null) return send(res, 400, { error: "Venue location is not configured yet. Please contact the organiser." });
      if (typeof b.lat !== "number" || typeof b.lng !== "number") return send(res, 400, { error: "Location is required." });
      distance = Math.round(hav(S.lat, S.lng, b.lat, b.lng));
      if (distance > S.radius) { logBlock(mobile, `Outside venue: ${distance} m (limit ${S.radius} m)`, via); return send(res, 400, { error: `You are ${distance >= 1000 ? (distance / 1000).toFixed(1) + " km" : distance + " m"} from the venue. You must be within ${S.radius} m.` }); }
      if (S.accLimit && b.acc > S.accLimit) return send(res, 400, { error: `GPS accuracy is too low (±${Math.round(b.acc)} m). Turn on Location / GPS (high accuracy) and try again.` });
    }
    // details
    const mci = String(b.mci || "").trim();
    if (!mci) return send(res, 400, { error: "MCI / TNMC registration number is required." });
    if (!b.sig) return send(res, 400, { error: "Signature is required." });
    let utr = "", shot = null;
    if (S.paid) {
      utr = String(b.utr || "").replace(/\s/g, "");
      if (!/^\d{12}$/.test(utr)) return send(res, 400, { error: "Enter the 12-digit UPI transaction / UTR number." });
      if (db.apps.find(a => a.utr === utr && a.status !== "rejected")) return send(res, 400, { error: "This UTR number has already been used." });
      shot = saveImage(b.shot, "pay"); if (!shot) return send(res, 400, { error: "Payment screenshot is required." });
    }
    const sig = saveImage(b.sig, "sig"); if (!sig) return send(res, 400, { error: "Invalid signature image." });
    const app = {
      id: "CME-" + (++db.seq), attId: att.id, name: att.name, role: att.role, regid: att.regid, institution: att.institution,
      mobile, email: String(b.email || att.email || "").trim(), mci,
      lat: b.lat ?? null, lng: b.lng ?? null, acc: b.acc ?? null, distance,
      device: desk ? "" : b.device, via, deskBy: desk ? String(b.deskBy || "").slice(0, 40) : "",
      utr, shot, sig, status: (!S.paid && S.autoApproveFree) ? "approved" : "pending", createdAt: stamp(),
    };
    // keep the attendee master updated with corrected details
    if (!att.mobile) att.mobile = mobile;
    att.mci = mci; if (app.email) att.email = app.email;
    db.apps.push(app); save();
    return send(res, 200, { ok: true, id: app.id, status: app.status });
  }

  /* ---- admin API ---- */
  if (p === "/api/admin/login" && req.method === "POST") {
    const b = await body(req);
    if (b.password !== ADMIN_PASSWORD) return send(res, 401, { error: "Wrong password" });
    const t = crypto.randomBytes(16).toString("hex"); tokens.add(t); return send(res, 200, { token: t });
  }
  if (p.startsWith("/api/admin/")) {
    const t = req.headers["x-admin-token"] || url.searchParams.get("t");
    if (!tokens.has(t)) return send(res, 401, { error: "Login required" });

    if (p === "/api/admin/state" && req.method === "GET") return send(res, 200, db);

    if (p === "/api/admin/settings" && req.method === "POST") {
      const b = await body(req);
      for (const k of Object.keys(DEFAULT.settings)) if (k in b && k !== "deskKey") db.settings[k] = b[k];
      ["credits", "radius", "accLimit", "fee"].forEach(k => db.settings[k] = +db.settings[k] || 0);
      ["lat", "lng"].forEach(k => db.settings[k] = db.settings[k] === "" || db.settings[k] == null ? null : +db.settings[k]);
      save(); return send(res, 200, { ok: true, settings: db.settings });
    }
    if (p === "/api/admin/desk-key" && req.method === "POST") {
      db.settings.deskKey = crypto.randomBytes(5).toString("hex"); save(); return send(res, 200, { deskKey: db.settings.deskKey });
    }
    if (p === "/api/admin/attendees" && req.method === "POST") {
      const b = await body(req);
      const rows = (b.rows || []).map(r => ({
        id: "A" + crypto.randomBytes(4).toString("hex"), regid: String(r.regid || "").trim(), name: String(r.name || "").trim(),
        mobile: norm(r.mobile), email: String(r.email || "").trim(), mci: String(r.mci || "").trim(),
        role: String(r.role || "Delegate").trim() || "Delegate", institution: String(r.institution || "").trim(),
      })).filter(r => r.name);
      if (b.mode === "replace") {
        if (db.apps.length && !b.force) return send(res, 400, { error: "Applications already exist. Use 'Append' or confirm replace." });
        db.attendees = rows;
      } else db.attendees.push(...rows);
      save(); return send(res, 200, { ok: true, count: db.attendees.length, added: rows.length });
    }
    let m;
    if ((m = p.match(/^\/api\/admin\/attendee\/([\w-]+)$/)) && req.method === "DELETE") {
      if (db.apps.find(a => a.attId === m[1] && a.status !== "rejected")) return send(res, 400, { error: "Attendee has an application. Delete that first." });
      db.attendees = db.attendees.filter(a => a.id !== m[1]); save(); return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/admin\/app\/([\w-]+)\/status$/)) && req.method === "POST") {
      const b = await body(req); const a = db.apps.find(x => x.id === m[1]);
      if (!a) return send(res, 404, { error: "Not found" });
      a.status = b.status; save(); return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/admin\/app\/([\w-]+)$/)) && req.method === "DELETE") {
      db.apps = db.apps.filter(x => x.id !== m[1]); save(); return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/admin\/file\/([\w.-]+)$/)) && req.method === "GET") return serveStatic(res, path.join(FILES_DIR, path.basename(m[1])));
    if (p === "/api/admin/export" && req.method === "GET") {
      const inc = url.searchParams.get("include") === "all" ? ["approved", "pending"] : ["approved"];
      const list = db.apps.filter(a => inc.includes(a.status)).map(a => {
        let sigData = null; try { sigData = fs.readFileSync(path.join(FILES_DIR, a.sig)).toString("base64"); } catch {}
        return { ...a, sigData };
      });
      return send(res, 200, { settings: db.settings, apps: list });
    }
    if (p === "/api/admin/backup" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="cme-backup-${Date.now()}.json"` });
      return res.end(JSON.stringify(db));
    }
  }
  send(res, 404, { error: "Not found" });
}

http.createServer((req, res) => {
  route(req, res).catch(e => { console.error(e); send(res, 500, { error: e.message || "Server error" }); });
}).listen(PORT, () => {
  console.log(`CME portal running on http://localhost:${PORT}`);
  console.log(`  Delegate link : /apply`);
  console.log(`  Help-desk link: /desk?k=${db.settings.deskKey}`);
  console.log(`  Admin panel   : /admin  (password from ADMIN_PASSWORD env)`);
});
