import { DAYS } from "./disponibilidad.js";
import { MATCH_MINUTES, slotLabel } from "./fixturer.js";

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
      });
    }
  }
  return out;
}

/** Agrupa ventanas por complejo: capacidad = partidos de 90' que entran. */
export function summarizeCourtSlots(slots = []) {
  const map = new Map();
  for (const s of slots) {
    const key = s.venue || "Sin complejo";
    if (!map.has(key)) map.set(key, { venue: key, total: 0, days: new Map() });
    const row = map.get(key);
    const cap = Number(s.capacity) || windowCapacity(s.from, s.to) || 1;
    row.total += cap;
    row.days.set(s.day, (row.days.get(s.day) || 0) + cap);
  }
  return [...map.values()]
    .map((r) => ({
      venue: r.venue,
      total: r.total,
      days: DAYS.filter((d) => r.days.has(d)).map((d) => ({ day: d, count: r.days.get(d) })),
      daySet: new Set(DAYS.filter((d) => r.days.has(d))),
    }))
    .sort((a, b) => a.venue.localeCompare(b.venue, "es"));
}

function windowsOverlap(aFrom, aTo, bFrom, bTo) {
  return aFrom < bTo && bFrom < aTo;
}

function sameCourt(a, b) {
  return fold(a.venue) === fold(b.venue) && fold(a.court) === fold(b.court) && a.day === b.day;
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
 * Devuelve hasta `count` candidatos no solapados por complejo (capacidad real).
 */
export function applyVenuePlan(slots = [], plan = []) {
  if (!plan.length) return expandCourtCandidates(slots);
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
 * Asigna canchas a partidos.
 * Los candidatos pueden solapar en el mismo rango: al usar uno, se bloquea el solape en esa cancha.
 */
export function assignCourtSlots(matches = [], slots = [], { onlyEmpty = true, venueCaps = null, preferPlan = false } = {}) {
  const next = matches.map((m) => ({ ...m }));
  // Ventanas del Excel → candidatos de 90'. Si ya vienen como partidos de 90', se reúsan.
  const needsExpand = slots.some((s) => Number(s.to) - Number(s.from) > MATCH_MINUTES || s.capacity > 1);
  const poolSource = needsExpand ? expandCourtCandidates(slots) : slots.slice();
  const pool = poolSource.map((s, i) => ({ ...s, _i: i, used: false }));
  const usedByVenue = new Map();
  const candidates = [];

  function markUsed(slot) {
    slot.used = true;
    for (const other of pool) {
      if (other.used) continue;
      if (sameCourt(other, slot) && windowsOverlap(other.from, other.to, slot.from, slot.to)) other.used = true;
    }
  }

  function isPendingMatch(m) {
    return !!m.pending || fold(m.away) === fold("Pendiente / Pendiente");
  }

  /** Bonus si el pendiente declara disponibilidad ese día (m.days). */
  function pendingAvailScore(slot, match) {
    const days = match.days;
    if (!days || typeof days !== "object") return 0;
    const day = slot.day;
    if (!(day in days)) return -8;
    const win = parseCourtWindow(days[day]);
    if (!win) return 12;
    if (windowsOverlap(slot.from, slot.to, win.from, win.to)) return 18;
    return 4;
  }

  for (let i = 0; i < next.length; i++) {
    const m = next[i];
    const pending = isPendingMatch(m);
    const hasRealAway = String(m.away || "").trim() && !pending;
    // Partidos reales y pendientes reservan cancha; filas vacías no.
    if (!hasRealAway && !pending) continue;
    const filled = String(m.venue || "").trim() && String(m.time || "").trim();
    if (onlyEmpty && filled) continue;
    const scoreOf = (slot) => fitScore(slot, m) + (pending ? pendingAvailScore(slot, m) : 0);
    const strict = pool
      .map((slot, si) => ({ slot, si, score: scoreOf(slot) }))
      .filter(({ slot }) => !slot.used && slotFitsMatch(slot, m))
      .sort((a, b) => b.score - a.score || a.slot.from - b.slot.from);
    const options =
      preferPlan && !strict.length
        ? pool
            .map((slot, si) => ({
              slot,
              si,
              score: scoreOf(slot) + (normalizeDay(m.day) === slot.day ? 10 : 0),
            }))
            .filter(({ slot }) => !slot.used)
            .sort((a, b) => b.score - a.score || a.slot.from - b.slot.from)
        : strict;
    candidates.push({ i, options, pending });
  }

  // Primero partidos con pocas opciones; los pendientes (suelen matchear muchos slots) al final.
  candidates.sort(
    (a, b) =>
      Number(!!a.pending) - Number(!!b.pending) ||
      a.options.length - b.options.length ||
      String(next[a.i].cat || "").localeCompare(String(next[b.i].cat || ""), "es")
  );

  let assigned = 0;
  for (const { i, options } of candidates) {
    const pick = options.find((o) => {
      if (pool[o.si].used) return false;
      if (!venueCaps) return true;
      const v = pool[o.si].venue;
      const cap = venueCaps[v] ?? venueCaps[normVenueName(v)];
      if (cap == null) return true;
      return (usedByVenue.get(venueKey(v)) || 0) < Number(cap);
    });
    if (!pick) continue;
    const slot = pool[pick.si];
    markUsed(slot);
    const vk = venueKey(slot.venue);
    usedByVenue.set(vk, (usedByVenue.get(vk) || 0) + 1);
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
    leftover: Math.max(0, pool.filter((s) => !s.used).length),
    matches: next,
  };
}

export { MATCH_MINUTES };
