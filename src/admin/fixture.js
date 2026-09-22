import { FIXTURE_PATH, FX_COLS, RANK_PATH, RESULTS_PATH } from "./constants.js";
import { cleanMatch, cleanRow, downloadCsv, driveRow, matchKey, parseFixtureText } from "./csv.js";
import { applyFixtureResults, describeResult } from "../lib/scoring.js";
import { mergeArchivedMatches, weekKey } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createFixture(ctx, api, shell, { onRankingChanged }) {
  function fallbackWeek() {
    return $("fx-week")?.value.trim() || ctx.fixture[0]?.week || "Fecha 5";
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
      .map((m, i) => {
        const parsed = describeResult(m.result);
        const hint = parsed ? `${parsed.label} · ${parsed.homePts}-${parsed.awayPts} pts` : "";
        return `<tr data-i="${i}">
          <td><input data-k="week" value="${escAttr(m.week)}" /></td>
          <td><input data-k="day" value="${escAttr(m.day)}" placeholder="Jueves" /></td>
          <td><input data-k="time" value="${escAttr(m.time)}" placeholder="19:00 - 20:30" /></td>
          <td><input data-k="cat" value="${escAttr(m.cat)}" /></td>
          <td><input data-k="venue" value="${escAttr(m.venue)}" /></td>
          <td><input data-k="court" value="${escAttr(m.court)}" placeholder="Cancha 1" /></td>
          <td><input data-k="home" value="${escAttr(m.home)}" /></td>
          <td><input data-k="away" value="${escAttr(m.away)}" /></td>
          <td class="col-result">
            <input data-k="result" value="${escAttr(m.result)}" placeholder="6-4 6-2" />
            ${hint ? `<small class="admin-hint">${hint}</small>` : ""}
          </td>
          <td><button class="admin-del" type="button" data-fx-del="${i}" aria-label="Eliminar">×</button></td>
        </tr>`;
      })
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
      if (k === "result") {
        const td = e.target.closest("td");
        const parsed = describeResult(e.target.value);
        let hint = td.querySelector(".admin-hint");
        if (parsed) {
          if (!hint) {
            hint = document.createElement("small");
            hint.className = "admin-hint";
            td.appendChild(hint);
          }
          hint.textContent = `${parsed.label} · ${parsed.homePts}-${parsed.awayPts} pts`;
        } else if (hint) hint.remove();
      }
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
        body: "Las fechas que no estén en este fixture pasan a Resultados. Los scores cargados actualizan el ranking. El sitio se actualiza en ~1 minuto.",
        confirmLabel: "Publicar fixture",
      });
      if (!ok) return;

      const season = ctx.siteData.currentSeason || "T4";
      const nextFixture = ctx.fixture.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
      const nextRanking = structuredClone(ctx.rows)
        .map((r) => cleanRow(r, season))
        .filter((r) => r.name && r.cat.toLowerCase() !== "s masculina");
      setBusy($("fx-publish"), true, "Publicando…");
      setMsg($("fx-msg"), "Publicando fixture y ranking…");
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
        const reportOld = applyFixtureResults(nextRanking, toArchive);
        const report = applyFixtureResults(nextRanking, nextFixture);
        report.applied += reportOld.applied;
        report.unmatched.push(...reportOld.unmatched);
        report.created.push(...reportOld.created);
        const archivedWeeks = [...new Set(toArchive.map((m) => m.week).filter(Boolean))];
        const liveWeek = [...new Set(nextFixture.map((m) => m.week).filter(Boolean))].join(", ") || fallbackWeek();
        await api.publishFiles(
          [
            { path: FIXTURE_PATH, content: JSON.stringify(nextFixture, null, 2) + "\n" },
            { path: RESULTS_PATH, content: JSON.stringify(nextResults, null, 2) + "\n" },
            { path: RANK_PATH, content: JSON.stringify(nextRanking, null, 2) + "\n" },
          ],
          archivedWeeks.length
            ? `Pasa ${archivedWeeks.join(", ")} a resultados y publica ${liveWeek}.`
            : report.applied
              ? `Carga resultados del fixture y actualiza el ranking (${report.applied}).`
              : "Actualiza fixture desde el admin."
        );
        ctx.fixture = nextFixture;
        ctx.rows = nextRanking;
        ctx.results = nextResults;
        $("fx-week").value = nextFixture[0]?.week || $("fx-week").value;
        shell.clearDirty("fixture");
        shell.clearDirty("ranking");
        onRankingChanged?.();
        render();
        const extra = report.created.length ? ` Altas: ${[...new Set(report.created)].join(" · ")}.` : "";
        const warn = report.unmatched.length ? ` ${report.unmatched[0]}` : "";
        const archived = archivedWeeks.length ? ` ${archivedWeeks.join(", ")} quedó en Resultados.` : "";
        const text =
          (report.applied
            ? `Fixture y ranking publicados. ${report.applied} resultado${report.applied === 1 ? "" : "s"} sumados.${extra}`
            : "Fixture publicado. El sitio se actualiza en ~1 minuto.") +
          archived +
          warn;
        setMsg($("fx-msg"), text, report.unmatched.length ? "err" : "ok");
        toast(report.unmatched.length ? "Publicado con avisos" : "Fixture publicado", report.unmatched.length ? "err" : "ok");
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
