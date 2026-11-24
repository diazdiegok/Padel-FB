import { createAcademiaInscripciones } from "./acadinsc.js";
import { createApi } from "./api.js";
import { createAscensos } from "./ascensos.js";
import { createAuth } from "./auth.js";
import { ASCENSOS_PATH, HIDDEN_CATS, PLAYOFF_PATH, RANK_PATH, SITE_PATH } from "./constants.js";
import { createCms } from "./cms.js";
import { createFixture } from "./fixture.js";
import { createParejas } from "./parejas.js";
import { createPlayoff } from "./playoff.js";
import { isPendingMatch } from "../lib/fixturer.js";
import { normalizePlayoffs } from "../lib/playoff.js";
import { createRanking } from "./ranking.js";
import { createResults } from "./results.js";
import { createSeasons } from "./seasons.js";
import { createShell } from "./shell.js";
import { createConsumos } from "./consumos.js";
import { createDrafts } from "./drafts.js";
import { createVisitas } from "./visitas.js";
import { $, updateDirtyBadge } from "./ui.js";

export function bootAdmin({
  rankingJson,
  fixtureJson,
  fixturePendingJson,
  siteJson,
  dispJson,
  resultsJson,
  playoffJson,
  pairsJson,
  pairsConfigJson,
  ascensosJson,
}) {
  const publishedLive = structuredClone(Array.isArray(fixtureJson) ? fixtureJson : []);
  const pendingOnly = structuredClone(Array.isArray(fixturePendingJson) ? fixturePendingJson : []);
  // En admin: partidos publicados + pendientes (estos últimos no van a la web).
  const adminFixture = [...publishedLive.filter((m) => !isPendingMatch(m)), ...pendingOnly];
  const ctx = {
    rows: structuredClone(rankingJson.filter((p) => !HIDDEN_CATS.has(p.cat))),
    siteData: structuredClone(siteJson),
    fixture: adminFixture,
    fixturePublished: structuredClone(adminFixture),
    results: structuredClone(resultsJson || []),
    disp: structuredClone(dispJson),
    pairs: structuredClone(Array.isArray(pairsJson) ? pairsJson : []),
    pairsConfig: { open: true, deadline: "", ...(pairsConfigJson || {}) },
    contacts: {},
    playoffs: normalizePlayoffs(playoffJson),
    ascensos: structuredClone(Array.isArray(ascensosJson) ? ascensosJson : []),
    owner: siteJson.githubOwner,
    repo: siteJson.githubRepo,
    API_URL: String(siteJson.apiUrl || "").replace(/\/$/, ""),
    BASE: import.meta.env.BASE_URL || "/",
    token: "",
    dirty: new Set(),
    currentSection: "",
  };

  const api = createApi(ctx);
  const drafts = createDrafts(ctx);
  let ranking;
  let fixture;
  let results;
  let seasons;
  let cms;
  let playoff;
  let ascensos;
  let parejas;
  let acadinsc;
  let visitas;
  let consumos;

  const shell = createShell(ctx, {
    onDirtyChange() {
      drafts.save();
    },
    onEnterSection(id) {
      if (id === "fixture") {
        fixture?.syncWeek();
        fixture?.render();
      }
      if (id === "resultados") results?.reload();
      if (id === "playoff") playoff?.reload();
      if (id === "parejas") parejas?.reload();
      if (id === "temporadas") seasons?.reload();
      if (id === "acadinsc") acadinsc?.reload();
      if (id === "visitas") visitas?.reload();
      if (id === "consumos") consumos?.reload();
    },
    async onDiscardSection(id) {
      if (id === "fixture") {
        ctx.fixture = structuredClone(ctx.fixturePublished);
        fixture?.render();
        return;
      }
      if (id === "resultados") {
        for (const m of [...ctx.fixture, ...ctx.results]) m.result = m.appliedResult || "";
        results?.render();
        return;
      }
      if (id === "parejas") {
        // reload() no pisa si sigue dirty: hay que liberarlo antes.
        ctx.dirty.delete("parejas");
        await parejas?.reload?.({ quiet: true });
        return;
      }
      if (id === "temporadas") {
        seasons?.discard();
        return;
      }
      if (id === "ranking") {
        try {
          const remote = await api.readRemoteJson(RANK_PATH, ctx.rows);
          ctx.rows = (Array.isArray(remote) ? remote : []).filter((p) => p && !HIDDEN_CATS.has(p.cat));
        } catch {
          /* se mantienen las filas locales si GitHub no responde */
        }
        ranking?.refresh();
        return;
      }
      if (id === "playoff") {
        await playoff?.reload?.({ force: true });
        return;
      }
      if (id === "ascensos") {
        try {
          const remote = await api.readRemoteJson(ASCENSOS_PATH, ctx.ascensos);
          ctx.ascensos = Array.isArray(remote) ? remote : [];
        } catch {
          /* keep local */
        }
        ascensos?.render();
        return;
      }
      if (["sitio", "academia", "infantiles", "sedes", "torneos"].includes(id)) {
        try {
          const remote = await api.readRemoteJson(SITE_PATH, ctx.siteData);
          if (remote && typeof remote === "object") Object.assign(ctx.siteData, remote);
        } catch {
          /* keep local */
        }
        cms?.refreshAll();
      }
    },
  });

  ranking = createRanking(ctx, api, shell);
  fixture = createFixture(ctx, api, shell, {
    onRankingChanged() {
      ranking.refresh();
      results?.render();
      seasons?.render();
    },
  });
  results = createResults(ctx, api, shell, {
    onRankingChanged() {
      ranking.refresh();
      seasons?.render();
    },
  });
  seasons = createSeasons(ctx, api, shell, {
    onSeasonChanged() {
      ranking.refresh();
    },
  });
  cms = createCms(ctx, api, shell);
  playoff = createPlayoff(ctx, api, shell);
  ascensos = createAscensos(ctx, api, shell);
  acadinsc = createAcademiaInscripciones(ctx, api);
  visitas = createVisitas(ctx, api);
  consumos = createConsumos(ctx, api);
  parejas = createParejas(ctx, api, shell, {
    onRankingChanged() {
      ranking.refresh();
      seasons?.render();
    },
    onPairsChanged(opts = {}) {
      return fixture?.syncFromPairs?.(opts) || null;
    },
  });

  async function showApp() {
    $("gate").hidden = true;
    $("app").hidden = false;
    document.body.classList.add("admin-ready");
    sessionStorage.removeItem("padel-fb-gh-token");
    ctx.token = api.getPublishToken();
    // Pintar la sección del hash / última visita YA (antes del await) para que F5/Ctrl+F5
    // no pase por Inicio y después salte a Fixture/Resultados.
    const start = shell.initialSection(drafts.preferredSection());
    shell.paintSection(start);
    try {
      await seasons.load();
    } catch {
      /* si GitHub no responde, se usan los datos de la última publicación */
    }
    // Publicado desde el build / GitHub primero; después se reaplica el borrador local (F5).
    drafts.restore();
    updateDirtyBadge(ctx.dirty);
    ranking.refresh();
    seasons.render();
    fixture.syncWeek();
    fixture.render();
    results.render();
    playoff.render();
    ascensos.render();
    parejas.render();
    cms.refreshAll();
    // Re-entrar la misma sección (force) para reload de datos remotos si aplica.
    shell.setSection(start, { force: true });
    // Punto rojo en Consumos si hay alerta (sin abrir la sección).
    consumos?.reload({ quiet: true }).catch(() => {});
  }

  const auth = createAuth(ctx, { onLogin: showApp });

  shell.bind();
  auth.bind();
  ranking.bind();
  fixture.bind();
  results.bind();
  seasons.bind();
  cms.bind();
  playoff.bind();
  ascensos.bind();
  parejas.bind();
  acadinsc.bind();
  visitas.bind();
  consumos.bind();

  if (auth.isLoggedIn()) showApp();
}
