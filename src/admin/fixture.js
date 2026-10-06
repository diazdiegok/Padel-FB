import { FIXTURE_PATH, FX_COLS, RESULTS_PATH } from "./constants.js";
import { cleanMatch, downloadCsv, driveRow, matchKey, parseFixtureText } from "./csv.js";
import { mergeArchivedMatches, weekKey } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createFixture(ctx, api, shell, { onRankingChanged }) {
  function fallbackWeek() {
    return $("fx-week")?.value.trim() || ctx.fixture[0]?.week || "Fecha 1";
  }

  function updateSummary() {
    const el = $("fx-summary");
    if (!el) return;
    const n = ctx.fixture.length;
    const cats = new Set(ctx.fixture.map((m) => m.cat).filter(Boolean));
    const weeks = [...new Set(ctx.fixture.map((m) => m.week).filter(Boolean))];
    el.textContent = n
      ? `${n} partido${n === 1 ? "" : "s"} · ${cats.size} categorí${cats.size === 1 ? "a" : "as"} · ${weeks.join(", ") || "sin semana"}`
      : "Sin partidos cargados";
  }

  function render() {
    updateSummary();
    const empty = $("fx-empty");
    if (empty) empty.hidden = ctx.fixture.length > 0;
    $("fx-body").innerHTML = ctx.fixture
      .map(
        (m, i) => `<tr data-i="${i}">
          <td><input data-k="week" value="${escAttr(m.week)}" /></td>
          <td><input data-k="day" value="${escAttr(m.day)}" placeholder="Jueves" /></td>
          <td><input data-k="time" value="${escAttr(m.time)}" placeholder="19:00 - 20:30" /></td>
          <td><input data-k="cat" value="${escAttr(m.cat)}" /></td>
          <td><input data-k="venue" value="${escAttr(m.venue)}" /></td>
          <td><input data-k="court" value="${escAttr(m.court)}" placeholder="Cancha 1" /></td>
          <td><input data-k="home" value="${escAttr(m.home)}" /></td>
          <td><input data-k="away" value="${escAttr(m.away)}" /></td>
          <td><button class="admin-del" type="button" data-fx-del="${i}" aria-label="Eliminar">×</button></td>
        </tr>`
      )
      .join("");
  }

  function loadFixtureText(text) {
    const season = ctx.siteData.currentSeason || "T4";
    const parsed = parseFixtureText(text, { week: fallbackWeek(), temp: season }, season);
    const prev = new Map(ctx.fixture.map((m) => [matchKey(m), m]));
    ctx.fixture = parsed.map((m) => {
      const old = prev.get(matchKey(m));
      if (!old) return m;
      return { ...m, result: m.result || old.result, appliedResult: old.appliedResult };
    });
    shell.markDirty("fixture");
    render();
    toast(`Cargué ${parsed.length} partidos de ${fallbackWeek()}`, "ok");
    setMsg($("fx-msg"), `Cargué ${parsed.length} partidos. Revisá y publicá.`, "ok");
  }

  function bind() {
    $("fx-import-toggle")?.addEventListener("click", () => {
      const panel = $("fx-import-panel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      $("fx-import-toggle").setAttribute("aria-expanded", String(!panel.hidden));
    });

    $("fx-add")?.addEventListener("click", () => {
      ctx.fixture.push(
        cleanMatch(
          {
            week: fallbackWeek(),
            day: "Jueves",
            temp: ctx.siteData.currentSeason || "T4",
            cat: "A Masculina",
            time: "19:00 - 20:30",
            venue: "Open Padel",
            court: "Cancha 1",
            home: "",
            away: "",
            result: "",
          },
          {},
          ctx.siteData.currentSeason || "T4"
        )
      );
      shell.markDirty("fixture");
      render();
    });

    $("fx-body")?.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const i = Number(tr.dataset.i);
      const k = e.target.dataset.k;
      if (!k) return;
      ctx.fixture[i][k] = e.target.value;
      shell.markDirty("fixture");
      updateSummary();
    });

    $("fx-body")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-fx-del]");
      if (!btn) return;
      const ok = await confirmModal({
        title: "Eliminar partido",
        body: "Se quita del fixture local. Publicá para que impacte en la web.",
        confirmLabel: "Eliminar",
        danger: true,
      });
      if (!ok) return;
      ctx.fixture.splice(Number(btn.dataset.fxDel), 1);
      shell.markDirty("fixture");
      render();
    });

    $("fx-model")?.addEventListener("click", () => {
      downloadCsv("modelo-fixture.csv", FX_COLS, [
        {
          categoria: "A MASC",
          partido: "Apellido Nombre - Apellido Nombre vs Apellido Nombre - Apellido Nombre",
          complejo: "OPEN",
          cancha: "Cancha 1",
          dia: "Jueves",
          horario: "19:00 - 20:30",
        },
      ]);
      toast("Modelo CSV descargado", "ok");
    });
    $("fx-export")?.addEventListener("click", () => {
      const season = ctx.siteData.currentSeason || "T4";
      downloadCsv(
        "fixture-liga-fb.csv",
        FX_COLS,
        ctx.fixture.map((m) => driveRow(cleanMatch(m, {}, season)))
      );
      toast("Fixture exportado", "ok");
    });

    $("fx-csv")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        loadFixtureText(await file.text());
        $("fx-import-panel").hidden = true;
      } catch (err) {
        toast(err.message, "err");
        setMsg($("fx-msg"), err.message, "err");
      }
    });

    $("fx-paste-btn")?.addEventListener("click", () => {
      try {
        loadFixtureText($("fx-paste").value);
        $("fx-import-panel").hidden = true;
      } catch (err) {
        toast(err.message, "err");
        setMsg($("fx-msg"), err.message, "err");
      }
    });

    $("fx-week")?.addEventListener("change", () => shell.markDirty("fixture"));

    $("fx-publish")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const ok = await confirmModal({
        title: "Publicar fixture",
        body: "Se publica esta fecha. Las fechas que salgan del fixture quedan guardadas en Resultados, sin mezclar los scores. El sitio se actualiza en ~1 minuto.",
        confirmLabel: "Publicar fixture",
      });
      if (!ok) return;

      const season = ctx.siteData.currentSeason || "T4";
      const nextFixture = ctx.fixture.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
      setBusy($("fx-publish"), true, "Publicando…");
      setMsg($("fx-msg"), "Publicando fixture…");
      try {
        const remoteFixture = await api.readRemoteJson(FIXTURE_PATH, []);
        const remoteResults = await api.readRemoteJson(RESULTS_PATH, []);
        const newWeeks = new Set(nextFixture.map(weekKey));
        const toArchive = (Array.isArray(remoteFixture) ? remoteFixture : [])
          .map((m) => cleanMatch(m, {}, season))
          .filter((m) => (m.home || m.away) && !newWeeks.has(weekKey(m)));
        const nextResults = mergeArchivedMatches(
          (Array.isArray(remoteResults) ? remoteResults : []).map((m) => cleanMatch(m, {}, season)),
          toArchive
        );
        const archivedWeeks = [...new Set(toArchive.map((m) => m.week).filter(Boolean))];
        const liveWeek = [...new Set(nextFixture.map((m) => m.week).filter(Boolean))].join(", ") || fallbackWeek();
        await api.publishFiles(
          [
            { path: FIXTURE_PATH, content: JSON.stringify(nextFixture, null, 2) + "\n" },
            { path: RESULTS_PATH, content: JSON.stringify(nextResults, null, 2) + "\n" },
          ],
          archivedWeeks.length
            ? `Pasa ${archivedWeeks.join(", ")} a resultados y publica ${liveWeek}.`
            : "Actualiza fixture desde el admin."
        );
        ctx.fixture = nextFixture;
        ctx.results = nextResults;
        $("fx-week").value = nextFixture[0]?.week || $("fx-week").value;
        shell.clearDirty("fixture");
        onRankingChanged?.();
        render();
        const archived = archivedWeeks.length ? ` ${archivedWeeks.join(", ")} quedó en Resultados.` : "";
        const text = "Fixture publicado. El sitio se actualiza en ~1 minuto." + archived;
        setMsg($("fx-msg"), text, "ok");
        toast("Fixture publicado", "ok");
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("fx-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("fx-publish"), false);
      }
    });
  }

  return { bind, render, fallbackWeek };
}
