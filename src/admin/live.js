import { HIDDEN_CATS } from "./constants.js";
import { normalizePlayoffs } from "../lib/playoff.js";

const SITE_FIELDS = {
  sitio: ["whatsapp", "instagram", "city", "province", "ligaIntro", "showPlayoff", "sponsors", "sponsorsSpeed"],
  temporadas: ["currentSeason", "seasons", "upcomingSeason", "seasonPhase", "seasonVenues"],
  academia: ["academia", "staff"],
  infantiles: ["kids"],
  sedes: ["venues", "moreVenues"],
  torneos: ["torneos"],
};

const POLL_MS = 4000;

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function editing(ctx, section) {
  if (ctx.dirty.has(section)) return true;
  const el = document.activeElement;
  if (!el?.closest?.(`[data-section="${section}"]`)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function keepPlace(fn) {
  const scroller = document.scrollingElement;
  const top = scroller ? scroller.scrollTop : 0;
  fn();
  if (scroller) scroller.scrollTop = top;
}

export function createLive(ctx, api, modules) {
  let sha = "";
  let timer = 0;
  let armed = false;
  let inflight = null;

  function apply(files) {
    const jobs = [];
    const site = files?.site;
    const siteTouched = new Set();
    if (site && typeof site === "object") {
      const blocked = new Set();
      for (const [section, keys] of Object.entries(SITE_FIELDS)) {
        if (editing(ctx, section)) keys.forEach((key) => blocked.add(key));
      }
      for (const [key, value] of Object.entries(site)) {
        if (blocked.has(key) || same(ctx.siteData[key], value)) continue;
        ctx.siteData[key] = structuredClone(value);
        for (const [section, keys] of Object.entries(SITE_FIELDS)) {
          if (keys.includes(key)) siteTouched.add(section);
        }
      }
      const cms = [...siteTouched].filter((section) => section !== "temporadas" && !editing(ctx, section));
      if (cms.length) jobs.push(() => modules.cms.refreshSections(cms));
      if (siteTouched.has("temporadas") && !editing(ctx, "temporadas")) {
        modules.seasons.noteRemote();
        jobs.push(() => modules.seasons.render());
      }
    }

    if (!editing(ctx, "ranking") && Array.isArray(files?.ranking)) {
      const next = files.ranking.filter((row) => row && !HIDDEN_CATS.has(row.cat));
      if (modules.ranking.adoptRemote(next)) {
        jobs.push(() => modules.ranking.render());
        if (!editing(ctx, "temporadas")) jobs.push(() => modules.seasons.render());
      }
    }

    const fixtureBlocked = editing(ctx, "fixture") || editing(ctx, "resultados");
    if (!fixtureBlocked && Array.isArray(files?.fixture) && !same(ctx.fixture, files.fixture)) {
      ctx.fixture = structuredClone(files.fixture);
      ctx.fixturePublished = structuredClone(files.fixture);
      jobs.push(() => modules.fixture.render());
    }
    if (!editing(ctx, "resultados") && Array.isArray(files?.results) && !same(ctx.results, files.results)) {
      ctx.results = structuredClone(files.results);
      jobs.push(() => modules.results.render());
    }

    if (!editing(ctx, "playoff") && files?.playoff) {
      const next = normalizePlayoffs(files.playoff);
      if (!same(ctx.playoffs, next)) {
        ctx.playoffs = next;
        jobs.push(() => modules.playoff.render());
      }
    }

    if (!editing(ctx, "ascensos") && Array.isArray(files?.ascensos) && !same(ctx.ascensos, files.ascensos)) {
      ctx.ascensos = structuredClone(files.ascensos);
      jobs.push(() => modules.ascensos.render());
    }

    if (!editing(ctx, "parejas") && modules.parejas.adoptRemote(files?.pairs, files?.pairsConfig)) {
      jobs.push(() => modules.parejas.render());
    }

    if (!editing(ctx, "temporadas") && files?.disp && !same(ctx.disp, files.disp)) {
      ctx.disp = structuredClone(files.disp);
    }

    const venueTouch = siteTouched.has("sedes") || siteTouched.has("temporadas");
    if (venueTouch && !editing(ctx, "fixture")) jobs.push(() => modules.fixture.render());
    if (jobs.length) keepPlace(() => jobs.forEach((job) => job()));
  }

  async function syncNow() {
    if (inflight) return inflight;
    const epoch = ctx.liveEpoch || 0;
    inflight = (async () => {
      const data = await api.worker(`/admin/live?sha=${encodeURIComponent(sha)}`);
      if ((ctx.liveEpoch || 0) !== epoch) return;
      if (data?.changed && data.files) {
        apply(data.files);
        if ((ctx.liveEpoch || 0) !== epoch) return;
        sha = data.sha || sha;
      }
      if (!editing(ctx, "parejas") && (await modules.parejas.pullExtras())) {
        if ((ctx.liveEpoch || 0) === epoch && !editing(ctx, "parejas")) {
          keepPlace(() => modules.parejas.render());
        }
      }
      if (ctx.currentSection === "acadinsc") await modules.acadinsc.reload({ quiet: true });
      if (ctx.currentSection === "visitas") await modules.visitas.reload({ quiet: true });
    })().catch((err) => {
      if (/sesi[oó]n vencida|\b401\b/i.test(String(err?.message || err))) halt();
      throw err;
    }).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function halt() {
    if (timer) clearInterval(timer);
    timer = 0;
    armed = false;
  }

  function arm() {
    if (armed) return;
    armed = true;
    const kick = () => {
      if (!document.hidden) syncNow().catch(() => {});
    };
    document.addEventListener("visibilitychange", kick);
    timer = setInterval(kick, POLL_MS);
  }

  return {
    async pull() {
      try {
        await syncNow();
        return true;
      } catch {
        /* si la API no responde, queda la última copia publicada */
        return false;
      }
    },
    arm,
    stop: halt,
  };
}
