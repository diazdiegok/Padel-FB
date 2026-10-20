export function venueKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/club|padel/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function sameVenue(a, b) {
  const ka = venueKey(a);
  const kb = venueKey(b);
  return !!ka && !!kb && (ka === kb || ka.includes(kb) || kb.includes(ka));
}

function emptyGroup(g) {
  return !String(g.when || "").trim() && !(g.rows || []).length;
}

// Cada sede tildada como Infantiles tiene su bloque de horarios; los bloques vacíos de sedes destildadas se quitan.
export function syncKidsGroups(venues, groups) {
  const flagged = (venues || []).filter((v) => v.infantiles && String(v.name || "").trim());
  const kept = (groups || []).filter((g) => {
    if (!emptyGroup(g)) return true;
    const known = (venues || []).find((v) => sameVenue(v.name, g.venue));
    return !known || flagged.includes(known);
  });
  for (const v of flagged) {
    if (!kept.some((g) => sameVenue(v.name, g.venue))) kept.push({ venue: v.name, when: "", rows: [] });
  }
  return kept;
}
