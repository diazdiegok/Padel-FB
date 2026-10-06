export function seasonNumber(temp) {
  const n = Number(String(temp || "").replace(/^T/i, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function seasonLabel(temp) {
  const n = String(temp || "").trim().replace(/^T/i, "");
  return n ? `Temporada ${n}` : "Temporada";
}

export function normalizeSeason(temp) {
  const n = seasonNumber(temp);
  return n ? `T${n}` : "";
}

export function listSeasons(site, extra = []) {
  const listed = Array.isArray(site?.seasons) ? site.seasons : [];
  const all = [...listed, ...extra, site?.currentSeason].map(normalizeSeason).filter(Boolean);
  return [...new Set(all)].sort((a, b) => seasonNumber(a) - seasonNumber(b));
}

export function nextSeason(seasons) {
  const max = (seasons || []).reduce((n, temp) => Math.max(n, seasonNumber(temp)), 0);
  return `T${max + 1}`;
}

export function weekNumber(week) {
  const match = String(week || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function weekKey(match) {
  return `${String(match?.temp || "").trim().toUpperCase()}|${match?.week || "Sin fecha"}`;
}

export function latestWeek(matches) {
  const weeks = [...new Set((matches || []).map((m) => m.week || "Sin fecha"))];
  if (!weeks.length) return "";
  weeks.sort((a, b) => weekNumber(a) - weekNumber(b) || String(a).localeCompare(String(b), "es"));
  return weeks[weeks.length - 1];
}

export function liveFixture(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const week = latestWeek(list);
  if (!week) return [];
  return list.filter((m) => (m.week || "Sin fecha") === week);
}

export function mergeArchivedMatches(archive, incoming) {
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return Array.isArray(archive) ? [...archive] : [];
  const keys = new Set(next.map(weekKey));
  return [...(Array.isArray(archive) ? archive : []).filter((m) => !keys.has(weekKey(m))), ...next];
}

export function combineResults(archive, live) {
  const current = Array.isArray(live) ? live : [];
  const liveKeys = new Set(current.map(weekKey));
  const previous = (Array.isArray(archive) ? archive : []).filter((m) => !liveKeys.has(weekKey(m)));
  return [...previous, ...current];
}
