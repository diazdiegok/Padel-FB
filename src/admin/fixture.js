import { FIXTURE_PATH, PAIRS_PATH, RESULTS_PATH } from "./constants.js";
import { cleanMatch } from "./csv.js";
import { validateDays } from "../lib/disponibilidad.js";
import { buildFixture } from "../lib/fixturer.js";
import { latestWeek, listSeasons, mergeArchivedMatches, seasonLabel, weekKey, weekNumber } from "../lib/liga.js";
import { pairsMatch } from "../lib/scoring.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

const isPending = (m) => !!m.pending && !String(m.away || "").trim();

export function createFixture(ctx, api, shell, { onRankingChanged }) {
  let buildCount = 0;
  let editing = -1;
  let focusEdit = false;
  let filterTemp = "";
  let filterWeek = "";

  function fallbackWeek() {
    return filterWeek || $("fx-week")?.value.trim() || latestWeek(ctx.fixture) || "Fecha 1";
  }

  function syncWeek() {
    const latest = latestWeek(ctx.fixture);
    if (latest) {
      filterWeek = latest;
      if ($("fx-week")) $("fx-week").value = latest;
      const liveTemp = (ctx.fixture || []).find((m) => (m.week || "") === latest)?.temp;
      if (liveTemp) filterTemp = liveTemp;
      else if (!filterTemp) filterTemp = ctx.siteData.currentSeason || "";
    }
    return fallbackWeek();
  }

  function seasonOf(m) {
    return m.temp || ctx.siteData.currentSeason || "T4";
  }

  function temps() {
    const extra = [...(ctx.results || []), ...(ctx.fixture || [])].map(seasonOf);
    return listSeasons(ctx.siteData, extra).slice().reverse();
  }

  function seasonPool(temp) {
    return [...(ctx.results || []), ...(ctx.fixture || [])].filter((m) => seasonOf(m) === temp);
  }

  function weeksOf(temp) {
    return [...new Set(seasonPool(temp).map((m) => m.week || "Sin fecha"))].sort(
      (a, b) => weekNumber(a) - weekNumber(b) || String(a).localeCompare(String(b), "es")
    );
  }

  function isLiveWeek(temp, week) {
    return (ctx.fixture || []).some((m) => seasonOf(m) === temp && (m.week || "") === week);
  }

  function weekStats(temp, week) {
    const live = (ctx.fixture || []).filter((m) => seasonOf(m) === temp && (m.week || "") === week);
    const arch = (ctx.results || []).filter((m) => seasonOf(m) === temp && (m.week || "") === week);
    const games = (live.length ? live : arch).filter((m) => !isPending(m) && m.home && m.away);
    const pending = live.filter(isPending).length;
    return { games, pending, live: live.length > 0, n: games.length };
  }

  function updateSummary() {
    const el = $("fx-summary");
    if (!el) return;
    if (!filterTemp) {
      el.textContent = `${temps().length} temporada${temps().length === 1 ? "" : "s"}`;
      return;
    }
    if (!filterWeek) {
      const weeks = weeksOf(filterTemp);
      el.textContent = `${seasonLabel(filterTemp)} · ${weeks.length} fecha${weeks.length === 1 ? "" : "s"}`;
      return;
    }
    const st = weekStats(filterTemp, filterWeek);
    el.textContent = st.n || st.pending
      ? `${st.n} partido${st.n === 1 ? "" : "s"} · ${filterWeek}` +
        (st.pending ? ` · ${st.pending} pendiente${st.pending === 1 ? "" : "s"}` : "") +
        (st.live ? "" : " · archivo")
      : `Sin partidos en ${filterWeek}`;
  }

  function renderVenues() {
    const list = $("fx-venues");
    if (!list) return;
    const venues = (ctx.siteData.venues || []).filter((v) => v.liga !== false);
    list.innerHTML = venues.map((v) => `<option value="${escAttr(v.name)}"></option>`).join("");
  }

  function previousMeetings(m) {
    if (!m.home || !m.away) return [];
    const played = [...(ctx.results || []), ...(ctx.fixturePublished || [])].filter(
      (p) => p.home && p.away && p.temp === m.temp && p.cat === m.cat && p.week !== m.week
    );
    const weeks = played
      .filter((p) => (pairsMatch(p.home, m.home) && pairsMatch(p.away, m.away)) || (pairsMatch(p.home, m.away) && pairsMatch(p.away, m.home)))
      .map((p) => p.week + (p.result ? ` (${p.result})` : ""));
    return [...new Set(weeks)].sort((a, b) => weekNumber(a) - weekNumber(b));
  }

  function renderWarnings(games) {
    const box = $("fx-warnings");
    if (!box) return new Set();
    const list = games.map(({ m, i }) => ({ m, i, weeks: previousMeetings(m) })).filter((x) => x.weeks.length);
    box.hidden = !list.length;
    box.innerHTML = list.length
      ? `<h3>Revisar · ${list.length} cruce${list.length === 1 ? "" : "s"} repetido${list.length === 1 ? "" : "s"}</h3>
        <p class="admin-help">Estas parejas ya se enfrentaron en esta temporada. El fixtureador lo evita cuando hay otra opción; si está bien así, podés publicar igual.</p>
        <ul>${list
          .map(
            ({ m, weeks }) =>
              `<li><strong>${escAttr(m.home)}</strong> vs <strong>${escAttr(m.away)}</strong> <span>${escAttr(m.cat)} · ya jugaron en ${escAttr(weeks.join(", "))}</span></li>`
          )
          .join("")}</ul>`
      : "";
    return new Set(list.map((x) => x.i));
  }

  function renderPending() {
    const box = $("fx-pending");
    if (!box) return;
    const pending = ctx.fixture
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => isPending(m) && seasonOf(m) === filterTemp && (m.week || "") === filterWeek);
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
                  <span class="admin-help">${escAttr(m.reason || "Sin rival")}${m.avail ? ` · ${escAttr(m.avail)}` : ""}${m.note ? ` · ${escAttr(m.note)}` : ""}</span>
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

  function renderTable() {
    const live = isLiveWeek(filterTemp, filterWeek);
    const detail = $("fx-detail");
    if (detail) detail.hidden = false;
    const build = $("fx-build");
    const add = $("fx-add");
    const bar = $("fx-publish")?.closest(".admin-sticky-bar");
    if (build) build.hidden = !live;
    if (add) add.hidden = !live;
    if (bar) bar.hidden = !live;

    if (!live) {
      const arch = (ctx.results || []).filter((m) => seasonOf(m) === filterTemp && (m.week || "") === filterWeek && m.home && m.away);
      const empty = $("fx-empty");
      if (empty) {
        empty.hidden = arch.length > 0;
        empty.querySelector("p").textContent = "Esta fecha ya pasó a Resultados. Los scores se cargan ahí.";
      }
      $("fx-warnings").hidden = true;
      $("fx-pending").hidden = true;
      $("fx-body").innerHTML = arch
        .map(
          (m) => `<tr>
          <td>${escAttr(m.day || "—")}</td>
          <td>${escAttr(m.time || "—")}</td>
          <td>${escAttr(m.cat || "—")}</td>
          <td>${escAttr(m.venue || "—")}</td>
          <td>${escAttr(m.court || "—")}</td>
          <td>${escAttr(m.home)}</td>
          <td>${escAttr(m.away)}</td>
          <td class="col-actions"><span class="admin-chip-arch">${escAttr(m.result || "Sin score")}</span></td>
        </tr>`
        )
        .join("");
      return;
    }

    renderPending();
    const games = ctx.fixture.map((m, i) => ({ m, i })).filter(({ m }) => !isPending(m) && seasonOf(m) === filterTemp && (m.week || "") === filterWeek);
    const repeated = renderWarnings(games) || new Set();
    const empty = $("fx-empty");
    if (empty) {
      empty.hidden = games.length > 0 || ctx.fixture.some((m) => isPending(m) && (m.week || "") === filterWeek);
      empty.querySelector("p").textContent = "Todavía no hay partidos. Usá Armar fixture o + Partido.";
    }
    $("fx-body").innerHTML = games
      .map(({ m, i }) => {
        const on = editing === i;
        const field = (k, placeholder) =>
          on
            ? `<input data-k="${k}" value="${escAttr(m[k])}" placeholder="${placeholder}"${k === "venue" ? ' list="fx-venues"' : ""} />`
            : escAttr(m[k]);
        return `<tr data-i="${i}"${repeated.has(i) ? ' class="is-rematch" title="Ya se enfrentaron en esta temporada"' : ""}>
          <td>${field("day", "Jueves")}</td>
          <td>${field("time", "19:00 - 20:30")}</td>
          <td>${field("cat", "A Masculina")}</td>
          <td>${field("venue", "Complejo")}</td>
          <td>${field("court", "Cancha 1")}</td>
          <td>${field("home", "Pareja 1")}</td>
          <td>${field("away", "Pareja 2")}</td>
          <td class="col-actions">
            <button class="admin-del admin-edit${on ? " on" : ""}" type="button" data-fx-edit="${i}" aria-label="${on ? "Cerrar edición" : "Editar"}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5V20h3.5L18.8 8.7l-3.5-3.5L4 16.5zm15.7-9.2a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.1 1.1 3.5 3.5 1.6-1.6z"/></svg>
            </button>
            <button class="admin-del" type="button" data-fx-del="${i}" aria-label="Eliminar">×</button>
          </td>
        </tr>`;
      })
      .join("");
    if (focusEdit && editing >= 0) {
      focusEdit = false;
      $("fx-body")?.querySelector(`tr[data-i="${editing}"] input`)?.focus();
    }
  }

  function render() {
    updateSummary();
    renderVenues();
    const root = $("fx-boxes");
    const detail = $("fx-detail");
    if (!root) return;
    const tlist = temps();
    const current = ctx.siteData.currentSeason;

    if (!filterTemp) {
      if (detail) detail.hidden = true;
      root.className = "res-boxes hub-like";
      root.innerHTML = tlist
        .map((temp) => {
          const weeks = weeksOf(temp);
          const live = temp === current;
          return `<button class="res-box hub-season" type="button" data-fx-open-temp="${escAttr(temp)}">
            <span class="kicker">Temporada${live ? " · En juego" : ""}</span>
            <strong>${escAttr(seasonLabel(temp))}</strong>
            <p>${weeks.length} fecha${weeks.length === 1 ? "" : "s"}</p>
          </button>`;
        })
        .join("");
      return;
    }

    if (!filterWeek) {
      if (detail) detail.hidden = true;
      root.className = "res-boxes stack";
      const weeks = weeksOf(filterTemp);
      const live = filterTemp === current;
      const next = nextBuildWeek(filterTemp);
      root.innerHTML = `<article class="season-box open">
        <div class="season-box-head">
          <button class="season-back" type="button" data-fx-back-temp>← Temporadas</button>
          <span class="kicker">Temporada${live ? " · En juego" : ""}</span>
          <strong>${escAttr(seasonLabel(filterTemp))}</strong>
          <p>${weeks.length} fecha${weeks.length === 1 ? "" : "s"}</p>
        </div>
        <div class="season-box-body">
          <div class="res-inner-grid">
            ${weeks
              .map((week) => {
                const st = weekStats(filterTemp, week);
                return `<button class="res-box" type="button" data-fx-open-week="${escAttr(week)}" style="min-height:96px">
                  <span class="kicker">Fecha</span>
                  <strong>${escAttr(week)}</strong>
                  <p>${st.n} partido${st.n === 1 ? "" : "s"}${st.live ? " · en juego" : " · archivo"}</p>
                  ${st.live ? `<span class="admin-chip-live">En juego</span>` : `<span class="admin-chip-arch">Archivo</span>`}
                </button>`;
              })
              .join("")}
            <button class="res-box" type="button" data-fx-arm-next style="min-height:96px;border-style:dashed">
              <span class="kicker">Nueva</span>
              <strong>${escAttr(next)}</strong>
              <p>Armar siguiente fecha</p>
            </button>
          </div>
        </div>
      </article>`;
      return;
    }

    // Nivel 3: partidos de la fecha (dentro de la temporada)
    root.className = "res-boxes stack";
    const live = filterTemp === current;
    const st = weekStats(filterTemp, filterWeek);
    root.innerHTML = `<article class="season-box open">
      <div class="season-box-head">
        <button class="season-back" type="button" data-fx-back-week>← Fechas</button>
        <span class="kicker">${escAttr(seasonLabel(filterTemp))}${live ? " · En juego" : ""}</span>
        <strong>${escAttr(filterWeek)}</strong>
        <p>${st.n} partido${st.n === 1 ? "" : "s"}${st.live ? "" : " · archivo en Resultados"}</p>
      </div>
    </article>`;
    if ($("fx-week")) $("fx-week").value = filterWeek;
    renderTable();
  }

  function seasonMatches(season) {
    return [...(ctx.results || []), ...(ctx.fixturePublished || []), ...(ctx.fixture || [])].filter(
      (m) => String(m.temp || "").toUpperCase() === String(season).toUpperCase()
    );
  }

  function nextBuildWeek(season) {
    const all = seasonMatches(season);
    const max = all.reduce((n, m) => Math.max(n, weekNumber(m.week)), 0);
    if (!max) return "Fecha 1";
    const label = `Fecha ${max}`;
    const inDraft = (ctx.fixture || []).filter((m) => m.week === label && String(m.temp || "").toUpperCase() === String(season).toUpperCase());
    const hasResults =
      inDraft.some((m) => String(m.result || m.appliedResult || "").trim()) ||
      (ctx.results || []).some(
        (m) => m.week === label && String(m.temp || "").toUpperCase() === String(season).toUpperCase() && String(m.result || "").trim()
      ) ||
      (ctx.fixturePublished || []).some(
        (m) =>
          m.week === label &&
          String(m.temp || "").toUpperCase() === String(season).toUpperCase() &&
          String(m.appliedResult || m.result || "").trim()
      );
    if (inDraft.length && !hasResults) return label;
    return `Fecha ${max + 1}`;
  }

  function pairEntries(season) {
    return (ctx.pairs || [])
      .filter((p) => String(p.temp || "").toUpperCase() === String(season).toUpperCase() && p.p1 && p.p2 && p.cat)
      .map((p) => {
        const days = p.days && typeof p.days === "object" ? p.days : {};
        const valid = !validateDays(days);
        return {
          p1: p.p1,
          p2: p.p2,
          cat: p.cat,
          days: valid ? days : {},
          note: p.note || "",
          bye: !valid,
          recover: false,
        };
      });
  }

  async function buildFromFecha() {
    if ((await shell.setSection("fixture")) === false) return;
    const btn = $("fx-build");
    setBusy(btn, true, "Armando…");
    try {
      if (!ctx.dirty.has("parejas")) {
        try {
          const remote = await api.readRemoteJson(PAIRS_PATH, []);
          if (Array.isArray(remote)) ctx.pairs = remote;
        } catch {
          /* se usan las parejas ya cargadas en el admin */
        }
      }
      const season = filterTemp || ctx.siteData.currentSeason || "T4";
      const temp = season;
      const week = nextBuildWeek(season);
      const entries = pairEntries(season);
      const playable = entries.filter((e) => !e.bye);
      if (!playable.length) {
        setMsg($("fx-msg"), "No hay parejas inscriptas con disponibilidad válida para armar el fixture.", "err");
        toast("No hay inscripciones para armar", "err");
        return;
      }
      const warnings = [];
      const withoutDays = entries.filter((e) => e.bye).length;
      if (withoutDays) warnings.push(`${withoutDays} pareja${withoutDays === 1 ? "" : "s"} sin disponibilidad quedan afuera.`);
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
          `Se arma ${week} (${seasonLabel(season)}) con ${playable.length} pareja${playable.length === 1 ? "" : "s"} inscriptas. ` +
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
            note: p.note || "",
          },
          {},
          season
        )
      );
      ctx.fixture = [...matches, ...pending];
      filterTemp = season;
      filterWeek = week;
      if ($("fx-week")) $("fx-week").value = week;
      shell.markDirty("fixture");
      render();
      const rematches = out.matches.filter((m) => m.rematch).length;
      const parts = [
        `${matches.length} partido${matches.length === 1 ? "" : "s"}`,
        pending.length ? `${pending.length} pendiente${pending.length === 1 ? "" : "s"}` : "sin pendientes",
      ];
      if (out.byes.length) parts.push(`${out.byes.length} sin disponibilidad`);
      if (rematches) parts.push(`${rematches} repite rival, mirá el aviso Revisar`);
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
    $("fx-boxes")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-fx-back-temp]")) {
        filterTemp = "";
        filterWeek = "";
        editing = -1;
        render();
        return;
      }
      if (e.target.closest("[data-fx-back-week]")) {
        filterWeek = "";
        editing = -1;
        render();
        return;
      }
      const openTemp = e.target.closest("[data-fx-open-temp]");
      if (openTemp) {
        filterTemp = openTemp.dataset.fxOpenTemp;
        filterWeek = "";
        editing = -1;
        render();
        return;
      }
      const openWeek = e.target.closest("[data-fx-open-week]");
      if (openWeek) {
        filterWeek = openWeek.dataset.fxOpenWeek;
        editing = -1;
        render();
        return;
      }
      if (e.target.closest("[data-fx-arm-next]")) {
        buildFromFecha();
      }
    });

    $("fx-build")?.addEventListener("click", buildFromFecha);

    $("fx-add")?.addEventListener("click", () => {
      if (!filterTemp || !filterWeek) return;
      ctx.fixture.push(
        cleanMatch(
          {
            week: filterWeek,
            day: "Jueves",
            temp: filterTemp,
            cat: "A Masculina",
            time: "19:00 - 20:30",
            venue: "",
            court: "",
            home: "",
            away: "",
            result: "",
          },
          {},
          filterTemp
        )
      );
      editing = ctx.fixture.length - 1;
      focusEdit = true;
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
      if (["home", "away", "cat"].includes(k)) {
        render();
        $("fx-body")?.querySelector(`tr[data-i="${i}"] input[data-k="${k}"]`)?.focus();
      } else updateSummary();
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
        filterTemp || ctx.siteData.currentSeason || "T4"
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

    $("fx-body")?.addEventListener("click", (e) => {
      const edit = e.target.closest("[data-fx-edit]");
      if (!edit) return;
      const i = Number(edit.dataset.fxEdit);
      editing = editing === i ? -1 : i;
      focusEdit = editing >= 0;
      render();
    });

    $("fx-publish")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const season = filterTemp || ctx.siteData.currentSeason || "T4";
      const nextFixture = ctx.fixture.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
      const incomplete = nextFixture.filter((m) => !m.pending && (!m.home || !m.away || !m.day || !m.time));
      const repeated = nextFixture.filter((m) => previousMeetings(m).length).length;
      const ok = await confirmModal({
        title: "Publicar fixture",
        body:
          (incomplete.length
            ? `Ojo: ${incomplete.length} partido${incomplete.length === 1 ? "" : "s"} sin pareja, día u horario. `
            : "") +
          (repeated ? `${repeated} cruce${repeated === 1 ? "" : "s"} ya se jugó en esta temporada (ver Revisar). ` : "") +
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
        filterWeek = latestWeek(nextFixture) || filterWeek;
        if ($("fx-week")) $("fx-week").value = filterWeek;
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

  return { bind, render, fallbackWeek, syncWeek, buildFromFecha };
}
