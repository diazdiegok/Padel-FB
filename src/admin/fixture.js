import { FIXTURE_PATH, FIXTURE_PENDING_PATH, PAIRS_PATH, RESULTS_PATH } from "./constants.js";
import {
  FX_EXPORT_COLS,
  cleanMatch,
  downloadXlsx,
  fixtureExportRows,
  courtSlotObjectsFromText,
  parseCourtSlotObjects,
  parseCourtSlotText,
  sortMatchesForExport,
} from "./csv.js";
import { DAYS, pairLabel, validateDays } from "../lib/disponibilidad.js";
import {
  MAX_PAIR_MATCHES,
  PENDING_AWAY,
  buildFixture,
  countPairMatches,
  coverCandidates,
  isPendingMatch,
  isRealPairMatch,
} from "../lib/fixturer.js";
import { latestWeek, listSeasons, mergeArchivedMatches, seasonLabel, weekKey, weekNumber } from "../lib/liga.js";
import { pairsMatch } from "../lib/scoring.js";
import { courtsSheetIdForSeason } from "../lib/sheets.js";
import { applyVenuePlan, driveCourtOptions, isCourtTaken, missingCourtHorarios, parkBareMatchesAsPending, rematchForCourts, summarizeCourtSlots, weekFromName } from "../lib/slots.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

const isPending = (m) => isPendingMatch(m);

/** Orden de tabla: Lunes→Sábado, luego horario de inicio, luego complejo/cancha. */
function timeStartMinutes(time) {
  const m = String(time || "").match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (!m) return 99 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function compareByDayTime(a, b) {
  const da = DAYS.indexOf(a?.day);
  const db = DAYS.indexOf(b?.day);
  return (
    (da < 0 ? 99 : da) - (db < 0 ? 99 : db) ||
    timeStartMinutes(a?.time) - timeStartMinutes(b?.time) ||
    String(a?.venue || "").localeCompare(String(b?.venue || ""), "es") ||
    String(a?.court || "").localeCompare(String(b?.court || ""), "es") ||
    String(a?.cat || "").localeCompare(String(b?.cat || ""), "es")
  );
}

const BALL_SVG = `<svg class="ball-check-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#c8f542"/><path d="M4.2 8.5c2.8 1 5.2 1.2 7.8 0M12 4.2c1.2 2.6 1.4 5.2.2 7.8M12 12c2.6 1.2 5.2 1.4 7.8.2M11.8 12.2c1 2.8 1.2 5.2 0 7.8" stroke="#1a3a0a" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;

export function createFixture(ctx, api, shell, { onRankingChanged }) {
  let buildCount = 0;
  let editing = -1;
  let focusEdit = false;
  let filterTemp = "";
  let filterWeek = "";
  /** @type {any[]} */
  let loadedSlots = [];
  let slotsFileName = "";
  let advancedOpen = false;
  /** Índice de pendiente → pareja elegida en «Cubrir con» (aún sin confirmar cancha). */
  const coverDraft = new Map();

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
    if ((ctx.fixture || []).some((m) => seasonOf(m) === temp && (m.week || "") === week)) return true;
    const archived = (ctx.results || []).some(
      (m) => seasonOf(m) === temp && (m.week || "") === week && isRealPairMatch(m)
    );
    if (archived) return false;
    // Fecha nueva sin partidos todavía: editable en la temporada actual.
    return temp === (ctx.siteData.currentSeason || temp);
  }

  function matchPools() {
    return [ctx.results || [], ctx.fixturePublished || [], ctx.fixture || []];
  }

  function weekStats(temp, week) {
    const live = (ctx.fixture || []).filter((m) => seasonOf(m) === temp && (m.week || "") === week);
    const arch = (ctx.results || []).filter((m) => seasonOf(m) === temp && (m.week || "") === week);
    const games = (live.length ? live : arch).filter((m) => !isPending(m) && isRealPairMatch(m));
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

  function needsCourt(m) {
    return !String(m?.venue || "").trim() || !String(m?.court || "").trim();
  }

  function daysOfPair(label, cat) {
    const season = String(filterTemp || "").toUpperCase();
    const found = (ctx.pairs || []).find((p) => {
      if (String(p.temp || "").toUpperCase() !== season) return false;
      if (cat && p.cat && p.cat !== cat) return false;
      return pairsMatch(pairLabel(p), label);
    });
    const days = found?.days;
    if (!days || typeof days !== "object" || !Object.keys(days).length) return undefined;
    return days;
  }

  function takenCourts(exclude) {
    return (ctx.fixture || []).filter((other) => {
      if (other === exclude) return false;
      if (seasonOf(other) !== filterTemp || (other.week || "") !== filterWeek) return false;
      return String(other.venue || "").trim() && String(other.court || "").trim();
    });
  }

  /** Canchas del Drive donde puedan jugar ambas, sin el tope de «Partidos a usar». */
  function courtChoicesFor(match) {
    return driveCourtOptions(
      {
        ...match,
        homeDays: match.homeDays || daysOfPair(match.home, match.cat),
        awayDays: match.awayDays || daysOfPair(match.away, match.cat),
      },
      loadedSlots,
      takenCourts(match)
    );
  }

  /**
   * Todos los turnos libres del Drive (cualquier día/horario/cancha) donde
   * el pendiente y la pareja que cubre puedan jugar ambas.
   */
  function coverCourtChoices(match, coverLabel) {
    const cover = String(coverLabel || "").trim();
    if (!cover) return { opts: [], homeDays: null, coverDays: null };
    const homeDays = match.homeDays || match.days || daysOfPair(match.home, match.cat);
    const coverDays = daysOfPair(cover, match.cat);
    if (!homeDays || !coverDays) {
      return { opts: [], homeDays: homeDays || null, coverDays: coverDays || null };
    }
    const opts = driveCourtOptions(
      {
        week: match.week,
        temp: match.temp,
        cat: match.cat,
        home: match.home,
        away: cover,
        pending: false,
        day: "",
        time: "",
        venue: "",
        court: "",
        homeDays,
        awayDays: coverDays,
      },
      loadedSlots,
      takenCourts(match)
    );
    return { opts, homeDays, coverDays };
  }

  function coverSlotSelect(i, match, coverLabel) {
    const label = "Elegir día, complejo y cancha";
    if (!loadedSlots.length) {
      return `<select disabled aria-label="${label}"><option>Leé el Drive para ver canchas</option></select>`;
    }
    const { opts, homeDays, coverDays } = coverCourtChoices(match, coverLabel);
    if (!homeDays || !coverDays) {
      return `<select disabled aria-label="${label}"><option>Falta la disponibilidad de una de las parejas</option></select>`;
    }
    if (!opts.length) {
      return `<select disabled aria-label="${label}" title="No hay un turno libre del Drive donde puedan jugar ambas"><option>Sin cancha libre donde puedan jugar ambas</option></select>`;
    }
    const byDay = new Map();
    for (const o of opts) {
      const day = o.day || "Sin día";
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(o);
    }
    const groups = [...byDay.entries()]
      .map(
        ([day, list]) =>
          `<optgroup label="${escAttr(day)} · ${list.length} turno${list.length === 1 ? "" : "s"} libres">
            ${list
              .map((o) => {
                const court = String(o.court || "").trim();
                const courtTxt = /^cancha\b/i.test(court) ? court : court ? `Cancha ${court}` : "";
                const text = [o.time, o.venue, courtTxt].filter(Boolean).join(" · ");
                return `<option value="${escAttr(o.key)}">${escAttr(text)}</option>`;
              })
              .join("")}
          </optgroup>`
      )
      .join("");
    return `<select data-fx-cover-slot="${i}" aria-label="${label}" title="Todos los días y horarios del Drive donde puedan jugar ambas, con cancha libre.">
      <option value="">2. Elegir entre ${opts.length} turno${opts.length === 1 ? "" : "s"} libre${opts.length === 1 ? "" : "s"}…</option>
      ${groups}
    </select>`;
  }

  function courtOptionText(option) {
    const court = String(option.court || "").trim();
    const courtTxt = /^cancha\b/i.test(court) ? court : court ? `Cancha ${court}` : "";
    return [option.day, option.time, option.venue, courtTxt].filter(Boolean).join(" · ");
  }

  function courtFallbackSelect(i, match) {
    const label = "Elegir día, complejo y cancha";
    if (!loadedSlots.length) {
      return `<select disabled aria-label="${label}" title="Leé el Drive para ver canchas disponibles"><option>Leé el Drive para elegir cancha</option></select>`;
    }
    const opts = courtChoicesFor(match);
    if (!opts.length) {
      return `<select disabled aria-label="${label}" title="En el Drive no quedó una cancha libre en un día y horario donde puedan jugar ambas parejas"><option>Sin cancha libre en el Drive donde puedan jugar ambas</option></select>`;
    }
    return `<select data-fx-slot="${i}" aria-label="${label}" title="Turnos del Drive donde puedan jugar ambas, aunque el complejo ya llegó a la cantidad de partidos.">
      <option value="">Elegir día, complejo y cancha…</option>
      ${opts.map((o) => `<option value="${escAttr(o.key)}">${escAttr(courtOptionText(o))}</option>`).join("")}
    </select>`;
  }

  function applyCourtOption(i, key) {
    const match = ctx.fixture[i];
    if (!match || !key) return;
    const opt = courtChoicesFor(match).find((o) => o.key === key);
    if (!opt) {
      toast("Esa cancha ya está en uso o no está libre.", "err");
      render();
      return;
    }
    const next = { ...match, venue: opt.venue, court: opt.court, day: opt.day || match.day, time: opt.time || match.time };
    const taken = (ctx.fixture || []).filter((other) => {
      if (other === match) return false;
      if (seasonOf(other) !== filterTemp || (other.week || "") !== filterWeek) return false;
      return String(other.venue || "").trim() && String(other.court || "").trim();
    });
    if (isCourtTaken(next, taken)) {
      toast("Esa cancha ya está en uso en ese horario.", "err");
      render();
      return;
    }
    match.venue = next.venue;
    match.court = next.court;
    match.day = next.day;
    match.time = next.time;
    shell.markDirty("fixture");
    render();
    toast(courtOptionText(opt), "ok");
  }

  function renderVenues() {
    const list = $("fx-venues");
    if (!list) return;
    const venues = (ctx.siteData.venues || []).filter((v) => v.liga !== false);
    list.innerHTML = venues.map((v) => `<option value="${escAttr(v.name)}"></option>`).join("");
  }

  function previousMeetings(m) {
    if (!isRealPairMatch(m)) return [];
    const played = [...(ctx.results || []), ...(ctx.fixturePublished || [])].filter(
      (p) => isRealPairMatch(p) && p.temp === m.temp && p.cat === m.cat && p.week !== m.week
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
      coverDraft.clear();
      box.innerHTML = "";
      return;
    }
    for (const key of [...coverDraft.keys()]) {
      if (!pending.some(({ i }) => i === key)) coverDraft.delete(key);
    }
    const cats = [...new Set(pending.map(({ m }) => m.cat || "Sin categoría"))];
    const pools = matchPools();
    box.innerHTML = `<h3>Pendientes · ${pending.length}</h3>
      <p class="admin-help">Quedaron sin rival (impar, horarios, rivales ocupados o sin cancha libre en el Drive). Primero elegí <strong>Cubrir con</strong> y después vas a ver <strong>todos los días y horarios</strong> del Drive donde puedan jugar ambas, con las canchas que siguen libres. En la web pública también pueden cubrirse (misma categoría, menos de ${MAX_PAIR_MATCHES} PJ).</p>
      ${cats
        .map((cat) => {
          const rows = pending.filter(({ m }) => (m.cat || "Sin categoría") === cat);
          return `<div class="fx-pending-cat">
            <h4>${escAttr(cat)}</h4>
            ${rows
              .map(({ m, i }) => {
                const covers = coverCandidates({
                  match: m,
                  pairs: ctx.pairs || [],
                  pools,
                  temp: filterTemp,
                });
                const draft = coverDraft.get(i) || "";
                return `<article class="fx-pending-card" data-i="${i}">
                  <strong>${escAttr(m.home)}</strong>
                  <div class="fx-pending-actions">
                    <select data-fx-cover="${i}" aria-label="Cubrir con">
                      <option value="">1. Cubrir con…</option>
                      ${
                        covers.length
                          ? covers
                              .map(
                                (c) =>
                                  `<option value="${escAttr(c.label)}"${draft === c.label ? " selected" : ""}>${escAttr(c.label)} (${c.pj} PJ)</option>`
                              )
                              .join("")
                          : `<option value="" disabled>No hay parejas disponibles en ${escAttr(cat)}</option>`
                      }
                    </select>
                    ${
                      draft
                        ? `<span class="fx-court-fallback">${coverSlotSelect(i, m, draft)}</span>`
                        : `<select disabled aria-label="Elegir día, complejo y cancha"><option>2. Primero elegí con quién cubrir</option></select>`
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

  function readVenuePlanFromDom() {
    const list = $("fx-advanced-list");
    if (!list) return [];
    return [...list.querySelectorAll("[data-fx-venue]")].map((row) => {
      const venue = row.dataset.fxVenue || "";
      const count = Number(row.querySelector("[data-fx-count]")?.value || 0);
      const days = [...row.querySelectorAll("[data-fx-day]:checked")].map((el) => el.value);
      return { venue, count, days };
    });
  }

  function playablePairCount() {
    const season = filterTemp || ctx.siteData.currentSeason || "T4";
    return pairEntries(season).filter((e) => !e.bye).length;
  }

  /** Cupo de la fecha: 1 partido por pareja jugable → floor(n/2). Dinámico (35, 20, …). */
  function matchesNeeded() {
    const pairs = playablePairCount();
    return pairs ? Math.floor(pairs / 2) : 0;
  }

  function effectiveChosen(plan, summary) {
    const byVenue = new Map(summary.map((s) => [s.venue, s]));
    let chosen = 0;
    for (const p of plan) {
      const row = byVenue.get(p.venue);
      if (!row) continue;
      const days = new Set(p.days || []);
      const availOnDays = row.days.filter((d) => days.has(d.day)).reduce((n, d) => n + d.count, 0);
      chosen += Math.max(0, Math.min(Number(p.count) || 0, availOnDays || row.total));
    }
    return chosen;
  }

  /** Suma de «Partidos a usar» ≤ need; cada complejo ≤ capacidad del Sheet. Orden = orden del summary. */
  function clampCountsToNeed(counts, venues, need) {
    const out = {};
    let left = Math.max(0, Number(need) || 0);
    for (const row of venues) {
      const sheetCap = Math.max(0, Number(row.total) || 0);
      const want = Math.max(0, Number(counts[row.venue]) || 0);
      const next = Math.min(want, sheetCap, left);
      out[row.venue] = next;
      left -= next;
    }
    return out;
  }

  function rawVenueCounts(list) {
    const raw = {};
    for (const card of list.querySelectorAll("[data-fx-venue]")) {
      const venue = card.dataset.fxVenue || "";
      raw[venue] = Math.max(0, Math.floor(Number(card.querySelector("[data-fx-count]")?.value || 0)));
    }
    return raw;
  }

  function venueCountCap(venue, summary, need, counts) {
    const row = summary.find((s) => s.venue === venue);
    if (!row) return 0;
    const sumOthers = summary
      .filter((s) => s.venue !== venue)
      .reduce((n, s) => n + Math.max(0, Number(counts[s.venue]) || 0), 0);
    return Math.max(0, Math.min(Number(row.total) || 0, Math.max(0, need) - sumOthers));
  }

  /**
   * Topea cada input al cupo de la fecha sin “robarle” partidos a otros complejos.
   * Si se pasa el total, baja solo el complejo editado (o los que excedan) y puede avisar.
   */
  function syncVenueCountInputs({ editedVenue = null, announce = false } = {}) {
    const list = $("fx-advanced-list");
    const summary = summarizeCourtSlots(loadedSlots);
    if (!list || !summary.length) return { overflow: false, need: 0 };
    const need = matchesNeeded();
    const raw = rawVenueCounts(list);
    const order = editedVenue
      ? [editedVenue, ...summary.map((s) => s.venue).filter((v) => v !== editedVenue)]
      : summary.map((s) => s.venue);
    const cardsByVenue = new Map(
      [...list.querySelectorAll("[data-fx-venue]")].map((card) => [card.dataset.fxVenue || "", card])
    );
    let overflow = false;
    for (const venue of order) {
      const card = cardsByVenue.get(venue);
      const input = card?.querySelector("[data-fx-count]");
      if (!input) continue;
      const max = venueCountCap(venue, summary, need, raw);
      input.max = String(max);
      input.setCustomValidity("");
      let value = Math.max(0, Math.floor(Number(input.value || 0)));
      if (value > max) {
        overflow = true;
        value = max;
        raw[venue] = value;
        input.value = String(value);
        input.setCustomValidity(`Máximo ${max} (cupo de la fecha: ${need})`);
      } else {
        raw[venue] = value;
      }
    }
    if (announce && overflow) {
      const msg = need
        ? `La suma de «Partidos a usar» no puede pasar ${need} (parejas jugables ÷ 2).`
        : "No hay cupo de partidos para esta fecha.";
      setMsg($("fx-msg"), msg, "err");
      toast(need ? `Tope: ${need} partidos` : "Sin cupo", "err");
    }
    return { overflow, need };
  }

  function updatePlanSummary(opts = {}) {
    const el = $("fx-plan-summary");
    const status = $("fx-slots-status");
    const summary = summarizeCourtSlots(loadedSlots);
    if (!summary.length) {
      if (el) {
        el.hidden = true;
        el.textContent = "";
      }
      return;
    }
    // El toast avisa si intentaron pasarse; el banner refleja el valor ya corregido.
    syncVenueCountInputs(opts);
    const plan = readVenuePlanFromDom();
    const assigned = plan.reduce((n, p) => n + Math.max(0, Number(p.count) || 0), 0);
    const sheetTotal = summary.reduce((n, s) => n + s.total, 0);
    const pairs = playablePairCount();
    const need = matchesNeeded();
    const over = Boolean(need && assigned > need);
    const leftNeed = Math.max(0, need - assigned);
    const text = need
      ? `Asignados: ${assigned} / ${need}` +
        (over
          ? ` · ¡Pasaste el cupo!`
          : leftNeed
            ? ` · Quedan por asignar: ${leftNeed}`
            : " · completo") +
        ` · ${pairs} parejas jugables (máx. ${MAX_PAIR_MATCHES} PJ c/u) · Sheet: ${sheetTotal} posibles`
      : `Sin parejas jugables (o todas en tope de ${MAX_PAIR_MATCHES} PJ) · Sheet: ${sheetTotal} posibles`;
    if (el) {
      el.hidden = false;
      el.textContent = text;
      el.className = "fx-plan-summary" + (over ? " is-err" : need && assigned === need ? " is-ok" : "");
    }
    if (status && loadedSlots.length) {
      status.hidden = false;
      status.textContent = `Drive${slotsFileName ? ` · ${slotsFileName}` : ""}: ${sheetTotal} posibles · ${summary.length} complejos · ${text}`;
    }
  }

  function renderAdvanced() {
    const panel = $("fx-advanced");
    const list = $("fx-advanced-list");
    const build = $("fx-build");
    const status = $("fx-slots-status");
    const summary = summarizeCourtSlots(loadedSlots);
    const showPlan = summary.length > 0 && advancedOpen;
    if (build) build.hidden = !(showPlan && isLiveWeek(filterTemp, filterWeek));
    if (status) {
      status.hidden = !loadedSlots.length;
      status.textContent = loadedSlots.length
        ? `Drive${slotsFileName ? ` · ${slotsFileName}` : ""}: ${summary.reduce((n, s) => n + s.total, 0)} partidos posibles · ${summary.length} complejo${summary.length === 1 ? "" : "s"}.`
        : "";
    }
    if (!panel || !list) return;
    panel.hidden = !showPlan;
    if (!summary.length) {
      list.innerHTML = "";
      updatePlanSummary();
      return;
    }
    const need = matchesNeeded();
    const prev = Object.fromEntries(readVenuePlanFromDom().map((p) => [p.venue, p]));
    const rawCounts = Object.fromEntries(summary.map((row) => [row.venue, prev[row.venue]?.count ?? 0]));
    // Solo al re-render: si el DOM venía pasado de cupo, ajusta sin dejar suma > need.
    const counts = clampCountsToNeed(rawCounts, summary, need);
    list.innerHTML = summary
      .map((row) => {
        const saved = prev[row.venue];
        const count = counts[row.venue] ?? 0;
        const max = venueCountCap(row.venue, summary, need, counts);
        const selectedDays = new Set(saved?.days?.length ? saved.days : row.days.map((d) => d.day));
        const dayChecks = DAYS.map((day) => {
          const avail = row.daySet.has(day);
          const n = row.days.find((d) => d.day === day)?.count || 0;
          const checked = avail && selectedDays.has(day);
          return `<label class="ball-check${!avail ? " is-disabled" : ""}" title="${avail ? `${n} partido${n === 1 ? "" : "s"} de 1:30 caben este día en el Sheet` : "Sin turnos este día en el Sheet"}">
            <input type="checkbox" data-fx-day value="${escAttr(day)}"${checked ? " checked" : ""}${avail ? "" : " disabled"} />
            <span class="ball-check-face">${BALL_SVG}</span>
            <span class="ball-check-label">${escAttr(day)}${avail ? ` · ${n} disp.` : ""}</span>
          </label>`;
        }).join("");
        return `<article class="fx-venue-card" data-fx-venue="${escAttr(row.venue)}">
          <div class="fx-venue-top">
            <div>
              <strong>${escAttr(row.venue)}</strong>
              <p class="admin-help">${row.total} posibles en el Sheet · cupo de la fecha: ${need} · la suma de todos no puede pasar ${need}</p>
            </div>
            <label class="fx-venue-count">
              <span>Partidos a usar</span>
              <input type="number" min="0" max="${max}" step="1" data-fx-count value="${count}" />
            </label>
          </div>
          <div class="fx-venue-days">
            <label class="ball-check ball-check-all">
              <input type="checkbox" data-fx-days-all${row.days.every((d) => selectedDays.has(d.day)) ? " checked" : ""} />
              <span class="ball-check-face">${BALL_SVG}</span>
              <span class="ball-check-label">Todos los días</span>
            </label>
            <div class="fx-day-grid">${dayChecks}</div>
          </div>
        </article>`;
      })
      .join("");
    updatePlanSummary();
  }

  function renderTable() {
    const live = isLiveWeek(filterTemp, filterWeek);
    const detail = $("fx-detail");
    if (detail) detail.hidden = false;
    const build = $("fx-build");
    const slotsBtn = $("fx-slots");
    const driveBtn = $("fx-drive");
    const add = $("fx-add");
    const bar = $("fx-publish")?.closest(".admin-sticky-bar");
    const dl = $("fx-download-wrap");
    if (slotsBtn) slotsBtn.hidden = !live;
    if (driveBtn) driveBtn.hidden = !live;
    // + Partido solo cuando ya hay partidos (retoque manual)
    const hasGames =
      live &&
      (ctx.fixture || []).some(
        (m) => seasonOf(m) === filterTemp && (m.week || "") === filterWeek && (isRealPairMatch(m) || isPending(m))
      );
    if (add) add.hidden = !hasGames;
    if (bar) bar.hidden = !live;
    if (dl) dl.hidden = !filterWeek;
    renderAdvanced();
    if (build) build.hidden = !(live && loadedSlots.length && advancedOpen);

    if (!live) {
      const arch = (ctx.results || [])
        .filter((m) => seasonOf(m) === filterTemp && (m.week || "") === filterWeek && isRealPairMatch(m))
        .slice()
        .sort(compareByDayTime);
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
    const games = ctx.fixture
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !isPending(m) && seasonOf(m) === filterTemp && (m.week || "") === filterWeek)
      .sort((a, b) => compareByDayTime(a.m, b.m));
    const repeated = renderWarnings(games) || new Set();
    const empty = $("fx-empty");
    if (empty) {
      empty.hidden = games.length > 0 || ctx.fixture.some((m) => isPending(m) && (m.week || "") === filterWeek);
      empty.querySelector("p").textContent = !loadedSlots.length
        ? "Paso 1: tocá Leer Drive (pestaña con el mismo nombre que esta fecha)."
        : "Paso 2: abajo elegí partidos y días por complejo, y tocá Armar fixture.";
    }
    $("fx-body").innerHTML = games
      .map(({ m, i }) => {
        const on = editing === i;
        const bare = !on && needsCourt(m);
        const field = (k, placeholder) =>
          on
            ? `<input data-k="${k}" value="${escAttr(m[k])}" placeholder="${placeholder}"${k === "venue" ? ' list="fx-venues"' : ""} />`
            : escAttr(m[k]);
        const titles = [];
        if (repeated.has(i)) titles.push("Ya se enfrentaron en esta temporada");
        if (bare) {
          titles.push(
            "Sin cancha en el cupo elegido. El desplegable lista días y canchas del Drive donde puedan jugar ambas, aunque el complejo ya llegó a la cantidad."
          );
        }
        const cls = [repeated.has(i) ? "is-rematch" : "", bare ? "is-uncourted" : ""].filter(Boolean).join(" ");
        return `<tr data-i="${i}"${cls ? ` class="${cls}"` : ""}${titles.length ? ` title="${escAttr(titles.join(" "))}"` : ""}>
          <td>${field("day", "Jueves")}</td>
          <td>${field("time", "19:00 - 20:30")}</td>
          <td>${field("cat", "A Masculina")}</td>
          ${
            bare
              ? `<td class="fx-court-fallback" colspan="2">${courtFallbackSelect(i, m)}</td>`
              : `<td>${field("venue", "Complejo")}</td>
          <td>${field("court", "Cancha 1")}</td>`
          }
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
              <p>Abrir · leer Drive</p>
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
    const pools = matchPools();
    return (ctx.pairs || [])
      .filter((p) => String(p.temp || "").toUpperCase() === String(season).toUpperCase() && p.p1 && p.p2 && p.cat)
      .map((p) => {
        const days = p.days && typeof p.days === "object" ? p.days : {};
        const valid = !validateDays(days);
        const label = pairLabel(p);
        const pj = countPairMatches(label, p.cat, season, pools);
        const capped = pj >= MAX_PAIR_MATCHES;
        return {
          p1: p.p1,
          p2: p.p2,
          cat: p.cat,
          days: valid && !capped ? days : {},
          note: p.note || "",
          bye: !valid || capped,
          recover: false,
          _pj: pj,
          _capped: capped,
        };
      });
  }

  async function buildFromFecha() {
    if ((await shell.setSection("fixture")) === false) return;
    if (!loadedSlots.length) {
      setMsg($("fx-msg"), "Primero leé el Drive (o subí el archivo) de canchas para esta fecha.", "err");
      toast("Leé el Drive primero", "err");
      $("fx-drive")?.focus();
      return;
    }
    if (!advancedOpen) {
      advancedOpen = true;
      renderAdvanced();
    }
    const summary = summarizeCourtSlots(loadedSlots);
    const need = matchesNeeded();
    const rawPlan = readVenuePlanFromDom();
    const rawSum = rawPlan.reduce((n, p) => n + Math.max(0, Number(p.count) || 0), 0);
    if (need && rawSum > need) {
      syncVenueCountInputs({ announce: true });
      updatePlanSummary();
      setMsg(
        $("fx-msg"),
        `Esta fecha pide ${need} partido${need === 1 ? "" : "s"}; la suma de «Partidos a usar» no puede ser mayor (${rawSum}).`,
        "err"
      );
      toast(`Tope: ${need} partidos`, "err");
      return;
    }
    const plan = rawPlan.filter((p) => p.count > 0 && p.days.length);
    if (!plan.length) {
      setMsg($("fx-msg"), "Poné cantidad de partidos (sin pasar el cupo de la fecha) y al menos un día por complejo.", "err");
      toast("Configurá los complejos", "err");
      return;
    }
    const chosen = effectiveChosen(plan, summary);
    if (need && chosen > need) {
      setMsg(
        $("fx-msg"),
        `Esta fecha pide ${need} partido${need === 1 ? "" : "s"}; la suma de «Partidos a usar» no puede ser mayor.`,
        "err"
      );
      toast(`Tope: ${need} partidos`, "err");
      return;
    }
    // pool = todos los turnos posibles de los días elegidos; venueCaps limita «Partidos a usar».
    // Si usáramos solo el pack temprano, canchas de las 15:00 ocupaban el cupo y las parejas
    // que solo pueden 16:30-19:30 quedaban sin complejo/cancha.
    const plannedSlots = applyVenuePlan(loadedSlots, plan, { mode: "pool" });
    const planCapacity = plan.reduce((n, p) => n + Math.max(0, Number(p.count) || 0), 0);
    if (!plannedSlots.length || !planCapacity) {
      setMsg($("fx-msg"), "No hay disponibilidad que coincida con los días y cupos elegidos.", "err");
      toast("Sin cupos para el plan", "err");
      return;
    }
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
      const capped = entries.filter((e) => e._capped).length;
      const withoutDays = entries.filter((e) => e.bye && !e._capped).length;
      if (withoutDays) warnings.push(`${withoutDays} pareja${withoutDays === 1 ? "" : "s"} sin disponibilidad quedan afuera.`);
      if (capped) warnings.push(`${capped} pareja${capped === 1 ? "" : "s"} ya llegaron a ${MAX_PAIR_MATCHES} PJ y no se fixturean.`);
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
      const planTxt = plan.map((p) => `${p.venue}: ${p.count} · ${p.days.join(", ")}`).join(" · ");
      const ok = await confirmModal({
        title: `Armar ${week}`,
        body:
          `Se arma ${week} (${seasonLabel(season)}) con ${playable.length} pareja${playable.length === 1 ? "" : "s"} y ${planCapacity} cupo${planCapacity === 1 ? "" : "s"} de cancha (${planTxt}). ` +
          (warnings.length ? warnings.join(" ") + " " : "") +
          "Los horarios respetan la disponibilidad de cada pareja. Nada se publica hasta que toques Publicar fixture.",
        confirmLabel: "Armar fixture",
      });
      if (!ok) return;

      const history = [...(ctx.results || []), ...(ctx.fixture || [])].filter(
        (m) => m.temp === temp && m.week !== week && isRealPairMatch(m)
      );
      buildCount += 1;
      const out = buildFixture({ entries, ranking: ctx.rows, history, week, temp, seed: buildCount });
      let built = out.matches.map((m) => {
        const cleaned = cleanMatch(m, {}, season);
        if (!cleaned.pending) {
          return {
            ...cleaned,
            homeDays: m.homeDays && typeof m.homeDays === "object" ? m.homeDays : undefined,
            awayDays: m.awayDays && typeof m.awayDays === "object" ? m.awayDays : undefined,
          };
        }
        // days se pasa a assignCourtSlots para respetar disponibilidad; luego se limpia.
        return {
          ...cleanMatch(
            {
              ...cleaned,
              pending: true,
              away: PENDING_AWAY,
              reason: m.reason || cleaned.reason || "",
              avail:
                cleaned.avail ||
                Object.entries(m.days || {})
                  .map(([d, h]) => `${d} ${h}`)
                  .join(" · "),
              note: m.note || cleaned.note || "",
            },
            {},
            season
          ),
          days: m.days && typeof m.days === "object" ? m.days : undefined,
        };
      });
      const venueCaps = Object.fromEntries(plan.map((p) => [p.venue, p.count]));
      const courtOpts = { onlyEmpty: true, venueCaps, preferPlan: true };
      // Primero asigna canchas; si alguna pareja no entra, prueba cambiarle el rival.
      const assigned = rematchForCourts(built, plannedSlots, courtOpts);
      // Si igual no hay cancha, van a pendientes (como impar / sin cruce).
      const parked = parkBareMatchesAsPending(assigned.matches);
      built = parked.matches.map((m) => {
        const { days: _days, homeDays: _h, awayDays: _a, ...rest } = m;
        return cleanMatch(rest, {}, season);
      });
      const real = built.filter((m) => !isPending(m));
      const pending = built.filter(isPending);
      const pendingBare = pending.filter((m) => !String(m.venue || "").trim() || !String(m.day || "").trim() || !String(m.time || "").trim());
      const bare = built.filter(
        (m) =>
          (isRealPairMatch(m) || isPending(m)) &&
          (!String(m.venue || "").trim() || !String(m.court || "").trim())
      );
      const keepOther = (ctx.fixture || []).filter(
        (m) => isPending(m) && seasonOf(m) === season && (m.week || "") !== week
      );
      built.sort(compareByDayTime);
      ctx.fixture = [...keepOther, ...built];
      filterTemp = season;
      filterWeek = week;
      if ($("fx-week")) $("fx-week").value = week;
      shell.markDirty("fixture");
      render();
      const rematches = out.matches.filter((m) => m.rematch && !m.pending).length;
      const parts = [
        `${real.length} partido${real.length === 1 ? "" : "s"}`,
        `${assigned.assigned} con cancha`,
        pending.length ? `${pending.length} pendiente${pending.length === 1 ? "" : "s"}` : "sin pendientes",
      ];
      if (assigned.swaps) {
        parts.push(
          `${assigned.swaps} rival${assigned.swaps === 1 ? "" : "es"} rearmado${assigned.swaps === 1 ? "" : "s"} para encontrar cancha`
        );
      }
      if (parked.parked) {
        parts.push(
          `${parked.parked} cruce${parked.parked === 1 ? "" : "s"} sin cancha → pendiente${parked.parked === 1 ? "" : "s"}`
        );
      }
      if (pendingBare.length) {
        parts.push(`${pendingBare.length} pendiente${pendingBare.length === 1 ? "" : "s"} sin cancha reservada`);
      }
      if (bare.filter(isRealPairMatch).length) {
        parts.push(`${bare.filter(isRealPairMatch).length} sin complejo/cancha`);
      }
      if (assigned.skipped && !parked.parked) parts.push(`${assigned.skipped} sin cancha compatible`);
      const byesNoCap = out.byes.filter((e) => !e._capped);
      if (byesNoCap.length) parts.push(`${byesNoCap.length} sin disponibilidad`);
      if (capped) parts.push(`${capped} en tope ${MAX_PAIR_MATCHES} PJ`);
      if (rematches) parts.push(`${rematches} repite rival, mirá el aviso Revisar`);
      setMsg($("fx-msg"), `${week} armada: ${parts.join(" · ")}. Revisá y publicá.`, "ok");
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
        const season = filterTemp || ctx.siteData.currentSeason || "T4";
        filterWeek = nextBuildWeek(season);
        if ($("fx-week")) $("fx-week").value = filterWeek;
        editing = -1;
        loadedSlots = [];
        slotsFileName = "";
        advancedOpen = false;
        render();
        setMsg(
          $("fx-msg"),
          `${filterWeek}: 1) Leer Drive (pestaña «${filterWeek}»). 2) Configurá complejos/días. 3) Armar fixture.`,
          "ok"
        );
        loadSlotsFromDrive();
      }
    });

    $("fx-build")?.addEventListener("click", buildFromFecha);

    function applyLoadedSlots(slots, label, { gaps = [] } = {}) {
      loadedSlots = slots;
      slotsFileName = label || "";
      advancedOpen = true;
      render();
      const summary = summarizeCourtSlots(slots);
      const cap = summary.reduce((n, s) => n + s.total, 0);
      const gapTxt = gaps.length
        ? ` Ojo: ${gaps.map((g) => `${g.venue} (${g.count} filas sin horario)`).join(" · ")}. Revisá la columna Horario en el Sheet (ej. 16:30 - 18:00).`
        : "";
      setMsg(
        $("fx-msg"),
        `${label || "Canchas"} listo: ${cap} partido${cap === 1 ? "" : "s"} posibles en ${summary.length} complejo${summary.length === 1 ? "" : "s"}.${gapTxt} Ajustá cupos/días y armá el fixture.`,
        gaps.length ? "err" : "ok"
      );
      toast(gaps.length ? "Canchas OK · faltan horarios en el Sheet" : "Canchas cargadas", gaps.length ? "err" : "ok");
    }

    async function loadSlotsFromDrive() {
      if (!filterTemp || !filterWeek) {
        toast("Entrá a la fecha del fixture antes de leer el Drive.", "err");
        return;
      }
      const sheetId = courtsSheetIdForSeason(ctx.siteData, filterTemp);
      if ((await shell.setSection("fixture")) === false) return;
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      setBusy($("fx-drive"), true, "Leyendo Drive…");
      try {
        const data = await api.worker(
          `/fixture/courts?week=${encodeURIComponent(filterWeek)}&sheetId=${encodeURIComponent(sheetId)}`
        );
        const objects = courtSlotObjectsFromText(data.csv || "");
        const gaps = missingCourtHorarios(objects);
        const slots = parseCourtSlotObjects(objects);
        applyLoadedSlots(slots, `Drive · ${filterWeek}`, { gaps });
      } catch (err) {
        setMsg($("fx-msg"), err.message || "No se pudo leer el Google Sheet.", "err");
        toast(err.message || "Error al leer Drive", "err");
      } finally {
        setBusy($("fx-drive"), false);
      }
    }

    async function readSlotsFile(file) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
        return { slots: parseCourtSlotText(await file.text()), weekHint: weekFromName(file.name) };
      }
      if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheetName = wb.SheetNames.find((n) => weekFromName(n)) || wb.SheetNames[0];
        if (!sheetName) throw new Error("El Excel no tiene hojas.");
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
        return {
          slots: parseCourtSlotObjects(rows),
          weekHint: weekFromName(file.name) || weekFromName(sheetName),
        };
      }
      throw new Error("Usá un archivo .xlsx, .xls o .csv con Complejo, Cancha, Dia y Horario.");
    }

    $("fx-drive")?.addEventListener("click", () => loadSlotsFromDrive());
    $("fx-slots")?.addEventListener("click", () => $("fx-slots-file")?.click());
    $("fx-slots-file")?.addEventListener("change", async (e) => {
      const input = e.target;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (!filterTemp || !filterWeek) {
        toast("Entrá a la fecha del fixture antes de subir el archivo.", "err");
        return;
      }
      if ((await shell.setSection("fixture")) === false) return;
      setBusy($("fx-slots"), true, "Leyendo…");
      try {
        const { slots, weekHint } = await readSlotsFile(file);
        if (weekHint && weekHint !== filterWeek) {
          const ok = await confirmModal({
            title: "Fecha del archivo",
            body: `El archivo parece de ${weekHint} y estás en ${filterWeek}. ¿Usarlo igual para ${filterWeek}?`,
            confirmLabel: "Usar igual",
          });
          if (!ok) return;
        }
        applyLoadedSlots(slots, file.name);
      } catch (err) {
        setMsg($("fx-msg"), err.message || "No se pudo leer el archivo.", "err");
        toast(err.message || "Error al leer el archivo", "err");
      } finally {
        setBusy($("fx-slots"), false);
      }
    });

    $("fx-advanced-list")?.addEventListener("change", (e) => {
      const countInput = e.target.closest("[data-fx-count]");
      if (countInput) {
        const venue = countInput.closest("[data-fx-venue]")?.dataset.fxVenue || null;
        updatePlanSummary({ editedVenue: venue, announce: true });
        return;
      }
      const all = e.target.closest("[data-fx-days-all]");
      if (all) {
        const card = all.closest("[data-fx-venue]");
        card?.querySelectorAll("[data-fx-day]:not(:disabled)").forEach((el) => {
          el.checked = all.checked;
        });
      }
      const day = e.target.closest("[data-fx-day]");
      if (day) {
        const card = day.closest("[data-fx-venue]");
        const boxes = [...(card?.querySelectorAll("[data-fx-day]:not(:disabled)") || [])];
        const master = card?.querySelector("[data-fx-days-all]");
        if (master) master.checked = boxes.length > 0 && boxes.every((el) => el.checked);
      }
      updatePlanSummary();
    });
    $("fx-advanced-list")?.addEventListener("input", (e) => {
      const countInput = e.target.closest("[data-fx-count]");
      if (!countInput) return;
      const venue = countInput.closest("[data-fx-venue]")?.dataset.fxVenue || null;
      updatePlanSummary({ editedVenue: venue, announce: true });
    });

    $("fx-dl")?.addEventListener("click", async () => {
      const games = (ctx.fixture || [])
        .concat(ctx.results || [])
        .filter((m) => seasonOf(m) === filterTemp && (m.week || "") === filterWeek && (isRealPairMatch(m) || isPending(m)));
      const unique = [];
      const seen = new Set();
      for (const m of games) {
        const k = weekKey(m) + "|" + (m.home || "") + "|" + (m.away || "") + "|" + (m.day || "") + "|" + (m.time || "");
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(m);
      }
      if (!unique.length) {
        toast("No hay partidos para descargar en esta fecha", "err");
        return;
      }
      const mode = $("fx-dl-sort")?.value || "complejo";
      const sorted = sortMatchesForExport(unique, mode);
      const name = `${(filterWeek || "fixture").replace(/\s+/g, "-").toLowerCase()}-${mode}.xlsx`;
      try {
        await downloadXlsx(name, FX_EXPORT_COLS, fixtureExportRows(sorted), filterWeek || "Fixture");
        toast("Excel descargado", "ok");
      } catch (err) {
        toast(err.message || "No se pudo descargar", "err");
      }
    });

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
      const slotSel = e.target.closest("[data-fx-slot]");
      if (slotSel) {
        applyCourtOption(Number(slotSel.dataset.fxSlot), slotSel.value);
        return;
      }
      const tr = e.target.closest("tr");
      if (!tr) return;
      const i = Number(tr.dataset.i);
      const k = e.target.dataset.k;
      if (!k) return;
      const prev = ctx.fixture[i][k];
      ctx.fixture[i][k] = e.target.value;
      if (["day", "time", "venue", "court"].includes(k)) {
        const taken = (ctx.fixture || []).filter((other, idx) => {
          if (idx === i) return false;
          if (seasonOf(other) !== filterTemp || (other.week || "") !== filterWeek) return false;
          return String(other.venue || "").trim() && String(other.court || "").trim();
        });
        if (isCourtTaken(ctx.fixture[i], taken)) {
          ctx.fixture[i][k] = prev;
          e.target.value = prev || "";
          toast("Esa cancha ya está en uso en ese horario.", "err");
          return;
        }
      }
      shell.markDirty("fixture");
      if (["home", "away", "cat"].includes(k)) {
        render();
        $("fx-body")?.querySelector(`tr[data-i="${i}"] input[data-k="${k}"]`)?.focus();
      } else updateSummary();
    });

    $("fx-pending")?.addEventListener("change", (e) => {
      const coverSlot = e.target.closest("[data-fx-cover-slot]");
      if (coverSlot) {
        const i = Number(coverSlot.dataset.fxCoverSlot);
        const slot = ctx.fixture[i];
        const cover = coverDraft.get(i) || "";
        const key = coverSlot.value;
        if (!slot || !isPending(slot) || !cover || !key) return;
        const opt = coverCourtChoices(slot, cover).opts.find((o) => o.key === key);
        if (!opt) {
          toast("Esa cancha ya no está libre para ambas parejas.", "err");
          coverSlot.value = "";
          return;
        }
        const next = cleanMatch(
          {
            ...slot,
            away: cover,
            day: opt.day,
            time: opt.time,
            venue: opt.venue,
            court: opt.court,
            pending: false,
            reason: "",
            avail: "",
            note: slot.note || "",
            result: "",
          },
          {},
          filterTemp || ctx.siteData.currentSeason || "T4"
        );
        delete next.pending;
        delete next.reason;
        delete next.avail;
        ctx.fixture[i] = next;
        coverDraft.delete(i);
        shell.markDirty("fixture");
        render();
        toast(`Cubierto · ${courtOptionText(opt)}`, "ok");
        return;
      }
      const sel = e.target.closest("[data-fx-cover]");
      if (!sel) return;
      const i = Number(sel.dataset.fxCover);
      const slot = ctx.fixture[i];
      if (!slot || !isPending(slot)) return;
      const cover = String(sel.value || "").trim();
      if (!cover) {
        coverDraft.delete(i);
        renderPending();
        return;
      }
      const allowed = coverCandidates({
        match: slot,
        pairs: ctx.pairs || [],
        pools: matchPools(),
        temp: filterTemp || slot.temp,
      });
      if (!allowed.some((c) => pairsMatch(c.label, cover) || c.label === cover)) {
        toast("Esa pareja no puede cubrir (otra categoría o ya tiene 12 PJ).", "err");
        sel.value = "";
        coverDraft.delete(i);
        return;
      }
      // No confirma todavía: primero hay que elegir día/complejo/cancha común.
      coverDraft.set(i, cover);
      renderPending();
      if (!loadedSlots.length) {
        toast("Leé el Drive para ver los turnos donde puedan jugar ambas.", "err");
        return;
      }
      const shared = coverCourtChoices(slot, cover);
      if (!shared.homeDays || !shared.coverDays) {
        toast("Falta la disponibilidad de una de las parejas en Inscripciones.", "err");
        return;
      }
      if (!shared.opts.length) {
        toast("Esas dos parejas no tienen un turno libre en común en el Drive.", "err");
        return;
      }
      toast(`${shared.opts.length} turno${shared.opts.length === 1 ? "" : "s"} libre${shared.opts.length === 1 ? "" : "s"} donde pueden jugar ambas`, "ok");
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
      const draft = ctx.fixture.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
      const draftLive = draft.filter((m) => !isPending(m));
      const draftPending = draft.filter(isPending);
      const incomplete = draftLive.filter((m) => !isRealPairMatch(m) || !m.day || !m.time);
      const openPending = draftPending.length;
      const repeated = draftLive.filter((m) => isRealPairMatch(m) && previousMeetings(m).length).length;
      const ok = await confirmModal({
        title: "Publicar fixture",
        body:
          (incomplete.length
            ? `Ojo: ${incomplete.length} partido${incomplete.length === 1 ? "" : "s"} sin pareja, día u horario. `
            : "") +
          (openPending
            ? `${openPending} pendiente${openPending === 1 ? "" : "s"} quedan en el admin (no salen al sitio hasta cubrirlos). `
            : "") +
          (repeated ? `${repeated} cruce${repeated === 1 ? "" : "s"} ya se jugó en esta temporada (ver Revisar). ` : "") +
          "Se publican solo los partidos con rival. Las fechas que salgan del fixture quedan en Resultados. El sitio se actualiza en ~1 minuto.",
        confirmLabel: "Publicar fixture",
        danger: incomplete.length > 0,
      });
      if (!ok) return;

      setBusy($("fx-publish"), true, "Publicando…");
      setMsg($("fx-msg"), "Publicando fixture…");
      try {
        const [remoteFixture, remotePendingRaw, remoteResults] = await Promise.all([
          api.readRemoteJson(FIXTURE_PATH, []),
          api.readRemoteJson(FIXTURE_PENDING_PATH, []),
          api.readRemoteJson(RESULTS_PATH, []),
        ]);
        const remoteClean = (Array.isArray(remoteFixture) ? remoteFixture : [])
          .map((m) => cleanMatch(m, {}, season))
          .filter((m) => m.home || m.away);
        // Migración: si el fixture público todavía tenía pendientes, pasan al archivo admin.
        const remotePublicPending = remoteClean.filter(isPending);
        const remoteLive = remoteClean.filter((m) => !isPending(m));
        const remotePending = [
          ...(Array.isArray(remotePendingRaw) ? remotePendingRaw : []),
          ...remotePublicPending,
        ]
          .map((m) => cleanMatch(m, {}, season))
          .filter((m) => m.home || m.away);
        const draftKeys = new Set(draft.map(weekKey));
        const carryLive = remoteLive.filter((m) => !draftKeys.has(weekKey(m)));
        const carryPending = remotePending.filter((m) => isPending(m) && !draftKeys.has(weekKey(m)));
        const nextPublished = [...carryLive, ...draftLive];
        const nextPending = [...carryPending, ...draftPending];
        const adminFixture = [...nextPublished, ...nextPending];
        const newWeeks = new Set(adminFixture.map(weekKey));
        const toArchive = remoteLive.filter((m) => isRealPairMatch(m) && !newWeeks.has(weekKey(m)));
        const nextResults = mergeArchivedMatches(
          (Array.isArray(remoteResults) ? remoteResults : []).map((m) => cleanMatch(m, {}, season)),
          toArchive
        );
        const archivedWeeks = [...new Set(toArchive.map((m) => m.week).filter(Boolean))];
        const liveWeek = [...new Set(nextPublished.map((m) => m.week).filter(Boolean))].join(", ") || fallbackWeek();
        await api.publishFiles(
          [
            { path: FIXTURE_PATH, content: JSON.stringify(nextPublished, null, 2) + "\n" },
            { path: FIXTURE_PENDING_PATH, content: JSON.stringify(nextPending, null, 2) + "\n" },
            { path: RESULTS_PATH, content: JSON.stringify(nextResults, null, 2) + "\n" },
          ],
          archivedWeeks.length
            ? `Pasa ${archivedWeeks.join(", ")} a resultados y publica ${liveWeek}.`
            : "Actualiza fixture desde el admin."
        );
        ctx.fixture = adminFixture;
        ctx.fixturePublished = structuredClone(adminFixture);
        ctx.results = nextResults;
        filterWeek = latestWeek(adminFixture) || filterWeek;
        if ($("fx-week")) $("fx-week").value = filterWeek;
        shell.clearDirty("fixture");
        onRankingChanged?.();
        render();
        const archived = archivedWeeks.length ? ` ${archivedWeeks.join(", ")} quedó en Resultados.` : "";
        const pendingNote = openPending
          ? ` ${openPending} pendiente${openPending === 1 ? "" : "s"} siguen en el admin.`
          : "";
        const text = "Fixture publicado. El sitio se actualiza en ~1 minuto." + pendingNote + archived;
        setMsg($("fx-msg"), text, "ok");
        toast(openPending ? "Fixture publicado · pendientes en admin" : "Fixture publicado", "ok");
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
