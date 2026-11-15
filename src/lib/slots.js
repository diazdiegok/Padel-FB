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

/**
 * El partido de 90' tiene que entrar ENTERO en la ventana declarada ese día.
 * Sin datos de ese jugador → no bloquea (legado / carga manual).
 */
function daysMapFitsSlot(days, slot) {
  if (!days || typeof days !== "object") return true;
  const day = normalizeDay(slot.day);
  if (!day) return false;
  if (!(day in days) && !(slot.day in days)) return false;
  const raw = days[day] ?? days[slot.day];
  const win = parseCourtWindow(raw);
  if (!win || !(win.to > win.from)) return true;
  return Number(slot.from) >= win.from && Number(slot.to) <= win.to;
}

/** Respetar inscripción de ambas parejas (o days del pendiente). */
export function slotFitsPairAvailability(slot, match, { pending = false } = {}) {
  if (pending) {
    if (match?.days && typeof match.days === "object") return daysMapFitsSlot(match.days, slot);
    return true;
  }
  const homeOk = daysMapFitsSlot(match?.homeDays, slot);
  const awayOk = daysMapFitsSlot(match?.awayDays, slot);
  return homeOk && awayOk;
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
function matchHasCourt(m) {
  return Boolean(String(m?.venue || "").trim() && String(m?.court || "").trim() && String(m?.time || "").trim());
}

/**
 * Segunda pasada: partidos que quedaron sin complejo/cancha toman turnos del Sheet completo
 * (no solo del plan de cupos). Respeta ocupación ya asignada y la disponibilidad de las parejas.
 */
export function fillMissingCourtsFromSheet(matches = [], sheetSlots = [], opts = {}) {
  const pool = expandCourtCandidates(sheetSlots);
  if (!pool.length) {
    return { assigned: 0, skipped: 0, leftover: 0, matches: matches.map((m) => ({ ...m })), filledExtra: 0 };
  }
  const before = matches.filter((m) => !matchHasCourt(m)).length;
  const out = assignCourtSlots(matches, pool, {
    onlyEmpty: true,
    preferPlan: true,
    venueCaps: null,
    ...opts,
  });
  const after = out.matches.filter((m) => !matchHasCourt(m)).length;
  return { ...out, filledExtra: Math.max(0, before - after) };
}

export function assignCourtSlots(matches = [], slots = [], { onlyEmpty = true, venueCaps = null, preferPlan = false } = {}) {
  const next = matches.map((m) => ({ ...m }));
  const needsExpand = slots.some((s) => Number(s.to) - Number(s.from) > MATCH_MINUTES || s.capacity > 1);
  const poolSource = needsExpand ? expandCourtCandidates(slots) : slots.slice();
  const pool = poolSource.map((s, i) => ({ ...s, _i: i }));

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
      const other = pool[osi];
      if (sameCourt(slot, other) && windowsOverlap(slot.from, slot.to, other.from, other.to)) return false;
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

  function findPoolIndexForMatch(m) {
    const day = normalizeDay(m.day);
    const win = parseCourtWindow(m.time);
    if (!day || !win) return -1;
    const exact = [];
    const loose = [];
    for (let si = 0; si < pool.length; si++) {
      const s = pool[si];
      if (fold(s.venue) !== fold(m.venue)) continue;
      if (fold(s.court) !== fold(m.court)) continue;
      if (s.day !== day) continue;
      if (s.from === win.from && s.to === win.to) exact.push(si);
      else if (windowsOverlap(s.from, s.to, win.from, win.to)) loose.push(si);
    }
    return exact[0] ?? loose[0] ?? -1;
  }

  // Solo vacíos: marcar ocupación de los que ya tienen cancha para no pisarlos en una 2ª pasada.
  const locked = new Set();
  if (onlyEmpty) {
    for (let i = 0; i < next.length; i++) {
      const m = next[i];
      if (!matchHasCourt(m)) continue;
      let si = findPoolIndexForMatch(m);
      if (si < 0) {
        const win = parseCourtWindow(m.time);
        if (!win) continue;
        si = pool.length;
        pool.push({
          day: normalizeDay(m.day),
          venue: m.venue,
          court: m.court,
          from: win.from,
          to: win.to,
          time: m.time || clockRange(win.from, win.to),
          _i: si,
          _seeded: true,
        });
      }
      if (![...owner.values()].includes(si)) {
        owner.set(i, si);
        locked.add(i);
      }
    }
  }

  const needIdx = [];
  for (let i = 0; i < next.length; i++) {
    const m = next[i];
    const pending = isPendingMatch(m);
    const hasRealAway = String(m.away || "").trim() && !pending;
    if (!hasRealAway && !pending) continue;
    if (onlyEmpty && (matchHasCourt(m) || locked.has(i))) continue;
    needIdx.push(i);
  }

  // Snapshot del día/hora del fixtureo (para restaurar si no hay cancha).
  const originalWhen = new Map(needIdx.map((i) => [i, { day: next[i].day || "", time: next[i].time || "" }]));

  needIdx.sort(
    (a, b) =>
      Number(!!isPendingMatch(next[a])) - Number(!!isPendingMatch(next[b])) ||
      optionsFor(a).length - optionsFor(b).length ||
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
      const other = pool[osi];
      if (sameCourt(slot, other) && windowsOverlap(slot.from, slot.to, other.from, other.to)) return mi;
    }
    return null;
  }

  // Reasignación: si un partido quedó sin cancha, pedirle el turno a uno que pueda mudarse.
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
        // No desplazar partidos que ya venían con cancha (2ª pasada / onlyEmpty).
        if (locked.has(occupant)) continue;
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
      const a = pool[si];
      const b = pool[osi];
      if (sameCourt(a, b) && windowsOverlap(a.from, a.to, b.from, b.to)) {
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

export { MATCH_MINUTES };
