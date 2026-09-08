const PASS_SALT = "liga-fb-admin-v1";
const DISP_PATH = "src/data/disponibilidad.json";
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === env.SITE_ORIGIN || origin === "http://localhost:4321";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : env.SITE_ORIGIN,
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

async function readAvailability(env) {
  const path = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${DISP_PATH}?ref=main`;
  const res = await github(env, path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "No se pudo leer la fecha.");
  return { sha: data.sha, json: JSON.parse(decodeBase64(data.content)) };
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

function pairKey(entry) {
  return [fold(entry.p1), fold(entry.p2)].sort().join("|");
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
  const entry = cleanAvailability(raw);
  const error = validateAvailability(entry);
  if (error) throw new Error(error);
  const file = await readAvailability(env);
  if (!file.json.open) throw new Error("La carga de esta fecha ya está cerrada.");
  if ((file.json.entries || []).some((row) => pairKey(row) === pairKey(entry))) {
    throw new Error(`Esta pareja ya está anotada en ${file.json.week || "la fecha"}.`);
  }
  file.json.entries = [...(file.json.entries || []), entry];
  const content = encodeBase64(JSON.stringify(file.json, null, 2) + "\n");
  const body = JSON.stringify({
    message: `Carga disponibilidad de ${entry.p1} / ${entry.p2} en ${file.json.week}.`,
    content,
    sha: file.sha,
    branch: "main",
  });
  const path = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${DISP_PATH}`;
  const saved = await github(env, path, { method: "PUT", body });
  const data = await saved.json();
  if (!saved.ok) throw new Error(data.message || "No se pudo guardar la disponibilidad.");
  return { ok: true, week: file.json.week };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") return response(request, env, { ok: true });

      if (url.pathname === "/auth/password" && request.method === "POST") {
        const body = await request.json();
        const ok = await validPassword(env, body.user, body.password);
        return ok
          ? response(request, env, { ok: true })
          : response(request, env, { message: "Usuario o clave incorrectos." }, 401);
      }

      if (url.pathname === "/auth/login" && request.method === "POST") {
        const body = await request.json();
        const passwordOk = await validPassword(env, body.user, body.password);
        const otpOk = passwordOk && (await validTotp(env.TOTP_SECRET, body.otp));
        if (!otpOk) return response(request, env, { message: "Datos de acceso incorrectos." }, 401);
        return response(request, env, await createSession(env));
      }

      if (url.pathname === "/github" && request.method === "POST") {
        if (!(await validSession(request, env))) return response(request, env, { message: "Sesión vencida." }, 401);
        const body = await request.json();
        const upstream = await github(env, body.path, { method: body.method, body: body.body });
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request, env) },
        });
      }

      if (url.pathname === "/availability" && request.method === "POST") {
        const body = await request.json();
        if (body.website) return response(request, env, { ok: true });
        return response(request, env, await appendAvailability(env, body));
      }

      return response(request, env, { message: "No encontrado." }, 404);
    } catch (error) {
      return response(request, env, { message: error?.message || "Error inesperado." }, 400);
    }
  },
};
