import { DAYS } from "./disponibilidad.js";
import { MATCH_MINUTES, parseWindow } from "./fixturer.js";

const DAY_ALIASES = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  miércoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  sábado: "Sábado",
};

function fold(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = fold(raw).split(" ")[0];
  return DAY_ALIASES[key] || DAYS.find((d) => fold(d) === key) || raw;
}

function pick(map, names) {
  for (const name of names) {
    if (map[name] != null && String(map[name]).trim() !== "") return String(map[name]).trim();
  }
  return "";
}

function foldHeader(h) {
  return fold(h).replace(/[_./]+/g, " ");
}

/** Detecta "Fecha 1" en nombre de archivo u hoja. */
export function weekFromName(name) {
  const m = String(name || "").match(/fecha[\s_-]*(\d{1,3})/i);
  return m ? `Fecha ${Number(m[1])}` : "";
}

/**
 * Fila de Excel/CSV → slot de cancha.
 * Columnas: complejo, cancha, horario (+ dia opcional).
 * horario puede ser "19:00 - 20:30" o "Lunes 19:00 - 20:30".
 */
export function parseCourtSlot(raw = {}) {
  const map = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) map[foldHeader(k)] = v;
  }
  let day = normalizeDay(pick(map, ["dia", "day", "dias", "jornada"]));
  let time = String(pick(map, ["horario", "hora", "time", "horario cancha", "turno"]) || "").replace(/\s+/g, " ").trim();
  const venue = String(pick(map, ["complejo", "venue", "sede", "club"]) || "").trim();
  const court = String(pick(map, ["cancha", "court", "pista"]) || "").trim();

  const dayInTime = time.match(/^(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado)\b\s*/i);
  if (dayInTime) {
    if (!day) day = normalizeDay(dayInTime[1]);
    time = time.slice(dayInTime[0].length).trim();
  }

  time = time
    .replace(/\ba\b/gi, "-")
    .replace(/(\d{1,2})\s*hs?/gi, "$1:00")
    .replace(/\./g, ":")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

  if (!venue && !court && !time) return null;
  if (!venue || !time) return null;
  const [from, to] = parseWindow(time);
  if (!(to > from)) return null;
  return { day, time, venue, court, from, to };
}

export function parseCourtSlotRows(rows = []) {
  const slots = [];
  for (const row of rows) {
    const slot = parseCourtSlot(row);
    if (slot) slots.push(slot);
  }
  return slots;
}

function windowsOverlap(aFrom, aTo, bFrom, bTo) {
  return aFrom < bTo && bFrom < aTo;
}

function slotFitsMatch(slot, match) {
  const matchDay = normalizeDay(match.day);
  if (slot.day && matchDay && slot.day !== matchDay) return false;
  if (match.time) {
    const [mFrom, mTo] = parseWindow(match.time);
    if (mTo > mFrom && !windowsOverlap(slot.from, slot.to, mFrom, mTo)) return false;
  }
  return true;
}

function fitScore(slot, match) {
  let score = 0;
  const matchDay = normalizeDay(match.day);
  if (slot.day && matchDay && slot.day === matchDay) score += 10;
  if (match.time) {
    const [mFrom, mTo] = parseWindow(match.time);
    if (mTo > mFrom) {
      if (slot.from === mFrom && slot.to === mTo) score += 20;
      else if (windowsOverlap(slot.from, slot.to, mFrom, mTo)) score += 8;
      score -= Math.abs(slot.from - mFrom) / 30;
    }
  }
  if (slot.court) score += 1;
  return score;
}

/**
 * Asigna canchas del Excel a los partidos de la fecha.
 * onlyEmpty=true: no pisa complejo/cancha/horario ya cargados a mano.
 * Devuelve { assigned, skipped, leftover, matches }.
 */
export function assignCourtSlots(matches = [], slots = [], { onlyEmpty = true } = {}) {
  const next = matches.map((m) => ({ ...m }));
  const pool = slots.map((s, i) => ({ ...s, _i: i, used: false }));
  const candidates = [];

  for (let i = 0; i < next.length; i++) {
    const m = next[i];
    const hasAway = String(m.away || "").trim() && fold(m.away) !== fold("Pendiente / Pendiente");
    if (!hasAway || m.pending) continue;
    const filled = String(m.venue || "").trim() && String(m.time || "").trim();
    if (onlyEmpty && filled) continue;
    const options = pool
      .map((slot, si) => ({ slot, si, score: fitScore(slot, m) }))
      .filter(({ slot }) => !slot.used && slotFitsMatch(slot, m))
      .sort((a, b) => b.score - a.score || a.slot.from - b.slot.from);
    candidates.push({ i, options });
  }

  candidates.sort((a, b) => a.options.length - b.options.length || String(next[a.i].cat || "").localeCompare(String(next[b.i].cat || ""), "es"));

  let assigned = 0;
  for (const { i, options } of candidates) {
    const pick = options.find((o) => !pool[o.si].used);
    if (!pick) continue;
    const slot = pool[pick.si];
    slot.used = true;
    const m = next[i];
    m.venue = slot.venue;
    m.court = slot.court || m.court || "";
    m.day = slot.day || m.day || "";
    m.time = slot.time || m.time || "";
    assigned += 1;
  }

  return {
    assigned,
    skipped: candidates.length - assigned,
    leftover: pool.filter((s) => !s.used).length,
    matches: next,
  };
}

export { MATCH_MINUTES };
