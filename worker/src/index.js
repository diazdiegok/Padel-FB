const PASS_SALT = "liga-fb-admin-v1";
const DISP_PATH = "src/data/disponibilidad.json";
const PAIRS_PATH = "src/data/parejas.json";
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

async function createSession(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeBase64Url(JSON.stringify({ sub: "admin", iat: now, exp: now + 14 * 86400 }));
  const signature = encodeBase64Url(await hmac(env.SESSION_SECRET, payload));
  return { token: `${payload}.${signature}`, exp: (now + 14 * 86400) * 1000 };
}

async function validSession(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = encodeBase64Url(await hmac(env.SESSION_SECRET, payload));
  if (!timingEqual(signature, expected)) return false;
  try {
    const json = JSON.parse(decodeBase64(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.sub === "admin" && Number(json.exp) > Date.now() / 1000;
  } catch {
    return false;
  }
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

async function validPassword(env, user, password) {
  if (String(user || "").trim().toLowerCase() !== String(env.ADMIN_USER).toLowerCase()) return false;
  const hash = await sha256hex(PASS_SALT + String(password || ""));
  return timingEqual(hash, env.PASSWORD_HASH);
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

async function registerPair(env, raw) {
  const pair = {
    id: `p${Date.now().toString(36)}${crypto.randomUUID().slice(0, 4)}`,
    createdAt: new Date().toISOString(),
    temp: String(raw.temp || "").trim().toUpperCase(),
    cat: String(raw.cat || "").trim(),
    p1: cleanName(raw.p1),
    p2: cleanName(raw.p2),
  };
  if (!pair.p1 || !pair.p2) throw new Error("Completá los dos integrantes de la pareja.");
  if (fold(pair.p1) === fold(pair.p2)) throw new Error("Los dos integrantes no pueden ser la misma persona.");
  if (!CATS.includes(pair.cat)) throw new Error("Elegí la categoría.");
  if (!/^T\d{1,3}$/.test(pair.temp)) throw new Error("Temporada inválida.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const file = await readPairs(env);
    const same = file.json.find((row) => row.temp === pair.temp && pairKey(row) === pairKey(pair));
    if (same) throw new Error(`Esta pareja ya está inscripta en ${same.cat}. Ya pueden anotarse en Fecha.`);
    const saved = await writeData(env, PAIRS_PATH, [...file.json, pair], file.sha, `Inscribe a ${pair.p1} / ${pair.p2} en ${pair.cat}.`);
    if (saved) {
      await caches.default.delete(PAIRS_CACHE);
      return { ok: true, pair: { id: pair.id, p1: pair.p1, p2: pair.p2, cat: pair.cat } };
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw new Error("Hubo muchos envíos juntos. Probá de nuevo en unos segundos.");
}

async function listPairs(env) {
  const cached = await caches.default.match(PAIRS_CACHE);
  if (cached) return cached.json();
  const file = await readPairs(env);
  const list = file.json.map((p) => ({ id: p.id, temp: p.temp, cat: p.cat, p1: p.p1, p2: p.p2 }));
  await caches.default.put(
    PAIRS_CACHE,
    new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=30" } })
  );
  return list;
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
    if (!file.json.open) throw new Error("La carga de esta fecha ya está cerrada.");
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

      const isAuth = url.pathname === "/auth/password" || url.pathname === "/auth/login";
      if (isAuth && request.method === "POST") {
        const lockedMinutes = await loginLock(env, request);
        if (lockedMinutes) {
          const wait = lockedMinutes >= 60 ? "1 hora" : lockedMinutes > 1 ? `${lockedMinutes} minutos` : "1 minuto";
          return response(request, env, { message: `Demasiados intentos fallidos. Probá de nuevo en ${wait}.` }, 429);
        }
        if (!(await allowed(env.LOGIN_LIMITER, request, "login"))) {
          return response(request, env, { message: "Demasiados intentos. Esperá un minuto y probá de nuevo." }, 429);
        }
      }

      if (url.pathname === "/auth/password" && request.method === "POST") {
        const body = await request.json();
        const ok = await validPassword(env, body.user, body.password);
        if (ok) return response(request, env, { ok: true });
        await loginFailed(env, request);
        return response(request, env, { message: "Usuario o clave incorrectos." }, 401);
      }

      if (url.pathname === "/auth/login" && request.method === "POST") {
        const body = await request.json();
        const passwordOk = await validPassword(env, body.user, body.password);
        const otpOk = passwordOk && (await validTotp(env.TOTP_SECRET, body.otp));
        if (!otpOk) {
          await loginFailed(env, request);
          return response(request, env, { message: "Datos de acceso incorrectos." }, 401);
        }
        await loginOk(env, request);
        return response(request, env, await createSession(env));
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
        return response(request, env, await appendAvailability(env, body));
      }

      if (url.pathname === "/pairs" && request.method === "GET") {
        const temp = String(url.searchParams.get("temp") || "").toUpperCase();
        const list = await listPairs(env);
        return response(request, env, temp ? list.filter((p) => p.temp === temp) : list);
      }

      if (url.pathname === "/pairs" && request.method === "POST") {
        const body = await request.json();
        if (body.website) return response(request, env, { ok: true });
        if (!(await allowed(env.FORM_LIMITER, request, "form"))) {
          return response(request, env, { message: "Muchos envíos seguidos. Esperá un minuto y probá de nuevo." }, 429);
        }
        return response(request, env, await registerPair(env, body));
      }

      return response(request, env, { message: "No encontrado." }, 404);
    } catch (error) {
      return response(request, env, { message: error?.message || "Error inesperado." }, 400);
    }
  },
};
