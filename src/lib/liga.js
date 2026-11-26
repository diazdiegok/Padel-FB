export function seasonNumber(temp) {
  const n = Number(String(temp || "").replace(/^T/i, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function seasonLabel(temp) {
  const n = String(temp || "").trim().replace(/^T/i, "");
  return n ? `Temporada ${n}` : "Temporada";
}

export function seasonSlug(temp) {
  return String(temp || "").trim().toLowerCase();
}

/** Ancla estable para abrir el resultado de un partido desde el fixture. */
export function matchAnchor(m) {
  const raw = [m?.cat, m?.day, m?.time, m?.home, m?.away].filter(Boolean).join(" ");
  const slug = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
  return slug ? `partido-${slug}` : "partido";
}

export function weekSlug(week) {
  const raw = String(week || "Sin fecha")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return raw || "sin-fecha";
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

/**
 * Última fecha que sigue en el fixture vivo de una temporada.
 * Solo esa debe mostrarse como «En juego»; al crear Fecha N+1, la anterior deja de serlo.
 */
export function openWeek(matches = [], temp = "") {
  const season = String(temp || "").trim().toUpperCase();
  const list = (matches || []).filter((m) => {
    if (!season) return true;
    return String(m?.temp || "").trim().toUpperCase() === season;
  });
  return latestWeek(list);
}

export function isOpenWeek(week, matches = [], temp = "") {
  const open = openWeek(matches, temp);
  return !!open && String(week || "") === open;
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
