export const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export const CATS = [
  "A Masculina",
  "B Masculina",
  "C Masculina",
  "A Femenino",
  "B Femenino",
  "C Femenino",
];

export const MAIL_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
  "proton.me",
];

export const DISP_PATH = "src/data/disponibilidad.json";

export function fold(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pairLabel(entry) {
  return [entry.p1, entry.p2].filter(Boolean).join(" / ");
}

export function samePair(a, b) {
  const left = [fold(a.p1), fold(a.p2)].sort().join("|");
  const right = [fold(b.p1), fold(b.p2)].sort().join("|");
  return left && left === right;
}

export function cleanEntry(raw) {
  const days = {};
  for (const day of DAYS) {
    if (raw.days && Object.prototype.hasOwnProperty.call(raw.days, day)) {
      days[day] = String(raw.days[day] || "").trim();
    }
  }
  const bye = Boolean(raw.bye);
  return {
    id: String(raw.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    p1: String(raw.p1 || "").trim(),
    p2: String(raw.p2 || "").trim(),
    cat: String(raw.cat || "").trim(),
    recover: Boolean(raw.recover),
    bye,
    days: bye ? {} : days,
    note: String(raw.note || "").trim(),
  };
}

export function cleanDays(raw) {
  const days = {};
  for (const day of DAYS) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, day)) {
      const value = String(raw[day] || "").trim();
      if (value) days[day] = value;
    }
  }
  return days;
}

export function validateDays(days) {
  const list = days && typeof days === "object" ? days : {};
  if (!Object.keys(list).length) return "Marcá al menos un día y horario en el que puedan jugar.";
  const missing = Object.entries(list).filter(([, hours]) => !hours);
  if (missing.length) return `Falta el horario de ${missing[0][0]}.`;
  for (const [day, hours] of Object.entries(list)) {
    const m = String(hours).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return `El horario de ${day} no es válido. Usá desde-hasta, por ejemplo 19:00 - 22:00.`;
    const from = Number(m[1]) * 60 + Number(m[2]);
    let to = Number(m[3]) * 60 + Number(m[4]);
    if (to <= from) to += 24 * 60;
    if (to - from < 90) return `En ${day} el horario tiene que cubrir al menos 1:30 (lo que dura un partido).`;
  }
  return "";
}

export function cleanMailLocal(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 64);
}

export function cleanMailDomain(value) {
  const domain = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  return MAIL_DOMAINS.includes(domain) ? domain : "";
}

export function buildMail(local, domain) {
  const loc = cleanMailLocal(local);
  const dom = cleanMailDomain(domain);
  if (!loc || !dom) return "";
  if (!/^[a-z0-9._%+-]+$/i.test(loc)) return "";
  return `${loc}@${dom}`;
}

export function splitMail(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0) return { local: cleanMailLocal(raw), domain: "" };
  return {
    local: cleanMailLocal(raw.slice(0, at)),
    domain: cleanMailDomain(raw.slice(at + 1)),
  };
}

export function validateMail(mail) {
  if (!mail) return "Completá el mail.";
  const { local, domain } = splitMail(mail);
  if (!local || !domain) return "Elegí un mail con un dominio de la lista.";
  if (!/^[a-z0-9._%+-]+$/i.test(local)) return "El mail tiene caracteres inválidos.";
  return "";
}

export function validateEntry(entry) {
  if (!entry.p1 || !entry.p2) return "Completá los dos integrantes de la pareja.";
  if (!entry.cat) return "Elegí la categoría.";
  if (!entry.bye && !Object.keys(entry.days || {}).length) {
    return "Marcá al menos un día o indicá que no pueden jugar esta semana.";
  }
  if (!entry.bye) {
    const dayError = validateDays(entry.days);
    if (dayError) return dayError;
  }
  return "";
}

export function toB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export function fromB64(b64) {
  return decodeURIComponent(escape(atob(String(b64 || "").replace(/\n/g, ""))));
}

export async function loadDisponibilidad({ owner, repo, token }) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${DISP_PATH}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "No pude leer las inscripciones.");
  return { sha: data.sha, json: JSON.parse(fromB64(data.content)) };
}

export async function saveDisponibilidad({ owner, repo, token, json, sha, message }) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${DISP_PATH}`, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message,
      content: toB64(JSON.stringify(json, null, 2) + "\n"),
      sha,
      branch: "main",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "No pude guardar la disponibilidad.");
  return data;
}

export async function appendDisponibilidad({ owner, repo, token, entry }) {
  let lastErr = new Error("No pude guardar.");
  for (let i = 0; i < 5; i++) {
    const file = await loadDisponibilidad({ owner, repo, token });
    if (!file.json.open) throw new Error("La carga de esta fecha ya está cerrada.");
    const next = cleanEntry(entry);
    const err = validateEntry(next);
    if (err) throw new Error(err);
    if ((file.json.entries || []).some((row) => samePair(row, next))) {
      throw new Error("Esta pareja ya está anotada en " + (file.json.week || "la fecha") + ".");
    }
    if (next.bye) next.days = {};
    else {
      next.days = Object.fromEntries(Object.entries(next.days).filter(([, hours]) => hours));
    }
    file.json.entries = [...(file.json.entries || []), next];
    try {
      await saveDisponibilidad({
        owner,
        repo,
        token,
        json: file.json,
        sha: file.sha,
        message: `Carga disponibilidad de ${pairLabel(next)} en ${file.json.week}.`,
      });
      return file.json;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}
