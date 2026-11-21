import { DAYS } from "./disponibilidad.js";
import { isPendingMatch, isRealPairMatch, MATCH_MINUTES, PENDING_AWAY, slotLabel } from "./fixturer.js";
import { pairsMatch } from "./scoring.js";

const VENUE_ALIASES = {
  OPEN: "Open Padel",
  "OPEN PADEL": "Open Padel",
  AMERICAS: "Americas Padel",
  AMÉRICAS: "Americas Padel",
  "AMERICAS PADEL": "Americas Padel",
  PALERMO: "Palermo Padel",
  "PALERMO PÁDEL": "Palermo Padel",
  "PALERMO PADEL": "Palermo Padel",
  TERRAZAS: "Terrazas Padel",
  "TERRAZAS PADEL": "Terrazas Padel",
  BENGURION: "Bengurion Padel",
  "BEN GURION": "Bengurion Padel",
  "LA MANZANA": "La manzana Padel",
  "LA MANZANA PADEL": "La manzana Padel",
  MANZANA: "La manzana Padel",
};

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

const DAY_END = 24 * 60;
/** Dentro de un rango (ej. 16:30-21:00) los partidos de 90' pueden empezar cada 30'. */
const START_STEP = 30;
/** Margen máximo (en minutos) que puede aflojar la disponibilidad de la pareja para entrar en «cercanos». */
export const FREE_COURT_MARGIN = 90;

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

function normVenueName(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const key = s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const folded = Object.fromEntries(
    Object.entries(VENUE_ALIASES).map(([k, val]) => [k.normalize("NFD").replace(/[\u0300-\u036f]/g, ""), val])
  );
  return folded[key] || VENUE_ALIASES[s.toUpperCase()] || s;
}

/** Detecta "Fecha 1" en nombre de archivo u hoja. */
export function weekFromName(name) {
  const m = String(name || "").match(/fecha[\s_-]*(\d{1,3})/i);
  return m ? `Fecha ${Number(m[1])}` : "";
}

/**
 * Ventana de cancha:
 * - Un solo horario ("14:30") = un turno fijo de 1:30.
 * - Un rango ("16:30 - 21:00") = disponibilidad: adentro podés fixturear partidos de 1:30.
 */
export function parseCourtWindow(text) {
  const raw = String(text || "")
    .toLowerCase()
    .replace(/\ba\b/gi, "-")
    .replace(/(\d{1,2})\s*hs?/gi, "$1:00")
    .replace(/\./g, ":")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  const times = [...raw.matchAll(/(\d{1,2})(?:\s*[:.]\s*(\d{2}))?/g)]
    .map((m) => Number(m[1]) * 60 + Number(m[2] || 0))
    .filter((t) => t >= 0 && t <= DAY_END);
  if (!times.length) return null;
  if (times.length === 1) {
    const from = times[0];
    return { from, to: from + MATCH_MINUTES, single: true };
  }
  let from = times[0];
  let to = times[1];
  if (to <= from) to = DAY_END;
  return { from, to, single: false };
}

/** Cuántos partidos de 90' entran en una ventana (empaquetado sin solapar). */
export function windowCapacity(from, to) {
  const span = Number(to) - Number(from);
  if (!(span >= MATCH_MINUTES)) return 0;
  return Math.floor(span / MATCH_MINUTES);
}

function clockRange(from, to) {
  const h = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${h(from)} - ${h(to)}`;
}

/**
 * Posibles inicios de partido de 90' dentro de la ventana.
 * Rango largo → cada 30' (ej. 16:30, 17:00, …) mientras entre el partido.
 * Horario suelto → un solo inicio.
 */
export function matchStartsInWindow(from, to, { single = false } = {}) {
  const out = [];
  if (!(to > from)) return out;
  if (single || to - from === MATCH_MINUTES) {
    if (from + MATCH_MINUTES <= to) out.push({ from, to: from + MATCH_MINUTES, time: slotLabel(from) });
    return out;
  }
  for (let start = from; start + MATCH_MINUTES <= to; start += START_STEP) {
    out.push({ from: start, to: start + MATCH_MINUTES, time: slotLabel(start) });
  }
  return out;
}

/**
 * Fila de Excel/CSV → ventana de disponibilidad de cancha.
 * Columnas: Complejo, Cancha, Dia, Horario.
 * Devuelve un objeto ventana (no parte el rango en filas fijas del Excel).
 */
export function parseCourtSlot(raw = {}) {
  const map = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) map[foldHeader(k)] = v;
  }
  let day = normalizeDay(pick(map, ["dia", "day", "dias", "jornada"]));
  let timeRaw = String(pick(map, ["horario", "hora", "time", "horario cancha", "turno"]) || "")
    .replace(/\s+/g, " ")
    .trim();
  const venue = normVenueName(pick(map, ["complejo", "venue", "sede", "club"]));
  const court = String(pick(map, ["cancha", "court", "pista"]) || "").trim();

  const dayInTime = timeRaw.match(/^(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado)\b\s*/i);
  if (dayInTime) {
    if (!day) day = normalizeDay(dayInTime[1]);
    timeRaw = timeRaw.slice(dayInTime[0].length).trim();
  }

  if (!venue && !court && !day && !timeRaw) return null;
  if (!venue || !court || !day || !timeRaw) return null;

  const win = parseCourtWindow(timeRaw);
  if (!win || !(win.to > win.from)) return null;
  if (windowCapacity(win.from, win.to) < 1 && win.to - win.from < MATCH_MINUTES) return null;

  return {
    day,
    venue,
    court,
    from: win.from,
    to: win.to,
    single: !!win.single,
    time: win.single || win.to - win.from === MATCH_MINUTES ? slotLabel(win.from) : clockRange(win.from, win.to),
    capacity: Math.max(1, windowCapacity(win.from, win.to)),
  };
}

export function parseCourtSlotRows(rows = []) {
  const slots = [];
  for (const row of rows) {
    const parsed = parseCourtSlot(row);
    if (parsed) {
      if (Array.isArray(parsed)) slots.push(...parsed);
      else slots.push(parsed);
    }
  }
  return slots;
}

/**
 * Filas con Complejo/Cancha/Día pero sin horario usable (Google a veces deja vacío el rango).
 * Devuelve [{ venue, count }].
 */
export function missingCourtHorarios(rows = []) {
  const map = new Map();
  for (const raw of rows || []) {
    const mapH = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) mapH[foldHeader(k)] = v;
    }
    const venue = normVenueName(pick(mapH, ["complejo", "venue", "sede", "club"]));
    const court = String(pick(mapH, ["cancha", "court", "pista"]) || "").trim();
    const day = normalizeDay(pick(mapH, ["dia", "day", "dias", "jornada"]));
    const timeRaw = String(pick(mapH, ["horario", "hora", "time", "horario cancha", "turno"]) || "").trim();
    if (!venue || !court || !day) continue;
    if (timeRaw && parseCourtWindow(timeRaw)) continue;
    map.set(venue, (map.get(venue) || 0) + 1);
  }
  return [...map.entries()]
    .map(([venue, count]) => ({ venue, count }))
    .sort((a, b) => a.venue.localeCompare(b.venue, "es"));
}

/** Expande ventanas a candidatos de partido (90') para asignar. */
export function expandCourtCandidates(windows = []) {
  const out = [];
  for (const w of windows) {
    const sheetFrom = Number.isFinite(w._sheetFrom) ? w._sheetFrom : w.from;
    const sheetTo = Number.isFinite(w._sheetTo) ? w._sheetTo : w.to;
    for (const start of matchStartsInWindow(w.from, w.to, { single: w.single })) {
      out.push({
        day: w.day,
        venue: w.venue,
        court: w.court,
        from: start.from,
        to: start.to,
        time: start.time,
        _windowFrom: w.from,
        _windowTo: w.to,
        outsideSheet: start.from < sheetFrom || start.to > sheetTo,
      });
    }
  }
  return out;
}

function courtDayKey(day, venue, court) {
  return `${normalizeDay(day)}|${fold(venue)}|${courtKey(court)}`;
}

/** True si esa cancha no tiene ningún partido ese día. */
export function courtDayIsOpen(day, venue, court, taken = []) {
  const key = courtDayKey(day, venue, court);
  if (!normalizeDay(day) || !fold(venue) || !courtKey(court)) return false;
  return !(taken || []).some((m) => {
    if (!String(m?.venue || "").trim() || !String(m?.court || "").trim()) return false;
    if (!parseCourtWindow(m.time)) return false;
    return courtDayKey(m.day, m.venue, m.court) === key;
  });
}

/** Las canchas libres conservan el horario exacto del Drive (no se inventan turnos). */
export function widenUnusedCourtWindows(slots = []) {
  return Array.isArray(slots) ? slots : [];
}

function fitsWindowMargin(days, slot, margin) {
  if (!days || typeof days !== "object") return false;
  const day = normalizeDay(slot.day);
  if (!day || (!(day in days) && !(slot.day in days))) return false;
  const raw = days[day] ?? days[slot.day];
  const win = parseCourtWindow(raw);
  if (!win || !(win.to > win.from)) return true;
  const pad = Math.max(0, Number(margin) || 0);
  return Number(slot.from) >= win.from - pad && Number(slot.to) <= win.to + pad;
}

function windowsOverlap(aFrom, aTo, bFrom, bTo) {
  return aFrom < bTo && bFrom < aTo;
}

/**
 * Partidos de 90' que todavía entran en una ventana del Sheet,
 * restando los que ya ocupan esa cancha/día (sin repetir turnos).
 */
export function freeWindowCapacity(slot, taken = []) {
  if (!slot) return 0;
  const from = Number(slot.from);
  const to = Number(slot.to);
  if (!(to > from)) return 0;
  const busy = [];
  for (const m of taken || []) {
    if (!String(m?.venue || "").trim() || !String(m?.court || "").trim()) continue;
    if (fold(m.venue) !== fold(slot.venue) || courtKey(m.court) !== courtKey(slot.court)) continue;
    if (normalizeDay(m.day) !== normalizeDay(slot.day)) continue;
    const win = parseCourtWindow(m.time);
    if (!win || !(win.to > win.from)) continue;
    if (!windowsOverlap(from, to, win.from, win.to)) continue;
    busy.push(win);
  }
  if (slot.single || to - from === MATCH_MINUTES) {
    if (from + MATCH_MINUTES > to && windowCapacity(from, to) < 1) return 0;
    const end = from + MATCH_MINUTES <= to ? from + MATCH_MINUTES : to;
    return busy.some((b) => windowsOverlap(from, end, b.from, b.to)) ? 0 : Math.max(1, windowCapacity(from, to) || 1);
  }
  let free = 0;
  for (let start = from; start + MATCH_MINUTES <= to; start += MATCH_MINUTES) {
    if (!busy.some((b) => windowsOverlap(start, start + MATCH_MINUTES, b.from, b.to))) free += 1;
  }
  return free;
}

/** Agrupa ventanas por complejo: capacidad = partidos de 90' libres (resta los ya fixtureados). */
export function summarizeCourtSlots(slots = [], taken = []) {
  const map = new Map();
  const occupied = Array.isArray(taken) ? taken : [];
  for (const s of slots) {
    const key = s.venue || "Sin complejo";
    if (!map.has(key)) map.set(key, { venue: key, total: 0, sheetTotal: 0, days: new Map(), sheetDays: new Map() });
    const row = map.get(key);
    const sheetCap = Number(s.capacity) || windowCapacity(s.from, s.to) || 1;
    const cap = freeWindowCapacity(s, occupied);
    row.total += cap;
    row.sheetTotal += sheetCap;
    row.days.set(s.day, (row.days.get(s.day) || 0) + cap);
    row.sheetDays.set(s.day, (row.sheetDays.get(s.day) || 0) + sheetCap);
  }
  return [...map.values()]
    .map((r) => ({
      venue: r.venue,
      total: r.total,
      sheetTotal: r.sheetTotal,
      days: DAYS.filter((d) => r.sheetDays.has(d)).map((d) => ({
        day: d,
        count: r.days.get(d) || 0,
        sheet: r.sheetDays.get(d) || 0,
      })),
      daySet: new Set(DAYS.filter((d) => (r.sheetDays.get(d) || 0) > 0)),
    }))
    .sort((a, b) => a.venue.localeCompare(b.venue, "es"));
}

/** "Cancha 1", "1", "Pista 1" → misma cancha. */
export function courtKey(court) {
  const f = fold(court);
  if (!f) return "";
  const numbered = f.match(/^(?:cancha|pista|court)\s*([0-9]+[a-z]?)$/) || f.match(/^([0-9]+[a-z]?)$/);
  if (numbered) return numbered[1];
  return f;
}

function sameCourt(a, b) {
  return (
    fold(a.venue) === fold(b.venue) &&
    courtKey(a.court) === courtKey(b.court) &&
    normalizeDay(a.day) === normalizeDay(b.day)
  );
}

function slotFitsMatch(slot, match) {
  const matchDay = normalizeDay(match.day);
  if (slot.day && matchDay && slot.day !== matchDay) return false;
  if (match.time) {
    const win = parseCourtWindow(match.time);
    if (win && win.to > win.from && !windowsOverlap(slot.from, slot.to, win.from, win.to)) return false;
  }
  return true;
}

/** Busca el horario de un día tolerando tildes (Miercoles ↔ Miércoles). */
function daysRawForDay(days, dayName) {
  if (!days || typeof days !== "object") return undefined;
  const day = normalizeDay(dayName);
  if (!day) return undefined;
  if (Object.prototype.hasOwnProperty.call(days, day)) return days[day];
  if (dayName && Object.prototype.hasOwnProperty.call(days, dayName)) return days[dayName];
  const hit = Object.keys(days).find((k) => normalizeDay(k) === day);
  return hit != null ? days[hit] : undefined;
}

/**
 * El partido de 90' tiene que entrar ENTERO en la ventana declarada ese día.
 * Sin datos de ese jugador → no bloquea (legado / carga manual).
 */
function daysMapFitsSlot(days, slot) {
  if (!days || typeof days !== "object") return true;
  const day = normalizeDay(slot.day);
  if (!day) return false;
  const raw = daysRawForDay(days, slot.day);
  if (raw == null) return false;
  const win = parseCourtWindow(raw);
  if (!win || !(win.to > win.from)) return true;
  return Number(slot.from) >= win.from && Number(slot.to) <= win.to;
}

/** Respetar inscripción de ambas parejas (o days del pendiente). */
export function slotFitsPairAvailability(slot, match, { pending = false } = {}) {
  // Si hay mapa de ambas puntas, SIEMPRE tienen que entrar las dos
  // (aunque el partido figure como pendiente / softAway viejo).
  const hasHome = match?.homeDays && typeof match.homeDays === "object" && Object.keys(match.homeDays).length;
  const hasAway = match?.awayDays && typeof match.awayDays === "object" && Object.keys(match.awayDays).length;
  if (hasHome && hasAway) {
    return daysMapFitsSlot(match.homeDays, slot) && daysMapFitsSlot(match.awayDays, slot);
  }
  if (pending) {
    if (match?.days && typeof match.days === "object") return daysMapFitsSlot(match.days, slot);
    if (hasHome) return daysMapFitsSlot(match.homeDays, slot);
    return true;
  }
  const homeOk = daysMapFitsSlot(match?.homeDays, slot);
  const awayOk = daysMapFitsSlot(match?.awayDays, slot);
  return homeOk && awayOk;
}

/**
 * Adjunta homeDays/awayDays/days desde inscripciones.
 * Sin eso, assignCourtSlots trata “sin mapa” como legado y puede meter cualquier turno.
 */
export function attachPairDaysFromPairs(matches = [], pairs = []) {
  const list = Array.isArray(pairs) ? pairs : [];
  function daysFor(name, cat, temp) {
    const label = String(name || "").trim();
    if (!label || isPlaceholderPairName(label)) return undefined;
    const season = String(temp || "").toUpperCase();
    const hit =
      list.find(
        (p) =>
          String(p.temp || "").toUpperCase() === season &&
          (!cat || !p.cat || p.cat === cat) &&
          pairsMatch(`${p.p1 || ""} / ${p.p2 || ""}`, label)
      ) ||
      list.find(
        (p) => String(p.temp || "").toUpperCase() === season && pairsMatch(`${p.p1 || ""} / ${p.p2 || ""}`, label)
      );
    const days = hit?.days;
    if (!days || typeof days !== "object" || !Object.keys(days).length) return undefined;
    return days;
  }
  return (matches || []).map((m) => {
    const temp = m.temp || "";
    const cat = m.cat || "";
    const homeDays = daysFor(m.home, cat, temp) || (m.homeDays && typeof m.homeDays === "object" ? m.homeDays : undefined);
    const awayDays = daysFor(m.away, cat, temp) || (m.awayDays && typeof m.awayDays === "object" ? m.awayDays : undefined);
    const pending = isPendingMatch(m);
    const days =
      pending && homeDays
        ? homeDays
        : m.days && typeof m.days === "object"
          ? m.days
          : homeDays;
    return {
      ...m,
      ...(homeDays ? { homeDays } : {}),
      ...(awayDays ? { awayDays } : {}),
      ...(pending && days ? { days, avail: availText(days) } : {}),
    };
  });
}

function isPlaceholderPairName(name) {
  const raw = String(name || "").trim();
  if (!raw) return true;
  return fold(raw) === fold(PENDING_AWAY);
}

/** Texto corto: por qué el horario no entra en la inscripción de cada punta. */
export function availabilityMissDetail(match) {
  if (!match || !isRealPairMatch(match)) return "";
  if (match.flexAvail) return "";
  const day = normalizeDay(match.day);
  const time = String(match.time || "").trim();
  if (!day || !time) return "";
  const win = parseCourtWindow(time);
  if (!win || !(win.to > win.from)) return "";
  const slot = { day, time, venue: match.venue, court: match.court, from: win.from, to: win.to };
  const hasHome = match?.homeDays && typeof match.homeDays === "object" && Object.keys(match.homeDays).length;
  const hasAway = match?.awayDays && typeof match.awayDays === "object" && Object.keys(match.awayDays).length;
  if (!hasHome && !hasAway) return "";
  if (slotFitsPairAvailability(slot, match, { pending: false })) return "";
  const bits = [];
  const homeName = String(match.home || "").split("/")[0].trim() || "Local";
  const awayName = String(match.away || "").split("/")[0].trim() || "Visitante";
  if (hasHome && !daysMapFitsSlot(match.homeDays, slot)) {
    const raw = daysRawForDay(match.homeDays, day);
    bits.push(`${homeName}: ${raw ? `${day} ${raw}` : `sin ${day}`}`);
  }
  if (hasAway && !daysMapFitsSlot(match.awayDays, slot)) {
    const raw = daysRawForDay(match.awayDays, day);
    bits.push(`${awayName}: ${raw ? `${day} ${raw}` : `sin ${day}`}`);
  }
  if (!bits.length) return "";
  return `${day} ${time} no entra · ${bits.join(" · ")}`;
}

/** True si el partido tiene sede/horario y alguna punta no puede jugar ahí. */
export function matchViolatesAvailability(match) {
  if (!match || !isRealPairMatch(match)) return false;
  // Admin eligió a propósito un turno “cercano” (afloja inscripción).
  if (match.flexAvail) return false;
  if (!String(match.day || "").trim() || !String(match.time || "").trim()) return false;
  const win = parseCourtWindow(match.time);
  if (!win || !(win.to > win.from)) return false;
  const slot = {
    day: match.day,
    time: match.time,
    venue: match.venue,
    court: match.court,
    from: win.from,
    to: win.to,
  };
  const hasHome = match?.homeDays && typeof match.homeDays === "object" && Object.keys(match.homeDays).length;
  const hasAway = match?.awayDays && typeof match.awayDays === "object" && Object.keys(match.awayDays).length;
  // Solo marcamos violación cuando conocemos la disponibilidad de la punta.
  if (!hasHome && !hasAway) return false;
  return !slotFitsPairAvailability(slot, match, { pending: false });
}

/**
 * Parte a pendientes los partidos reales cuyo horario no entra en la inscripción.
 * Devuelve { matches, parked, details } (details = por qué se aparcó cada cruce).
 */
export function parkAvailabilityViolations(
  matches = [],
  { reason = "El horario del partido no entra en la disponibilidad de la inscripción." } = {}
) {
  const out = [];
  const details = [];
  let parked = 0;
  for (const m of matches) {
    if (!matchViolatesAvailability(m)) {
      out.push(m);
      continue;
    }
    parked += 1;
    const detail = availabilityMissDetail(m);
    if (detail) details.push(detail);
    const homeDays = m.homeDays && typeof m.homeDays === "object" ? m.homeDays : undefined;
    const awayDays = m.awayDays && typeof m.awayDays === "object" ? m.awayDays : undefined;
    out.push({
      ...m,
      away: PENDING_AWAY,
      pending: true,
      venue: "",
      court: "",
      day: "",
      time: "",
      date: "",
      result: "",
      appliedResult: "",
      reason,
      avail: availText(homeDays),
      days: homeDays,
      homeDays,
      awayDays: undefined,
    });
    if (String(m.away || "").trim() && !isPlaceholderPairName(m.away)) {
      out.push({
        ...m,
        home: m.away,
        away: PENDING_AWAY,
        pending: true,
        venue: "",
        court: "",
        day: "",
        time: "",
        date: "",
        result: "",
        appliedResult: "",
        reason,
        avail: availText(awayDays),
        days: awayDays,
        homeDays: awayDays,
        awayDays: undefined,
      });
    }
  }
  return { matches: out, parked, details };
}

/**
 * True si ambas mapas de disponibilidad comparten al menos un tramo de 90'
 * el mismo día (sin mirar canchas del Drive).
 */
export function pairsSharePlayableWindow(homeDays, awayDays) {
  if (!homeDays || !awayDays || typeof homeDays !== "object" || typeof awayDays !== "object") return false;
  for (const day of DAYS) {
    if (!(day in homeDays) || !(day in awayDays)) continue;
    const a = parseCourtWindow(homeDays[day]);
    const b = parseCourtWindow(awayDays[day]);
    if (!a || !b) continue;
    const from = Math.max(a.from, b.from);
    const to = Math.min(a.to, b.to);
    if (to - from >= MATCH_MINUTES) return true;
  }
  return false;
}

function fitScore(slot, match) {
  let score = 0;
  const matchDay = normalizeDay(match.day);
  if (slot.day && matchDay && slot.day === matchDay) score += 10;
  if (match.time) {
    const win = parseCourtWindow(match.time);
    if (win && win.to > win.from) {
      if (slot.from === win.from && slot.to === win.to) score += 20;
      else if (windowsOverlap(slot.from, slot.to, win.from, win.to)) score += 8;
      score -= Math.abs(slot.from - win.from) / 30;
    }
  }
  if (slot.court) score += 1;
  return score;
}

function venueKey(name) {
  return fold(name);
}

/**
 * Filtra ventanas según plan avanzado y expande a candidatos de 90'.
 * plan: [{ venue, count, days: string[] }]
 *
 * mode:
 * - "pack" (default): hasta `count` turnos no solapados por complejo (los más tempranos).
 * - "pool": TODOS los turnos posibles de esos días; el tope `count` lo aplica assignCourtSlots
 *   con venueCaps. Así si las parejas solo pueden 16:30-19:30 no nos quedamos trabados
 *   con canchas de las 15:00 que el pack agarró primero.
 */
export function applyVenuePlan(slots = [], plan = [], { mode = "pack" } = {}) {
  if (!plan.length) return expandCourtCandidates(slots);
  const loose = mode === "pool";
  const out = [];
  for (const row of plan) {
    const want = Math.max(0, Number(row.count) || 0);
    if (!want) continue;
    const days = new Set((row.days || []).map(normalizeDay).filter(Boolean));
    if (!days.size) continue;
    const windows = slots
      .filter((s) => venueKey(s.venue) === venueKey(row.venue) && days.has(s.day))
      .sort(
        (a, b) =>
          DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.from - b.from || String(a.court).localeCompare(String(b.court), "es")
      );
    const candidates = expandCourtCandidates(windows).sort(
      (a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.from - b.from || String(a.court).localeCompare(String(b.court), "es")
    );
    if (loose) {
      out.push(...candidates);
      continue;
    }
    const picked = [];
    for (const c of candidates) {
      if (picked.length >= want) break;
      if (picked.some((p) => sameCourt(p, c) && windowsOverlap(p.from, p.to, c.from, c.to))) continue;
      picked.push(c);
    }
    out.push(...picked);
  }
  return out;
}

/**
 * Asigna canchas a partidos respetando disponibilidad de ambas parejas.
 * 1) Greedy: primero los partidos con menos opciones.
 * 2) Reasignación: si uno quedó sin cancha, mueve a otro partido flexible y le cede el turno.
 * Nunca asigna fuera de la ventana inscripta (preferPlan solo reubica dentro de ella).
 */
export function assignCourtSlots(
  matches = [],
  slots = [],
  {
    onlyEmpty = true,
    venueCaps = null,
    preferPlan = false,
    skipPendingAssign = false,
    /** No muda partidos que ya tenían cancha (evita “robar” cupos al probar exactos). */
    freezeFilled = false,
  } = {}
) {
  const next = matches.map((m) => ({ ...m }));
  const needsExpand = slots.some((s) => Number(s.to) - Number(s.from) > MATCH_MINUTES || s.capacity > 1);
  const poolSource = needsExpand ? expandCourtCandidates(slots) : slots.slice();
  // _ck precalculado: sameCourt() normaliza strings y es el costo dominante en fechas grandes.
  const pool = poolSource.map((s, i) => ({ ...s, _i: i, _ck: courtDayKey(s.day, s.venue, s.court) }));
  const clash = (a, b) => a._ck === b._ck && windowsOverlap(a.from, a.to, b.from, b.to);

  /** matchIndex → pool index elegido */
  const owner = new Map();

  function isPendingMatch(m) {
    return !!m.pending || fold(m.away) === fold("Pendiente / Pendiente");
  }

  function pendingAvailScore(slot, match) {
    const days = match.days;
    if (!days || typeof days !== "object") return 0;
    const day = slot.day;
    if (!(day in days)) return -8;
    const win = parseCourtWindow(days[day]);
    if (!win) return 12;
    if (Number(slot.from) >= win.from && Number(slot.to) <= win.to) return 18;
    return 4;
  }

  function scoreOf(slot, m, pending) {
    let score = fitScore(slot, m) + (pending ? pendingAvailScore(slot, m) : 0);
    if (preferPlan && normalizeDay(m.day) === slot.day) score += 10;
    if (preferPlan && slotFitsMatch(slot, m)) score += 30;
    return score;
  }

  function venueCountExcluding(matchIndex) {
    const counts = new Map();
    for (const [mi, si] of owner) {
      if (mi === matchIndex) continue;
      const v = venueKey(pool[si].venue);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return counts;
  }

  function capForVenue(venue) {
    if (!venueCaps) return null;
    if (venueCaps[venue] != null) return Number(venueCaps[venue]);
    const norm = normVenueName(venue);
    if (venueCaps[norm] != null) return Number(venueCaps[norm]);
    const folded = venueKey(venue);
    for (const [k, v] of Object.entries(venueCaps)) {
      if (venueKey(k) === folded) return Number(v);
    }
    return null;
  }

  function underCapFor(slot, matchIndex) {
    const cap = capForVenue(slot.venue);
    if (cap == null || !Number.isFinite(cap)) return true;
    const used = venueCountExcluding(matchIndex).get(venueKey(slot.venue)) || 0;
    return used < cap;
  }

  function slotFreeFor(si, matchIndex) {
    const slot = pool[si];
    if (!underCapFor(slot, matchIndex)) return false;
    for (const [mi, osi] of owner) {
      if (mi === matchIndex) continue;
      if (clash(slot, pool[osi])) return false;
    }
    return true;
  }

  /** Candidatos legales: disponibilidad + cupo + sin solape. preferPlan permite otro horario válido. */
  function optionsFor(matchIndex) {
    const m = next[matchIndex];
    const pending = isPendingMatch(m);
    const opts = [];
    for (let si = 0; si < pool.length; si++) {
      const slot = pool[si];
      if (!slotFitsPairAvailability(slot, m, { pending })) continue;
      if (!preferPlan && !slotFitsMatch(slot, m)) continue;
      if (!slotFreeFor(si, matchIndex)) continue;
      opts.push({ si, score: scoreOf(slot, m, pending) });
    }
    opts.sort((a, b) => b.score - a.score || pool[a.si].from - pool[b.si].from);
    return opts;
  }

  function applyOwner(matchIndex, si) {
    owner.set(matchIndex, si);
    const slot = pool[si];
    const m = next[matchIndex];
    m.venue = slot.venue;
    m.court = slot.court || m.court || "";
    m.day = slot.day || m.day || "";
    m.time = slot.time || m.time || "";
  }

  function clearOwner(matchIndex) {
    owner.delete(matchIndex);
    const m = next[matchIndex];
    m.venue = "";
    m.court = "";
    // day/time originales se reescriben al reasignar; si queda libre, se restauran abajo
  }

  /** Índice del pool que coincide con el turno ya cargado, o -1. */
  function poolIndexForMatch(m) {
    const venue = String(m.venue || "").trim();
    const court = String(m.court || "").trim();
    const day = normalizeDay(m.day);
    const win = parseCourtWindow(m.time);
    if (!venue || !court || !day || !win || !(win.to > win.from)) return -1;
    for (let si = 0; si < pool.length; si++) {
      const slot = pool[si];
      if (!sameCourt(slot, { venue, court, day })) continue;
      if (Number(slot.from) === win.from && Number(slot.to) === win.to) return si;
    }
    return -1;
  }

  /** Si el partido ya tiene cancha pero no está en el pool, la agregamos para bloquear solapes. */
  function ensurePoolSlotForMatch(m) {
    const existing = poolIndexForMatch(m);
    if (existing >= 0) return existing;
    const venue = String(m.venue || "").trim();
    const court = String(m.court || "").trim();
    const day = normalizeDay(m.day);
    const win = parseCourtWindow(m.time);
    if (!venue || !court || !day || !win || !(win.to > win.from)) return -1;
    const si = pool.length;
    pool.push({
      day,
      venue,
      court,
      from: win.from,
      to: win.to,
      time: m.time || slotLabel(win.from),
      _i: si,
      _ck: courtDayKey(day, venue, court),
      _seeded: true,
    });
    return si;
  }

  const needIdx = [];
  const filledIdx = [];
  for (let i = 0; i < next.length; i++) {
    const m = next[i];
    const pending = isPendingMatch(m);
    const hasRealAway = String(m.away || "").trim() && !pending;
    if (!hasRealAway && !pending) continue;
    // Exactos / rematch: no gastar en acomodar pendientes (solo el partido real nuevo).
    if (pending && skipPendingAssign) continue;
    const filled =
      String(m.venue || "").trim() && String(m.court || "").trim() && String(m.time || "").trim() && String(m.day || "").trim();
    if (onlyEmpty && filled) {
      filledIdx.push(i);
      continue;
    }
    needIdx.push(i);
  }

  // onlyEmpty: las canchas ya asignadas tienen que ocupar el pool. Si dos partidos
  // ya chocan (dato viejo / doble book), el primero se queda y el resto se reasigna.
  if (onlyEmpty) {
    for (const i of filledIdx) {
      const si = ensurePoolSlotForMatch(next[i]);
      if (si < 0) {
        needIdx.push(i);
        continue;
      }
      let blocked = false;
      for (const [mi, osi] of owner) {
        if (mi === i) continue;
        if (clash(pool[si], pool[osi])) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        const m = next[i];
        m.venue = "";
        m.court = "";
        needIdx.push(i);
        continue;
      }
      owner.set(i, si);
    }
  }

  // Snapshot del día/hora del fixtureo (para restaurar si no hay cancha).
  const originalWhen = new Map(needIdx.map((i) => [i, { day: next[i].day || "", time: next[i].time || "" }]));

  const optionCount = new Map(needIdx.map((i) => [i, optionsFor(i).length]));
  needIdx.sort(
    (a, b) =>
      Number(!!isPendingMatch(next[a])) - Number(!!isPendingMatch(next[b])) ||
      optionCount.get(a) - optionCount.get(b) ||
      String(next[a].cat || "").localeCompare(String(next[b].cat || ""), "es")
  );

  for (const i of needIdx) {
    const pick = optionsFor(i)[0];
    if (pick) applyOwner(i, pick.si);
  }

  function fitsAvailAndMode(matchIndex, si) {
    const m = next[matchIndex];
    const pending = isPendingMatch(m);
    const slot = pool[si];
    if (!slotFitsPairAvailability(slot, m, { pending })) return false;
    if (!preferPlan && !slotFitsMatch(slot, m)) return false;
    return true;
  }

  function findOccupantBlocking(si, ignoreMatch = null) {
    const slot = pool[si];
    for (const [mi, osi] of owner) {
      if (mi === ignoreMatch) continue;
      if (osi === si) return mi;
      if (clash(slot, pool[osi])) return mi;
    }
    return null;
  }

  // Reasignación: si un partido quedó sin cancha, pedirle el turno a uno que pueda mudarse.
  // freezeFilled: solo ocupa huecos libres (para probar exactos sin desalojar a nadie).
  if (!freezeFilled) {
    let improved = true;
    let guard = 0;
    while (improved && guard++ < needIdx.length * 6) {
      improved = false;
      for (const u of needIdx) {
        if (owner.has(u)) continue;
        const direct = optionsFor(u)[0];
        if (direct) {
          applyOwner(u, direct.si);
          improved = true;
          continue;
        }
        if (!preferPlan) continue;

        const ranked = [];
        for (let si = 0; si < pool.length; si++) {
          if (!fitsAvailAndMode(u, si)) continue;
          ranked.push({ si, score: scoreOf(pool[si], next[u], isPendingMatch(next[u])) });
        }
        ranked.sort((a, b) => b.score - a.score || pool[a.si].from - pool[b.si].from);

        for (const { si } of ranked) {
          const occupant = findOccupantBlocking(si);
          if (occupant == null) {
            if (!slotFreeFor(si, u)) continue;
            applyOwner(u, si);
            improved = true;
            break;
          }
          const occSlot = owner.get(occupant);
          clearOwner(occupant);
          const alt = optionsFor(occupant).find((o) => o.si !== si);
          if (!alt) {
            applyOwner(occupant, occSlot);
            continue;
          }
          applyOwner(occupant, alt.si);
          // Revalidar cupo/solape DESPUÉS de mudar al ocupante (si no, se puede pasar el tope del complejo).
          if (!slotFreeFor(si, u) || !fitsAvailAndMode(u, si)) {
            clearOwner(occupant);
            applyOwner(occupant, occSlot);
            continue;
          }
          applyOwner(u, si);
          improved = true;
          break;
        }
      }
    }
  }

  for (const i of needIdx) {
    if (owner.has(i)) continue;
    const orig = originalWhen.get(i);
    if (!orig) continue;
    next[i].day = orig.day;
    next[i].time = orig.time;
    next[i].venue = "";
    next[i].court = "";
  }

  const assigned = needIdx.filter((i) => owner.has(i)).length;
  // leftover: turnos del pool que no chocan con ninguno asignado (aprox. capacidad libre)
  let leftover = 0;
  for (let si = 0; si < pool.length; si++) {
    let blocked = false;
    for (const osi of owner.values()) {
      if (clash(pool[si], pool[osi])) {
        blocked = true;
        break;
      }
    }
    if (!blocked) leftover += 1;
  }

  return {
    assigned,
    skipped: needIdx.length - assigned,
    leftover,
    matches: next,
  };
}

/**
 * Partidos de la misma fecha (week+temp) que comparten complejo/cancha en un horario solapado.
 * Devuelve grupos [{ key, matches: [...] }, ...] con 2+ partidos.
 */
export function findCourtConflicts(matches = []) {
  const indexed = (matches || [])
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => {
      if (!String(m?.venue || "").trim() || !String(m?.court || "").trim()) return false;
      if (!normalizeDay(m.day)) return false;
      const win = parseCourtWindow(m.time);
      return !!(win && win.to > win.from);
    });

  const groups = [];
  const seen = new Set();
  for (let i = 0; i < indexed.length; i++) {
    if (seen.has(indexed[i].index)) continue;
    const a = indexed[i].m;
    const aWin = parseCourtWindow(a.time);
    const aWeek = String(a.week || "");
    const aTemp = String(a.temp || "").toUpperCase();
    const cluster = [indexed[i]];
    for (let j = i + 1; j < indexed.length; j++) {
      if (seen.has(indexed[j].index)) continue;
      const b = indexed[j].m;
      if (String(b.week || "") !== aWeek) continue;
      if (String(b.temp || "").toUpperCase() !== aTemp) continue;
      if (fold(a.venue) !== fold(b.venue) || courtKey(a.court) !== courtKey(b.court)) continue;
      if (normalizeDay(a.day) !== normalizeDay(b.day)) continue;
      const bWin = parseCourtWindow(b.time);
      if (!bWin || !windowsOverlap(aWin.from, aWin.to, bWin.from, bWin.to)) continue;
      cluster.push(indexed[j]);
    }
    if (cluster.length < 2) continue;
    for (const c of cluster) seen.add(c.index);
    groups.push({
      key: `${aTemp}|${aWeek}|${normalizeDay(a.day)}|${a.time}|${a.venue}|${a.court}`,
      day: normalizeDay(a.day),
      time: a.time,
      venue: a.venue,
      court: a.court,
      week: aWeek,
      temp: aTemp,
      matches: cluster.map((c) => c.m),
      indexes: cluster.map((c) => c.index),
    });
  }
  return groups;
}

function courtOptionKey(slot) {
  return [slot.day, slot.time, slot.venue, slot.court].map((part) => encodeURIComponent(part || "")).join("|");
}

/** True si otro partido ya usa la misma cancha en un horario que se solapa. */
export function isCourtTaken(match = {}, taken = []) {
  const venue = String(match.venue || "").trim();
  const court = String(match.court || "").trim();
  const day = normalizeDay(match.day);
  const win = parseCourtWindow(match.time);
  if (!venue || !court || !day || !win || !(win.to > win.from)) return false;
  const ck = courtKey(court);
  return (taken || []).some((other) => {
    if (!other?.venue || !other?.court) return false;
    if (fold(other.venue) !== fold(venue) || courtKey(other.court) !== ck) return false;
    if (normalizeDay(other.day) !== day) return false;
    const otherWin = parseCourtWindow(other.time);
    if (!otherWin) return false;
    return windowsOverlap(win.from, win.to, otherWin.from, otherWin.to);
  });
}

function hasPairAvailability(match, pending) {
  if (pending && match?.days && typeof match.days === "object" && Object.keys(match.days).length) return true;
  if (match?.homeDays && typeof match.homeDays === "object" && Object.keys(match.homeDays).length) return true;
  if (match?.awayDays && typeof match.awayDays === "object" && Object.keys(match.awayDays).length) return true;
  return false;
}

/**
 * Minutos del turno de 90' que quedan fuera de la ventana de inscripción ese día.
 * Si ese día no figura en la inscripción → penalización fuerte (día + gap).
 */
export function slotAvailabilityMiss(days, slot) {
  const from = Number(slot?.from);
  const to = Number(slot?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return DAY_END;
  if (!days || typeof days !== "object") return DAY_END;
  const day = normalizeDay(slot.day);
  if (!day) return DAY_END;
  if (!(day in days) && !(slot.day in days)) return DAY_END + MATCH_MINUTES;
  const raw = days[day] ?? days[slot.day];
  const win = parseCourtWindow(raw);
  if (!win || !(win.to > win.from)) return 0;
  if (to <= win.from || from >= win.to) {
    const gap = to <= win.from ? win.from - to : from - win.to;
    return MATCH_MINUTES + Math.max(0, gap);
  }
  const overlap = Math.min(to, win.to) - Math.max(from, win.from);
  return Math.max(0, MATCH_MINUTES - overlap);
}

function missLabel(mins) {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  if (n === 0) return "ok";
  if (n >= DAY_END) return "sin día";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h && m) return `+${h}h${String(m).padStart(2, "0")}`;
  if (h) return `+${h}h`;
  return `+${m}'`;
}

/**
 * Canchas libres del Drive ordenadas por menor “distancia” a ambas inscripciones.
 * Sin includeFar: solo desfase chico (ambas tienen el día y aflojan ≤ ~1 partido).
 * Con includeFar: todas las canchas libres, aunque una pareja no tenga ese día.
 * Los exactos (entran las dos) los sigue armando driveCourtOptions.
 */
export function nearCoverCourtOptions(
  { homeDays, awayDays } = {},
  slots = [],
  taken = [],
  { limit = 12, maxMiss = MATCH_MINUTES, includeFar = false } = {}
) {
  if (!homeDays || !awayDays) return [];
  const missCap = Math.max(1, Number(maxMiss) || MATCH_MINUTES);
  const seen = new Set();
  const out = [];
  for (const slot of expandCourtCandidates(slots)) {
    const slotDay = normalizeDay(slot.day);
    const busy = (taken || []).some((other) => {
      if (!other?.venue || !other?.court) return false;
      if (fold(other.venue) !== fold(slot.venue) || courtKey(other.court) !== courtKey(slot.court)) return false;
      if (normalizeDay(other.day) !== slotDay) return false;
      const otherWin = parseCourtWindow(other.time);
      if (!otherWin) return false;
      return windowsOverlap(slot.from, slot.to, otherWin.from, otherWin.to);
    });
    if (busy) continue;

    const homeMiss = slotAvailabilityMiss(homeDays, slot);
    const awayMiss = slotAvailabilityMiss(awayDays, slot);
    // Ya entra perfecto para ambas → lo maneja driveCourtOptions estricto.
    if (homeMiss === 0 && awayMiss === 0) continue;

    const bothHaveDay =
      !!slotDay &&
      ((slotDay in homeDays || slot.day in homeDays) && (slotDay in awayDays || slot.day in awayDays));
    const miss = homeMiss + awayMiss;
    const worst = Math.max(homeMiss, awayMiss);
    // Cercano: desfase chico, o el turno entra si se estira la inscripción 1:30.
    const withinMargin =
      bothHaveDay &&
      fitsWindowMargin(homeDays, slot, FREE_COURT_MARGIN) &&
      fitsWindowMargin(awayDays, slot, FREE_COURT_MARGIN);
    const close = bothHaveDay && ((miss <= missCap && worst <= missCap) || withinMargin);
    if (!includeFar && !close) continue;

    const key = courtOptionKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      day: slot.day,
      time: slot.time,
      venue: slot.venue,
      court: slot.court,
      key,
      near: true,
      close,
      estimate: !close,
      homeMiss,
      awayMiss,
      miss,
      worst,
      bothHaveDay,
      fitsHome: homeMiss === 0,
      fitsAway: awayMiss === 0,
      outsideSheet: !!slot.outsideSheet,
      nearLabel: `pendiente ${missLabel(homeMiss)} · cubre ${missLabel(awayMiss)}`,
    });
  }

  out.sort(
    (a, b) =>
      a.miss - b.miss ||
      a.worst - b.worst ||
      DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
      a.time.localeCompare(b.time, "es") ||
      a.venue.localeCompare(b.venue, "es") ||
      String(a.court).localeCompare(String(b.court), "es", { numeric: true })
  );
  if (includeFar) return out;
  return out.slice(0, Math.max(1, Number(limit) || 12));
}

/** El menor desfase de quien sí tiene ese día. «Sin día» no cuenta como cerca. */
export function bestKnownMiss(o) {
  const known = [o?.homeMiss, o?.awayMiss].filter((n) => Number.isFinite(n) && n < 24 * 60);
  return known.length ? Math.min(...known) : 24 * 60;
}

/**
 * exact: entran las dos. near: desfase chico, o una entra en ok/+30' aunque la otra no tenga el día.
 * estimate: se estira hasta 2 h, o queda lejos pero la cancha ya tiene partido.
 * free: cancha vacía y el turno queda lejos. Es la última opción, para proponerlo por si pueden.
 */
export function coverSlotTier(o) {
  if (!o?.near && !o?.estimate) return "exact";
  if (o.close) return "near";
  const best = bestKnownMiss(o);
  if (best <= 30) return "near";
  if (best <= 120) return "estimate";
  return o?.openDay ? "free" : "estimate";
}

/**
 * Un turno dura 90'. En la misma cancha no se listan inicios cada 30'
 * que se pisan (19:00-20:30 y 19:30-21:00 no pueden jugarse los dos).
 * Prioridad: exacto, después cercano, después estimable; a igual prioridad, el más temprano.
 */
export function packNonOverlappingTurns(list = []) {
  const groups = new Map();
  for (const o of list) {
    const key = `${normalizeDay(o.day)}|${fold(o.venue)}|${courtKey(o.court)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const rank = (o) => (o.estimate ? 2 : o.near ? 1 : 0);
  const out = [];
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank) return byRank;
      const wa = parseCourtWindow(a.time);
      const wb = parseCourtWindow(b.time);
      return (wa?.from ?? 0) - (wb?.from ?? 0);
    });
    const chosen = [];
    for (const o of ranked) {
      const w = parseCourtWindow(o.time);
      if (!w) continue;
      const overlaps = chosen.some((c) => {
        const cw = parseCourtWindow(c.time);
        return cw && windowsOverlap(w.from, w.to, cw.from, cw.to);
      });
      if (!overlaps) chosen.push(o);
    }
    out.push(...chosen);
  }
  return out;
}

/**
 * Canchas del Sheet para partidos que quedaron sin complejo/cancha.
 * Ignora el tope de «Partidos a usar».
 * Con disponibilidad de las parejas: ofrece cualquier día/horario del Drive donde
 * puedan jugar (no solo el turno que había armado el fixture).
 * softAway: la pareja visitante/cubre no bloquea; solo ordena (prioriza si también entra).
 * Sin disponibilidad cargada: se limita al día y horario ya fijados.
 * No ofrece una cancha ya ocupada (mismo complejo, cancha y horario solapado).
 */
export function driveCourtOptions(match = {}, slots = [], taken = [], { softAway = false } = {}) {
  const matchDay = normalizeDay(match.day);
  const matchWin = parseCourtWindow(match.time);
  const pending = !!match.pending || fold(match.away) === fold("Pendiente / Pendiente");
  const useAvail = hasPairAvailability(match, pending);
  if (!useAvail && (!matchDay || !matchWin || !(matchWin.to > matchWin.from))) return [];

  const seen = new Set();
  const out = [];
  for (const slot of expandCourtCandidates(slots)) {
    if (useAvail) {
      if (softAway) {
        // Anclar en la pareja local/pendiente; la que cubre puede aflojar horario.
        if (pending) {
          if (match?.days && typeof match.days === "object") {
            if (!daysMapFitsSlot(match.days, slot)) continue;
          } else if (!daysMapFitsSlot(match?.homeDays, slot)) continue;
        } else if (!daysMapFitsSlot(match?.homeDays, slot)) continue;
      } else if (!slotFitsPairAvailability(slot, match, { pending })) continue;
    } else {
      if (normalizeDay(slot.day) !== matchDay) continue;
      if (slot.from !== matchWin.from || slot.to !== matchWin.to) continue;
    }

    const slotDay = normalizeDay(slot.day);
    const busy = (taken || []).some((other) => {
      if (!other?.venue || !other?.court) return false;
      if (fold(other.venue) !== fold(slot.venue) || courtKey(other.court) !== courtKey(slot.court)) return false;
      if (normalizeDay(other.day) !== slotDay) return false;
      const otherWin = parseCourtWindow(other.time);
      if (!otherWin) return false;
      return windowsOverlap(slot.from, slot.to, otherWin.from, otherWin.to);
    });
    if (busy) continue;

    const key = courtOptionKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);

    const sameDay = matchDay && slotDay === matchDay;
    const sameWhen =
      sameDay && matchWin && slot.from === matchWin.from && slot.to === matchWin.to;
    const fitsAway = softAway ? daysMapFitsSlot(match?.awayDays, slot) : true;
    out.push({
      day: slot.day,
      time: slot.time,
      venue: slot.venue,
      court: slot.court,
      key,
      sameWhen: !!sameWhen,
      sameDay: !!sameDay,
      fitsAway: !!fitsAway,
      outsideSheet: !!slot.outsideSheet,
    });
  }

  out.sort(
    (a, b) =>
      Number(b.fitsAway) - Number(a.fitsAway) ||
      Number(b.sameWhen) - Number(a.sameWhen) ||
      Number(b.sameDay) - Number(a.sameDay) ||
      DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
      a.time.localeCompare(b.time, "es") ||
      a.venue.localeCompare(b.venue, "es") ||
      String(a.court).localeCompare(String(b.court), "es", { numeric: true })
  );
  return out;
}

function withPairDays(base, home, away, homeDays, awayDays) {
  return {
    ...base,
    home,
    away,
    homeDays,
    awayDays,
    venue: "",
    court: "",
    day: "",
    time: "",
    pending: false,
    reason: "",
    avail: "",
  };
}

function courtAssignedCount(matches = []) {
  return matches.filter((m) => String(m.venue || "").trim() && String(m.court || "").trim()).length;
}

/**
 * Solo turnos EXACTOS del Drive (entran las dos en el horario de la cancha).
 * Cercanos / estimables / cancha vacía no cuentan acá: eso es para cubrir pendientes a mano.
 * Si no hay exacto, [].
 */
export function filterSharedSlotsToDrive(slots = [], entryA = {}, entryB = {}, courtPool = []) {
  if (!courtPool?.length) return slots || [];
  const match = {
    homeDays: entryA?.days && typeof entryA.days === "object" ? entryA.days : undefined,
    awayDays: entryB?.days && typeof entryB.days === "object" ? entryB.days : undefined,
  };
  const fitting = (courtPool || []).filter((c) => slotFitsPairAvailability(c, match, { pending: false }));
  if (!fitting.length) return [];
  // Slots = inicios exactos de canchas del Drive donde caben las dos (no el grid teórico suelto).
  const byKey = new Map();
  for (const c of fitting) {
    const day = normalizeDay(c.day);
    const start = Number(c.from);
    if (!day || !Number.isFinite(start)) continue;
    byKey.set(`${day}|${start}`, { day, start });
  }
  if (byKey.size) return [...byKey.values()];
  // Respaldo: si el pool no trae from, intersectar con el grid teórico.
  const list = Array.isArray(slots) ? slots : [];
  return list.filter((sl) =>
    fitting.some((c) => normalizeDay(c.day) === normalizeDay(sl.day) && Number(c.from) === Number(sl.start))
  );
}

/** True si hay al menos un turno EXACTO del Drive donde ambas pueden jugar. */
export function pairsHaveDriveCourt(entryA, entryB, courtPool = []) {
  if (!courtPool?.length) return true;
  const match = {
    homeDays: entryA?.days && typeof entryA.days === "object" ? entryA.days : undefined,
    awayDays: entryB?.days && typeof entryB.days === "object" ? entryB.days : undefined,
  };
  return (courtPool || []).some((c) => slotFitsPairAvailability(c, match, { pending: false }));
}

/**
 * Segunda pasada: une pendientes de la misma categoría que todavía tienen exacto libre en el Drive.
 * Así los exactos no quedan en Pendientes (cercanos/estimables/vacía son solo para cubrir a mano).
 */
export function pairPendingsWithExactCourts(matches = [], courtPool = [], opts = {}) {
  let current = (matches || []).map((m) => ({ ...m }));
  if (!courtPool?.length) return { matches: current, paired: 0 };

  // Tope de assignCourtSlots: sin esto, O(pendientes²) traba el Armar en fechas grandes.
  const maxTrials = Math.max(8, Number(opts.maxTrials) || 48);
  let trials = 0;
  let paired = 0;
  let guard = 0;
  // Pares ya intentados que no entraron en cancha libre: no reintentar en bucle.
  const skipKeys = new Set();
  while (guard++ < Math.max(8, current.length * 2) && trials < maxTrials) {
    const pendingIdx = current
      .map((m, i) => i)
      .filter((i) => isPendingMatch(current[i]) && String(current[i].home || "").trim());
    if (pendingIdx.length < 2) break;

    let progressed = false;
    for (let a = 0; a < pendingIdx.length && !progressed && trials < maxTrials; a++) {
      for (let b = a + 1; b < pendingIdx.length && trials < maxTrials; b++) {
        const ia = pendingIdx[a];
        const ib = pendingIdx[b];
        const pa = current[ia];
        const pb = current[ib];
        if ((pa.cat || "") !== (pb.cat || "")) continue;
        if (String(pa.temp || "").toUpperCase() !== String(pb.temp || "").toUpperCase()) continue;
        if ((pa.week || "") !== (pb.week || "")) continue;
        // Recuperan fecha se cubren a mano (cercanos / estimables).
        if (pa.recoverFrom || pb.recoverFrom) continue;
        const key = [fold(pa.home), fold(pb.home)].sort().join("|");
        if (skipKeys.has(key)) continue;
        const entryA = { days: pa.days || pa.homeDays };
        const entryB = { days: pb.days || pb.homeDays };
        if (!pairsHaveDriveCourt(entryA, entryB, courtPool)) {
          skipKeys.add(key);
          continue;
        }

        const trial = current.map((m) => ({ ...m }));
        const home = pa;
        const away = pb;
        trial[ia] = {
          ...home,
          away: away.home,
          pending: false,
          reason: "",
          avail: "",
          venue: "",
          court: "",
          day: "",
          time: "",
          result: "",
          homeDays: entryA.days,
          awayDays: entryB.days,
          days: undefined,
        };
        // Saca el otro pendiente de la lista (índice mayor primero si hiciera falta).
        trial.splice(ib, 1);
        trials += 1;
        const assigned = assignCourtSlots(trial, courtPool, {
          ...opts,
          onlyEmpty: true,
          preferPlan: true,
          skipPendingAssign: true,
          freezeFilled: true,
        });
        // Por índice (ia < ib, el splice no lo corre): pairsMatch por nombre confunde parejas parecidas.
        const made = assigned.matches[ia];
        const linked =
          made && isRealPairMatch(made) && !isPendingMatch(made) && String(made.venue || "").trim() ? made : null;
        if (!linked) {
          // Este cruce no tiene cancha libre ahora; probar otro par de pendientes.
          skipKeys.add(key);
          continue;
        }
        current = assigned.matches;
        paired += 1;
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  return { matches: current, paired };
}

/**
 * Si un partido real quedó sin cancha, prueba cambiar el rival (con otro partido
 * de la misma categoría, o con un pendiente) para que ambas puntas entren en un
 * turno libre del plan/Sheet. No baja la cantidad de canchas ya asignadas.
 */
export function rematchForCourts(matches = [], slots = [], opts = {}) {
  let current = matches.map((m) => ({ ...m }));
  let assigned = assignCourtSlots(current, slots, opts);
  current = assigned.matches;
  let swaps = 0;
  let guard = 0;
  // Sin tope, en fechas grandes (canchas justas) cada semilla tarda decenas de segundos
  // y el Armar parece trabado en «Probando armado 1/12».
  const maxTrials = Math.max(12, Number(opts.maxTrials) || 96);
  const maxPasses = Math.max(4, Number(opts.maxPasses) || 16);
  const maxRealPartners = Math.max(4, Number(opts.maxRealPartners) || 10);
  let trials = 0;

  while (guard++ < maxPasses && trials < maxTrials) {
    const bareIdx = current
      .map((m, i) => i)
      .filter((i) => isRealPairMatch(current[i]) && !String(current[i].venue || "").trim());
    if (!bareIdx.length) break;

    let improved = false;
    for (const bi of bareIdx) {
      if (trials >= maxTrials) break;
      const bare = current[bi];
      const cat = bare.cat || "";

      const realOthers = current
        .map((m, i) => i)
        .filter((i) => i !== bi && isRealPairMatch(current[i]) && (current[i].cat || "") === cat)
        .slice(0, maxRealPartners);

      // Pendientes primero (menos variantes y suelen destrabar cancha).
      const variants = [];
      for (const pi of current
        .map((m, i) => i)
        .filter((i) => i !== bi && isPendingMatch(current[i]) && (current[i].cat || "") === cat)) {
        const pending = current[pi];
        const cover = pending.home;
        const coverDays = pending.days || pending.homeDays;
        variants.push({
          oi: pi,
          left: withPairDays(bare, bare.home, cover, bare.homeDays, coverDays),
          right: {
            ...pending,
            home: bare.away,
            away: PENDING_AWAY,
            pending: true,
            days: bare.awayDays,
            homeDays: bare.awayDays,
            awayDays: undefined,
            venue: "",
            court: "",
            day: "",
            time: "",
            reason: "Quedó libre al rearmar rivales por cancha.",
          },
        });
        variants.push({
          oi: pi,
          left: withPairDays(bare, bare.away, cover, bare.awayDays, coverDays),
          right: {
            ...pending,
            home: bare.home,
            away: PENDING_AWAY,
            pending: true,
            days: bare.homeDays,
            homeDays: bare.homeDays,
            awayDays: undefined,
            venue: "",
            court: "",
            day: "",
            time: "",
            reason: "Quedó libre al rearmar rivales por cancha.",
          },
        });
      }

      for (const oi of realOthers) {
        const other = current[oi];
        const sides = [
          [bare.home, bare.homeDays, bare.away, bare.awayDays],
          [other.home, other.homeDays, other.away, other.awayDays],
        ];
        const [ah, ad, bh, bd] = [sides[0][0], sides[0][1], sides[0][2], sides[0][3]];
        const [ch, cd, dh, dd] = [sides[1][0], sides[1][1], sides[1][2], sides[1][3]];
        // A vs D y C vs B
        variants.push({
          oi,
          left: withPairDays(bare, ah, dh, ad, dd),
          right: withPairDays(other, ch, bh, cd, bd),
        });
        // A vs C y D vs B
        variants.push({
          oi,
          left: withPairDays(bare, ah, ch, ad, cd),
          right: withPairDays(other, dh, bh, dd, bd),
        });
      }

      for (const variant of variants) {
        if (trials >= maxTrials) break;
        if (pairsMatch(variant.left.home, variant.left.away)) continue;
        if (isRealPairMatch(variant.right) && pairsMatch(variant.right.home, variant.right.away)) continue;

        const trial = current.map((m) => ({ ...m }));
        trial[bi] = variant.left;
        trial[variant.oi] = variant.right;
        // Libera las canchas de ambos para reasignar con el nuevo cruce.
        for (const idx of [bi, variant.oi]) {
          trial[idx] = {
            ...trial[idx],
            venue: "",
            court: "",
            day: trial[idx].day || "",
            time: trial[idx].time || "",
          };
          if (isRealPairMatch(trial[idx])) {
            trial[idx].day = "";
            trial[idx].time = "";
          }
        }

        trials += 1;
        const again = assignCourtSlots(trial, slots, {
          ...opts,
          onlyEmpty: true,
          preferPlan: true,
          skipPendingAssign: true,
        });
        const before = courtAssignedCount(current);
        const after = courtAssignedCount(again.matches);
        const fixed = again.matches[bi];
        const bareFixed = !!(fixed && isRealPairMatch(fixed) && String(fixed.venue || "").trim());
        if (after > before || (after === before && bareFixed)) {
          current = again.matches;
          assigned = again;
          swaps += 1;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
    if (!improved) break;
  }

  return {
    matches: current,
    assigned: assigned.assigned,
    skipped: assigned.skipped,
    leftover: assigned.leftover,
    swaps,
  };
}

function availText(days) {
  if (!days || typeof days !== "object") return "";
  return Object.entries(days)
    .map(([d, h]) => `${d} ${h}`)
    .join(" · ");
}

/**
 * Si por algún bug quedaron dos partidos en la misma cancha/horario, libera el 2º+
 * (saca venue/court) para que parkBareMatchesAsPending los mande a pendientes.
 * assignCourtSlots ya evita esto; es red de seguridad.
 */
export function releaseOverlappingCourts(matches = []) {
  const next = (matches || []).map((m) => ({ ...m }));
  const groups = findCourtConflicts(next);
  let released = 0;
  for (const g of groups) {
    for (const idx of (g.indexes || []).slice(1)) {
      const m = next[idx];
      if (!m) continue;
      m.venue = "";
      m.court = "";
      m.day = "";
      m.time = "";
      released += 1;
    }
  }
  return { matches: next, released, groups };
}

/**
 * Partidos reales que quedaron sin cancha → dos pendientes (como impar / sin cruce).
 * Así ninguna pareja queda “colgada” con rival pero sin sede.
 */
export function parkBareMatchesAsPending(matches = [], { reason = "No quedó cancha libre en el Drive donde puedan jugar." } = {}) {
  const out = [];
  let parked = 0;
  for (const m of matches) {
    if (!isRealPairMatch(m) || String(m.venue || "").trim()) {
      out.push(m);
      continue;
    }
    const homeDays = m.homeDays && typeof m.homeDays === "object" ? m.homeDays : undefined;
    const awayDays = m.awayDays && typeof m.awayDays === "object" ? m.awayDays : undefined;
    out.push({
      ...m,
      away: PENDING_AWAY,
      pending: true,
      venue: "",
      court: "",
      day: "",
      time: "",
      result: "",
      rematch: false,
      reason,
      avail: availText(homeDays),
      days: homeDays,
      homeDays,
      awayDays: undefined,
    });
    out.push({
      ...m,
      home: m.away,
      away: PENDING_AWAY,
      pending: true,
      venue: "",
      court: "",
      day: "",
      time: "",
      result: "",
      rematch: false,
      reason,
      avail: availText(awayDays),
      days: awayDays,
      homeDays: awayDays,
      awayDays: undefined,
    });
    parked += 1;
  }
  return { matches: out, parked };
}

export { MATCH_MINUTES };
