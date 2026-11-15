import { DAYS, pairLabel } from "./disponibilidad.js";
import { PENDING_AWAY, isPendingMatch, isPlaceholderPair, isRealPairMatch } from "./fixturer.js";
import { fold, pairsMatch } from "./scoring.js";

function availText(days) {
  if (!days || typeof days !== "object") return "";
  return Object.entries(days)
    .map(([d, h]) => `${d} ${h}`)
    .join(" · ");
}

function seasonPairs(pairs = [], temp = "") {
  const season = String(temp || "").toUpperCase();
  return (pairs || []).filter((p) => p?.p1 && p?.p2 && p?.cat && String(p.temp || "").toUpperCase() === season);
}

function pairEntry(pairs, name, temp, catHint = "") {
  const season = String(temp || "").toUpperCase();
  const list = (pairs || []).filter((p) => String(p.temp || "").toUpperCase() === season && p?.p1 && p?.p2);
  const hit =
    list.find((p) => (!catHint || p.cat === catHint) && pairsMatch(pairLabel(p), name)) ||
    list.find((p) => pairsMatch(pairLabel(p), name));
  return hit || null;
}

function asPending({ week, temp, cat, home, reason, days }) {
  const dayMap = days && typeof days === "object" ? days : undefined;
  return {
    week: week || "",
    day: "",
    date: "",
    temp: String(temp || "").toUpperCase(),
    cat: cat || "",
    time: "",
    venue: "",
    court: "",
    home: home || "",
    away: PENDING_AWAY,
    result: "",
    appliedResult: "",
    pending: true,
    reason: reason || "",
    avail: availText(dayMap),
    ...(dayMap ? { days: dayMap } : {}),
  };
}

function pairKey(name, temp) {
  return `${String(temp || "").toUpperCase()}|${fold(name)}`;
}

function playsInWeek(matches, name, week, temp) {
  return (matches || []).some((m) => {
    if ((m.week || "") !== week) return false;
    if (String(m.temp || "").toUpperCase() !== String(temp || "").toUpperCase()) return false;
    if (isPendingMatch(m)) return pairsMatch(m.home, name);
    if (!isRealPairMatch(m)) return false;
    return pairsMatch(m.home, name) || pairsMatch(m.away, name);
  });
}

/**
 * Alinea el fixture (y pendientes) con las inscripciones de la temporada.
 *
 * - Pareja borrada: el rival queda pendiente (sin cancha); el partido viejo se saca.
 * - Cambio de categoría: ambas puntas del partido pasan a pendiente en su cat actual.
 * - Pareja nueva: entra como pendiente en `liveWeek` (si se indica).
 */
export function syncFixtureWithPairs({ matches = [], pairs = [], temp = "", liveWeek = "" } = {}) {
  const season = String(temp || "").toUpperCase();
  const inscribed = seasonPairs(pairs, season);
  const byName = new Map();
  for (const p of inscribed) byName.set(fold(pairLabel(p)), p);

  const out = [];
  let removedMatches = 0;
  let pendingFromRemoved = 0;
  let pendingFromCatChange = 0;
  let addedPending = 0;
  const seenPending = new Set();

  function pushPending(row) {
    const key = `${pairKey(row.home, row.temp)}|${row.week || ""}`;
    if (seenPending.has(key)) return;
    if (out.some((m) => isPendingMatch(m) && pairsMatch(m.home, row.home) && (m.week || "") === (row.week || ""))) {
      return;
    }
    seenPending.add(key);
    out.push(row);
  }

  for (const m of matches || []) {
    if (String(m.temp || "").toUpperCase() !== season) {
      out.push(m);
      continue;
    }

    if (isPendingMatch(m)) {
      const home = String(m.home || "").trim();
      if (!home || isPlaceholderPair(home)) continue;
      const entry = byName.get(fold(home)) || pairEntry(inscribed, home, season, m.cat);
      if (!entry) {
        // Pareja borrada: se elimina el pendiente.
        removedMatches += 1;
        continue;
      }
      const cat = entry.cat || m.cat || "";
      const days = entry.days && typeof entry.days === "object" ? entry.days : m.days;
      pushPending(
        asPending({
          week: m.week || liveWeek || "",
          temp: season,
          cat,
          home: pairLabel(entry),
          reason: m.reason || "Pendiente de rival.",
          days,
        })
      );
      continue;
    }

    if (!isRealPairMatch(m)) {
      out.push(m);
      continue;
    }

    const homeEntry = byName.get(fold(m.home)) || pairEntry(inscribed, m.home, season, m.cat);
    const awayEntry = byName.get(fold(m.away)) || pairEntry(inscribed, m.away, season, m.cat);
    const homeOk = !!homeEntry;
    const awayOk = !!awayEntry;
    const homeCat = homeEntry?.cat || "";
    const awayCat = awayEntry?.cat || "";
    const catChanged =
      (homeOk && homeCat && m.cat && homeCat !== m.cat) || (awayOk && awayCat && m.cat && awayCat !== m.cat);

    if (homeOk && awayOk && !catChanged) {
      out.push({
        ...m,
        home: pairLabel(homeEntry),
        away: pairLabel(awayEntry),
        cat: homeCat || awayCat || m.cat,
      });
      continue;
    }

    removedMatches += 1;

    if (catChanged && homeOk && awayOk) {
      pushPending(
        asPending({
          week: m.week || liveWeek || "",
          temp: season,
          cat: homeCat,
          home: pairLabel(homeEntry),
          reason: "Cambió de categoría: el partido anterior quedó sin efecto.",
          days: homeEntry.days,
        })
      );
      pushPending(
        asPending({
          week: m.week || liveWeek || "",
          temp: season,
          cat: awayCat,
          home: pairLabel(awayEntry),
          reason: "Cambió de categoría: el partido anterior quedó sin efecto.",
          days: awayEntry.days,
        })
      );
      pendingFromCatChange += 2;
      continue;
    }

    if (homeOk && !awayOk) {
      pushPending(
        asPending({
          week: m.week || liveWeek || "",
          temp: season,
          cat: homeCat || m.cat,
          home: pairLabel(homeEntry),
          reason: "Su rival ya no está inscripto.",
          days: homeEntry.days,
        })
      );
      pendingFromRemoved += 1;
      continue;
    }
    if (awayOk && !homeOk) {
      pushPending(
        asPending({
          week: m.week || liveWeek || "",
          temp: season,
          cat: awayCat || m.cat,
          home: pairLabel(awayEntry),
          reason: "Su rival ya no está inscripto.",
          days: awayEntry.days,
        })
      );
      pendingFromRemoved += 1;
    }
  }

  const week = String(liveWeek || "").trim();
  if (week) {
    for (const p of inscribed) {
      const label = pairLabel(p);
      if (playsInWeek(out, label, week, season)) continue;
      pushPending(
        asPending({
          week,
          temp: season,
          cat: p.cat,
          home: label,
          reason: "Pareja inscripta: todavía no tiene rival en esta fecha.",
          days: p.days,
        })
      );
      addedPending += 1;
    }
  }

  return {
    matches: out,
    stats: { removedMatches, pendingFromRemoved, pendingFromCatChange, addedPending },
  };
}

/**
 * Parte un partido real en dos filas pendientes (home y away).
 * Usado por “Marcar como pendiente” en el admin de fixture.
 */
export function splitMatchToPending(match, pairs = []) {
  if (!match || isPendingMatch(match) || !isRealPairMatch(match)) return [];
  const temp = String(match.temp || "").toUpperCase();
  const week = match.week || "";
  const cat = match.cat || "";
  const reason = "Partido marcado como pendiente desde el fixture.";
  const out = [];
  for (const side of ["home", "away"]) {
    const name = String(match[side] || "").trim();
    if (!name || isPlaceholderPair(name)) continue;
    const entry = pairEntry(pairs, name, temp, cat);
    out.push(
      asPending({
        week,
        temp,
        cat: entry?.cat || cat,
        home: entry ? pairLabel(entry) : name,
        reason,
        days: entry?.days,
      })
    );
  }
  return out;
}

/** Opciones de rival desde inscripciones de la misma categoría (más Pendiente). */
export function rivalOptionsFromPairs({ pairs = [], temp = "", cat = "", exclude = "" } = {}) {
  const season = String(temp || "").toUpperCase();
  const out = [];
  const seen = new Set();
  for (const p of seasonPairs(pairs, season)) {
    if (cat && p.cat !== cat) continue;
    const label = pairLabel(p);
    if (!label || pairsMatch(label, exclude)) continue;
    const key = fold(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  out.sort((a, b) => a.localeCompare(b, "es"));
  return out;
}

export function scheduleOptionsFromSlots(slots = [], matches = []) {
  const days = new Set(DAYS);
  const times = new Set();
  const venues = new Set();
  const courtsByVenue = new Map();

  const addCourt = (venue, court) => {
    const v = String(venue || "").trim();
    const c = String(court || "").trim();
    if (!v || !c) return;
    if (!courtsByVenue.has(v)) courtsByVenue.set(v, new Set());
    courtsByVenue.get(v).add(c);
  };

  for (const s of slots || []) {
    if (s.day) days.add(s.day);
    if (s.time) times.add(s.time);
    if (s.venue) venues.add(s.venue);
    addCourt(s.venue, s.court);
  }
  for (const m of matches || []) {
    if (m.day) days.add(m.day);
    if (m.time) times.add(m.time);
    if (m.venue) venues.add(m.venue);
    addCourt(m.venue, m.court);
  }

  return {
    days: DAYS.filter((d) => days.has(d)).concat([...days].filter((d) => !DAYS.includes(d))),
    times: [...times].sort((a, b) => a.localeCompare(b, "es")),
    venues: [...venues].sort((a, b) => a.localeCompare(b, "es")),
    courtsByVenue: Object.fromEntries(
      [...courtsByVenue.entries()].map(([v, set]) => [v, [...set].sort((a, b) => a.localeCompare(b, "es", { numeric: true }))])
    ),
  };
}

export { availText };
