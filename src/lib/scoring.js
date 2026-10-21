/** 2-0 = 3 pts ganador. 2-1 = 2 pts ganador y 1 el perdedor. */

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
  const overlap = ta.filter((t) => setB.has(t));
  const strong = overlap.filter((t) => t.length >= 4);
  if (strong.length >= 1) return true;
  const [short, long] = ta.length <= tb.length ? [ta, setB] : [tb, setA];
  return short.length >= 2 && short.every((t) => long.has(t));
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

  const sets = [...s.matchAll(/(\d+)\s*-\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
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
  if (homeSets === 2 && awaySets === 1) return { homePts: 2, awayPts: 1, homeDif: 1, awayDif: -1 };
  if (homeSets === 0 && awaySets === 2) return { homePts: 0, awayPts: 3, homeDif: -2, awayDif: 2 };
  if (homeSets === 1 && awaySets === 2) return { homePts: 1, awayPts: 2, homeDif: -1, awayDif: 1 };
  return null;
}

export function describeResult(raw) {
  const parsed = parseResult(raw);
  if (!parsed) return null;
  const pts = pointsFor(parsed.homeSets, parsed.awaySets);
  if (!pts) return null;
  const score = parsed.sets.length > 1 ? parsed.sets.map((s) => s.join("-")).join(" ") : `${parsed.homeSets}-${parsed.awaySets}`;
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
    if (!String(match.home || "").trim() || !String(match.away || "").trim()) {
      if (next) unmatched.push(`Falta una de las parejas en ${match.cat || "un partido"} (${match.home || match.away || "sin nombre"}).`);
      continue;
    }

    const nextScore = next ? describeResult(next) : null;
    const prevScore = prev ? describeResult(prev) : null;

    if (next && !nextScore) {
      unmatched.push(`Resultado inválido (${match.home} vs ${match.away}): "${next}". Usá 6-4 6-2 o 2-1.`);
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
