import { FIXTURE_PATH, FX_COLS, RESULTS_PATH } from "./constants.js";
import { cleanMatch, downloadCsv, driveRow, matchKey, parseFixtureText } from "./csv.js";
import { DISP_PATH } from "../lib/disponibilidad.js";
import { buildFixture } from "../lib/fixturer.js";
import { mergeArchivedMatches, weekKey } from "../lib/liga.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

const isPending = (m) => !!m.pending && !String(m.away || "").trim();

export function createFixture(ctx, api, shell, { onRankingChanged }) {
  let buildCount = 0;

  function fallbackWeek() {
    return $("fx-week")?.value.trim() || ctx.fixture[0]?.week || "Fecha 1";
  }

  function updateSummary() {
    const el = $("fx-summary");
    if (!el) return;
    const games = ctx.fixture.filter((m) => !isPending(m));
    const pending = ctx.fixture.length - games.length;
    const n = games.length;
    const cats = new Set(games.map((m) => m.cat).filter(Boolean));
    const weeks = [...new Set(ctx.fixture.map((m) => m.week).filter(Boolean))];
    el.textContent = ctx.fixture.length
      ? `${n} partido${n === 1 ? "" : "s"} · ${cats.size} categorí${cats.size === 1 ? "a" : "as"} · ${weeks.join(", ") || "sin semana"}` +
        (pending ? ` · ${pending} pendiente${pending === 1 ? "" : "s"}` : "")
      : "Sin partidos cargados";
  }

  function renderVenues() {
    const list = $("fx-venues");
    if (!list) return;
    const venues = (ctx.siteData.venues || []).filter((v) => v.liga !== false);
    list.innerHTML = venues.map((v) => `<option value="${escAttr(v.name)}"></option>`).join("");
  }

  function renderPending() {
    const box = $("fx-pending");
    if (!box) return;
    const pending = ctx.fixture.map((m, i) => ({ m, i })).filter(({ m }) => isPending(m));
    box.hidden = !pending.length;
    if (!pending.length) {
      box.innerHTML = "";
      return;
    }
    const cats = [...new Set(pending.map(({ m }) => m.cat || "Sin categoría"))];
    box.innerHTML = `<h3>Pendientes · ${pending.length}</h3>
      <p class="admin-help">No se pudieron cruzar por día y horario. Se publican como pendientes. Si arreglan otro horario, emparejalas acá.</p>
      ${cats
        .map((cat) => {
          const rows = pending.filter(({ m }) => (m.cat || "Sin categoría") === cat);
          return `<div class="fx-pending-cat">
            <h4>${escAttr(cat)}</h4>
            ${rows
              .map(({ m, i }) => {
                const others = rows.filter((o) => o.i !== i);
                return `<article class="fx-pending-card" data-i="${i}">
                  <strong>${escAttr(m.home)}</strong>
                  <span class="admin-help">${escAttr(m.reason || "Sin rival")}${m.avail ? ` · ${escAttr(m.avail)}` : ""}</span>
                  <div class="fx-pending-actions">
                    ${
                      others.length
                        ? `<select data-fx-pair="${i}" aria-label="Emparejar con">
                            <option value="">Emparejar con…</option>
                            ${others.map((o) => `<option value="${o.i}">${escAttr(o.m.home)}</option>`).join("")}
                          </select>`
                        : ""
                    }
                    <button class="btn btn-ghost" type="button" data-fx-del="${i}">Quitar</button>
                  </div>
                </article>`;
              })
              .join("")}
          </div>`;
        })
        .join("")}`;
  }

  function render() {
    updateSummary();
    renderVenues();
    renderPending();
    const games = ctx.fixture.map((m, i) => ({ m, i })).filter(({ m }) => !isPending(m));
    const empty = $("fx-empty");
    if (empty) empty.hidden = ctx.fixture.length > 0;
    $("fx-body").innerHTML = games
      .map(
        ({ m, i }) => `<tr data-i="${i}">
          <td><input data-k="week" value="${escAttr(m.week)}" /></td>
          <td><input data-k="day" value="${escAttr(m.day)}" placeholder="Jueves" /></td>
          <td><input data-k="time" value="${escAttr(m.time)}" placeholder="19:00 - 20:30" /></td>
          <td><input data-k="cat" value="${escAttr(m.cat)}" /></td>
          <td><input data-k="venue" value="${escAttr(m.venue)}" list="fx-venues" placeholder="Complejo" /></td>
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

  async function readDisp() {
    if (!ctx.token) return ctx.disp;
    const file = await api.api(`/repos/${ctx.owner}/${ctx.repo}/contents/${DISP_PATH}?ref=main`);
    ctx.disp = JSON.parse(api.fromB64(String(file.content || "").replace(/\n/g, "")));
    return ctx.disp;
  }

  async function buildFromFecha() {
    if ((await shell.setSection("fixture")) === false) return;
    const btn = $("fx-build");
    setBusy(btn, true, "Armando…");
    try {
      const disp = await readDisp();
      const season = ctx.siteData.currentSeason || "T4";
      const temp = disp.temp || season;
      const week = String(disp.week || fallbackWeek()).trim();
      const entries = disp.entries || [];
      if (!entries.some((e) => !e.bye)) {
        setMsg($("fx-msg"), `No hay parejas anotadas para jugar en ${week}.`, "err");
        toast("No hay inscripciones para armar", "err");
        return;
      }
      if (temp !== season) {
        setMsg($("fx-msg"), `La fecha anotada es de ${temp} y la temporada en juego es ${season}. Abrí una fecha nueva en Fecha.`, "err");
        return;
      }
      const warnings = [];
      if (disp.open !== false) warnings.push("La carga de la fecha sigue abierta: si alguien se anota después, va a faltar en el fixture.");
      const unsaved = ctx.fixture.filter((m) => String(m.result || "").trim() !== String(m.appliedResult || "").trim());
      if (unsaved.length) {
        setMsg($("fx-msg"), `Hay ${unsaved.length} resultado${unsaved.length === 1 ? "" : "s"} sin publicar. Publicalos en Resultados antes de armar la fecha nueva.`, "err");
        return;
      }
      const replacing = ctx.fixture.filter((m) => m.week === week);
      if (replacing.some((m) => String(m.result || m.appliedResult || "").trim())) {
        setMsg($("fx-msg"), `${week} ya tiene resultados cargados. No la rearmo para no perder puntos.`, "err");
        return;
      }
      if (replacing.length) warnings.push(`Se reemplazan los ${replacing.length} partidos de ${week} que ves en pantalla.`);
      const ok = await confirmModal({
        title: `Armar ${week}`,
        body:
          `Armo los cruces con ${entries.filter((e) => !e.bye).length} parejas anotadas. ` +
          (warnings.length ? warnings.join(" ") + " " : "") +
          "Nada se publica hasta que toques Publicar fixture.",
        confirmLabel: "Armar fixture",
      });
      if (!ok) return;

      const history = [...ctx.results, ...ctx.fixture].filter((m) => m.temp === temp && m.week !== week && m.home && m.away);
      buildCount += 1;
      const out = buildFixture({ entries, ranking: ctx.rows, history, week, temp, seed: buildCount });
      const matches = out.matches.map((m) => cleanMatch(m, {}, season));
      const pending = out.pending.map((p) =>
        cleanMatch(
          {
            week,
            temp,
            cat: p.cat,
            home: p.home,
            away: "",
            pending: true,
            reason: p.reason,
            avail: Object.entries(p.days || {})
              .map(([d, h]) => `${d} ${h}`)
              .join(" · "),
          },
          {},
          season
        )
      );
      ctx.fixture = [...matches, ...pending];
      $("fx-week").value = week;
      shell.markDirty("fixture");
      render();
      const rematches = out.matches.filter((m) => m.rematch).length;
      const parts = [
        `${matches.length} partido${matches.length === 1 ? "" : "s"}`,
        pending.length ? `${pending.length} pendiente${pending.length === 1 ? "" : "s"}` : "sin pendientes",
      ];
      if (out.byes.length) parts.push(`${out.byes.length} no juega${out.byes.length === 1 ? "" : "n"}`);
      if (rematches) parts.push(`${rematches} repite rival (no había otra opción)`);
      setMsg($("fx-msg"), `${week} armada: ${parts.join(" · ")}. Completá complejo y cancha, revisá y publicá.`, "ok");
      toast(`${week} armada`, "ok");
    } catch (err) {
      setMsg($("fx-msg"), err.message, "err");
      toast(err.message, "err");
    } finally {
      setBusy(btn, false);
    }
  }

  function bind() {
    $("fx-import-toggle")?.addEventListener("click", () => {
      const panel = $("fx-import-panel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      $("fx-import-toggle").setAttribute("aria-expanded", String(!panel.hidden));
    });

    $("fx-build")?.addEventListener("click", buildFromFecha);

    $("fx-add")?.addEventListener("click", () => {
      ctx.fixture.push(
        cleanMatch(
          {
            week: fallbackWeek(),
            day: "Jueves",
            temp: ctx.siteData.currentSeason || "T4",
            cat: "A Masculina",
            time: "19:00 - 20:30",
            venue: "",
            court: "",
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

    $("fx-pending")?.addEventListener("change", (e) => {
      const sel = e.target.closest("[data-fx-pair]");
      if (!sel || sel.value === "") return;
      const a = ctx.fixture[Number(sel.dataset.fxPair)];
      const b = ctx.fixture[Number(sel.value)];
      if (!a || !b) return;
      const match = cleanMatch(
        { week: a.week, temp: a.temp, cat: a.cat, day: "", time: "", venue: "", court: "", home: a.home, away: b.home, result: "" },
        {},
        ctx.siteData.currentSeason || "T4"
      );
      ctx.fixture = ctx.fixture.filter((m) => m !== a && m !== b).concat(match);
      shell.markDirty("fixture");
      render();
      toast("Partido creado. Completá día y horario en la tabla.", "ok");
    });

    const onDelete = async (e) => {
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
    };
    $("fx-body")?.addEventListener("click", onDelete);
    $("fx-pending")?.addEventListener("click", onDelete);

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
        ctx.fixture.filter((m) => !isPending(m)).map((m) => driveRow(cleanMatch(m, {}, season)))
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
      const season = ctx.siteData.currentSeason || "T4";
      const nextFixture = ctx.fixture.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
      const incomplete = nextFixture.filter((m) => !m.pending && (!m.home || !m.away || !m.day || !m.time));
      const ok = await confirmModal({
        title: "Publicar fixture",
        body:
          (incomplete.length
            ? `Ojo: ${incomplete.length} partido${incomplete.length === 1 ? "" : "s"} sin pareja, día u horario. `
            : "") +
          "Se publica esta fecha. Las fechas que salgan del fixture quedan guardadas en Resultados, sin mezclar los scores. El sitio se actualiza en ~1 minuto.",
        confirmLabel: "Publicar fixture",
        danger: incomplete.length > 0,
      });
      if (!ok) return;

      setBusy($("fx-publish"), true, "Publicando…");
      setMsg($("fx-msg"), "Publicando fixture…");
      try {
        const remoteFixture = await api.readRemoteJson(FIXTURE_PATH, []);
        const remoteResults = await api.readRemoteJson(RESULTS_PATH, []);
        const newWeeks = new Set(nextFixture.map(weekKey));
        const toArchive = (Array.isArray(remoteFixture) ? remoteFixture : [])
          .map((m) => cleanMatch(m, {}, season))
          .filter((m) => m.home && m.away && !newWeeks.has(weekKey(m)));
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
        ctx.fixturePublished = structuredClone(nextFixture);
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

  return { bind, render, fallbackWeek, buildFromFecha };
}
