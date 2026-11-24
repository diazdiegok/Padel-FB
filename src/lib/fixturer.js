import { DAYS, isAbandonedPair, pairLabel } from "./disponibilidad.js";
import { weekKey, weekNumber } from "./liga.js";
import { findPairIndex, fold, pairsMatch, parseWalkover } from "./scoring.js";

export const MATCH_MINUTES = 90;
export const PENDING_AWAY = "Pendiente / Pendiente";
export const MAX_PAIR_MATCHES = 12;
const DAY_START = 8 * 60;
const DAY_END = 24 * 60;
const REMATCH_COST = 1000;
const TRIES = 400;

export function isPlaceholderPair(name) {
  const raw = String(name || "").trim();
  if (!raw) return true;
  return fold(raw) === fold(PENDING_AWAY);
}

export function isPendingMatch(m) {
  if (!m) return false;
  return !!m.pending || isPlaceholderPair(m.away);
}

export function isRealPairMatch(m) {
  return Boolean(m && String(m.home || "").trim() && !isPlaceholderPair(m.home) && !isPlaceholderPair(m.away));
}

/**
 * Fechas de esta temporada donde el mismo cruce ya se jugó (otro week).
 * Sirve para mandar a Duplicados al cubrir pendientes / recuperan.
 */
export function rematchWeeks(match, history = []) {
  if (!isRealPairMatch(match) || isPendingMatch(match)) return [];
  const season = String(match.temp || "").toUpperCase();
  const week = match.week || "";
  const cat = match.cat || "";
  const weeks = (history || [])
    .filter((p) => {
      if (p === match) return false;
      if (!isRealPairMatch(p) || p.dupHold) return false;
      if (String(p.temp || "").toUpperCase() !== season) return false;
      if ((p.cat || "") !== cat) return false;
      if ((p.week || "") === week) return false;
      return (
        (pairsMatch(p.home, match.home) && pairsMatch(p.away, match.away)) ||
        (pairsMatch(p.home, match.away) && pairsMatch(p.away, match.home))
      );
    })
    .map((p) => p.week)
    .filter(Boolean);
  return [...new Set(weeks)].sort((a, b) => weekNumber(a) - weekNumber(b));
}

/** Pendiente que no juega esa fecha: se recupera en una fecha siguiente. */
export function isRecoverLater(m) {
  return !!(m && isPendingMatch(m) && m.recoverLater);
}

/** Pendiente traído a otra fecha para cubrir el partido que debe. */
export function isMakeupPending(m) {
  return !!(m && isPendingMatch(m) && m.recoverFrom && !m.recoverLater);
}

function pendingKind(m) {
  return m && m.recoverFrom && !m.recoverLater ? "makeup" : "normal";
}

function samePendingKind(a, b) {
  return pendingKind(a) === pendingKind(b);
}

/** Partidos contables (ambas puntas reales) de una pareja en la temporada. */
export function countPairMatches(name, cat, temp, pools = []) {
  if (!String(name || "").trim() || isPlaceholderPair(name)) return 0;
  const season = String(temp || "").toUpperCase();
  let n = 0;
  const seen = new Set();
  for (const pool of pools) {
    for (const m of Array.isArray(pool) ? pool : []) {
      if (!isRealPairMatch(m)) continue;
      if (String(m.temp || "").toUpperCase() !== season) continue;
      if (cat && m.cat && m.cat !== cat) continue;
      const isHome = pairsMatch(m.home, name);
      const isAway = pairsMatch(m.away, name);
      if (!isHome && !isAway) continue;
      // W.O.: solo suma PJ al ganador (el ausente queda en 0, como en el ranking).
      const wo = parseWalkover(m.appliedResult || m.result);
      if (wo) {
        const won = wo.homeWin ? isHome : isAway;
        if (!won) continue;
      }
      const key = `${m.week || ""}|${m.day || ""}|${m.time || ""}|${fold(m.home)}|${fold(m.away)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      n += 1;
    }
  }
  return n;
}

/**
 * El borrador de una fecha reemplaza lo ya publicado de esa misma fecha.
 * Así, pasar un partido a pendiente baja el PJ en el admin antes de publicar.
 * Si el borrador no se guarda, la fecha publicada sigue contando.
 *
 * Importante: el borrador debe conservar las otras fechas (partidos reales).
 * Si al armar Fecha 2 se tiran los de Fecha 1, el PJ de «Cubrir con» queda en 0.
 */
export function draftAwarePools(results = [], published = [], draft = [], season = "") {
  const key = (m) => `${String(m?.temp || season || "").toUpperCase()}|${m?.week || ""}`;
  const weeks = new Set((draft || []).map(key));
  const rest = (published || []).filter((m) => !weeks.has(key(m)));
  return [results || [], rest, draft || []];
}

/**
 * Al cubrir un pendiente con otra pareja que también estaba pendiente,
 * saca de la lista el pendiente de quien cubrió (y cualquier duplicado del local).
 * `covered` es el partido ya convertido a cruce real.
 */
export function absorbCoveredPending(matches = [], covered, coverLabel = "") {
  if (!covered || !Array.isArray(matches)) return matches.slice();
  const week = covered.week || "";
  const temp = String(covered.temp || "").toUpperCase();
  const cover = String(coverLabel || covered.away || "").trim();
  const home = String(covered.home || "").trim();
  return matches.filter((m) => {
    if (m === covered) return true;
    if (!isPendingMatch(m)) return true;
    if ((m.week || "") !== week) return true;
    if (String(m.temp || "").toUpperCase() !== temp) return true;
    if (home && pairsMatch(m.home, home)) return !samePendingKind(m, covered);
    if (cover && !isPlaceholderPair(cover) && pairsMatch(m.home, cover)) return !samePendingKind(m, covered);
    return true;
  });
}

function sameSeason(m, season) {
  return String(m?.temp || "").toUpperCase() === season;
}

function involvesPair(m, name) {
  if (!m || !name) return false;
  if (pairsMatch(m.home, name)) return true;
  return !isPendingMatch(m) && pairsMatch(m.away, name);
}

/** Partido de la fecha, no el que se está recuperando. */
function isWeekMatch(m) {
  return isRealPairMatch(m) && !m.recoverFrom;
}

function recoverySettled(pool, name, from, season) {
  return pool.some(
    (m) =>
      sameSeason(m, season) &&
      String(m.recoverFrom || "") === from &&
      involvesPair(m, name) &&
      (isRealPairMatch(m) || isMakeupPending(m))
  );
}

function sameTeams(a, b) {
  if (!a || !b) return false;
  return (
    (pairsMatch(a.home, b.home) && pairsMatch(a.away, b.away)) ||
    (pairsMatch(a.home, b.away) && pairsMatch(a.away, b.home))
  );
}

/**
 * El recupero pertenece a la fecha que falta (`recoverFrom`), no a la fecha
 * en la que se está armando. Si no, esa pareja queda con dos partidos en una fecha.
 * `recoveredIn` marca la fecha desde la que se lo agenda.
 */
export function normalizeRecoveryWeeks(matches = []) {
  const list = Array.isArray(matches) ? matches.slice() : [];
  let changed = 0;
  for (const m of list) {
    const owed = String(m?.recoverFrom || "").trim();
    if (!owed || m.recoverLater) continue;
    if ((m.week || "") === owed) continue;
    if (!m.recoveredIn) m.recoveredIn = m.week || "";
    m.week = owed;
    changed += 1;
  }
  const makeups = list.filter(isMakeupPending);
  const next = list.filter((m) => {
    if (!isPendingMatch(m) || m.recoverFrom || m.recoverLater) return true;
    const dup = makeups.some(
      (k) =>
        (k.week || "") === (m.week || "") &&
        String(k.temp || "").toUpperCase() === String(m.temp || "").toUpperCase() &&
        (k.cat || "") === (m.cat || "") &&
        pairsMatch(k.home, m.home)
    );
    if (dup) changed += 1;
    return !dup;
  });
  return { matches: next, changed };
}

/**
 * Un partido ya cubierto que recupera una fecha anterior se publica en esa fecha.
 * Si la fecha sigue en el fixture, se suma ahí. Si ya pasó a resultados, se suma al historial.
 * No reemplaza el resto de los partidos de esa fecha.
 */
export function fileOwedRecoveries({ published = [], results = [], owed = [] } = {}) {
  const live = published.slice();
  const archive = results.slice();
  const liveWeeks = new Set(live.map((m) => weekKey(m)));
  for (const rec of owed) {
    if (!rec?.recoverFrom) continue;
    const key = weekKey(rec);
    const same = (m) => weekKey(m) === key && sameTeams(m, rec);
    if (liveWeeks.has(key)) {
      const idx = live.findIndex(same);
      if (idx >= 0) live[idx] = rec;
      else live.push(rec);
    } else {
      const idx = archive.findIndex(same);
      if (idx >= 0) {
        archive[idx] = { ...archive[idx], ...rec, result: rec.result || archive[idx].result || "" };
      } else archive.push(rec);
    }
  }
  return { published: live, results: archive };
}

/**
 * Si una pareja ya tiene partido real en la fecha donde recupera (recoveredIn)
 * y el pendiente de recupero quedó colgado, cuelga la deuda en ese partido y
 * saca el pendiente. Así no figura dos veces en Recuperan.
 * No toca deudas de W.O. (woKey): esas siguen en Recuperan hasta cubrirlas.
 */
export function attachOrphanMakeups(matches = []) {
  const list = Array.isArray(matches) ? matches.slice() : [];
  const remove = new Set();
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!isMakeupPending(m) || m.woKey) continue;
    const from = String(m.recoverFrom || "").trim();
    const inWeek = String(m.recoveredIn || "").trim();
    const season = String(m.temp || "").toUpperCase();
    if (!from || !inWeek) continue;

    if (
      list.some(
        (x, j) =>
          j !== i &&
          sameSeason(x, season) &&
          String(x.recoverFrom || "") === from &&
          involvesPair(x, m.home) &&
          isRealPairMatch(x)
      )
    ) {
      remove.add(i);
      continue;
    }

    let host = null;
    for (const x of list) {
      if (!isRealPairMatch(x) || isPendingMatch(x)) continue;
      if (!sameSeason(x, season) || (x.week || "") !== inWeek) continue;
      if (x.recoverFrom || !involvesPair(x, m.home)) continue;
      const wo = parseWalkover(x.result);
      if (wo) {
        const loser = wo.homeWin ? x.away : x.home;
        if (pairsMatch(loser, m.home)) continue;
      }
      host = x;
      if (!String(x.result || "").trim()) break;
    }
    if (!host) continue;
    host.recoverFrom = from;
    host.recoveredIn = inWeek;
    host.week = from;
    remove.add(i);
  }
  if (!remove.size) return { matches: list, changed: 0 };
  return { matches: list.filter((_, i) => !remove.has(i)), changed: remove.size };
}

/**
 * Marca en la fecha que se arma a quien tiene menos partidos que el resto de su categoría.
 * En Fecha 2, quien tiene 0 partidos jugados recupera Fecha 1.
 * El partido queda en la fecha que falta: no se copia como un segundo partido de esta fecha.
 */
export function importRecoveryDebts(matches = [], { temp = "", week = "", history = null, pairs = [] } = {}) {
  const season = String(temp || "").toUpperCase();
  const here = weekNumber(week);
  const normalized = normalizeRecoveryWeeks(matches);
  const attached = attachOrphanMakeups(normalized.matches);
  let list = attached.matches;
  const pool = Array.isArray(history) ? history : list;
  if (!season || !week || !here) {
    return { matches: list, added: normalized.changed + attached.changed, waiting: 0 };
  }

  const abandonedLabels = (pairs || [])
    .filter((p) => isAbandonedPair(p) && String(p?.temp || "").toUpperCase() === season && p.p1 && p.p2)
    .map((p) => pairLabel(p));
  const isAbandonedName = (label) => abandonedLabels.some((name) => pairsMatch(name, label));

  // Sacá pendientes de recupero/normal de parejas que abandonaron.
  const beforePrune = list.length;
  list = list.filter((m) => {
    if (!sameSeason(m, season) || !isPendingMatch(m)) return true;
    return !isAbandonedName(m.home);
  });
  let added = normalized.changed + attached.changed + (beforePrune - list.length);

  const seasonRows = pool.filter((m) => sameSeason(m, season));
  const cats = [
    ...new Set(
      [
        ...seasonRows.map((m) => m.cat || ""),
        ...(pairs || [])
          .filter((p) => String(p?.temp || "").toUpperCase() === season && !isAbandonedPair(p))
          .map((p) => p.cat || ""),
      ].filter(Boolean)
    ),
  ];
  let waiting = 0;

  for (const cat of cats) {
    const catRows = seasonRows.filter((m) => (m.cat || "") === cat);
    const playedWeeks = [
      ...new Set(
        catRows
          .filter((m) => isWeekMatch(m) && weekNumber(m.week) > 0 && weekNumber(m.week) < here)
          .map((m) => m.week)
      ),
    ].sort((a, b) => weekNumber(a) - weekNumber(b));
    if (!playedWeeks.length) continue;

    const people = [];
    const pushPerson = (label, extra = {}) => {
      const name = String(label || "").trim();
      if (!name || isPlaceholderPair(name) || isAbandonedName(name)) return;
      if (people.some((p) => pairsMatch(p.name, name))) return;
      people.push({ name, days: extra.days, avail: extra.avail || "", note: extra.note || "" });
    };
    for (const p of pairs || []) {
      if (isAbandonedPair(p)) continue;
      if (String(p?.temp || "").toUpperCase() !== season || (p.cat || "") !== cat || !p.p1 || !p.p2) continue;
      pushPerson(pairLabel(p), { days: p.days });
    }
    for (const m of catRows) {
      pushPerson(m.home, { days: m.days, avail: m.avail, note: m.note });
      if (!isPendingMatch(m)) pushPerson(m.away);
    }

    for (const person of people) {
      const missed = playedWeeks.filter((from) => {
        const inWeek = catRows.filter((m) => (m.week || "") === from);
        return !inWeek.some((m) => isWeekMatch(m) && involvesPair(m, person.name));
      });
      if (!missed.length) continue;
      for (const from of missed) {
        waiting += 1;
        if (recoverySettled(list, person.name, from, season) || recoverySettled(pool, person.name, from, season)) continue;
        const parked = list.some(
          (m) =>
            sameSeason(m, season) &&
            (m.week || "") === from &&
            (m.cat || "") === cat &&
            isRecoverLater(m) &&
            pairsMatch(m.home, person.name)
        );
        if (parked) continue;
        const src = list.find(
          (m) =>
            sameSeason(m, season) &&
            (m.week || "") === from &&
            (m.cat || "") === cat &&
            isPendingMatch(m) &&
            !m.recoverFrom &&
            !m.recoverLater &&
            pairsMatch(m.home, person.name)
        );
        const remembered = catRows.find((m) => (m.week || "") === from && isPendingMatch(m) && pairsMatch(m.home, person.name));
        const days =
          (src?.days && typeof src.days === "object" && src.days) ||
          (remembered?.days && typeof remembered.days === "object" && remembered.days) ||
          (person.days && typeof person.days === "object" && person.days) ||
          null;
        if (src) {
          src.recoverFrom = from;
          src.recoveredIn = week;
          src.pending = true;
          src.reason = src.reason || `Tiene 0 partidos en ${from}. Recupera esa fecha.`;
          added += 1;
          continue;
        }
        list.push({
          pending: true,
          recoverFrom: from,
          recoveredIn: week,
          week: from,
          day: "",
          date: "",
          temp: season,
          cat,
          time: "",
          venue: "",
          court: "",
          home: src?.home || person.name,
          away: PENDING_AWAY,
          result: "",
          appliedResult: "",
          reason: `Tiene 0 partidos en ${from}. Recupera esa fecha.`,
          ...(days ? { days } : {}),
          ...(src?.avail || person.avail ? { avail: String(src?.avail || person.avail) } : {}),
          ...(src?.note || person.note ? { note: String(src?.note || person.note) } : {}),
        });
        added += 1;
      }
    }
  }
  return { matches: list, added, waiting };
}

/** Si se quita el pendiente de recupero, la deuda vuelve a estar libre para otra fecha. */
export function releaseRecoveryDebt(matches = [], makeup) {
  if (!makeup || !isMakeupPending(makeup)) return;
  const from = String(makeup.recoverFrom || "").trim();
  const week = makeup.week || "";
  const temp = String(makeup.temp || "").toUpperCase();
  for (const m of matches) {
    if (!isRecoverLater(m)) continue;
    if (String(m.temp || "").toUpperCase() !== temp) continue;
    if ((m.recoveredIn || "") !== week) continue;
    if (from && String(m.recoverFrom || m.week || "") !== from) continue;
    if (!pairsMatch(m.home, makeup.home)) continue;
    delete m.recoveredIn;
  }
}

/** Candidatas de la misma categoría para cubrir un pendiente (doble jornada ok; tope 12 PJ). */
export function coverCandidates({ match, pairs = [], pools = [], temp = "" } = {}) {
  if (!match || !String(match.home || "").trim()) return [];
  const season = String(temp || match.temp || "").toUpperCase();
  const cat = match.cat || "";
  const out = [];
  const seen = new Set();
  for (const p of pairs) {
    if (!p?.p1 || !p?.p2 || !p?.cat || isAbandonedPair(p)) continue;
    if (cat && p.cat !== cat) continue;
    if (String(p.temp || "").toUpperCase() !== season) continue;
    const label = pairLabel(p);
    if (isPlaceholderPair(label) || pairsMatch(label, match.home)) continue;
    const key = fold(label);
    if (seen.has(key)) continue;
    const pj = countPairMatches(label, cat, season, pools);
    if (pj >= MAX_PAIR_MATCHES) continue;
    seen.add(key);
    out.push({ label, pj, cat: p.cat });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function clock(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function slotLabel(start) {
  return `${clock(start)} - ${clock(start + MATCH_MINUTES)}`;
}

// "19:00 - 22:00", "19 a 22", "19hs", "desde las 20", "hasta 21" → minutos [desde, hasta].
export function parseWindow(text) {
  const raw = String(text || "").toLowerCase();
  const times = [...raw.matchAll(/(\d{1,2})(?:\s*[:.]\s*(\d{2}))?/g)]
    .map((m) => Number(m[1]) * 60 + Number(m[2] || 0))
    .filter((t) => t >= 0 && t <= DAY_END);
  if (times.length >= 2) {
    const [from, to] = times;
    return to > from ? [from, to] : [from, DAY_END];
  }
  if (times.length === 1) return /hasta|antes/.test(raw) ? [DAY_START, times[0]] : [times[0], DAY_END];
  return [DAY_START, DAY_END];
}

function roundUp(min) {
  return Math.ceil(min / 30) * 30;
}

function sharedSlots(a, b) {
  const slots = [];
  for (const day of DAYS) {
    if (!(day in a.days) || !(day in b.days)) continue;
    const [fa, ta] = parseWindow(a.days[day]);
    const [fb, tb] = parseWindow(b.days[day]);
    const end = Math.min(ta, tb);
    for (let start = roundUp(Math.max(fa, fb)); start + MATCH_MINUTES <= end; start += 30) slots.push({ day, start });
  }
  return slots;
}

function overlaps(x, y) {
  return x.day === y.day && x.start < y.start + MATCH_MINUTES && y.start < x.start + MATCH_MINUTES;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playedBefore(history, a, b) {
  return history.some(
    (m) => (pairsMatch(m.home, a) && pairsMatch(m.away, b)) || (pairsMatch(m.home, b) && pairsMatch(m.away, a))
  );
}

function solveCategory(pairs, edges, seed) {
  const random = rng(seed);
  let best = null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const left = new Map(pairs.map((p) => [p.key, p.capacity]));
    const busy = new Map(pairs.map((p) => [p.key, []]));
    const chosen = [];
    const order = pairs
      .map((p) => ({ p, r: random() }))
      .sort((x, y) => (attempt === 0 ? x.p.options - y.p.options || x.r - y.r : x.r - y.r))
      .map((x) => x.p);
    for (const p of order) {
      while (left.get(p.key) > 0) {
        const options = edges
          .filter((e) => (e.a === p.key || e.b === p.key) && left.get(e.a) > 0 && left.get(e.b) > 0)
          .filter((e) => !chosen.some((c) => c.edge === e))
          .map((e) => {
            const slot = e.slots.find(
              (s) => !busy.get(e.a).some((x) => overlaps(x, s)) && !busy.get(e.b).some((x) => overlaps(x, s))
            );
            return slot ? { edge: e, slot, cost: e.cost + random() * 0.5 } : null;
          })
          .filter(Boolean)
          .sort((x, y) => x.cost - y.cost);
        const pick = options[0];
        if (!pick) break;
        chosen.push(pick);
        for (const k of [pick.edge.a, pick.edge.b]) {
          left.set(k, left.get(k) - 1);
          busy.get(k).push(pick.slot);
        }
      }
    }
    const playing = new Set(chosen.flatMap((c) => [c.edge.a, c.edge.b]));
    const score = [playing.size, chosen.length, -chosen.reduce((n, c) => n + c.edge.cost, 0)];
    const better =
      !best ||
      score[0] > best.score[0] ||
      (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])));
    if (better) best = { chosen, playing, score };
  }
  return best;
}

/**
 * Arma los partidos de una fecha a partir de las inscripciones.
 * Una pareja juega un partido (dos si pidió recuperar) contra otra de su categoría con la que
 * comparta al menos 1:30 en el mismo día. Se prioriza no repetir rival y cruzar posiciones cercanas.
 *
 * `filterSharedSlots(slots, entryA, entryB)` (opcional): deja solo huecos que existan en el Drive.
 * Así no se arman cruces “en papel” que después caen a pendientes por falta de cancha.
 */
export function buildFixture({
  entries = [],
  ranking = [],
  history = [],
  week = "",
  temp = "",
  seed = 1,
  filterSharedSlots = null,
} = {}) {
  const matches = [];
  const pending = [];
  const active = entries.filter((e) => !e.bye && e.p1 && e.p2 && e.cat);
  const cats = [...new Set(active.map((e) => e.cat))].sort((a, b) => a.localeCompare(b, "es"));

  for (const cat of cats) {
    const pairs = active
      .filter((e) => e.cat === cat)
      .map((e, i) => {
        const label = pairLabel(e);
        const idx = findPairIndex(ranking, label, cat, temp);
        const row = idx >= 0 ? ranking[idx] : null;
        return {
          key: `${cat}#${i}`,
          entry: e,
          name: row?.name || label,
          pos: Number(row?.pos) || 0,
          capacity: e.recover ? 2 : 1,
          options: 0,
        };
      });
    const maxPos = Math.max(1, ...pairs.map((p) => p.pos));
    const catHistory = history.filter((m) => m.cat === cat && String(m.temp || "").toUpperCase() === String(temp).toUpperCase());
    const edges = [];
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const a = pairs[i];
        const b = pairs[j];
        let slots = sharedSlots(a.entry, b.entry);
        if (typeof filterSharedSlots === "function") {
          slots = filterSharedSlots(slots, a.entry, b.entry) || [];
        }
        if (!slots.length) continue;
        const pa = a.pos || maxPos + 1;
        const pb = b.pos || maxPos + 1;
        const cost = Math.abs(pa - pb) + (playedBefore(catHistory, a.name, b.name) ? REMATCH_COST : 0);
        edges.push({ a: a.key, b: b.key, slots, cost });
        a.options += 1;
        b.options += 1;
      }
    }

    const best = solveCategory(pairs, edges, seed + cats.indexOf(cat));
    const byKey = new Map(pairs.map((p) => [p.key, p]));
    for (const { edge, slot } of best.chosen) {
      const [home, away] = [byKey.get(edge.a), byKey.get(edge.b)].sort((x, y) => (x.pos || 999) - (y.pos || 999));
      matches.push({
        week,
        temp,
        cat,
        day: slot.day,
        time: slotLabel(slot.start),
        venue: "",
        court: "",
        home: home.name,
        away: away.name,
        result: "",
        rematch: edge.cost >= REMATCH_COST,
        // Para assignCourtSlots: no mover a un turno fuera de la inscripción.
        homeDays: home.entry?.days && typeof home.entry.days === "object" ? home.entry.days : undefined,
        awayDays: away.entry?.days && typeof away.entry.days === "object" ? away.entry.days : undefined,
      });
    }
    for (const p of pairs) {
      if (best.playing.has(p.key)) continue;
      const reason =
        pairs.length === 1
          ? "Es la única pareja anotada en su categoría."
          : p.options === 0
            ? filterSharedSlots
              ? "Sin turno exacto en el Drive con otra pareja de su categoría (cercanos/estimables se cubren a mano)."
              : "No coincide en día y horario con ninguna pareja de su categoría."
            : "Las parejas con las que coincide en exacto ya tienen partido.";
      const slot = {
        week,
        temp,
        cat,
        day: "",
        time: "",
        venue: "",
        court: "",
        home: p.name,
        away: PENDING_AWAY,
        result: "",
        pending: true,
        reason,
        days: p.entry.days,
        note: p.entry.note || "",
      };
      matches.push(slot);
      pending.push(slot);
    }
  }

  matches.sort(
    (x, y) =>
      Number(!!x.pending) - Number(!!y.pending) ||
      DAYS.indexOf(x.day) - DAYS.indexOf(y.day) ||
      x.time.localeCompare(y.time) ||
      x.cat.localeCompare(y.cat, "es")
  );
  return { matches, pending, byes: entries.filter((e) => e.bye) };
}
