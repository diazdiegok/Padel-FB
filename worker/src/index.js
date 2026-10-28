import { addPairsToRanking } from "../../src/lib/scoring.js";
import { closeStatus, deadlinePassed, validDeadline } from "../../src/lib/cierre.js";
import { buildMail, cleanDays, validateDays, validateMail } from "../../src/lib/disponibilidad.js";

const PASS_SALT = "liga-fb-admin-v1";
// Cloudflare Workers: Web Crypto PBKDF2 topea en 100_000 iteraciones.
const PBKDF2_ITERS = 100_000;
const SESSION_SECONDS = 3 * 86400;
const FORM_DAY_MAX = { pairs: 8, form: 12 };
const RANK_PATH = "src/data/ranking.json";
const DISP_PATH = "src/data/disponibilidad.json";
const PAIRS_PATH = "src/data/parejas.json";
const PAIRS_CONFIG_PATH = "src/data/inscripcion-parejas.json";
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const CATS = ["A Masculina", "B Masculina", "C Masculina", "A Femenino", "B Femenino", "C Femenino"];
const PAIRS_CACHE = "https://padel-fb-api.cache/pairs";

const DATA_FILE = /^src\/data\/[a-z0-9_-]+\.json$/;
const IMAGE_FILE = /^public\/images\/[a-z0-9_-]+\.(png|jpg|webp|gif)$/;

function siteOrigins(env) {
  return String(env.SITE_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const origins = siteOrigins(env);
  const allowed = origins.includes(origin) || origin === "http://localhost:4321";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : origins[0] || "",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function response(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request, env) },
  });
}

function encodeBase64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeBase64(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const raw = String(value || "").replace(/\n/g, "");
  const clean = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function sessionTokenFrom(request) {
  return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
}

async function createSession(env) {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const payload = encodeBase64Url(JSON.stringify({ sub: "admin", iat: now, exp: now + SESSION_SECONDS, jti }));
  const signature = encodeBase64Url(await hmac(env.SESSION_SECRET, payload));
  if (env.AUTH_KV) {
    await env.AUTH_KV.put(`sess:${jti}`, "1", { expirationTtl: SESSION_SECONDS });
  }
  return { token: `${payload}.${signature}`, exp: (now + SESSION_SECONDS) * 1000 };
}

async function parseSession(request, env) {
  const token = sessionTokenFrom(request);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = encodeBase64Url(await hmac(env.SESSION_SECRET, payload));
  if (!timingEqual(signature, expected)) return null;
  try {
    const json = JSON.parse(decodeBase64(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (json.sub !== "admin" || Number(json.exp) <= Date.now() / 1000 || !json.jti) return null;
    return json;
  } catch {
    return null;
  }
}

async function validSession(request, env) {
  const json = await parseSession(request, env);
  if (!json || !env.AUTH_KV) return false;
  return Boolean(await env.AUTH_KV.get(`sess:${json.jti}`));
}

async function revokeSession(request, env) {
  const json = await parseSession(request, env);
  if (json?.jti && env.AUTH_KV) await env.AUTH_KV.delete(`sess:${json.jti}`);
}

function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function sha256hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input).toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

async function hotp(secretBytes, counter) {
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = signature[signature.length - 1] & 0xf;
  const code =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

async function validTotp(secret, value) {
  const wanted = String(value || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(wanted)) return false;
  const bytes = base32Decode(secret);
  const current = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if (timingEqual(await hotp(bytes, current + delta), wanted)) return true;
  }
  return false;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2Hex(password, saltBytes, iterations = PBKDF2_ITERS) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function createPbkdf2Hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hex(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${encodeBase64Url(salt)}$${hash}`;
}

async function storedPassHash(env) {
  const fromKv = env.AUTH_KV ? await env.AUTH_KV.get("admin:passhash") : null;
  return String(fromKv || env.PASSWORD_HASH || "");
}

async function verifyStoredPassword(stored, password) {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) {
    const [, itersRaw, saltB64, want] = stored.split("$");
    const iterations = Number(itersRaw) || PBKDF2_ITERS;
    if (!saltB64 || !want) return false;
    const salt = Uint8Array.from(
      atob(saltB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (saltB64.length % 4)) % 4)),
      (c) => c.charCodeAt(0)
    );
    const got = await pbkdf2Hex(password, salt, iterations);
    return timingEqual(got, want);
  }
  const hash = await sha256hex(PASS_SALT + String(password || ""));
  return timingEqual(hash, stored);
}

async function validPassword(env, user, password) {
  if (String(user || "").trim().toLowerCase() !== String(env.ADMIN_USER).toLowerCase()) return false;
  return verifyStoredPassword(await storedPassHash(env), password);
}

async function maybeUpgradePassword(env, password) {
  try {
    if (!env.AUTH_KV) return;
    const stored = await storedPassHash(env);
    if (stored.startsWith("pbkdf2$")) return;
    await env.AUTH_KV.put("admin:passhash", await createPbkdf2Hash(password));
  } catch {
    /* el login no debe fallar si el upgrade del hash no sale */
  }
}

async function formDayOk(env, request, scope) {
  if (!env.AUTH_KV) return true;
  const max = FORM_DAY_MAX[scope] ?? FORM_DAY_MAX.form;
  const day = new Date().toISOString().slice(0, 10);
  const key = `formday:${scope}:${clientIp(request)}:${day}`;
  const n = Number((await env.AUTH_KV.get(key)) || 0);
  if (n >= max) return false;
  await env.AUTH_KV.put(key, String(n + 1), { expirationTtl: 90_000 });
  return true;
}

function receiptLooksValid(mime, b64) {
  try {
    const head = atob(String(b64 || "").slice(0, 48));
    const bytes = [...head].slice(0, 16).map((c) => c.charCodeAt(0));
    const kind = String(mime || "").toLowerCase();
    if (kind.includes("pdf")) return head.startsWith("%PDF");
    if (kind.includes("jpeg") || kind.includes("jpg")) return bytes[0] === 0xff && bytes[1] === 0xd8;
    if (kind.includes("png")) return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (kind.includes("gif")) return head.startsWith("GIF8");
    if (kind.includes("webp")) return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
  return false;
}

async function github(env, path, options = {}) {
  const prefix = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  if (!(path === prefix || path.startsWith(`${prefix}/`))) {
    return new Response(JSON.stringify({ message: "Ruta no permitida." }), { status: 403 });
  }
  const method = String(options.method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH"].includes(method)) {
    return new Response(JSON.stringify({ message: "Método no permitido." }), { status: 405 });
  }
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "Padel-FB-Worker",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: method === "GET" ? undefined : options.body,
  });
}

function writableFile(path) {
  return DATA_FILE.test(path) || IMAGE_FILE.test(path);
}

function parseBody(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return null;
  }
}

// Solo deja pasar lo que usa el admin: leer y escribir datos/fotos y armar commits sobre main.
function adminRequest(env, path, method, rawBody) {
  const prefix = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  if (!String(path || "").startsWith(`${prefix}/`)) return null;
  const [route, query = ""] = path.slice(prefix.length + 1).split("?");
  if (query && query !== "ref=main") return null;
  const body = method === "GET" ? undefined : parseBody(rawBody);
  if (body === null) return null;

  if (route.startsWith("contents/")) {
    const file = route.slice("contents/".length);
    if (!writableFile(file)) return null;
    if (method === "GET") return { path, method };
    if (method !== "PUT" || typeof body.content !== "string" || !body.message) return null;
    const clean = { message: String(body.message), content: body.content, branch: "main" };
    if (body.sha) clean.sha = String(body.sha);
    return { path: `${prefix}/${route}`, method, body: JSON.stringify(clean) };
  }
  if (route === "git/refs/heads/main") {
    if (method === "GET") return { path, method };
    if (method !== "PATCH" || !/^[0-9a-f]{40}$/.test(body.sha || "")) return null;
    return { path, method, body: JSON.stringify({ sha: body.sha, force: false }) };
  }
  if (/^git\/commits\/[0-9a-f]{40}$/.test(route) && method === "GET") return { path, method };
  if (route === "git/commits" && method === "POST") {
    const sha = /^[0-9a-f]{40}$/;
    const parents = Array.isArray(body.parents) ? body.parents : [];
    if (!sha.test(body.tree || "") || parents.length !== 1 || !sha.test(parents[0])) return null;
    return { path, method, body: JSON.stringify({ message: String(body.message || ""), tree: body.tree, parents }) };
  }
  if (route === "git/trees" && method === "POST") {
    const tree = Array.isArray(body.tree) ? body.tree : [];
    const ok =
      /^[0-9a-f]{40}$/.test(body.base_tree || "") &&
      tree.length > 0 &&
      tree.every((f) => writableFile(f.path) && f.mode === "100644" && f.type === "blob" && typeof f.content === "string");
    if (!ok) return null;
    const clean = tree.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content }));
    return { path, method, body: JSON.stringify({ base_tree: body.base_tree, tree: clean }) };
  }
  return null;
}

const MAX_FAILS = 5;
const LOCK_SECONDS = 3600;

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "anon";
}

async function loginLock(env, request) {
  if (!env.AUTH_KV) return null;
  const state = await env.AUTH_KV.get(`fail:${clientIp(request)}`, "json");
  const left = Number(state?.until || 0) - Math.floor(Date.now() / 1000);
  return left > 0 ? Math.ceil(left / 60) : null;
}

async function loginFailed(env, request) {
  if (!env.AUTH_KV) return;
  const key = `fail:${clientIp(request)}`;
  const state = (await env.AUTH_KV.get(key, "json")) || { n: 0 };
  const n = Number(state.n || 0) + 1;
  const until = n >= MAX_FAILS ? Math.floor(Date.now() / 1000) + LOCK_SECONDS : 0;
  await env.AUTH_KV.put(key, JSON.stringify({ n, until }), { expirationTtl: LOCK_SECONDS });
}

async function loginOk(env, request) {
  if (env.AUTH_KV) await env.AUTH_KV.delete(`fail:${clientIp(request)}`);
}

async function allowed(limiter, request, scope) {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key: `${scope}:${clientIp(request)}` });
  return success;
}

async function readData(env, file, fallback) {
  const path = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${file}?ref=main`;
  const res = await github(env, path);
  if (res.status === 404 && fallback !== undefined) return { sha: undefined, json: fallback };
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "No se pudieron leer los datos.");
  return { sha: data.sha, json: JSON.parse(decodeBase64(data.content)) };
}

async function writeData(env, file, json, sha, message) {
  const body = { message, content: encodeBase64(JSON.stringify(json, null, 2) + "\n"), branch: "main" };
  if (sha) body.sha = sha;
  const path = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${file}`;
  const saved = await github(env, path, { method: "PUT", body: JSON.stringify(body) });
  if (saved.ok) return true;
  if (saved.status === 409 || saved.status === 422) return false;
  const data = await saved.json().catch(() => ({}));
  throw new Error(data.message || "No se pudo guardar.");
}

async function readAvailability(env) {
  return readData(env, DISP_PATH);
}

async function readPairs(env) {
  const file = await readData(env, PAIRS_PATH, []);
  return { ...file, json: Array.isArray(file.json) ? file.json : [] };
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 15);
}

function copyFields(json) {
  const clip = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    title: clip(json.title, 80),
    intro: clip(json.intro, 400),
    hint: clip(json.hint, 300),
    cta: clip(json.cta, 40),
  };
}

async function registrationState(env) {
  const { json } = await readData(env, PAIRS_CONFIG_PATH, {});
  const deadline = validDeadline(json.deadline);
  const copy = copyFields(json);
  if (json.open === false || deadlinePassed(deadline)) {
    return {
      open: false,
      deadline,
      ...copy,
      message: `${closeStatus(false, deadline)}.`,
    };
  }
  return { open: true, deadline, ...copy };
}

async function registerPair(env, raw) {
  const days = cleanDays(raw.days);
  const note = clip(raw.note, 500);
  const pair = {
    id: `p${Date.now().toString(36)}${crypto.randomUUID().slice(0, 4)}`,
    createdAt: new Date().toISOString(),
    temp: String(raw.temp || "").trim().toUpperCase(),
    cat: String(raw.cat || "").trim(),
    p1: cleanName(raw.p1),
    p2: cleanName(raw.p2),
    days,
    note,
  };
  const mail1 = buildMail(raw.mail1local ?? String(raw.mail1 || "").split("@")[0], raw.mail1domain ?? String(raw.mail1 || "").split("@")[1]);
  const mail2 = buildMail(raw.mail2local ?? String(raw.mail2 || "").split("@")[0], raw.mail2domain ?? String(raw.mail2 || "").split("@")[1]);
  const contact = {
    tel1: cleanPhone(raw.tel1),
    tel2: cleanPhone(raw.tel2),
    mail1,
    mail2,
  };
  if (!pair.p1 || !pair.p2) throw new Error("Completá los dos integrantes de la pareja.");
  if (fold(pair.p1) === fold(pair.p2)) throw new Error("Los dos integrantes no pueden ser la misma persona.");
  if (contact.tel1.length < 8 || contact.tel2.length < 8) {
    throw new Error("Dejá el WhatsApp de cada integrante, con característica (ej. 343 555 0000).");
  }
  if (!mail1 || !mail2) throw new Error("Completá el mail de cada integrante.");
  const mail1Error = validateMail(mail1);
  if (mail1Error) throw new Error(`Mail del primer integrante: ${mail1Error}`);
  const mail2Error = validateMail(mail2);
  if (mail2Error) throw new Error(`Mail del segundo integrante: ${mail2Error}`);
  if (!CATS.includes(pair.cat)) throw new Error("Elegí la categoría.");
  if (!/^T\d{1,3}$/.test(pair.temp)) throw new Error("Temporada inválida.");
  const dayError = validateDays(days);
  if (dayError) throw new Error(dayError);
  const state = await registrationState(env);
  if (!state.open) throw new Error(state.message);
  if (!env.AUTH_KV) throw new Error("Falta configurar el guardado de contactos y comprobantes.");
  // Validar comprobante antes de grabar la pareja.
  const receiptMime = String(raw.receiptMime || raw.mime || "").toLowerCase();
  const receiptData = cleanReceiptData(raw.receiptData || raw.receipt || "");
  if (!PAY_MIME.test(receiptMime)) throw new Error("El comprobante tiene que ser una imagen (JPG/PNG) o un PDF.");
  if (!receiptData) throw new Error("Adjuntá el comprobante de pago o abono de la inscripción.");
  if (receiptData.length > MAX_RECEIPT_B64) {
    throw new Error("El comprobante es muy pesado. Sacá una foto más liviana (menos de 1,5 MB).");
  }
  if (!receiptLooksValid(receiptMime, receiptData)) {
    throw new Error("El archivo no parece una imagen o PDF válido. Probá con otra foto del comprobante.");
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const file = await readPairs(env);
    const same = file.json.find((row) => row.temp === pair.temp && pairKey(row) === pairKey(pair));
    if (same) {
      throw new Error(`Esta pareja ya está inscrita en ${same.cat}: no hace falta inscribirla de nuevo.`);
    }
    const saved = await writeData(env, PAIRS_PATH, [...file.json, pair], file.sha, `Inscribe a ${pair.p1} / ${pair.p2} en ${pair.cat}.`);
    if (saved) {
      await caches.default.delete(PAIRS_CACHE);
      await env.AUTH_KV.put(`contact:${pair.id}`, "", { metadata: contact });
      await savePayment(env, pair.id, { receiptMime, receiptData });
      await addToRanking(env, pair).catch(() => {});
      return { ok: true, pair: { id: pair.id, p1: pair.p1, p2: pair.p2, cat: pair.cat } };
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw new Error("Hubo muchos envíos juntos. Probá de nuevo en unos segundos.");
}

async function addToRanking(env, pair) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const file = await readData(env, RANK_PATH, []);
    const rows = Array.isArray(file.json) ? file.json : [];
    if (!addPairsToRanking(rows, [pair]).length) return;
    if (await writeData(env, RANK_PATH, rows, file.sha, `Suma a ${pair.p1} / ${pair.p2} al ranking de ${pair.cat}.`)) return;
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
}

async function listPairs(env) {
  const cached = await caches.default.match(PAIRS_CACHE);
  if (cached) return cached.json();
  const file = await readPairs(env);
  const list = file.json.map((p) => ({
    id: p.id,
    temp: p.temp,
    cat: p.cat,
    p1: p.p1,
    p2: p.p2,
    days: p.days && typeof p.days === "object" ? p.days : {},
  }));
  await caches.default.put(
    PAIRS_CACHE,
    new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=30" } })
  );
  return list;
}

// Los WhatsApp y comprobantes quedan en KV y no en el repo, que es público.
function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

const PAY_MIME = /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i;
const MAX_RECEIPT_B64 = 1_900_000;

function cleanReceiptData(raw) {
  return String(raw || "")
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "");
}

async function savePayment(env, pairId, raw) {
  if (!env.AUTH_KV) throw new Error("Falta configurar el guardado de comprobantes.");
  if (!/^p[a-z0-9]{4,30}$/i.test(String(pairId || ""))) throw new Error("Pareja inválida.");
  const mime = String(raw.receiptMime || raw.mime || "image/jpeg").toLowerCase();
  const data = cleanReceiptData(raw.receiptData || raw.receipt || "");
  if (!PAY_MIME.test(mime)) throw new Error("El comprobante tiene que ser una imagen (JPG/PNG) o un PDF.");
  if (!data) throw new Error("Adjuntá el comprobante de pago o abono de la inscripción.");
  if (data.length > MAX_RECEIPT_B64) throw new Error("El comprobante es muy pesado. Sacá una foto más liviana (menos de 1,5 MB).");
  if (!receiptLooksValid(mime, data)) {
    throw new Error("El archivo no parece una imagen o PDF válido. Probá con otra foto del comprobante.");
  }
  const entry = {
    mime: mime === "image/jpg" ? "image/jpeg" : mime,
    data,
    verified: true,
    at: new Date().toISOString(),
  };
  await env.AUTH_KV.put(`pay:${pairId}`, JSON.stringify(entry), {
    metadata: { verified: true, mime: entry.mime, at: entry.at, hasReceipt: true },
  });
  return { ok: true, verified: true, hasReceipt: true };
}

async function listPayments(env) {
  if (!env.AUTH_KV) return {};
  const out = {};
  let cursor;
  do {
    const page = await env.AUTH_KV.list({ prefix: "pay:", cursor });
    for (const key of page.keys) {
      const id = key.name.slice("pay:".length);
      const meta = key.metadata || {};
      const hasReceipt =
        typeof meta.hasReceipt === "boolean" ? meta.hasReceipt : Boolean(meta.mime);
      out[id] = {
        hasReceipt,
        verified: Boolean(meta.verified),
        mime: meta.mime || "",
        at: meta.at || "",
      };
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function readPayment(env, id) {
  if (!env.AUTH_KV) throw new Error("Falta configurar el guardado de comprobantes.");
  if (!/^p[a-z0-9]{4,30}$/i.test(String(id || ""))) throw new Error("Pareja inválida.");
  const raw = await env.AUTH_KV.get(`pay:${id}`, "json");
  if (!raw || !raw.data) throw new Error("No hay comprobante para esa pareja.");
  return {
    id,
    mime: raw.mime || "image/jpeg",
    data: raw.data,
    verified: Boolean(raw.verified),
    at: raw.at || "",
  };
}

async function setPaymentVerified(env, id, verified) {
  if (!env.AUTH_KV) throw new Error("Falta configurar el guardado de comprobantes.");
  if (!/^p[a-z0-9]{4,30}$/i.test(String(id || ""))) throw new Error("Pareja inválida.");
  const raw = (await env.AUTH_KV.get(`pay:${id}`, "json")) || {};
  const next = {
    mime: raw.mime || "",
    data: raw.data || "",
    verified: Boolean(verified),
    at: raw.at || new Date().toISOString(),
    note: raw.note || (raw.data ? "" : "manual"),
  };
  await env.AUTH_KV.put(`pay:${id}`, JSON.stringify(next), {
    metadata: {
      verified: next.verified,
      mime: next.mime || "",
      at: next.at,
      hasReceipt: Boolean(next.data),
    },
  });
  return { ok: true, verified: next.verified, hasReceipt: Boolean(next.data) };
}

async function deletePayment(env, id) {
  if (!env.AUTH_KV) return;
  if (!/^p[a-z0-9]{4,30}$/i.test(String(id || ""))) return;
  await env.AUTH_KV.delete(`pay:${id}`);
}

async function saveAcademy(env, raw) {
  if (!env.AUTH_KV) throw new Error("Falta configurar el guardado de inscripciones.");
  const entry = {
    id: `a${Date.now().toString(36)}${crypto.randomUUID().slice(0, 4)}`,
    createdAt: new Date().toISOString(),
    para: raw.para === "Infantiles" ? "Infantiles" : "Adultos",
    nombre: cleanName(raw.nombre),
    tel: cleanPhone(raw.tel),
    edad: clip(raw.edad, 3).replace(/\D/g, ""),
    nivel: clip(raw.nivel, 40),
    sede: clip(raw.sede, 60),
    horario: clip(raw.horario, 120),
    nota: clip(raw.nota, 500),
  };
  if (!entry.nombre) throw new Error("Completá el nombre.");
  if (entry.tel.length < 8) throw new Error("Dejá un WhatsApp con característica (ej. 343 555 0000).");
  if (entry.para === "Infantiles" && !entry.edad) throw new Error("Para infantiles, completá la edad.");
  await env.AUTH_KV.put(`acad:${entry.id}`, JSON.stringify(entry));
  return { ok: true };
}

async function listAcademy(env) {
  if (!env.AUTH_KV) return [];
  const out = [];
  let cursor;
  do {
    const page = await env.AUTH_KV.list({ prefix: "acad:", cursor });
    const values = await Promise.all(page.keys.map((key) => env.AUTH_KV.get(key.name)));
    for (const value of values) {
      try {
        if (value) out.push(JSON.parse(value));
      } catch {
        /* una entrada vieja mal grabada no frena el listado */
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function deleteAcademy(env, id) {
  if (!env.AUTH_KV) throw new Error("Falta configurar el guardado de inscripciones.");
  if (!/^a[a-z0-9]{6,40}$/.test(String(id || ""))) throw new Error("Inscripción inválida.");
  await env.AUTH_KV.delete(`acad:${id}`);
  return { ok: true };
}

async function listContacts(env) {
  if (!env.AUTH_KV) return {};
  const out = {};
  let cursor;
  do {
    const page = await env.AUTH_KV.list({ prefix: "contact:", cursor });
    for (const key of page.keys) out[key.name.slice("contact:".length)] = key.metadata || {};
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function saveContacts(env, raw) {
  if (!env.AUTH_KV) throw new Error("Falta configurar el guardado de contactos.");
  const entries = Object.entries(raw && typeof raw === "object" ? raw : {});
  if (entries.length > 500) throw new Error("Demasiados contactos juntos.");
  for (const [id, value] of entries) {
    if (!/^p[a-z0-9]{4,30}$/.test(id)) continue;
    const mail1 = buildMail(
      value?.mail1local ?? String(value?.mail1 || "").split("@")[0],
      value?.mail1domain ?? String(value?.mail1 || "").split("@")[1]
    );
    const mail2 = buildMail(
      value?.mail2local ?? String(value?.mail2 || "").split("@")[0],
      value?.mail2domain ?? String(value?.mail2 || "").split("@")[1]
    );
    const contact = {
      tel1: cleanPhone(value?.tel1),
      tel2: cleanPhone(value?.tel2),
      mail1,
      mail2,
    };
    if (!value || (!contact.tel1 && !contact.tel2 && !contact.mail1 && !contact.mail2)) {
      await env.AUTH_KV.delete(`contact:${id}`);
    } else {
      await env.AUTH_KV.put(`contact:${id}`, "", { metadata: contact });
    }
  }
  return { ok: true };
}

const STATS_TTL = 60 * 60 * 24 * 45;
const COUNTRY_NAMES = {
  AR: "Argentina",
  UY: "Uruguay",
  CL: "Chile",
  BR: "Brasil",
  PY: "Paraguay",
  BO: "Bolivia",
  PE: "Perú",
  ES: "España",
  US: "Estados Unidos",
  MX: "México",
  XX: "Desconocido",
  T1: "Tor / proxy",
};

function utcDay(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function deviceOf(ua) {
  const s = String(ua || "").toLowerCase();
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(s)) return "Bot";
  if (/ipad|tablet|kindle|playbook/i.test(s)) return "Tablet";
  if (/mobi|iphone|ipod|android|webos|opera mini|iemobile/i.test(s)) return "Móvil";
  return "Desktop";
}

// Tráfico que no aporta (previews, CI, pruebas desde afuera): no lo contamos.
function noiseHit(request, country, device) {
  if (device === "Bot") return true;
  if (country === "US") return true;
  const ua = String(request.headers.get("user-agent") || "").toLowerCase();
  if (!ua) return true;
  if (/curl|wget|python|axios|node-fetch|httpclient|vercel-favicon|headless|phantom|selenium/i.test(ua)) return true;
  return false;
}

function cleanHitPath(raw) {
  let p = String(raw || "/")
    .split("?")[0]
    .split("#")[0]
    .replace(/\\/g, "/")
    .replace(/^\/Padel-FB/i, "")
    .replace(/\/{2,}/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return (p || "/").slice(0, 120);
}

function bump(map, key) {
  const k = String(key || "").slice(0, 80) || "—";
  map[k] = (map[k] || 0) + 1;
}

function referrerHost(raw, env) {
  const value = String(raw || "").trim();
  if (!value) return "Directo";
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
    if (!host) return "Directo";
    const own = siteOrigins(env).map((o) => {
      try {
        return new URL(o).hostname.replace(/^www\./i, "").toLowerCase();
      } catch {
        return "";
      }
    });
    if (
      own.includes(host) ||
      host === "localhost" ||
      host.endsWith(".workers.dev") ||
      host.endsWith(".vercel.app")
    ) {
      return "Directo";
    }
    return host.slice(0, 80);
  } catch {
    return "Directo";
  }
}

async function hitRateOk(env, request) {
  if (!env.AUTH_KV) return true;
  const hash = (await sha256hex(clientIp(request))).slice(0, 16);
  const key = `hitrl:${hash}`;
  const n = Number((await env.AUTH_KV.get(key)) || 0);
  if (n >= 40) return false;
  await env.AUTH_KV.put(key, String(n + 1), { expirationTtl: 60 });
  return true;
}

async function recordHit(env, request, raw) {
  if (!env.AUTH_KV) return { ok: true };
  const country = String(request.cf?.country || "XX")
    .toUpperCase()
    .slice(0, 3);
  const device = deviceOf(request.headers.get("user-agent"));
  if (noiseHit(request, country, device)) return { ok: true };
  const day = utcDay(0);
  const key = `stats:day:${day}`;
  const path = cleanHitPath(raw?.path || "/");
  const ref = referrerHost(raw?.ref || request.headers.get("Referer"), env);
  const ip = String(clientIp(request) || "anon").slice(0, 45);
  const cur = (await env.AUTH_KV.get(key, "json")) || {
    total: 0,
    countries: {},
    devices: {},
    paths: {},
    refs: {},
  };
  cur.total = Number(cur.total || 0) + 1;
  bump(cur.countries, country);
  bump(cur.devices, device);
  bump(cur.paths, path);
  bump(cur.refs, ref);
  const recentRaw = await env.AUTH_KV.get("stats:recent", "json");
  const recentList = Array.isArray(recentRaw) ? recentRaw : [];
  recentList.unshift({
    at: new Date().toISOString(),
    ip,
    path,
    country: COUNTRY_NAMES[country] || country,
    device,
    ref,
  });
  await Promise.all([
    env.AUTH_KV.put(key, JSON.stringify(cur), { expirationTtl: STATS_TTL }),
    env.AUTH_KV.put("stats:recent", JSON.stringify(recentList.slice(0, 50)), { expirationTtl: STATS_TTL }),
  ]);
  return { ok: true };
}

function isNoiseCountry(codeOrName) {
  const v = String(codeOrName || "");
  return v === "US" || v === "Estados Unidos";
}

function isNoiseRef(ref) {
  const v = String(ref || "").toLowerCase();
  return !v || v === "directo" ? false : v.endsWith(".vercel.app") || v.includes("vercel.app");
}

function mergeMaps(into, from) {
  for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + Number(v || 0);
}

async function readStats(env, days = 14) {
  const n = Math.min(Math.max(Number(days) || 14, 1), 30);
  const daily = [];
  const countries = {};
  const devices = {};
  const paths = {};
  const refs = {};
  let total = 0;
  for (let i = n - 1; i >= 0; i--) {
    const day = utcDay(-i);
    const cur = (await env.AUTH_KV?.get(`stats:day:${day}`, "json")) || null;
    const noise = Number(cur?.countries?.US || 0);
    const dayTotal = Math.max(0, Number(cur?.total || 0) - noise);
    daily.push({ day, total: dayTotal });
    total += dayTotal;
    if (!cur) continue;
    mergeMaps(countries, cur.countries);
    mergeMaps(devices, cur.devices);
    mergeMaps(paths, cur.paths);
    mergeMaps(refs, cur.refs);
  }
  const namedCountries = {};
  for (const [code, count] of Object.entries(countries)) {
    if (isNoiseCountry(code)) continue;
    namedCountries[COUNTRY_NAMES[code] || code] = count;
  }
  const cleanRefs = {};
  for (const [ref, count] of Object.entries(refs)) {
    const key = isNoiseRef(ref) ? "Directo" : ref;
    cleanRefs[key] = (cleanRefs[key] || 0) + Number(count || 0);
  }
  const recentRaw = (await env.AUTH_KV?.get("stats:recent", "json")) || [];
  const recent = (Array.isArray(recentRaw) ? recentRaw : [])
    .filter((row) => !isNoiseCountry(row?.country) && row?.device !== "Bot")
    .slice(0, 50);
  return {
    days: n,
    total,
    daily,
    countries: namedCountries,
    devices,
    paths,
    refs: cleanRefs,
    recent,
  };
}

function fold(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function personKey(name) {
  return fold(name).split(" ").filter(Boolean).sort().join(" ");
}

function pairKey(entry) {
  return [personKey(entry.p1), personKey(entry.p2)].sort().join("|");
}

function cleanAvailability(raw) {
  const days = {};
  for (const day of DAYS) {
    if (raw.days && Object.prototype.hasOwnProperty.call(raw.days, day)) {
      days[day] = String(raw.days[day] || "").trim().slice(0, 40);
    }
  }
  const bye = Boolean(raw.bye);
  return {
    id: `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    createdAt: new Date().toISOString(),
    p1: String(raw.p1 || "").trim().slice(0, 80),
    p2: String(raw.p2 || "").trim().slice(0, 80),
    cat: String(raw.cat || "").trim().slice(0, 40),
    recover: Boolean(raw.recover),
    bye,
    days: bye ? {} : days,
    note: String(raw.note || "").trim().slice(0, 500),
  };
}

function validateAvailability(entry) {
  if (!entry.p1 || !entry.p2) return "Completá los dos integrantes de la pareja.";
  if (!entry.cat) return "Elegí la categoría.";
  if (!entry.bye && !Object.keys(entry.days).length) return "Marcá al menos un día.";
  if (!entry.bye && Object.values(entry.days).some((hours) => !hours)) return "Completá todos los horarios.";
  return "";
}

async function appendAvailability(env, raw) {
  const pairId = String(raw.pairId || "").trim();
  if (!pairId) throw new Error("Elegí tu pareja. Si no aparece, inscribila primero en Inscripción de parejas.");
  const pairs = await readPairs(env);
  const pair = pairs.json.find((p) => p.id === pairId);
  if (!pair) throw new Error("No encontramos esa pareja. Inscribila primero en Inscripción de parejas.");
  const entry = { ...cleanAvailability({ ...raw, p1: pair.p1, p2: pair.p2, cat: pair.cat }), pairId };
  const error = validateAvailability(entry);
  if (error) throw new Error(error);
  for (let attempt = 0; attempt < 4; attempt++) {
    const file = await readAvailability(env);
    if (!file.json.open || deadlinePassed(file.json.deadline)) {
      throw new Error(`${closeStatus(false, file.json.deadline, "Fecha")}.`);
    }
    if (file.json.temp && pair.temp && file.json.temp !== pair.temp) {
      throw new Error(`Esa pareja está inscripta en ${pair.temp} y la fecha es de ${file.json.temp}. Inscribila para esta temporada.`);
    }
    if ((file.json.entries || []).some((row) => row.pairId === pairId || pairKey(row) === pairKey(entry))) {
      throw new Error(`Esta pareja ya está anotada en ${file.json.week || "la fecha"}.`);
    }
    const next = { ...file.json, entries: [...(file.json.entries || []), entry] };
    const saved = await writeData(env, DISP_PATH, next, file.sha, `Carga disponibilidad de ${entry.p1} / ${entry.p2} en ${file.json.week}.`);
    if (saved) return { ok: true, week: file.json.week, pair: `${entry.p1} / ${entry.p2}` };
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw new Error("Hubo muchos envíos juntos. Probá de nuevo en unos segundos.");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") return response(request, env, { ok: true });

      if (url.pathname === "/auth/login" && request.method === "POST") {
        const lockedMinutes = await loginLock(env, request);
        if (lockedMinutes) {
          const wait = lockedMinutes >= 60 ? "1 hora" : lockedMinutes > 1 ? `${lockedMinutes} minutos` : "1 minuto";
          return response(request, env, { message: `Demasiados intentos fallidos. Probá de nuevo en ${wait}.` }, 429);
        }
        if (!(await allowed(env.LOGIN_LIMITER, request, "login"))) {
          return response(request, env, { message: "Demasiados intentos. Esperá un minuto y probá de nuevo." }, 429);
        }
        const body = await request.json();
        const passwordOk = await validPassword(env, body.user, body.password);
        const otpOk = passwordOk && (await validTotp(env.TOTP_SECRET, body.otp));
        if (!otpOk) {
          await loginFailed(env, request);
          return response(request, env, { message: "Datos de acceso incorrectos." }, 401);
        }
        await maybeUpgradePassword(env, body.password);
        await loginOk(env, request);
        return response(request, env, await createSession(env));
      }

      if (url.pathname === "/auth/logout" && request.method === "POST") {
        await revokeSession(request, env);
        return response(request, env, { ok: true });
      }

      // Compat: ya no valida la clave (evita oráculo). Solo rate-limit + ok.
      if (url.pathname === "/auth/password" && request.method === "POST") {
        if (!(await allowed(env.LOGIN_LIMITER, request, "login"))) {
          return response(request, env, { message: "Demasiados intentos. Esperá un minuto y probá de nuevo." }, 429);
        }
        return response(request, env, { ok: true });
      }

      if (url.pathname === "/github" && request.method === "POST") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        const body = await request.json();
        const method = String(body.method || "GET").toUpperCase();
        const call = adminRequest(env, String(body.path || ""), method, body.body);
        if (!call) return response(request, env, { message: "Operación no permitida desde el admin." }, 403);
        const upstream = await github(env, call.path, { method: call.method, body: call.body });
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request, env) },
        });
      }

      if (url.pathname === "/availability" && request.method === "POST") {
        const body = await request.json();
        if (body.website) return response(request, env, { ok: true });
        if (!(await allowed(env.FORM_LIMITER, request, "form"))) {
          return response(request, env, { message: "Muchos envíos seguidos. Esperá un minuto y probá de nuevo." }, 429);
        }
        if (!(await formDayOk(env, request, "form"))) {
          return response(request, env, { message: "Llegaste al límite de envíos por hoy. Probá mañana." }, 429);
        }
        return response(request, env, await appendAvailability(env, body));
      }

      if (url.pathname === "/pairs" && request.method === "GET") {
        const temp = String(url.searchParams.get("temp") || "").toUpperCase();
        const list = await listPairs(env);
        return response(request, env, temp ? list.filter((p) => p.temp === temp) : list);
      }

      if (url.pathname === "/academia" && request.method === "POST") {
        const body = await request.json();
        if (body.website) return response(request, env, { ok: true });
        if (!(await allowed(env.FORM_LIMITER, request, "form"))) {
          return response(request, env, { message: "Muchos envíos seguidos. Esperá un minuto y probá de nuevo." }, 429);
        }
        if (!(await formDayOk(env, request, "form"))) {
          return response(request, env, { message: "Llegaste al límite de envíos por hoy. Probá mañana." }, 429);
        }
        return response(request, env, await saveAcademy(env, body));
      }

      if (url.pathname === "/academia" && request.method === "GET") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        return response(request, env, await listAcademy(env));
      }

      if (url.pathname === "/academia/delete" && request.method === "POST") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        const body = await request.json();
        return response(request, env, await deleteAcademy(env, body.id));
      }

      if (url.pathname === "/pairs/status" && request.method === "GET") {
        return response(request, env, await registrationState(env));
      }

      if (url.pathname === "/pairs/contacts") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        if (request.method === "GET") return response(request, env, await listContacts(env));
        if (request.method === "POST") return response(request, env, await saveContacts(env, (await request.json()).contacts));
      }

      if (url.pathname === "/pairs/payments" && request.method === "GET") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        return response(request, env, await listPayments(env));
      }

      if (url.pathname === "/pairs/payment" && request.method === "GET") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        return response(request, env, await readPayment(env, url.searchParams.get("id")));
      }

      if (url.pathname === "/pairs/payment/verify" && request.method === "POST") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        const body = await request.json();
        return response(request, env, await setPaymentVerified(env, body.id, body.verified));
      }

      if (url.pathname === "/pairs/payment/delete" && request.method === "POST") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        const body = await request.json();
        await deletePayment(env, body.id);
        return response(request, env, { ok: true });
      }

      if (url.pathname === "/pairs" && request.method === "POST") {
        const body = await request.json();
        if (body.website) return response(request, env, { ok: true });
        if (!(await allowed(env.FORM_LIMITER, request, "form"))) {
          return response(request, env, { message: "Muchos envíos seguidos. Esperá un minuto y probá de nuevo." }, 429);
        }
        if (!(await formDayOk(env, request, "pairs"))) {
          return response(request, env, { message: "Llegaste al límite de inscripciones por hoy. Probá mañana." }, 429);
        }
        return response(request, env, await registerPair(env, body));
      }

      if (url.pathname === "/hit" && request.method === "POST") {
        if (!(await hitRateOk(env, request))) return response(request, env, { ok: true });
        let body = {};
        const ct = request.headers.get("Content-Type") || "";
        if (ct.includes("application/json")) {
          body = await request.json().catch(() => ({}));
        } else {
          const text = await request.text().catch(() => "");
          body = parseBody(text) || {};
        }
        return response(request, env, await recordHit(env, request, body));
      }

      if (url.pathname === "/stats" && request.method === "GET") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        const days = Number(url.searchParams.get("days") || 14);
        return response(request, env, await readStats(env, days));
      }

      return response(request, env, { message: "No encontrado." }, 404);
    } catch (error) {
      return response(request, env, { message: error?.message || "Error inesperado." }, 400);
    }
  },
};
