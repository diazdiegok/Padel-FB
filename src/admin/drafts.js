/** Borradores locales del admin: sobreviven a F5 / Ctrl+F5 hasta publicar o cancelar. */

const KEY = "padel-fb-admin-drafts-v1";

function clone(value) {
  return structuredClone(value);
}

function capture(ctx, id) {
  switch (id) {
    case "fixture":
      return { fixture: clone(ctx.fixture || []) };
    case "resultados":
      return {
        fixture: clone(ctx.fixture || []),
        results: clone(ctx.results || []),
      };
    case "ranking":
      return { rows: clone(ctx.rows || []) };
    case "parejas":
      return {
        pairs: clone(ctx.pairs || []),
        pairsConfig: clone(ctx.pairsConfig || { open: true, deadline: "" }),
      };
    case "temporadas":
      return {
        currentSeason: ctx.siteData?.currentSeason || "",
        upcomingSeason: ctx.siteData?.upcomingSeason || "",
        seasonPhase: ctx.siteData?.seasonPhase || "",
        seasons: clone(ctx.siteData?.seasons || []),
        seasonVenues: clone(ctx.siteData?.seasonVenues || {}),
        showPlayoff: Boolean(ctx.siteData?.showPlayoff),
      };
    case "playoff":
      return { playoffs: clone(ctx.playoffs) };
    case "ascensos":
      return { ascensos: clone(ctx.ascensos || []) };
    case "sitio":
    case "academia":
    case "infantiles":
    case "sedes":
    case "torneos":
      return { siteData: clone(ctx.siteData || {}) };
    default:
      return null;
  }
}

function apply(ctx, id, data) {
  if (!data || typeof data !== "object") return false;
  switch (id) {
    case "fixture":
      if (!Array.isArray(data.fixture)) return false;
      ctx.fixture = clone(data.fixture);
      return true;
    case "resultados":
      if (!Array.isArray(data.fixture) || !Array.isArray(data.results)) return false;
      ctx.fixture = clone(data.fixture);
      ctx.results = clone(data.results);
      return true;
    case "ranking":
      if (!Array.isArray(data.rows)) return false;
      ctx.rows = clone(data.rows);
      return true;
    case "parejas":
      if (!Array.isArray(data.pairs)) return false;
      ctx.pairs = clone(data.pairs);
      if (data.pairsConfig && typeof data.pairsConfig === "object") {
        ctx.pairsConfig = clone(data.pairsConfig);
      }
      return true;
    case "temporadas":
      ctx.siteData.currentSeason = data.currentSeason || ctx.siteData.currentSeason;
      ctx.siteData.upcomingSeason = data.upcomingSeason ?? ctx.siteData.upcomingSeason;
      if (data.seasonPhase) ctx.siteData.seasonPhase = data.seasonPhase;
      if (Array.isArray(data.seasons)) ctx.siteData.seasons = clone(data.seasons);
      if (data.seasonVenues && typeof data.seasonVenues === "object") {
        ctx.siteData.seasonVenues = clone(data.seasonVenues);
      }
      if ("showPlayoff" in data) ctx.siteData.showPlayoff = Boolean(data.showPlayoff);
      return true;
    case "playoff":
      if (data.playoffs == null) return false;
      ctx.playoffs = clone(data.playoffs);
      return true;
    case "ascensos":
      if (!Array.isArray(data.ascensos)) return false;
      ctx.ascensos = clone(data.ascensos);
      return true;
    case "sitio":
    case "academia":
    case "infantiles":
    case "sedes":
    case "torneos":
      if (!data.siteData || typeof data.siteData !== "object") return false;
      Object.assign(ctx.siteData, clone(data.siteData));
      return true;
    default:
      return false;
  }
}

export function createDrafts(ctx) {
  let timer = 0;

  function readStore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.dirty) || typeof parsed.data !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeStore(payload) {
    try {
      if (!payload?.dirty?.length) {
        localStorage.removeItem(KEY);
        return;
      }
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch {
      /* cuota / modo privado: el admin sigue en memoria */
    }
  }

  function saveNow() {
    const dirty = [...ctx.dirty];
    if (!dirty.length) {
      writeStore(null);
      return;
    }
    const prev = readStore();
    const data = { ...(prev?.data || {}) };
    for (const id of dirty) {
      const snap = capture(ctx, id);
      if (snap) data[id] = snap;
    }
    for (const id of Object.keys(data)) {
      if (!dirty.includes(id)) delete data[id];
    }
    writeStore({
      dirty,
      section: ctx.currentSection || prev?.section || "",
      savedAt: Date.now(),
      data,
    });
  }

  function save() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      saveNow();
    }, 120);
  }

  function clear() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    writeStore(null);
  }

  /** Restaura borradores sobre el estado publicado. Devuelve las secciones dirty. */
  function restore() {
    const store = readStore();
    if (!store) return [];
    const restored = [];
    for (const id of store.dirty) {
      if (apply(ctx, id, store.data?.[id])) {
        ctx.dirty.add(id);
        restored.push(id);
      }
    }
    if (!restored.length) {
      clear();
      return [];
    }
    // Reescribir por si alguna sección inválida quedó afuera.
    writeStore({
      dirty: restored,
      section: store.section || "",
      savedAt: store.savedAt || Date.now(),
      data: Object.fromEntries(restored.map((id) => [id, store.data[id]])),
    });
    return restored;
  }

  function preferredSection() {
    return readStore()?.section || "";
  }

  return { save, saveNow, clear, restore, preferredSection };
}
