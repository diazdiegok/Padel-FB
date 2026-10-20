import { describeResult } from "./scoring.js";

export const PLAYOFF_SIZES = [2, 4, 8, 16];
export const BYE = "Libre";

const ROUND_NAMES = { 2: "Final", 4: "Semifinal", 8: "Cuartos", 16: "Octavos" };
const ROUND_SHORT = { 2: "F", 4: "SF", 8: "CF", 16: "OF" };

export function roundCount(size) {
  return Math.round(Math.log2(size));
}

export function roundTeams(size, round) {
  return size / 2 ** (round - 1);
}

export function roundName(size, round) {
  const teams = roundTeams(size, round);
  return ROUND_NAMES[teams] || `Ronda de ${teams}`;
}

export function matchLabel(size, round, slot) {
  const teams = roundTeams(size, round);
  const short = ROUND_SHORT[teams] || `R${round}`;
  return teams === 2 ? "Final" : `${short}${slot}`;
}

/** Orden de cabezas de serie: 1v8, 4v5, 2v7, 3v6 para 8. */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, n - seed]);
  }
  return order;
}

export function isBye(name) {
  return String(name || "").trim().toLowerCase() === BYE.toLowerCase();
}

function blankMatch(round, slot) {
  return {
    id: `${round}-${slot}`,
    round,
    slot,
    homeSeed: null,
    home: "",
    awaySeed: null,
    away: "",
    day: "",
    time: "",
    venue: "",
    court: "",
    result: "",
    wo: "",
  };
}

function cleanSeed(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Normaliza una categoría: tamaño válido y todos los partidos de cada ronda. */
export function normalizeCategory(raw = {}) {
  const size = PLAYOFF_SIZES.includes(Number(raw.size)) ? Number(raw.size) : 8;
  const byId = new Map((Array.isArray(raw.matches) ? raw.matches : []).map((m) => [String(m.id), m]));
  const matches = [];
  for (let round = 1; round <= roundCount(size); round++) {
    const total = roundTeams(size, round) / 2;
    for (let slot = 1; slot <= total; slot++) {
      const base = blankMatch(round, slot);
      const prev = byId.get(base.id) || {};
      matches.push({
        ...base,
        homeSeed: cleanSeed(prev.homeSeed),
        home: String(prev.home || "").trim(),
        awaySeed: cleanSeed(prev.awaySeed),
        away: String(prev.away || "").trim(),
        day: String(prev.day || "").trim(),
        time: String(prev.time || "").trim(),
        venue: String(prev.venue || "").trim(),
        court: String(prev.court || "").trim(),
        result: String(prev.result || "").trim(),
        wo: prev.wo === "home" || prev.wo === "away" ? prev.wo : "",
      });
    }
  }
  return { cat: String(raw.cat || "").trim(), size, matches };
}

export function normalizePlayoff(raw = {}) {
  return {
    temp: String(raw.temp || "").trim().toUpperCase(),
    title: String(raw.title || "").trim(),
    dates: String(raw.dates || "").trim(),
    note: String(raw.note || "").trim(),
    categories: (Array.isArray(raw.categories) ? raw.categories : []).map(normalizeCategory).filter((c) => c.cat),
  };
}

/** Arma la primera ronda con las mejores parejas del ranking (ordenadas por posición). */
export function seedCategory(category, pairs) {
  const size = category.size;
  const order = seedOrder(size);
  const next = normalizeCategory({ cat: category.cat, size, matches: [] });
  const keep = new Map(category.matches.map((m) => [m.id, m]));
  const pick = (seed) => (seed <= pairs.length ? pairs[seed - 1] : BYE);
  next.matches = next.matches.map((m) => {
    const old = keep.get(m.id) || {};
    const schedule = { day: old.day || "", time: old.time || "", venue: old.venue || "", court: old.court || "" };
    if (m.round !== 1) return { ...m, ...schedule };
    const homeSeed = order[(m.slot - 1) * 2];
    const awaySeed = order[(m.slot - 1) * 2 + 1];
    return { ...m, ...schedule, homeSeed, home: pick(homeSeed), awaySeed, away: pick(awaySeed) };
  });
  return next;
}

/** Ganador de un partido ya resuelto: "home", "away" o "". */
export function matchWinner(m) {
  if (!m.home || !m.away) return "";
  const homeBye = isBye(m.home);
  const awayBye = isBye(m.away);
  if (homeBye && awayBye) return "";
  if (awayBye) return "home";
  if (homeBye) return "away";
  if (m.wo === "home" || m.wo === "away") return m.wo;
  const info = describeResult(m.result);
  if (!info) return "";
  return info.homeWin ? "home" : "away";
}

/**
 * Completa las rondas siguientes con las ganadoras. Devuelve rondas listas para mostrar
 * y la campeona si la final está definida.
 */
export function resolveCategory(rawCategory) {
  const category = normalizeCategory(rawCategory);
  const { size } = category;
  const total = roundCount(size);
  const byRound = [];
  for (let round = 1; round <= total; round++) {
    const list = category.matches.filter((m) => m.round === round);
    const resolved = list.map((m) => {
      const match = { ...m };
      if (round > 1) {
        const prev = byRound[round - 2];
        const a = prev[(m.slot - 1) * 2];
        const b = prev[(m.slot - 1) * 2 + 1];
        match.home = a.winnerName || "";
        match.homeSeed = a.winnerSeed ?? null;
        match.away = b.winnerName || "";
        match.awaySeed = b.winnerSeed ?? null;
        match.homeFrom = a.label;
        match.awayFrom = b.label;
      }
      match.label = matchLabel(size, round, m.slot);
      match.info = describeResult(match.result);
      match.bye = isBye(match.home) || isBye(match.away);
      match.winner = matchWinner(match);
      match.winnerName = match.winner ? match[match.winner] : "";
      match.winnerSeed = match.winner ? match[`${match.winner}Seed`] : null;
      return match;
    });
    byRound.push(resolved);
  }
  const rounds = byRound.map((matches, i) => ({ round: i + 1, name: roundName(size, i + 1), matches }));
  const final = byRound[total - 1]?.[0];
  return {
    ...category,
    rounds,
    champion: final?.winnerName || "",
    championSeed: final?.winnerSeed ?? null,
  };
}

/** Lo que se guarda en el JSON: incluye las parejas ya clasificadas en cada ronda. */
export function serializePlayoff(playoff) {
  const clean = normalizePlayoff(playoff);
  return {
    ...clean,
    categories: clean.categories.map((category) => {
      const resolved = resolveCategory(category);
      return {
        cat: category.cat,
        size: category.size,
        matches: resolved.rounds.flatMap((r) =>
          r.matches.map((m) => ({
            id: m.id,
            round: m.round,
            slot: m.slot,
            homeSeed: m.homeSeed,
            home: m.home,
            awaySeed: m.awaySeed,
            away: m.away,
            day: m.day,
            time: m.time,
            venue: m.venue,
            court: m.court,
            result: m.result,
            wo: m.wo,
          }))
        ),
      };
    }),
  };
}

export function invalidResults(playoff) {
  const out = [];
  for (const category of normalizePlayoff(playoff).categories) {
    for (const m of category.matches) {
      if (m.result && !m.wo && !describeResult(m.result)) out.push({ cat: category.cat, match: m });
    }
  }
  return out;
}
