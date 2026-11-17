/** Ganador siempre 3 pts. 2-0 = 3-0. 2-1 = 3-1. */

export function fold(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function playerTokens(name) {
  return fold(name).split(" ").filter((w) => w.length > 1);
}

export function splitPair(name) {
  return String(name || "")
    .split(/\s*(?:\/|\s+vs\.?\s+|\s+-\s+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function playersMatch(a, b) {
  const ta = playerTokens(a);
  const tb = playerTokens(b);
  if (!ta.length || !tb.length) return false;
  const setA = new Set(ta);
  const setB = new Set(tb);
  // Nombre más corto contenido en el más largo (typos / segundo nombre de más).
  const [short, longSet] = ta.length <= tb.length ? [ta, setB] : [tb, setA];
  if (short.every((t) => longSet.has(t))) return true;
  const overlap = ta.filter((t) => setB.has(t));
  const strong = overlap.filter((t) => t.length >= 4);
  // Un solo nombre de pila compartido ("Martin", "Diego") NO alcanza: hace falta
  // otro token fuerte o que coincida el apellido (último token).
  if (strong.length >= 2) return true;
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  if (lastA.length >= 4 && lastA === lastB && overlap.length >= 1) return true;
  return false;
}

export function pairsMatch(a, b) {
  const pa = splitPair(a);
  const pb = splitPair(b);
  if (pa.length >= 2 && pb.length >= 2) {
    return (
      (playersMatch(pa[0], pb[0]) && playersMatch(pa[1], pb[1])) ||
      (playersMatch(pa[0], pb[1]) && playersMatch(pa[1], pb[0]))
    );
  }
  return playersMatch(a, b);
}

export function parseResult(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  if (!s) return null;

  const sets = [...s.matchAll(/(\d+)\s*[-\/]\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (!sets.length) return null;

  if (sets.length === 1) {
    const [home, away] = sets[0];
    if ((home === 2 || away === 2) && home !== away && home <= 2 && away <= 2 && home + away <= 3) {
      return { homeSets: home, awaySets: away, sets };
    }
    return null;
  }

  let homeSets = 0;
  let awaySets = 0;
  for (const [home, away] of sets) {
    if (home === away) return null;
    if (home > away) homeSets += 1;
    else awaySets += 1;
  }
  if (!((homeSets === 2 && awaySets <= 1) || (awaySets === 2 && homeSets <= 1))) return null;
  return { homeSets, awaySets, sets };
}

export function pointsFor(homeSets, awaySets) {
  if (homeSets === 2 && awaySets === 0) return { homePts: 3, awayPts: 0, homeDif: 2, awayDif: -2 };
  if (homeSets === 2 && awaySets === 1) return { homePts: 3, awayPts: 1, homeDif: 1, awayDif: -1 };
  if (homeSets === 0 && awaySets === 2) return { homePts: 0, awayPts: 3, homeDif: -2, awayDif: 2 };
  if (homeSets === 1 && awaySets === 2) return { homePts: 1, awayPts: 3, homeDif: -1, awayDif: 1 };
  return null;
}

/** Score canónico: 6/4 6/2. Acepta también el guión viejo. */
export function formatResult(raw) {
  const parsed = parseResult(raw);
  if (!parsed?.sets?.length) return "";
  return parsed.sets.map(([a, b]) => `${a}/${b}`).join(" ");
}

export function describeResult(raw) {
  const parsed = parseResult(raw);
  if (!parsed) return null;
  const pts = pointsFor(parsed.homeSets, parsed.awaySets);
  if (!pts) return null;
  const score = formatResult(raw);
  return {
    ...parsed,
    ...pts,
    homeWin: parsed.homeSets > parsed.awaySets,
    label: `${parsed.homeSets}-${parsed.awaySets}`,
    score,
  };
}

export function findPairIndex(rows, name, cat, temp) {
  let best = -1;
  let bestScore = 0;
  rows.forEach((row, i) => {
    if (row.cat !== cat || String(row.temp).toUpperCase() !== String(temp).toUpperCase()) return;
    if (!pairsMatch(row.name, name)) return;
    const tokens = new Set(splitPair(name).flatMap(playerTokens));
    const score = splitPair(row.name).flatMap(playerTokens).filter((t) => tokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Suma al ranking, con 0 puntos y al final de su categoría, las parejas inscriptas que todavía no están. */
export function addPairsToRanking(rows, pairs) {
  const added = [];
  for (const pair of pairs) {
    const temp = String(pair.temp || "").toUpperCase();
    if (!pair.p1 || !pair.p2 || !pair.cat || !temp) continue;
    const name = `${pair.p1} / ${pair.p2}`;
    if (findPairIndex(rows, name, pair.cat, temp) >= 0) continue;
    const last = rows
      .filter((r) => r.cat === pair.cat && String(r.temp).toUpperCase() === temp)
      .reduce((max, r) => Math.max(max, Number(r.pos) || 0), 0);
    rows.push({ name, cat: pair.cat, pts: 0, pj: 0, dif: 0, pos: last + 1, temp });
    added.push(name);
  }
  return added;
}

/** Quita del ranking las parejas indicadas (misma cat/temp y nombre coincidente). */
export function removePairsFromRanking(rows, pairs) {
  const removed = [];
  for (const pair of pairs || []) {
    const temp = String(pair.temp || "").toUpperCase();
    if (!pair.p1 || !pair.p2 || !pair.cat || !temp) continue;
    const name = `${pair.p1} / ${pair.p2}`;
    const i = findPairIndex(rows, name, pair.cat, temp);
    if (i < 0) continue;
    removed.push(rows[i]);
    rows.splice(i, 1);
  }
  if (removed.length) recomputePositions(rows);
  return removed;
}

/** Mejor inscripción vigente que matchee una fila del ranking (misma cat). */
function bestSeasonPairForRow(row, seasonPairs) {
  let best = null;
  let bestScore = 0;
  for (const p of seasonPairs) {
    if (p.cat !== row.cat) continue;
    const name = `${p.p1} / ${p.p2}`;
    if (!pairsMatch(row.name, name)) continue;
    const tokens = new Set(splitPair(name).flatMap(playerTokens));
    const score = splitPair(row.name).flatMap(playerTokens).filter((t) => tokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/**
 * Deja en `temp` solo filas que coincidan con inscripciones vigentes.
 * Si matchean, el nombre del ranking pasa a ser el de la inscripción (p1 / p2).
 * Otras temporadas no se tocan.
 * @returns {{ removed: object[], renamed: { from: string, to: string, cat: string }[] }}
 */
export function syncRankingToSeasonPairs(rows, pairs, temp) {
  const empty = { removed: [], renamed: [] };
  const season = String(temp || "").toUpperCase();
  if (!season || !Array.isArray(rows)) return empty;
  const seasonPairs = (pairs || []).filter(
    (p) => String(p.temp || "").toUpperCase() === season && p.p1 && p.p2 && p.cat
  );
  const removed = [];
  const renamed = [];
  const keep = [];
  const claimed = new Set();
  for (const row of rows) {
    if (String(row.temp || "").toUpperCase() !== season) {
      keep.push(row);
      continue;
    }
    const matched = bestSeasonPairForRow(row, seasonPairs);
    if (!matched) {
      removed.push(row);
      continue;
    }
    const key = `${matched.cat}|${fold(matched.p1)}|${fold(matched.p2)}`;
    // Una inscripción no puede sostener dos filas: la segunda sobra.
    if (claimed.has(key)) {
      removed.push(row);
      continue;
    }
    claimed.add(key);
    const nextName = `${matched.p1} / ${matched.p2}`;
    if (String(row.name || "").trim() !== nextName) {
      renamed.push({ from: row.name, to: nextName, cat: row.cat });
      row.name = nextName;
    }
    keep.push(row);
  }
  if (removed.length) {
    rows.length = 0;
    rows.push(...keep);
  }
  if (removed.length || renamed.length) recomputePositions(rows);
  return { removed, renamed };
}

function ensurePair(rows, name, cat, temp) {
  const i = findPairIndex(rows, name, cat, temp);
  if (i >= 0) return i;
  rows.push({
    name,
    cat,
    pts: 0,
    pj: 0,
    dif: 0,
    pos: 99,
    temp: String(temp || "T4").toUpperCase(),
  });
  return rows.length - 1;
}

function applySide(row, pts, dif, sign) {
  row.pts = Number(row.pts || 0) + sign * pts;
  row.pj = Number(row.pj || 0) + sign;
  row.dif = Number(row.dif || 0) + sign * dif;
}

export function recomputePositions(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.temp}|${row.cat}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        Number(b.pts) - Number(a.pts) ||
        Number(b.dif) - Number(a.dif) ||
        Number(a.pj) - Number(b.pj) ||
        String(a.name).localeCompare(String(b.name), "es")
    );
    list.forEach((row, i) => {
      row.pos = i + 1;
    });
  }
  return rows;
}

export function applyFixtureResults(ranking, matches) {
  const unmatched = [];
  const created = [];
  let applied = 0;
  let reverted = 0;

  for (const match of matches) {
    const next = String(match.result || "").trim();
    const prev = String(match.appliedResult || "").trim();
    if (next === prev) continue;
    const homeName = String(match.home || "").trim();
    const awayName = String(match.away || "").trim();
    const placeholder = (name) => !name || fold(name) === fold("Pendiente / Pendiente");
    if (!homeName || !awayName || placeholder(homeName) || placeholder(awayName)) {
      if (next) unmatched.push(`Falta una de las parejas en ${match.cat || "un partido"} (${homeName || awayName || "sin nombre"}).`);
      continue;
    }

    const nextScore = next ? describeResult(next) : null;
    const prevScore = prev ? describeResult(prev) : null;

    if (next && !nextScore) {
      unmatched.push(`Resultado inválido (${match.home} vs ${match.away}): "${next}". Usá 6/4 6/2 o 2/1.`);
      continue;
    }

    const cat = match.cat;
    const temp = match.temp;
    const homeBefore = findPairIndex(ranking, match.home, cat, temp);
    const awayBefore = findPairIndex(ranking, match.away, cat, temp);
    const homeIdx = ensurePair(ranking, match.home, cat, temp);
    const awayIdx = ensurePair(ranking, match.away, cat, temp);
    if (homeBefore < 0) created.push(match.home);
    if (awayBefore < 0) created.push(match.away);

    if (prevScore) {
      applySide(ranking[homeIdx], prevScore.homePts, prevScore.homeDif, -1);
      applySide(ranking[awayIdx], prevScore.awayPts, prevScore.awayDif, -1);
      reverted += 1;
    }
    if (nextScore) {
      applySide(ranking[homeIdx], nextScore.homePts, nextScore.homeDif, 1);
      applySide(ranking[awayIdx], nextScore.awayPts, nextScore.awayDif, 1);
      applied += 1;
    }
    match.appliedResult = next;
  }

  recomputePositions(ranking);
  return { applied, reverted, unmatched, created };
}
