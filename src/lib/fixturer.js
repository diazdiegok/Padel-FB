import { DAYS, pairLabel } from "./disponibilidad.js";
import { findPairIndex, pairsMatch } from "./scoring.js";

export const MATCH_MINUTES = 90;
const DAY_START = 8 * 60;
const DAY_END = 24 * 60;
const REMATCH_COST = 1000;
const TRIES = 400;

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
 */
export function buildFixture({ entries = [], ranking = [], history = [], week = "", temp = "", seed = 1 } = {}) {
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
        const slots = sharedSlots(a.entry, b.entry);
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
      });
    }
    for (const p of pairs) {
      if (best.playing.has(p.key)) continue;
      const reason =
        pairs.length === 1
          ? "Es la única pareja anotada en su categoría."
          : p.options === 0
            ? "No coincide en día y horario con ninguna pareja de su categoría."
            : "Las parejas con las que coincide ya tienen partido.";
      pending.push({ week, temp, cat, home: p.name, reason, days: p.entry.days, note: p.entry.note || "" });
    }
  }

  matches.sort((x, y) => DAYS.indexOf(x.day) - DAYS.indexOf(y.day) || x.time.localeCompare(y.time) || x.cat.localeCompare(y.cat, "es"));
  return { matches, pending, byes: entries.filter((e) => e.bye) };
}
