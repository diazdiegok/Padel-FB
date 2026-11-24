import { CATS, FIXTURE_PATH, FIXTURE_PENDING_PATH, PAIRS_PATH, RESULTS_PATH } from "./constants.js";
import {
  FX_EXPORT_COLS,
  cleanMatch,
  downloadXlsx,
  fixtureExportLabel,
  fixtureExportRows,
  splitLine,
  courtSlotObjectsFromText,
  parseCourtSlotObjects,
  sortMatchesForExport,
} from "./csv.js";
import { DAYS, compareCats, isAbandonedPair, pairLabel, validateDays } from "../lib/disponibilidad.js";
import {
  MAX_PAIR_MATCHES,
  PENDING_AWAY,
  absorbCoveredPending,
  buildFixture,
  countPairMatches,
  coverCandidates,
  draftAwarePools,
  fileOwedRecoveries,
  importRecoveryDebts,
  isMakeupPending,
  normalizeRecoveryWeeks,
  isPendingMatch,
  isPlaceholderPair,
  isRealPairMatch,
  releaseRecoveryDebt,
  rematchWeeks,
} from "../lib/fixturer.js";
import { isOpenWeek, latestWeek, listSeasons, mergeArchivedMatches, seasonLabel, weekKey, weekNumber } from "../lib/liga.js";
import {
  rivalOptionsFromPairs,
  scheduleOptionsFromSlots,
  splitMatchToPending,
  syncFixtureWithPairs,
} from "../lib/pair-fixture-sync.js";
import {
  mergeDriveFixtureRows,
  parseDriveSheetValues,
  pendingDriveRows,
  recoverDriveRows,
} from "../lib/drive-sheet.js";
import { fold, pairsMatch, preserveRemoteMatchScores, queryMatchesText } from "../lib/scoring.js";
import {
  courtsSheetIdForSeason,
  DEFAULT_FIXTURE_DRIVE_SHEET_ID,
  DEFAULT_FIXTURE_DRIVE_SHEET_URL,
  DEFAULT_PENDING_DRIVE_SHEET_ID,
  DEFAULT_PENDING_DRIVE_SHEET_URL,
  DEFAULT_RECOVER_DRIVE_SHEET_ID,
  DEFAULT_RECOVER_DRIVE_SHEET_URL,
  DEFAULT_FREE_COURTS_DRIVE_SHEET_ID,
  DEFAULT_FREE_COURTS_DRIVE_SHEET_URL,
} from "../lib/sheets.js";
import {
  applyVenuePlan,
  attachPairDaysFromPairs,
  driveCourtOptions,
  findCourtConflicts,
  freeCourtDriveRows,
  isCourtTaken,
  matchViolatesAvailability,
  missingCourtHorarios,
  bestKnownMiss,
  courtDayIsOpen,
  coverSlotTier,
  nearCoverCourtOptions,
  normalizeDay,
  pairsSharePlayableWindow,
  assignCourtSlots,
  filterSharedSlotsToDrive,
  pairPendingsWithExactCourts,
  parkAvailabilityViolations,
  parkBareMatchesAsPending,
  parseCourtWindow,
  releaseOverlappingCourts,
  rematchForCourts,
  summarizeCourtSlots,
} from "../lib/slots.js";
import { $, confirmModal, escAttr, noticeModal, setBusy, setMsg, toast } from "./ui.js";

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
  /** Filtros de la grilla (igual que la vista pública / Resultados). */
  let gridDay = "";
  let gridCat = "";
  let gridVenue = "";
  let gridTerm = "";
  /** @type {any[]} */
  let loadedSlots = [];
  let slotsFileName = "";
  /** Cupos/días por complejo. Apagado = Armar usa todos los horarios del Drive. */
  let advancedMode = false;
  /** Índice de pendiente → pareja elegida en «Cubrir con» (aún sin confirmar cancha). */
  const coverDraft = new Map();
  /** «+ Partido»: categoría → pareja 1 → pareja 2 → turno del Drive. null = cerrado. */
  let newDraft = null;
  /** Ventanas abiertas. Recuperan fecha y Duplicados arrancan plegados. */
  const foldOpen = new Set(["pending"]);

  function fallbackWeek() {
    return filterWeek || $("fx-week")?.value.trim() || latestWeek(ctx.fixture) || "Fecha 1";
  }

  function clearGridFilters() {
    gridDay = "";
    gridCat = "";
    gridVenue = "";
    gridTerm = "";
  }

  /** Vista raíz del nav Fixture: cajas de temporadas (después fechas). */
  function showSeasonsHome() {
    filterTemp = "";
    filterWeek = "";
    editing = -1;
    clearGridFilters();
    if ($("fx-week")) $("fx-week").value = "";
  }

  function syncWeek() {
    showSeasonsHome();
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
    const rows = (ctx.fixture || []).filter((m) => seasonOf(m) === temp && (m.week || "") === week);
    const archived = (ctx.results || []).some(
      (m) => seasonOf(m) === temp && (m.week || "") === week && isRealPairMatch(m) && !m.recoverFrom
    );
    // Un recupero de esa fecha no reabre el editor si la fecha ya está en resultados.
    const substantive = rows.some((m) => !m.recoverFrom && !isMakeupPending(m));
    if (substantive) return true;
    if (archived) return false;
    if (rows.length) return true;
    // Fecha nueva sin partidos todavía: editable en la temporada actual.
    return temp === (ctx.siteData.currentSeason || temp);
  }

  function matchPools() {
    return draftAwarePools(ctx.results || [], ctx.fixturePublished || [], ctx.fixture || [], ctx.siteData.currentSeason || "");
  }

  function weekStats(temp, week) {
    const seasonRows = (ctx.fixture || []).filter((m) => seasonOf(m) === temp);
    const live = seasonRows.filter((m) => (m.week || "") === week);
    const arch = (ctx.results || []).filter((m) => seasonOf(m) === temp && (m.week || "") === week);
    const games = (live.length ? live : arch).filter((m) => !isPending(m) && !m.dupHold && isRealPairMatch(m));
    const pending = live.filter((m) => isPending(m) && !isMakeupPending(m)).length;
    const recovering = seasonRows.filter(
      (m) => isMakeupPending(m) && ((m.recoveredIn || "") === week || (!m.recoveredIn && (m.week || "") === week))
    ).length;
    const duplicates = seasonRows.filter((m) => {
      if (!m.dupHold || !isRealPairMatch(m)) return false;
      if ((m.week || "") === week) return true;
      // Recupero cubierto desde esta fecha (week = fecha adeudada).
      return !!(m.recoverFrom && (m.recoveredIn || "") === week);
    }).length;
    // Solo la última fecha del fixture vivo es «En juego» (al crear otra, la anterior deja de serlo).
    const open = isOpenWeek(week, seasonRows, temp);
    return { games, pending, recovering, duplicates, live: open, n: games.length };
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
        (st.recovering ? ` · ${st.recovering} recuperan` : "") +
        (st.live ? "" : " · archivo")
      : `Sin partidos en ${filterWeek}`;
    updateGridCount(st);
  }

  function updateGridCount(st, shown = null) {
    const note = $("fx-grid-count");
    if (!note) return;
    if (!st || !filterWeek) {
      note.hidden = true;
      note.textContent = "";
      return;
    }
    const n = st.n;
    const filtered = shown != null && shown !== n;
    note.hidden = false;
    note.innerHTML = filtered
      ? `<strong>${escAttr(String(shown))}</strong> de ${escAttr(String(n))} partido${n === 1 ? "" : "s"} en ${escAttr(filterWeek)}`
      : `<strong>${escAttr(String(n))}</strong> partido${n === 1 ? "" : "s"} fixtureado${n === 1 ? "" : "s"} en ${escAttr(filterWeek)}`;
  }

  function gridPillSet(label, items, current, attr, total) {
    const allLabel = attr === "cat" ? "Todas" : "Todos";
    return `<div class="res-filter">
      <span>${label}</span>
      <div class="pills">
        <button class="pill${current === "" ? " on" : ""}" type="button" data-fx-grid-${attr}="">${allLabel} <small>${total}</small></button>
        ${items
          .map(
            (item) =>
              `<button class="pill${current === item.value ? " on" : ""}" type="button" data-fx-grid-${attr}="${escAttr(item.value)}">${escAttr(item.label || item.value)} <small>${item.n}</small></button>`
          )
          .join("")}
      </div>
    </div>`;
  }

  function filterGridMatches(list) {
    const days = [...new Set(list.map((m) => m.day).filter(Boolean))].sort(
      (a, b) => DAYS.indexOf(a) - DAYS.indexOf(b) || String(a).localeCompare(String(b), "es")
    );
    const cats = [...new Set(list.map((m) => m.cat || "Sin categoría"))].sort(compareCats);
    const venues = [...new Set(list.map((m) => m.venue).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    if (gridDay && !days.includes(gridDay)) gridDay = "";
    if (gridCat && !cats.includes(gridCat)) gridCat = "";
    if (gridVenue && !venues.includes(gridVenue)) gridVenue = "";
    const q = fold(gridTerm);
    let shown = list.slice();
    if (gridDay) shown = shown.filter((m) => m.day === gridDay);
    if (gridCat) shown = shown.filter((m) => (m.cat || "Sin categoría") === gridCat);
    if (gridVenue) shown = shown.filter((m) => m.venue === gridVenue);
    if (q) {
      shown = shown.filter((m) =>
        queryMatchesText(
          `${m.home || ""} ${m.away || ""} ${m.venue || ""} ${m.court || ""} ${m.cat || ""} ${m.day || ""} ${m.time || ""}`,
          q
        )
      );
    }
    return { days, cats, venues, shown };
  }

  function renderGridFilters(list, { days, cats, venues }) {
    const box = $("fx-filters");
    if (!box) return;
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = `${gridPillSet(
      "Día",
      days.map((value) => ({ value, n: list.filter((m) => m.day === value).length })),
      gridDay,
      "day",
      list.length
    )}
    ${gridPillSet(
      "Categoría",
      cats.map((value) => ({ value, n: list.filter((m) => (m.cat || "Sin categoría") === value).length })),
      gridCat,
      "cat",
      list.length
    )}
    ${gridPillSet(
      "Cancha",
      venues.map((value) => ({ value, n: list.filter((m) => m.venue === value).length })),
      gridVenue,
      "venue",
      list.length
    )}
    <input class="admin-search" data-fx-grid-search type="search" placeholder="Buscar pareja, jugador o complejo…" autocomplete="off" value="${escAttr(gridTerm)}" />`;
  }

  function needsCourt(m) {
    return !String(m?.venue || "").trim() || !String(m?.court || "").trim();
  }

  function daysOfPair(label, cat) {
    const season = String(filterTemp || "").toUpperCase();
    const found = (ctx.pairs || []).find((p) => {
      if (isAbandonedPair(p)) return false;
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
    const taken = takenCourts(match);
    return driveCourtOptions(
      {
        ...match,
        homeDays: match.homeDays || daysOfPair(match.home, match.cat),
        awayDays: match.awayDays || daysOfPair(match.away, match.cat),
      },
      loadedSlots,
      taken
    );
  }

  function availHint(days) {
    if (!days || typeof days !== "object") return "";
    return Object.entries(days)
      .map(([d, h]) => `${d} ${h}`)
      .join(" · ");
  }

  /** True si esa etiqueta también figura como pendiente en esta fecha. */
  function coverIsAlsoPending(coverLabel, exclude) {
    const cover = String(coverLabel || "").trim();
    if (!cover) return false;
    return (ctx.fixture || []).some((m) => {
      if (m === exclude) return false;
      if (!isPending(m)) return false;
      if (seasonOf(m) !== filterTemp || (m.week || "") !== filterWeek) return false;
      return pairsMatch(m.home, cover);
    });
  }

  /**
   * Turnos libres del Drive anclados a la pendiente.
   * Ambas parejas tienen que entrar enteras en el turno (nunca fuera de inscripción).
   */
  function coverCourtChoices(match, coverLabel) {
    const cover = String(coverLabel || "").trim();
    if (!cover) {
      return { opts: [], nearOpts: [], estimateOpts: [], homeDays: null, coverDays: null, bothPending: false, shareWindow: false };
    }
    // Inscripciones primero (no reusar days viejos del partido).
    const homeDays = daysOfPair(match.home, match.cat) || match.homeDays || match.days;
    const coverDays = daysOfPair(cover, match.cat) || undefined;
    const bothPending = coverIsAlsoPending(cover, match);
    const shareWindow = !!(homeDays && coverDays && pairsSharePlayableWindow(homeDays, coverDays));
    if (!homeDays) {
      return { opts: [], nearOpts: [], estimateOpts: [], homeDays: null, coverDays: coverDays || null, bothPending, shareWindow };
    }
    // Sin disponibilidad de quien cubre no ofrecemos turnos: evitar fixturear fuera de inscripción.
    if (!coverDays) {
      return { opts: [], nearOpts: [], estimateOpts: [], homeDays, coverDays: null, bothPending, shareWindow: false };
    }
    const taken = takenCourts(match);
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
      taken,
      { softAway: false }
    );
    // Exactos arriba. Después cercanos (desfase chico) y, si no coinciden,
    // todas las canchas libres del Drive como horarios estimables.
    const exactKeys = new Set(opts.map((o) => o.key));
    const flex = nearCoverCourtOptions({ homeDays, awayDays: coverDays }, loadedSlots, taken, {
      includeFar: true,
    }).filter((o) => !exactKeys.has(o.key));
    const nearOptsAll = flex.filter((o) => o.close);
    const estimateOptsAll = flex.filter((o) => !o.close);
    // Cancha libre: se listan TODOS los inicios (17:00 y también 16:30 y 18:00).
    // Son alternativas para un solo partido, no turnos simultáneos.
    const tag = (o) => ({ ...o, openDay: courtDayIsOpen(o.day, o.venue, o.court, taken) });
    const listed = [...opts, ...nearOptsAll, ...estimateOptsAll].map(tag);
    const nearOpts = listed.filter((o) => o.close);
    const estimateOpts = listed.filter((o) => o.estimate);
    const packedExact = listed.filter((o) => !o.near);
    return { opts: packedExact, nearOpts, estimateOpts, homeDays, coverDays, bothPending, shareWindow };
  }

  function coverSlotSelect(i, match, coverLabel, { attr = "", selected = "", step = "2. " } = {}) {
    const label = "Elegir día, complejo y cancha";
    const dataAttr = attr || `data-fx-cover-slot="${i}"`;
    if (!loadedSlots.length) {
      return `<select disabled aria-label="${label}"><option>Leé el Drive para ver canchas</option></select>`;
    }
    const { opts, nearOpts, estimateOpts, homeDays, coverDays } = coverCourtChoices(match, coverLabel);
    if (!homeDays) {
      return `<select disabled aria-label="${label}"><option>Falta la disponibilidad de la pareja pendiente</option></select>`;
    }
    if (!coverDays) {
      return `<select disabled aria-label="${label}" title="Falta la disponibilidad de quien cubre en Inscripciones"><option>Falta la disponibilidad de quien cubre</option></select>`;
    }
    if (!opts.length && !nearOpts.length && !estimateOpts.length) {
      return `<select disabled aria-label="${label}" title="No quedó ninguna cancha libre en el Sheet de esta fecha"><option>Sin cancha libre en el Drive</option></select>`;
    }

    const renderOpts = (list, { near = false, includeDay = false } = {}) =>
      list
        .map((o) => {
          const court = String(o.court || "").trim();
          const courtTxt = /^cancha\b/i.test(court) ? court : court ? `Cancha ${court}` : "";
          const base = [includeDay ? o.day : "", o.time, o.venue, courtTxt].filter(Boolean).join(" · ");
          const bits = [base];
          if (near && o.nearLabel) bits.push(o.nearLabel);
          const text = bits.join(" · ");
          return `<option value="${escAttr(o.key)}"${selected && o.key === selected ? " selected" : ""}>${escAttr(text)}</option>`;
        })
        .join("");

    const groupsByDay = (list, { near = false } = {}) => {
      const byDay = new Map();
      for (const o of list) {
        const day = o.day || "Sin día";
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(o);
      }
      const dayRank = (day) => {
        const i = DAYS.indexOf(day);
        return i < 0 ? DAYS.length : i;
      };
      return [...byDay.entries()]
        .sort((a, b) => dayRank(a[0]) - dayRank(b[0]) || a[0].localeCompare(b[0], "es"))
        .map(([day, dayList]) => {
          const sorted = [...dayList].sort(
            (a, b) =>
              bestKnownMiss(a) - bestKnownMiss(b) ||
              String(a.time || "").localeCompare(String(b.time || ""), "es") ||
              String(a.venue || "").localeCompare(String(b.venue || ""), "es") ||
              String(a.court || "").localeCompare(String(b.court || ""), "es", { numeric: true })
          );
          return `<optgroup label="${escAttr(day)} · ${sorted.length} turno${sorted.length === 1 ? "" : "s"}">
            ${renderOpts(sorted, { near, includeDay: true })}
          </optgroup>`;
        })
        .join("");
    };

    const cercanos = [];
    const estimables = [];
    const libres = [];
    for (const o of [...nearOpts, ...estimateOpts]) {
      const tier = coverSlotTier(o);
      if (tier === "near") cercanos.push(o);
      else if (tier === "estimate") estimables.push(o);
      else libres.push(o);
    }
    const total = opts.length + cercanos.length + estimables.length + libres.length;
    const parts = [];
    if (opts.length) parts.push(`${opts.length} exacto${opts.length === 1 ? "" : "s"}`);
    if (cercanos.length) parts.push(`${cercanos.length} cercano${cercanos.length === 1 ? "" : "s"}`);
    if (estimables.length) parts.push(`${estimables.length} estimable${estimables.length === 1 ? "" : "s"}`);
    if (libres.length) parts.push(`${libres.length} en cancha vacía`);
    const placeholder = `${match?.dupHold ? "" : step}Elegir entre ${parts.join(" + ")}…`;
    const hint = "Orden: exactos, cercanos, estimables y al final cancha vacía. Esos turnos libres suelen ser los más lejos: se proponen por si pueden jugar.";
    // Separadores con <option disabled> (no anidar optgroup).
    const exactBlock = opts.length
      ? `<option disabled value="">── Exactos (entran las dos) ──</option>
      ${groupsByDay(opts)}`
      : "";
    const nearBlock = cercanos.length
      ? `<option disabled value="">────────────────────────────────</option>
      <option disabled value="">── Cercanos · poco desfase (aflojan) ──</option>
      ${groupsByDay(cercanos, { near: true })}`
      : "";
    const estimateBlock = estimables.length
      ? `<option disabled value="">────────────────────────────────</option>
      <option disabled value="">── Estimables ──</option>
      ${groupsByDay(estimables, { near: true })}`
      : "";
    const openBlock = libres.length
      ? `<option disabled value="">────────────────────────────────</option>
      <option disabled value="">── Cancha vacía · turnos libres, por si pueden ──</option>
      ${groupsByDay(libres, { near: true })}`
      : "";

    return `<select ${dataAttr} aria-label="${label}" title="${escAttr(hint)}" data-fx-cover-total="${total}">
      <option value="">${escAttr(placeholder)}</option>
      ${exactBlock}
      ${nearBlock}
      ${estimateBlock}
      ${openBlock}
    </select>`;
  }

  function courtOptionText(option) {
    const court = String(option.court || "").trim();
    const courtTxt = /^cancha\b/i.test(court) ? court : court ? `Cancha ${court}` : "";
    const near = option?.near && option.nearLabel ? option.nearLabel : "";
    return [option.day, option.time, option.venue, courtTxt, near].filter(Boolean).join(" · ");
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
    if (!box) return { rematch: new Set(), conflict: new Set() };
    const list = games.map(({ m, i }) => ({ m, i, weeks: previousMeetings(m) })).filter((x) => x.weeks.length);
    const weekMatches = games.map(({ m }) => m);
    const conflicts = findCourtConflicts(weekMatches);
    const conflictIdx = new Set();
    for (const g of conflicts) {
      for (const m of g.matches) {
        const hit = games.find((row) => row.m === m);
        if (hit) conflictIdx.add(hit.i);
      }
    }
    const parts = [];
    if (conflicts.length) {
      parts.push(`<h3>Cancha doble · ${conflicts.length} horario${conflicts.length === 1 ? "" : "s"}</h3>
        <p class="admin-help">Hay más de un partido en la misma cancha, día y horario. Cambiá complejo/cancha o horario antes de publicar.</p>
        <ul>${conflicts
          .map((g) => {
            const pairs = g.matches
              .map((m) => `<strong>${escAttr(m.home)}</strong> vs <strong>${escAttr(m.away)}</strong>`)
              .join(" · ");
            return `<li><span>${escAttr(g.day)} ${escAttr(g.time)} · ${escAttr(g.venue)} · ${escAttr(g.court)}</span> — ${pairs}</li>`;
          })
          .join("")}</ul>`);
    }
    if (list.length) {
      parts.push(`<h3>Revisar · ${list.length} cruce${list.length === 1 ? "" : "s"} repetido${list.length === 1 ? "" : "s"}</h3>
        <p class="admin-help">Estas parejas ya se enfrentaron en esta temporada. El fixtureador lo evita cuando hay otra opción; si está bien así, podés publicar igual.</p>
        <ul>${list
          .map(
            ({ m, weeks }) =>
              `<li><strong>${escAttr(m.home)}</strong> vs <strong>${escAttr(m.away)}</strong> <span>${escAttr(m.cat)} · ya jugaron en ${escAttr(weeks.join(", "))}</span></li>`
          )
          .join("")}</ul>`);
    }
    box.hidden = !parts.length;
    box.innerHTML = parts.join("");
    return { rematch: new Set(list.map((x) => x.i)), conflict: conflictIdx };
  }

  function weekRows(pred) {
    return ctx.fixture
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => pred(m) && seasonOf(m) === filterTemp && (m.week || "") === filterWeek);
  }

  function pendingCards(rows, { makeup = false } = {}) {
    const cats = [...new Set(rows.map(({ m }) => m.cat || "Sin categoría"))];
    const pools = matchPools();
    return cats
      .map((cat) => {
        const group = rows.filter(({ m }) => (m.cat || "Sin categoría") === cat);
        return `<div class="fx-pending-cat">
          <h4>${escAttr(cat)}</h4>
          ${group
            .map(({ m, i }) => {
              const covers = coverCandidates({
                match: m,
                pairs: ctx.pairs || [],
                pools,
                temp: filterTemp,
              });
              const draft = coverDraft.get(i) || "";
              const pendingDays = daysOfPair(m.home, m.cat) || m.homeDays || m.days;
              const daysTxt = availHint(pendingDays);
              const from = m.recoverFrom || m.week || "";
              const quit = makeup
                ? `<button class="btn btn-ghost" type="button" data-fx-recover-del="${i}">Quitar</button>`
                : `<button class="btn btn-ghost" type="button" data-fx-del="${i}">Quitar</button>`;
              return `<article class="fx-pending-card" data-i="${i}">
                <strong>${escAttr(m.home)}</strong>
                ${makeup && from ? `<p class="admin-help" style="margin:4px 0 0">Le falta 1 partido en ${escAttr(from)}. Ese partido cuenta en ${escAttr(from)}, no suma otro en esta fecha.</p>` : ""}
                ${daysTxt ? `<p class="admin-help" style="margin:4px 0 0">Puede: ${escAttr(daysTxt)}</p>` : ""}
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
                  ${quit}
                </div>
              </article>`;
            })
            .join("")}
        </div>`;
      })
      .join("");
  }

  function facedBefore(m, history = null) {
    const pool = history || [...(ctx.results || []), ...(ctx.fixture || [])];
    return rematchWeeks(m, pool);
  }

  /** Si el cruce ya se jugó, queda en Duplicados (igual que al armar fixture). */
  function holdIfRematch(match) {
    const weeks = facedBefore(match);
    if (!weeks.length) return [];
    match.dupHold = true;
    foldOpen.add("dup");
    return weeks;
  }

  function duplicateRows() {
    return ctx.fixture
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => {
        if (seasonOf(m) !== filterTemp || !m.dupHold || !isRealPairMatch(m)) return false;
        if ((m.week || "") === filterWeek) return true;
        // Recupero cubierto desde esta fecha: se ve acá hasta autorizar.
        return !!(m.recoverFrom && (m.recoveredIn || "") === filterWeek);
      });
  }

  function foldBox(box, { key, title, help, count, body, tone }) {
    if (!box) return;
    const open = foldOpen.has(key);
    box.hidden = false;
    box.className = `fx-fold ${tone || ""}`.trim();
    box.innerHTML = `<button class="fx-fold-head" type="button" data-fx-fold="${key}" aria-expanded="${open ? "true" : "false"}">
        <span>
          <strong>${escAttr(title)} · ${count}</strong>
          <span class="admin-help">${help}</span>
        </span>
        <span class="fx-fold-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
      </button>
      <div class="fx-fold-body"${open ? "" : " hidden"}>${body}</div>`;
  }

  function renderPending() {
    const box = $("fx-pending");
    if (!box) return;
    const pending = weekRows((m) => isPending(m) && !isMakeupPending(m));
    for (const key of [...coverDraft.keys()]) {
      if (!pending.some(({ i }) => i === key) && !recoverRows().some(({ i }) => i === key)) {
        coverDraft.delete(key);
      }
    }
    foldBox(box, {
      key: "pending",
      title: "Pendientes",
      tone: "",
      count: pending.length,
      help: "Sin rival con turno exacto en el Drive (o número impar). Al cubrir: primero exactos; si no hay, cercanos, estimables o cancha vacía.",
      body: pending.length ? pendingCards(pending) : `<p class="admin-help">No hay pendientes en esta fecha.</p>`,
    });
  }

  function syncRecoveries() {
    if (!filterTemp || !filterWeek || !isLiveWeek(filterTemp, filterWeek)) return;
    const history = [...(ctx.results || []), ...(ctx.fixture || [])];
    const pulled = importRecoveryDebts(ctx.fixture, {
      temp: filterTemp,
      week: filterWeek,
      history,
      pairs: ctx.pairs || [],
    });
    if (!pulled.added) return;
    ctx.fixture = pulled.matches;
    // Alineación automática (recuperos / bajas abandonadas): no es edición del usuario.
    // Si marcamos dirty acá, el badge queda trabado en cada visita a Fixture.
    if (!ctx.dirty.has("fixture")) {
      ctx.fixturePublished = structuredClone(ctx.fixture);
    }
  }

  function recoverRows() {
    return ctx.fixture
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => {
        if (seasonOf(m) !== filterTemp || !isMakeupPending(m)) return false;
        if ((m.recoveredIn || "") === filterWeek) return true;
        return !m.recoveredIn && (m.week || "") === filterWeek;
      });
  }

  function renderRecover() {
    const box = $("fx-recover-box");
    if (!box) return;
    const rows = recoverRows();
    foldBox(box, {
      key: "recover",
      title: "Recuperan fecha",
      tone: "is-recover",
      count: rows.length,
      help: "Tienen un partido menos. El partido queda en la fecha que les falta: no suma otro en esta.",
      body: rows.length ? pendingCards(rows, { makeup: true }) : `<p class="admin-help">Nadie recupera en esta fecha.</p>`,
    });
  }

  function renderDuplicates() {
    const box = $("fx-dup-box");
    if (!box) return;
    const rows = duplicateRows();
    const cats = [...new Set(rows.map(({ m }) => m.cat || "Sin categoría"))];
    const body = rows.length
      ? cats
          .map((cat) => {
            const group = rows.filter(({ m }) => (m.cat || "Sin categoría") === cat);
            return `<div class="fx-pending-cat">
              <h4>${escAttr(cat)}</h4>
              ${group
                .map(({ m, i }) => {
                  const weeks = facedBefore(m);
                  const slot = [m.day, m.time].filter(Boolean).join(" ");
                  const place = [m.venue, m.court].filter(Boolean).join(" · ");
                  const when = slot || place ? `${slot}${place ? ` · ${place}` : ""}` : "Sin cancha · prearmado";
                  return `<article class="fx-pending-card" data-i="${i}">
                    <strong>${escAttr(m.home)} vs ${escAttr(m.away)}</strong>
                    <p class="admin-help" style="margin:4px 0 0">${weeks.length ? `Ya jugaron en ${escAttr(weeks.join(", "))}. ` : ""}${escAttr(when)}</p>
                    <div class="fx-pending-actions">
                      ${coverSlotSelect(i, m, m.away)}
                      <button class="btn btn-lime" type="button" data-fx-dup-ok="${i}">Autorizar</button>
                      <button class="btn btn-ghost" type="button" data-fx-del="${i}">Quitar</button>
                    </div>
                  </article>`;
                })
                .join("")}
            </div>`;
          })
          .join("")
      : `<p class="admin-help">Ningún cruce repetido.</p>`;
    foldBox(box, {
      key: "dup",
      title: "Duplicados",
      tone: "is-dup",
      count: rows.length,
      help: "Ya se enfrentaron. Quedan prearmados, con cancha y horario si coinciden, y no entran al fixture hasta que los autorices.",
      body,
    });
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

  /** Partidos de esta fecha que ya tomaron una cancha del Drive (sin repetir). */
  function weekTakenCourts() {
    return (ctx.fixture || []).filter((m) => {
      if (seasonOf(m) !== filterTemp || (m.week || "") !== filterWeek) return false;
      if (!String(m?.venue || "").trim() || !String(m?.court || "").trim()) return false;
      if (!normalizeDay(m.day)) return false;
      const win = parseCourtWindow(m.time);
      return !!(win && win.to > win.from);
    });
  }

  function courtSlotSummary() {
    return summarizeCourtSlots(loadedSlots, weekTakenCourts());
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
    const summary = courtSlotSummary();
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
    const summary = courtSlotSummary();
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
    const planned = plan.reduce((n, p) => n + Math.max(0, Number(p.count) || 0), 0);
    const used = weekTakenCourts().length;
    // Si ya hay partidos en cancha, Asignados refleja eso; si no, el plan «Partidos a usar».
    const assigned = used > 0 ? used : planned;
    const freeTotal = summary.reduce((n, s) => n + s.total, 0);
    const sheetTotal = summary.reduce((n, s) => n + (Number(s.sheetTotal) || s.total), 0);
    const pairs = playablePairCount();
    const need = matchesNeeded();
    const over = Boolean(need && planned > need);
    const leftNeed = Math.max(0, need - assigned);
    const sheetTxt =
      used > 0 && sheetTotal !== freeTotal
        ? `Sheet: ${freeTotal} libres (de ${sheetTotal})`
        : `Sheet: ${sheetTotal} posibles`;
    const text = need
      ? `Asignados: ${assigned} / ${need}` +
        (over
          ? ` · ¡Pasaste el cupo!`
          : leftNeed
            ? ` · Quedan por asignar: ${leftNeed}`
            : " · completo") +
        (used > 0 && planned > 0 ? ` · Plan armar: ${planned}` : "") +
        ` · ${pairs} parejas jugables (máx. ${MAX_PAIR_MATCHES} PJ c/u) · ${sheetTxt}`
      : `Sin parejas jugables (o todas en tope de ${MAX_PAIR_MATCHES} PJ) · ${sheetTxt}`;
    if (el) {
      el.hidden = false;
      el.textContent = text;
      el.className =
        "fx-plan-summary" + (over ? " is-err" : need && assigned >= need ? " is-ok" : "");
    }
    if (status && loadedSlots.length) {
      status.hidden = false;
      status.textContent = `Drive${slotsFileName ? ` · ${slotsFileName}` : ""}: ${sheetTxt} · ${summary.length} complejos · ${text}`;
    }
  }

  function renderAdvanced() {
    const panel = $("fx-advanced");
    const list = $("fx-advanced-list");
    const build = $("fx-build");
    const toggle = $("fx-advanced-toggle");
    const status = $("fx-slots-status");
    const summary = courtSlotSummary();
    const used = weekTakenCourts().length;
    const live = isLiveWeek(filterTemp, filterWeek);
    const slotsReady = summary.length > 0 && live;
    if (build) build.hidden = !(slotsReady && loadedSlots.length);
    if (toggle) {
      toggle.hidden = !(slotsReady && loadedSlots.length);
      toggle.classList.toggle("on", advancedMode);
      toggle.setAttribute("aria-expanded", advancedMode ? "true" : "false");
    }
    if (status) {
      status.hidden = !loadedSlots.length;
      const freeTotal = summary.reduce((n, s) => n + s.total, 0);
      const sheetTotal = summary.reduce((n, s) => n + (Number(s.sheetTotal) || s.total), 0);
      const base = loadedSlots.length
        ? `Drive${slotsFileName ? ` · ${slotsFileName}` : ""}: ${
            used > 0 && sheetTotal !== freeTotal
              ? `${freeTotal} libres (de ${sheetTotal})`
              : `${sheetTotal} partidos posibles`
          } · ${summary.length} complejo${summary.length === 1 ? "" : "s"}`
        : "";
      status.textContent = base
        ? `${base}${advancedMode ? "." : " · Armar usa todos los horarios (sin cupo por complejo)."}`
        : "";
    }
    if (!panel || !list) return;
    const showPlan = slotsReady && advancedMode;
    panel.hidden = !showPlan;
    if (!showPlan) {
      list.innerHTML = "";
      const planSummary = $("fx-plan-summary");
      if (planSummary) planSummary.hidden = true;
      return;
    }
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
        const sheetRow = Number(row.sheetTotal) || row.total;
        const dayChecks = DAYS.map((day) => {
          const avail = row.daySet.has(day);
          const dayRow = row.days.find((d) => d.day === day);
          const n = dayRow?.count || 0;
          const sheetN = dayRow?.sheet || n;
          const checked = avail && selectedDays.has(day);
          const title = avail
            ? used > 0 && sheetN !== n
              ? `${n} libre${n === 1 ? "" : "s"} de ${sheetN} en el Sheet este día`
              : `${n} partido${n === 1 ? "" : "s"} de 1:30 caben este día en el Sheet`
            : "Sin turnos este día en el Sheet";
          return `<label class="ball-check${!avail ? " is-disabled" : ""}" title="${escAttr(title)}">
            <input type="checkbox" data-fx-day value="${escAttr(day)}"${checked ? " checked" : ""}${avail ? "" : " disabled"} />
            <span class="ball-check-face">${BALL_SVG}</span>
            <span class="ball-check-label">${escAttr(day)}${avail ? ` · ${n} disp.` : ""}</span>
          </label>`;
        }).join("");
        const venueHelp =
          used > 0 && sheetRow !== row.total
            ? `${row.total} libres (de ${sheetRow} en el Sheet)`
            : `${row.total} posibles en el Sheet`;
        return `<article class="fx-venue-card" data-fx-venue="${escAttr(row.venue)}">
          <div class="fx-venue-top">
            <div>
              <strong>${escAttr(row.venue)}</strong>
              <p class="admin-help">${venueHelp} · cupo de la fecha: ${need} · la suma de todos no puede pasar ${need}</p>
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

  function scheduleOpts() {
    const ligaVenues = (ctx.siteData.venues || []).filter((v) => v.liga !== false).map((v) => v.name).filter(Boolean);
    const base = scheduleOptionsFromSlots(loadedSlots, ctx.fixture || []);
    const venues = [...new Set([...ligaVenues, ...base.venues])].sort((a, b) => a.localeCompare(b, "es"));
    return { ...base, venues };
  }

  /** Parejas de la fecha que ya tienen partido con rival (para avisar en el desplegable). */
  function playingThisWeek() {
    const out = [];
    for (const m of ctx.fixture || []) {
      if (seasonOf(m) !== filterTemp || (m.week || "") !== filterWeek) continue;
      if (isPending(m) || !isRealPairMatch(m)) continue;
      out.push(m.home, m.away);
    }
    return out;
  }

  function newDraftMatch() {
    const d = newDraft || {};
    return {
      week: filterWeek,
      temp: filterTemp,
      cat: d.cat || "",
      home: d.home || "",
      away: d.away || "",
      day: "",
      time: "",
      venue: "",
      court: "",
      result: "",
    };
  }

  function renderNewMatch() {
    const box = $("fx-new");
    if (!box) return;
    if (!newDraft || !isLiveWeek(filterTemp, filterWeek)) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const d = newDraft;
    const playing = playingThisWeek();
    const tag = (label) => (playing.some((p) => pairsMatch(p, label)) ? " · ya juega esta fecha" : "");
    const pairOpts = (list, value, empty) =>
      `<option value="">${escAttr(empty)}</option>` +
      list
        .map(
          (p) =>
            `<option value="${escAttr(p)}"${pairsMatch(p, value) ? " selected" : ""}>${escAttr(p + tag(p))}</option>`
        )
        .join("");

    const catsWithPairs = CATS.filter(
      (c) => rivalOptionsFromPairs({ pairs: ctx.pairs || [], temp: filterTemp, cat: c }).length >= 2
    );
    const homes = d.cat ? rivalOptionsFromPairs({ pairs: ctx.pairs || [], temp: filterTemp, cat: d.cat }) : [];
    const aways = d.home ? homes.filter((p) => !pairsMatch(p, d.home)) : [];

    let slotSel = `<select disabled aria-label="Horario"><option>4. Primero elegí las dos parejas</option></select>`;
    let hint = "";
    let canAdd = false;
    if (d.home && d.away) {
      const m = newDraftMatch();
      // Mismo desplegable que «Cubrir con»: exactos, cercanos, estimables y cancha vacía.
      slotSel = coverSlotSelect(-1, m, m.away, { attr: 'data-fx-new="slot"', selected: d.slot, step: "4. " });
      canAdd = !!d.slot && !!newSlotOption(d.slot);
      const homeDays = daysOfPair(m.home, m.cat);
      const awayDays = daysOfPair(m.away, m.cat);
      if (homeDays && awayDays) hint = `Disponibilidad: ${availHint(homeDays)} — ${availHint(awayDays)}`;
      const weeks = facedBefore(m);
      if (weeks.length) hint = `Ya se enfrentaron en ${weeks.join(", ")}: va a quedar en Duplicados.${hint ? ` ${hint}` : ""}`;
    }

    box.hidden = false;
    box.innerHTML = `<section class="fx-new-match" aria-label="Nuevo partido">
      <h4>Nuevo partido · ${escAttr(filterWeek)}</h4>
      <div class="fx-pending-actions">
        <select data-fx-new="cat" aria-label="Categoría">
          <option value="">1. Categoría…</option>
          ${catsWithPairs.map((c) => `<option value="${escAttr(c)}"${c === d.cat ? " selected" : ""}>${escAttr(c)}</option>`).join("")}
        </select>
        <select data-fx-new="home" aria-label="Pareja 1"${d.cat ? "" : " disabled"}>
          ${pairOpts(homes, d.home, d.cat ? "2. Pareja 1…" : "2. Primero elegí categoría")}
        </select>
        <select data-fx-new="away" aria-label="Pareja 2"${d.home ? "" : " disabled"}>
          ${pairOpts(aways, d.away, d.home ? "3. Pareja 2…" : "3. Primero elegí pareja 1")}
        </select>
        ${slotSel}
        <button class="btn btn-lime" type="button" data-fx-new-ok${canAdd ? "" : " disabled"}>Agregar</button>
        <button class="btn btn-ghost" type="button" data-fx-new-cancel>Cancelar</button>
      </div>
      ${hint ? `<p class="admin-help" style="margin:6px 0 0">${escAttr(hint)}</p>` : ""}
    </section>`;
  }

  function newSlotOption(key) {
    if (!key || !newDraft?.home || !newDraft?.away) return null;
    const m = newDraftMatch();
    const c = coverCourtChoices(m, m.away);
    return (
      c.opts.find((o) => o.key === key) ||
      c.nearOpts.find((o) => o.key === key) ||
      c.estimateOpts.find((o) => o.key === key) ||
      null
    );
  }

  async function addNewMatch() {
    if (!newDraft?.home || !newDraft?.away || !newDraft?.slot) return;
    const base = newDraftMatch();
    const opt = newSlotOption(newDraft.slot);
    if (!opt) {
      toast("Ese horario ya no está libre. Elegí otro.", "err");
      newDraft.slot = "";
      renderNewMatch();
      return;
    }
    if (opt.near || opt.estimate) {
      const ok = await confirmModal({
        title: opt.estimate ? "Horario estimable" : "Horario cercano",
        body:
          `No entran exactas en 1:30 según Inscripciones. La cancha está libre: ${courtOptionText(opt)}` +
          (opt.nearLabel ? ` (${opt.nearLabel})` : "") +
          ". Alguna pareja afloja su disponibilidad. ¿Lo usamos igual?",
        confirmLabel: "Usar igual",
        danger: true,
      });
      if (!ok) return;
    }
    const match = cleanMatch(
      {
        ...base,
        day: opt.day,
        time: opt.time,
        venue: opt.venue,
        court: opt.court,
        ...(opt.near ? { flexAvail: true } : {}),
      },
      {},
      filterTemp
    );
    // Si alguna estaba en Pendientes esta fecha, deja de estarlo.
    ctx.fixture = (ctx.fixture || []).filter(
      (m) =>
        !(
          isPending(m) &&
          !m.recoverFrom &&
          seasonOf(m) === filterTemp &&
          (m.week || "") === filterWeek &&
          (pairsMatch(m.home, base.home) || pairsMatch(m.home, base.away))
        )
    );
    ctx.fixture.push(match);
    const rematch = holdIfRematch(match);
    coverDraft.clear();
    newDraft = null;
    editing = -1;
    shell.markDirty("fixture");
    render();
    toast(
      rematch.length
        ? `Cruce repetido (ya jugaron en ${rematch.join(", ")}) · quedó en Duplicados`
        : `Partido agregado · ${courtOptionText(opt)}`,
      "ok"
    );
  }

  function selectField(k, value, options, { allowEmpty = false, emptyLabel = "—" } = {}) {
    const opts = [...options];
    if (value && !opts.some((o) => String(o) === String(value))) opts.unshift(value);
    return `<select data-k="${k}" aria-label="${escAttr(k)}">
      ${allowEmpty ? `<option value="">${escAttr(emptyLabel)}</option>` : ""}
      ${opts.map((o) => `<option value="${escAttr(o)}"${String(o) === String(value) ? " selected" : ""}>${escAttr(o)}</option>`).join("")}
    </select>`;
  }

  function renderTable() {
    const live = isLiveWeek(filterTemp, filterWeek);
    const detail = $("fx-detail");
    if (detail) detail.hidden = false;
    const build = $("fx-build");
    const driveBtn = $("fx-drive");
    const add = $("fx-add");
    const bar = $("fx-publish")?.closest(".admin-sticky-bar");
    const dl = $("fx-download-wrap");
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
    renderNewMatch();
    const sched = scheduleOpts();

    if (!live) {
      const archKeys = new Set();
      const arch = (ctx.results || [])
        .filter((m) => seasonOf(m) === filterTemp && (m.week || "") === filterWeek && isRealPairMatch(m))
        .concat(
          (ctx.fixture || []).filter(
            (m) =>
              seasonOf(m) === filterTemp &&
              (m.week || "") === filterWeek &&
              isRealPairMatch(m) &&
              !isPending(m) &&
              m.recoverFrom
          )
        )
        .filter((m) => {
          const key = `${m.cat || ""}|${m.home || ""}|${m.away || ""}`;
          if (archKeys.has(key)) return false;
          archKeys.add(key);
          return true;
        })
        .slice()
        .sort(compareByDayTime);
      const empty = $("fx-empty");
      if (empty) {
        empty.hidden = arch.length > 0;
        empty.querySelector("p").textContent = "Esta fecha ya pasó a Resultados. Los scores se cargan ahí.";
      }
      $("fx-warnings").hidden = true;
      $("fx-pending").hidden = true;
      if ($("fx-recover-box")) $("fx-recover-box").hidden = true;
      if ($("fx-dup-box")) $("fx-dup-box").hidden = true;
      const filtered = filterGridMatches(arch);
      renderGridFilters(arch, filtered);
      updateGridCount(weekStats(filterTemp, filterWeek), filtered.shown.length);
      $("fx-body").innerHTML = filtered.shown.length
        ? filtered.shown
            .map(
              (m) => `<tr>
          <td>${escAttr(m.cat || "—")}</td>
          <td>${escAttr(m.day || "—")}</td>
          <td>${escAttr(m.time || "—")}</td>
          <td>${escAttr(m.venue || "—")}</td>
          <td>${escAttr(m.court || "—")}</td>
          <td>${escAttr(m.home)}</td>
          <td>${escAttr(m.away)}</td>
          <td class="col-actions"></td>
        </tr>`
            )
            .join("")
        : `<tr><td colspan="8" class="admin-help">Nadie coincide con el filtro o la búsqueda.</td></tr>`;
      return;
    }

    syncRecoveries();
    renderPending();
    renderRecover();
    renderDuplicates();
    const games = ctx.fixture
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !isPending(m) && !m.dupHold && seasonOf(m) === filterTemp && (m.week || "") === filterWeek)
      .sort((a, b) => compareByDayTime(a.m, b.m));
    const filtered = filterGridMatches(games.map(({ m }) => m));
    renderGridFilters(
      games.map(({ m }) => m),
      filtered
    );
    const shownGames = games.filter(({ m, i }) => filtered.shown.includes(m) || editing === i);
    updateGridCount(weekStats(filterTemp, filterWeek), filtered.shown.length);
    const warnings = renderWarnings(games) || { rematch: new Set(), conflict: new Set() };
    const repeated = warnings.rematch || new Set();
    const conflicted = warnings.conflict || new Set();
    const empty = $("fx-empty");
    if (empty) {
      empty.hidden =
        games.length > 0 ||
        ctx.fixture.some(
          (m) => (isPending(m) || m.dupHold) && seasonOf(m) === filterTemp && (m.week || "") === filterWeek
        );
      empty.querySelector("p").textContent = !loadedSlots.length
        ? "Paso 1: tocá Leer Drive (pestaña con el mismo nombre que esta fecha)."
        : "Paso 2: abajo elegí partidos y días por complejo, y tocá Armar fixture.";
    }
    $("fx-body").innerHTML = shownGames.length
      ? shownGames
      .map(({ m, i }) => {
        const on = editing === i;
        const bare = !on && needsCourt(m);
        const rivals = m.cat
          ? rivalOptionsFromPairs({
              pairs: ctx.pairs || [],
              temp: filterTemp || m.temp,
              cat: m.cat,
            })
          : [];
        const courts = sched.courtsByVenue[m.venue] || [];
        const field = (k, placeholder) => {
          if (!on) return escAttr(m[k] || "");
          if (k === "day") return selectField("day", m.day || "", sched.days, { allowEmpty: true, emptyLabel: "Día…" });
          if (k === "time") return selectField("time", m.time || "", sched.times, { allowEmpty: true, emptyLabel: "Horario…" });
          if (k === "cat") return selectField("cat", m.cat || "", CATS, { allowEmpty: true, emptyLabel: "Categoría…" });
          if (k === "venue") return selectField("venue", m.venue || "", sched.venues, { allowEmpty: true, emptyLabel: "Complejo…" });
          if (k === "court") return selectField("court", m.court || "", courts, { allowEmpty: true, emptyLabel: "Cancha…" });
          if (k === "home") {
            return selectField("home", m.home || "", rivals, { allowEmpty: true, emptyLabel: "Pareja 1…" });
          }
          if (k === "away") {
            const awayOpts = [PENDING_AWAY, ...rivals.filter((r) => !pairsMatch(r, m.home))];
            return selectField("away", m.away || PENDING_AWAY, awayOpts);
          }
          return `<input data-k="${k}" value="${escAttr(m[k])}" placeholder="${placeholder}" />`;
        };
        const titles = [];
        if (conflicted.has(i)) titles.push("Misma cancha, día y horario que otro partido");
        if (repeated.has(i)) titles.push("Ya se enfrentaron en esta temporada");
        if (bare) {
          titles.push(
            "Sin cancha en el cupo elegido. El desplegable lista días y canchas del Drive donde puedan jugar ambas, aunque el complejo ya llegó a la cantidad."
          );
        }
        const cls = [
          conflicted.has(i) ? "is-court-conflict" : "",
          repeated.has(i) ? "is-rematch" : "",
          bare ? "is-uncourted" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<tr data-i="${i}"${cls ? ` class="${cls}"` : ""}${titles.length ? ` title="${escAttr(titles.join(" "))}"` : ""}>
          <td>${on ? field("cat", "A Masculina") : `${escAttr(m.cat || "—")}${m.recoverFrom ? ` · recupera ${escAttr(m.recoverFrom)}` : ""}`}</td>
          <td>${field("day", "Jueves")}</td>
          <td>${field("time", "19:00 - 20:30")}</td>
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
            <button
              class="admin-del admin-pending"
              type="button"
              data-fx-to-pending="${i}"
              aria-label="Marcar como pendiente"
              title="Marcar como pendiente: ambas parejas quedan sin rival"
            >P</button>
            <button class="admin-del" type="button" data-fx-del="${i}" aria-label="Eliminar">×</button>
          </td>
        </tr>`;
      })
      .join("")
      : games.length
        ? `<tr><td colspan="8" class="admin-help">Nadie coincide con el filtro o la búsqueda.</td></tr>`
        : "";
    if (focusEdit && editing >= 0) {
      focusEdit = false;
      $("fx-body")?.querySelector(`tr[data-i="${editing}"] select, tr[data-i="${editing}"] input`)?.focus();
    }
  }

  function matchesInOpenWeek() {
    const live = isLiveWeek(filterTemp, filterWeek);
    const source = live ? ctx.fixture || [] : ctx.results || [];
    return source.filter(
      (m) => seasonOf(m) === filterTemp && (m.week || "") === filterWeek && !isPending(m)
    );
  }

  async function reviewCourtDuplicates() {
    if (!filterTemp || !filterWeek) {
      await noticeModal({ title: "Revisar canchas duplicadas", body: "Entrá a una fecha para revisar." });
      return;
    }
    const conflicts = findCourtConflicts(matchesInOpenWeek());
    if (!conflicts.length) {
      await noticeModal({ title: filterWeek, body: "No hay canchas duplicadas." });
      return;
    }
    const lines = conflicts.map((g) => {
      const who = g.matches.map((m) => `${m.time ? m.time + " " : ""}${m.home} vs ${m.away}`).join(" / ");
      const court = String(g.court || "").trim();
      const courtTxt = /^cancha\b/i.test(court) ? court : court ? `Cancha ${court}` : "";
      return `${g.day} ${g.time} · ${g.venue}${courtTxt ? ` · ${courtTxt}` : ""}\n${who}`;
    });
    if (isLiveWeek(filterTemp, filterWeek)) render();
    const n = conflicts.length;
    await noticeModal({
      title: `${filterWeek}: ${n} cancha${n === 1 ? "" : "s"} duplicada${n === 1 ? "" : "s"}`,
      body: lines.join("\n\n"),
    });
  }

  /** Filas vacías del «+ Partido» viejo (sin categoría ni pareja) que quedaban como pendientes. */
  function purgeBlankRows() {
    const before = (ctx.fixture || []).length;
    ctx.fixture = (ctx.fixture || []).filter(
      (m) => !(!String(m.home || "").trim() && !String(m.cat || "").trim() && !isRealPairMatch(m))
    );
    if (ctx.fixture.length !== before) {
      editing = -1;
      coverDraft.clear();
      shell.markDirty("fixture");
    }
  }

  function render() {
    purgeBlankRows();
    updateSummary();
    renderVenues();
    const root = $("fx-boxes");
    const detail = $("fx-detail");
    if (!root) return;
    const tlist = temps();
    const current = ctx.siteData.currentSeason;

    if (!filterTemp) {
      if (detail) detail.hidden = true;
      if ($("fx-filters")) {
        $("fx-filters").hidden = true;
        $("fx-filters").innerHTML = "";
      }
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
      if ($("fx-filters")) {
        $("fx-filters").hidden = true;
        $("fx-filters").innerHTML = "";
      }
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

  /** Próxima fecha a armar: si ya existe Fecha N, la nueva es N+1. */
  function nextBuildWeek(season) {
    const all = seasonMatches(season);
    const max = all.reduce((n, m) => Math.max(n, weekNumber(m.week)), 0);
    return `Fecha ${max ? max + 1 : 1}`;
  }

  function pairEntries(season) {
    const pools = matchPools();
    return (ctx.pairs || [])
      .filter(
        (p) =>
          String(p.temp || "").toUpperCase() === String(season).toUpperCase() &&
          p.p1 &&
          p.p2 &&
          p.cat &&
          !isAbandonedPair(p)
      )
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

  function setBuildProgress(pct, label) {
    const wrap = $("fx-build-progress");
    const fill = $("fx-build-progress-fill");
    const pctEl = $("fx-build-progress-pct");
    const labelEl = $("fx-build-progress-label");
    const bar = wrap?.querySelector(".fx-build-progress-bar");
    if (!wrap) return;
    const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    wrap.hidden = false;
    if (fill) fill.style.width = `${n}%`;
    if (pctEl) pctEl.textContent = `${n}%`;
    if (labelEl && label) labelEl.textContent = label;
    if (bar) bar.setAttribute("aria-valuenow", String(n));
  }

  function clearBuildProgress() {
    const wrap = $("fx-build-progress");
    const fill = $("fx-build-progress-fill");
    const pctEl = $("fx-build-progress-pct");
    const labelEl = $("fx-build-progress-label");
    const bar = wrap?.querySelector(".fx-build-progress-bar");
    if (!wrap) return;
    wrap.hidden = true;
    if (fill) fill.style.width = "0%";
    if (pctEl) pctEl.textContent = "0%";
    if (labelEl) labelEl.textContent = "Armando fixture…";
    if (bar) bar.setAttribute("aria-valuenow", "0");
  }

  async function tickBuildProgress(pct, label) {
    setBuildProgress(pct, label);
    // 16ms: alcanza a pintar la barra; setTimeout(0) a veces no refresca y parece trabado.
    await new Promise((r) => setTimeout(r, 16));
  }

  async function buildFromFecha() {
    if ((await shell.setSection("fixture")) === false) return;
    if (!loadedSlots.length) {
      setMsg($("fx-msg"), "Primero leé el Drive de canchas para esta fecha.", "err");
      toast("Leé el Drive primero", "err");
      $("fx-drive")?.focus();
      return;
    }
    const summary = summarizeCourtSlots(loadedSlots);
    const need = matchesNeeded();
    let plan = [];
    let plannedSlots;
    let planCapacity = 0;
    let planTxt = "";
    let courtOpts = { onlyEmpty: true, preferPlan: true };

    if (advancedMode) {
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
      plan = rawPlan.filter((p) => p.count > 0 && p.days.length);
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
      // pool = todos los turnos de los días elegidos; venueCaps limita «Partidos a usar».
      plannedSlots = applyVenuePlan(loadedSlots, plan, { mode: "pool" });
      planCapacity = plan.reduce((n, p) => n + Math.max(0, Number(p.count) || 0), 0);
      if (!plannedSlots.length || !planCapacity) {
        setMsg($("fx-msg"), "No hay disponibilidad que coincida con los días y cupos elegidos.", "err");
        toast("Sin cupos para el plan", "err");
        return;
      }
      planTxt = plan.map((p) => `${p.venue}: ${p.count} · ${p.days.join(", ")}`).join(" · ");
      courtOpts = {
        onlyEmpty: true,
        preferPlan: true,
        venueCaps: Object.fromEntries(plan.map((p) => [p.venue, p.count])),
      };
    } else {
      // Sin cupos: todos los horarios del Drive, matching por disponibilidad.
      plannedSlots = applyVenuePlan(loadedSlots, [], { mode: "pool" });
      planCapacity = plannedSlots.length;
      if (!plannedSlots.length) {
        setMsg($("fx-msg"), "El Drive no tiene horarios de cancha para esta fecha.", "err");
        toast("Sin horarios en el Drive", "err");
        return;
      }
      planTxt = `todos los horarios del Drive (${summary.length} complejo${summary.length === 1 ? "" : "s"})`;
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
      const capacityTxt = advancedMode
        ? `${planCapacity} cupo${planCapacity === 1 ? "" : "s"} de cancha (${planTxt})`
        : planTxt;
      const ok = await confirmModal({
        title: `Armar ${week}`,
        body:
          `Se arma ${week} (${seasonLabel(season)}) con ${playable.length} pareja${playable.length === 1 ? "" : "s"} y ${capacityTxt}. ` +
          (warnings.length ? warnings.join(" ") + " " : "") +
          "Cada cancha queda en un solo partido (sin pisarse) y los horarios respetan la disponibilidad de cada pareja. Nada se publica hasta que toques Publicar fixture.",
        confirmLabel: "Armar fixture",
      });
      if (!ok) return;
      setBuildProgress(5, `Preparando ${week}…`);
      await tickBuildProgress(15, "Armando cruces (con canchas del Drive)…");

      const history = [...(ctx.results || []), ...(ctx.fixture || [])].filter(
        (m) => m.temp === temp && m.week !== week && isRealPairMatch(m)
      );
      // Solo armar cruces que tengan al menos un turno del Drive donde entren las dos.
      // Si no, después caían a pendientes aunque “coincidían” en inscripción.
      // Memo por par de inscripciones: no depende de la semilla y era ~1s por intento.
      const sharedMemo = new WeakMap();
      const filterSharedSlots = (slots, entryA, entryB) => {
        let byB = sharedMemo.get(entryA);
        if (!byB) {
          byB = new WeakMap();
          sharedMemo.set(entryA, byB);
        }
        if (byB.has(entryB)) return byB.get(entryB);
        const hit = filterSharedSlotsToDrive(slots, entryA, entryB, plannedSlots);
        byB.set(entryB, hit);
        return hit;
      };

      const mapBuilt = (rawMatches) =>
        attachPairDaysFromPairs(
          rawMatches.map((m) => {
            const cleaned = cleanMatch(m, {}, season);
            if (!cleaned.pending) {
              return {
                ...cleaned,
                homeDays: m.homeDays && typeof m.homeDays === "object" ? m.homeDays : undefined,
                awayDays: m.awayDays && typeof m.awayDays === "object" ? m.awayDays : undefined,
              };
            }
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
          }),
          ctx.pairs || []
        );

      // Semillas baratas (assign) → afinar solo las mejores (rematch + exactos).
      // Antes: 12× rematch completo (~50s c/u) dejaba el Armar trabado en «1/12 · 19%».
      const SEED_TRIES = 8;
      const POLISH_TOP = 2;
      const polishOpts = { ...courtOpts, maxTrials: 80, maxPasses: 14, maxRealPartners: 8 };
      const exactOpts = { ...courtOpts, maxTrials: 36, skipPendingAssign: true, freezeFilled: true };
      const candidates = [];
      for (let t = 0; t < SEED_TRIES; t++) {
        await tickBuildProgress(
          15 + Math.round((t / SEED_TRIES) * 35),
          `Probando armado ${t + 1}/${SEED_TRIES}…`
        );
        buildCount += 1;
        const trialOut = buildFixture({
          entries,
          ranking: ctx.rows,
          history,
          week,
          temp,
          seed: buildCount,
          filterSharedSlots,
        });
        const trialBuilt = mapBuilt(trialOut.matches);
        const trialAssigned = assignCourtSlots(trialBuilt, plannedSlots, courtOpts);
        const trialReleased = releaseOverlappingCourts(trialAssigned.matches);
        const trialFresh = [];
        const trialHeld = [];
        for (const m of trialReleased.matches) {
          if (isRealPairMatch(m) && !isPending(m) && facedBefore(m, history).length) {
            trialHeld.push({ ...m, dupHold: true });
          } else trialFresh.push(m);
        }
        const trialParked = parkBareMatchesAsPending(trialFresh);
        const trialFinal = [...trialHeld, ...trialParked.matches];
        const withCourt = trialFinal.filter(
          (m) => isRealPairMatch(m) && !isPending(m) && !m.dupHold && String(m.venue || "").trim()
        ).length;
        const pend = trialFinal.filter(isPending).length;
        const score = withCourt * 1000 - pend;
        candidates.push({
          out: trialOut,
          built: trialBuilt,
          score,
          withCourt,
          pend,
          assigned: {
            matches: trialAssigned.matches,
            assigned: trialAssigned.assigned,
            skipped: trialAssigned.skipped,
            leftover: trialAssigned.leftover,
            swaps: 0,
          },
          releasedCourts: trialReleased,
          parkedBare: trialParked,
          held: trialHeld,
        });
      }
      candidates.sort((a, b) => b.score - a.score || b.withCourt - a.withCourt);
      const toPolish = candidates.slice(0, Math.min(POLISH_TOP, candidates.length));
      let best = null;
      for (let p = 0; p < toPolish.length; p++) {
        const cand = toPolish[p];
        await tickBuildProgress(
          50 + Math.round((p / Math.max(1, toPolish.length)) * 18),
          `Afinando armado ${p + 1}/${toPolish.length}…`
        );
        // Rematch sobre el borrador original (con bare), no sobre pendientes ya parqueadas.
        const trialAssigned = rematchForCourts(cand.built, plannedSlots, polishOpts);
        const trialReleased = releaseOverlappingCourts(trialAssigned.matches);
        const trialFresh = [];
        const trialHeld = [];
        for (const m of trialReleased.matches) {
          if (isRealPairMatch(m) && !isPending(m) && facedBefore(m, history).length) {
            trialHeld.push({ ...m, dupHold: true });
          } else trialFresh.push(m);
        }
        const trialParked = parkBareMatchesAsPending(trialFresh);
        await tickBuildProgress(
          55 + Math.round(((p + 0.5) / Math.max(1, toPolish.length)) * 18),
          `Exactos ${p + 1}/${toPolish.length}…`
        );
        const exactRaw = pairPendingsWithExactCourts(trialParked.matches, plannedSlots, exactOpts);
        // Red de seguridad: ningún partido con rival queda sin cancha.
        const trialExact = { ...exactRaw, matches: parkBareMatchesAsPending(exactRaw.matches).matches };
        const trialFinal = [...trialHeld, ...trialExact.matches];
        const withCourt = trialFinal.filter(
          (m) => isRealPairMatch(m) && !isPending(m) && !m.dupHold && String(m.venue || "").trim()
        ).length;
        const pend = trialFinal.filter(isPending).length;
        const score = withCourt * 1000 - pend;
        if (!best || score > best.score) {
          best = {
            out: cand.out,
            score,
            withCourt,
            pend,
            assigned: trialAssigned,
            releasedCourts: trialReleased,
            parkedBare: trialParked,
            exactPaired: trialExact,
            held: trialHeld,
          };
        }
      }
      if (!best) {
        const fallback = candidates[0];
        best = {
          ...fallback,
          exactPaired: { matches: fallback.parkedBare?.matches || [], paired: 0 },
        };
      }
      const out = best.out;
      let assigned = best.assigned;
      let releasedCourts = best.releasedCourts;
      let parkedBare = best.parkedBare;
      let exactPaired = best.exactPaired;
      const held = best.held || [];
      await tickBuildProgress(70, "Revisando duplicados y pendientes…");
      // Exactos ya se probaron en el loop; cercanos / estimables / cancha vacía quedan a mano.
      const parkedBad = parkAvailabilityViolations(attachPairDaysFromPairs(exactPaired.matches, ctx.pairs || []));
      let built = parkedBad.matches.map((m) => {
        if (isPending(m)) {
          const days = m.days || m.homeDays;
          return cleanMatch(
            {
              ...m,
              pending: true,
              away: PENDING_AWAY,
              reason: m.reason || "",
              avail: m.avail || "",
              days,
              homeDays: days,
            },
            {},
            season
          );
        }
        // Live: no persistimos homeDays en el JSON público, pero el admin las rehidrata al editar.
        const { days: _days, homeDays: _h, awayDays: _a, ...rest } = m;
        return cleanMatch(rest, {}, season);
      });
      const heldClean = held.map((m) => {
        const { days: _days, homeDays: _h, awayDays: _a, ...rest } = m;
        return { ...cleanMatch(rest, {}, season), dupHold: true };
      });
      built = [...heldClean, ...built];
      const real = built.filter((m) => !isPending(m) && !m.dupHold);
      const duplicates = built.filter((m) => m.dupHold);
      const pending = built.filter(isPending);
      const pendingBare = pending.filter((m) => !String(m.venue || "").trim() || !String(m.day || "").trim() || !String(m.time || "").trim());
      const bare = built.filter(
        (m) =>
          (isRealPairMatch(m) || isPending(m)) &&
          (!String(m.venue || "").trim() || !String(m.court || "").trim())
      );
      // Conservar las otras fechas enteras (con resultados). Si solo se dejan
      // pendientes, draftAwarePools tapa Fecha 1 publicada y el PJ de «Cubrir con» queda en 0.
      const keepOtherWeeks = (ctx.fixture || []).filter(
        (m) => seasonOf(m) === season && (m.week || "") !== week
      );
      built.sort(compareByDayTime);
      ctx.fixture = [...keepOtherWeeks, ...built];
      filterTemp = season;
      filterWeek = week;
      clearGridFilters();
      if ($("fx-week")) $("fx-week").value = week;
      shell.markDirty("fixture");
      await tickBuildProgress(92, "Actualizando grilla…");
      render();
      await tickBuildProgress(100, "Listo");
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
      if (releasedCourts.released) {
        parts.push(
          `${releasedCourts.released} cancha${releasedCourts.released === 1 ? "" : "s"} duplicada${releasedCourts.released === 1 ? "" : "s"} liberada${releasedCourts.released === 1 ? "" : "s"}`
        );
      }
      if (parkedBare.parked) {
        parts.push(
          `${parkedBare.parked} cruce${parkedBare.parked === 1 ? "" : "s"} sin cancha → pendiente${parkedBare.parked === 1 ? "" : "s"}`
        );
      }
      if (exactPaired.paired) {
        parts.push(
          `${exactPaired.paired} pendiente${exactPaired.paired === 1 ? "" : "s"} rearmado${exactPaired.paired === 1 ? "" : "s"} con exacto`
        );
      }
      if (parkedBad.parked) {
        parts.push(
          `${parkedBad.parked} fuera de disponibilidad → pendiente${parkedBad.parked === 1 ? "" : "s"}`
        );
      }
      const stillConflict = findCourtConflicts(real);
      if (stillConflict.length) {
        parts.push(`${stillConflict.length} aviso${stillConflict.length === 1 ? "" : "s"} de cancha repetida (Revisar canchas duplicadas)`);
      }
      if (pendingBare.length) {
        parts.push(`${pendingBare.length} pendiente${pendingBare.length === 1 ? "" : "s"} sin cancha reservada`);
      }
      if (bare.filter(isRealPairMatch).length) {
        parts.push(`${bare.filter(isRealPairMatch).length} sin complejo/cancha`);
      }
      if (assigned.skipped && !parkedBare.parked && !parkedBad.parked) {
        parts.push(`${assigned.skipped} sin cancha compatible`);
      }
      const byesNoCap = out.byes.filter((e) => !e._capped);
      if (byesNoCap.length) parts.push(`${byesNoCap.length} sin disponibilidad`);
      if (capped) parts.push(`${capped} en tope ${MAX_PAIR_MATCHES} PJ`);
      if (duplicates.length) {
        parts.push(
          `${duplicates.length} duplicado${duplicates.length === 1 ? "" : "s"} prearmado${duplicates.length === 1 ? "" : "s"} (no entran al fixture hasta autorizarlos)`
        );
      }
      setMsg($("fx-msg"), `${week} armada: ${parts.join(" · ")}. Revisá y publicá.`, "ok");
      toast(`${week} armada`, "ok");
      await new Promise((r) => setTimeout(r, 450));
      clearBuildProgress();
    } catch (err) {
      clearBuildProgress();
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
        clearGridFilters();
        render();
        return;
      }
      if (e.target.closest("[data-fx-back-week]")) {
        filterWeek = "";
        editing = -1;
        clearGridFilters();
        render();
        return;
      }
      const openTemp = e.target.closest("[data-fx-open-temp]");
      if (openTemp) {
        filterTemp = openTemp.dataset.fxOpenTemp;
        filterWeek = "";
        editing = -1;
        clearGridFilters();
        render();
        return;
      }
      const openWeek = e.target.closest("[data-fx-open-week]");
      if (openWeek) {
        filterWeek = openWeek.dataset.fxOpenWeek;
        editing = -1;
        clearGridFilters();
        render();
        return;
      }
      if (e.target.closest("[data-fx-arm-next]")) {
        const season = filterTemp || ctx.siteData.currentSeason || "T4";
        filterWeek = nextBuildWeek(season);
        if ($("fx-week")) $("fx-week").value = filterWeek;
        editing = -1;
        clearGridFilters();
        loadedSlots = [];
        slotsFileName = "";
        advancedMode = false;
        render();
        setMsg(
          $("fx-msg"),
          `${filterWeek}: 1) Leer Drive (pestaña «${filterWeek}»). 2) Armar fixture (usa todos los horarios). Complejos avanzados es opcional.`,
          "ok"
        );
        loadSlotsFromDrive();
      }
    });

    $("fx-build")?.addEventListener("click", buildFromFecha);

    $("fx-advanced-toggle")?.addEventListener("click", () => {
      if (!loadedSlots.length) {
        toast("Leé el Drive primero", "err");
        return;
      }
      advancedMode = !advancedMode;
      renderAdvanced();
      if (advancedMode) {
        toast("Complejos avanzados · cupos y días por complejo", "ok");
        $("fx-advanced")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        toast("Complejos avanzados off · Armar usa todos los horarios", "ok");
      }
    });

    function applyLoadedSlots(slots, label, { gaps = [] } = {}) {
      loadedSlots = slots;
      slotsFileName = label || "";
      // No fuerza Complejos avanzados: por defecto Armar usa todos los horarios.
      render();
      const taken = weekTakenCourts();
      const summary = summarizeCourtSlots(slots, taken);
      const free = summary.reduce((n, s) => n + s.total, 0);
      const sheetCap = summary.reduce((n, s) => n + (Number(s.sheetTotal) || s.total), 0);
      const gapTxt = gaps.length
        ? ` Ojo: ${gaps.map((g) => `${g.venue} (${g.count} filas sin horario)`).join(" · ")}. Revisá la columna Horario en el Sheet (ej. 16:30 - 18:00).`
        : "";
      const usedTxt =
        taken.length && sheetCap !== free
          ? `${free} libres de ${sheetCap} (${taken.length} ya en cancha)`
          : `${sheetCap} partido${sheetCap === 1 ? "" : "s"} posibles`;
      setMsg(
        $("fx-msg"),
        `${label || "Canchas"} listo: ${usedTxt} en ${summary.length} complejo${summary.length === 1 ? "" : "s"}.${gapTxt} Podés Armar fixture (todos los horarios) o abrir Complejos avanzados.`,
        gaps.length ? "err" : "ok"
      );
      toast(gaps.length ? "Canchas OK · faltan horarios en el Sheet" : "Canchas cargadas", gaps.length ? "err" : "ok");
    }

    async function loadSlotsFromDrive() {
      const week = String(filterWeek || "").trim();
      const temp = String(filterTemp || "").trim();
      if (!temp || !week) {
        toast("Entrá a la fecha del fixture antes de leer el Drive.", "err");
        return;
      }
      const sheetId = courtsSheetIdForSeason(ctx.siteData, temp);
      if ((await shell.setSection("fixture")) === false) return;
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      setBusy($("fx-drive"), true, "Leyendo Drive…");
      try {
        const data = await api.worker(
          `/fixture/courts?week=${encodeURIComponent(week)}&sheetId=${encodeURIComponent(sheetId)}`
        );
        const objects = courtSlotObjectsFromText(data.csv || "");
        const gaps = missingCourtHorarios(objects);
        const slots = parseCourtSlotObjects(objects);
        applyLoadedSlots(slots, `Drive · ${week}`, { gaps });
      } catch (err) {
        setMsg($("fx-msg"), err.message || "No se pudo leer el Google Sheet.", "err");
        toast(err.message || "Error al leer Drive", "err");
      } finally {
        setBusy($("fx-drive"), false);
      }
    }

    $("fx-drive")?.addEventListener("click", () => loadSlotsFromDrive());
    $("fx-sync-pairs")?.addEventListener("click", () => {
      const res = syncFromPairs({ toastResult: false });
      const s = res?.stats || {};
      const bits = [];
      if (s.addedPending) bits.push(`+${s.addedPending} nueva${s.addedPending === 1 ? "" : "s"}`);
      if (s.pendingFromRemoved) bits.push(`${s.pendingFromRemoved} por baja de rival`);
      if (s.pendingFromCatChange) bits.push(`${s.pendingFromCatChange} por categoría`);
      if (!res?.changed) {
        toast("Pendientes ya estaban al día con Inscripciones", "ok");
        return;
      }
      toast(
        bits.length
          ? `Pendientes sync · ${bits.join(" · ")}. Tocá Publicar fixture para guardar.`
          : "Pendientes sincronizados · tocá Publicar fixture para guardar",
        "ok"
      );
      setMsg(
        $("fx-msg"),
        bits.length
          ? `Pendientes alineados con Inscripciones (${bits.join(" · ")}). Publicá fixture para confirmar.`
          : "Pendientes alineados con Inscripciones. Publicá fixture para confirmar.",
        "ok"
      );
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

    function exportableMatches({ includePending = true } = {}) {
      const games = (ctx.fixture || [])
        .concat(ctx.results || [])
        .filter((m) => {
          if (seasonOf(m) !== filterTemp || (m.week || "") !== filterWeek) return false;
          if (m.dupHold) return false;
          if (includePending) return isRealPairMatch(m) || isPending(m);
          return isRealPairMatch(m);
        });
      const unique = [];
      const seen = new Set();
      for (const m of games) {
        const k = weekKey(m) + "|" + (m.home || "") + "|" + (m.away || "") + "|" + (m.day || "") + "|" + (m.time || "");
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(m);
      }
      return unique;
    }

    $("fx-dl")?.addEventListener("click", async () => {
      const unique = exportableMatches({ includePending: true });
      if (!unique.length) {
        toast("No hay partidos para descargar en esta fecha", "err");
        return;
      }
      const mode = $("fx-dl-sort")?.value || "complejo";
      const sorted = sortMatchesForExport(unique, mode);
      const label = fixtureExportLabel(filterWeek, mode);
      const name = `${label}.xlsx`;
      try {
        await downloadXlsx(name, FX_EXPORT_COLS, fixtureExportRows(sorted), label);
        toast("Excel descargado", "ok");
      } catch (err) {
        toast(err.message || "No se pudo descargar", "err");
      }
    });

    async function existingDriveRows(week) {
      const url =
        `https://docs.google.com/spreadsheets/d/${DEFAULT_FIXTURE_DRIVE_SHEET_ID}/export?format=csv&sheet=` +
        encodeURIComponent(week);
      const res = await fetch(url);
      if (!res.ok) throw new Error("No pude leer la hoja de Drive. No pegué nada.");
      const text = await res.text();
      const head = text.slice(0, 200).trim().toLowerCase();
      if (!text.trim() || head.startsWith("<!doctype") || head.startsWith("<html")) {
        throw new Error("No pude leer la hoja de Drive. No pegué nada.");
      }
      const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
      const parsed = parseDriveSheetValues(lines.map((line) => splitLine(line, ",")));
      const want = fold(week);
      const tagged = parsed.filter((row) => fold(row.fecha));
      // Si el nombre de pestaña no existe, Drive devuelve otra fecha. Esa no se mezcla.
      if (tagged.length && !tagged.some((row) => fold(row.fecha) === want)) return [];
      return parsed.filter((row) => !fold(row.fecha) || fold(row.fecha) === want);
    }

    function phonesOfPending(m) {
      const season = String(filterTemp || m?.temp || "").toUpperCase();
      const found = (ctx.pairs || []).find((p) => {
        if (String(p.temp || "").toUpperCase() !== season) return false;
        if (m?.cat && p.cat && p.cat !== m.cat) return false;
        return pairsMatch(pairLabel(p), m.home);
      });
      if (!found?.id) return { tel1: "", tel2: "" };
      const c = ctx.contacts?.[found.id] || {};
      return { tel1: c.tel1 || "", tel2: c.tel2 || "" };
    }

    async function ensureContactsLoaded() {
      if (ctx.contacts && Object.keys(ctx.contacts).length) return;
      try {
        const remote = await api.worker("/pairs/contacts");
        ctx.contacts = remote && typeof remote === "object" ? remote : {};
      } catch {
        ctx.contacts = ctx.contacts || {};
      }
    }

    async function pendingRowsForWeek() {
      await ensureContactsLoaded();
      // Pendientes de la fecha (sin rival). W.O. / Recuperan (recoverFrom) van a otra hoja.
      const list = (ctx.fixture || []).filter(
        (m) =>
          seasonOf(m) === filterTemp &&
          (m.week || "") === filterWeek &&
          isPending(m) &&
          !isMakeupPending(m) &&
          !m.dupHold
      );
      return pendingDriveRows(
        list,
        (m) => availHint(daysOfPair(m.home, m.cat) || m.homeDays || m.days),
        phonesOfPending
      );
    }

    async function recoverRowsForWeek() {
      await ensureContactsLoaded();
      const list = recoverRows().map(({ m }) => m);
      return recoverDriveRows(
        list,
        (m) => availHint(daysOfPair(m.home, m.cat) || m.homeDays || m.days),
        phonesOfPending
      );
    }

    /** Lee canchas del Drive si todavía no están en memoria (para complejos libres). */
    async function ensureSlotsForFreeCourts() {
      if (loadedSlots.length) return true;
      const week = String(filterWeek || "").trim();
      const temp = String(filterTemp || "").trim();
      if (!temp || !week) return false;
      const sheetId = courtsSheetIdForSeason(ctx.siteData, temp);
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return false;
      }
      const data = await api.worker(
        `/fixture/courts?week=${encodeURIComponent(week)}&sheetId=${encodeURIComponent(sheetId)}`
      );
      const objects = courtSlotObjectsFromText(data.csv || "");
      loadedSlots = parseCourtSlotObjects(objects);
      return loadedSlots.length > 0;
    }

    $("fx-drive-paste")?.addEventListener("click", async () => {
      const unique = exportableMatches({ includePending: false });
      const pendingRows = await pendingRowsForWeek();
      const recoverRowsPayload = await recoverRowsForWeek();
      const mode = $("fx-dl-sort")?.value || "complejo";
      const btn = $("fx-drive-paste");
      if (!filterWeek) {
        toast("Entrá a una fecha del fixture antes de pegar en Drive.", "err");
        return;
      }

      setBusy(btn, true, "Leyendo canchas…");
      let slotsOk = true;
      try {
        slotsOk = await ensureSlotsForFreeCourts();
      } catch (err) {
        setBusy(btn, false);
        setMsg($("fx-msg"), err.message || "No pude leer las canchas del Drive.", "err");
        toast(err.message || "No pude leer canchas", "err");
        return;
      }
      setBusy(btn, false);

      // Solo actualiza Complejos libres si hay canchas leídas; si no, no borra el sheet.
      const freeCourtsRows = slotsOk
        ? freeCourtDriveRows(loadedSlots, weekTakenCourts(), filterWeek)
        : null;
      const freeN = freeCourtsRows ? freeCourtsRows.length : 0;
      if (!unique.length && !pendingRows.length && !recoverRowsPayload.length && freeCourtsRows == null) {
        toast("No hay partidos, pendientes, recuperan ni horarios libres para pegar en esta fecha.", "err");
        return;
      }

      let merged = null;
      if (unique.length) {
        const sorted = sortMatchesForExport(unique, mode);
        const rows = fixtureExportRows(sorted);
        setBusy(btn, true, "Leyendo…");
        let existing;
        try {
          existing = await existingDriveRows(filterWeek);
        } catch (err) {
          setBusy(btn, false);
          setMsg($("fx-msg"), err.message || "No pude leer la hoja de resultados. No pegué nada.", "err");
          toast(err.message || "No pude leer la hoja", "err");
          return;
        }
        setBusy(btn, false);
        merged = mergeDriveFixtureRows(existing, rows);
      }
      const kept = merged?.kept || 0;
      const pendingN = pendingRows.length;
      const recoverN = recoverRowsPayload.length;
      const ok = await confirmModal({
        title: "Pegar en Drive",
        body:
          (merged
            ? `Se van a pegar ${merged.rows.length} partido${merged.rows.length === 1 ? "" : "s"} en la hoja «${filterWeek}» del sheet de resultados (orden: ${mode}). ` +
              (kept
                ? `${kept} que ya tienen score quedan igual: no se pisan ni se borran. `
                : "En esa hoja todavía no hay scores. ") +
              "El resto de los partidos sin score se actualiza. "
            : "No hay partidos con rival. El sheet de resultados no se toca. ") +
          (pendingN
            ? `En Pendientes se pegan ${pendingN} pareja${pendingN === 1 ? "" : "s"}. `
            : `Pendientes «${filterWeek}» queda sin parejas. `) +
          (recoverN
            ? `En Recuperan fecha se pegan ${recoverN} pareja${recoverN === 1 ? "" : "s"} (partido de otra fecha). `
            : `Recuperan fecha «${filterWeek}» queda sin parejas. `) +
          (freeCourtsRows == null
            ? "Complejos libres no se actualiza (sin canchas del Drive)."
            : freeN
              ? `En Complejos libres se pegan ${freeN} turno${freeN === 1 ? "" : "s"} libre${freeN === 1 ? "" : "s"}.`
              : `Complejos libres «${filterWeek}» queda sin turnos.`),
        confirmLabel: "Pegar en Drive",
      });
      if (!ok) return;
      setBusy(btn, true, "Pegando…");
      try {
        const payload = {
          sheetId: DEFAULT_FIXTURE_DRIVE_SHEET_ID,
          pendingSheetId: DEFAULT_PENDING_DRIVE_SHEET_ID,
          recoverSheetId: DEFAULT_RECOVER_DRIVE_SHEET_ID,
          week: filterWeek,
          mode,
          rows: merged ? merged.rows : [],
          pendingRows,
          recoverRows: recoverRowsPayload,
        };
        if (freeCourtsRows != null) {
          payload.freeCourtsSheetId = DEFAULT_FREE_COURTS_DRIVE_SHEET_ID;
          payload.freeCourtsRows = freeCourtsRows;
        }
        const res = await api.worker("/fixture/drive", payload);
        const n = merged ? Number(res?.rows) || merged.rows.length : 0;
        const keptNow = merged ? Number(res?.kept) || kept : 0;
        const sheetName = res?.sheet || filterWeek;
        const pendingOk = !!res?.pending?.ok;
        const pendingWrote = Number(res?.pending?.rows);
        const recoverOk = !!res?.recover?.ok;
        const recoverWrote = Number(res?.recover?.rows);
        const freeOk = !!res?.freeCourts?.ok;
        const freeWrote = Number(res?.freeCourts?.rows);
        const bits = [];
        if (merged) {
          bits.push(
            `Resultados «${sheetName}»: ${n} partido${n === 1 ? "" : "s"}` +
              (keptNow ? `. ${keptNow} con score quedaron igual` : "")
          );
        }
        if (pendingOk) {
          bits.push(
            pendingWrote
              ? `Pendientes: ${pendingWrote} pareja${pendingWrote === 1 ? "" : "s"} con su horario`
              : `Pendientes «${filterWeek}» quedó sin parejas`
          );
        } else if (res?.pendingError) {
          bits.push(`Pendientes no se pudo pegar: ${res.pendingError}`);
        } else if (pendingN) {
          bits.push("Pendientes no se actualizó.");
        }
        if (recoverOk) {
          bits.push(
            recoverWrote
              ? `Recuperan: ${recoverWrote} pareja${recoverWrote === 1 ? "" : "s"}`
              : `Recuperan «${filterWeek}» quedó sin parejas`
          );
        } else if (res?.recoverError) {
          bits.push(`Recuperan no se pudo pegar: ${res.recoverError}`);
        } else if (recoverN) {
          bits.push("Recuperan no se actualizó.");
        }
        if (freeCourtsRows != null) {
          if (freeOk) {
            bits.push(
              freeWrote
                ? `Complejos libres: ${freeWrote} turno${freeWrote === 1 ? "" : "s"}`
                : `Complejos libres «${filterWeek}» quedó sin turnos`
            );
          } else if (res?.freeCourtsError) {
            bits.push(`Complejos libres no se pudo pegar: ${res.freeCourtsError}`);
          } else {
            bits.push("Complejos libres no se actualizó.");
          }
        }
        const okPaste = !merged || res?.ok !== false;
        const sideOk =
          (pendingOk || !pendingN) &&
          (recoverOk || !recoverN) &&
          (freeCourtsRows == null || freeOk);
        const level = sideOk ? (okPaste ? "ok" : "err") : "err";
        setMsg($("fx-msg"), bits.join(". ") + ".", level === "ok" ? "ok" : "err");
        const toastTxt = sideOk
          ? keptNow
            ? `Pegado · ${keptNow} con score intactos`
            : bits[0] || "Pegado"
          : "Pegado parcial: revisá Pendientes / Recuperan / Libres.";
        toast(toastTxt, level === "ok" ? "ok" : "err");
        const recoverUrl = recoverOk
          ? res?.recover?.url || DEFAULT_RECOVER_DRIVE_SHEET_URL
          : "";
        const freeUrl = freeOk
          ? res?.freeCourts?.url || DEFAULT_FREE_COURTS_DRIVE_SHEET_URL
          : "";
        const openUrl = merged
          ? res?.url || `${DEFAULT_FIXTURE_DRIVE_SHEET_URL}${res?.gid != null ? `#gid=${res.gid}` : ""}`
          : recoverUrl || freeUrl || res?.pending?.url || DEFAULT_PENDING_DRIVE_SHEET_URL;
        if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
        if (merged && recoverUrl && recoverWrote > 0) {
          window.open(recoverUrl, "_blank", "noopener,noreferrer");
        }
        if ((merged || recoverWrote > 0) && freeUrl && freeWrote > 0) {
          window.open(freeUrl, "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        setMsg($("fx-msg"), err.message || "No se pudo pegar en Drive.", "err");
        toast(err.message || "No se pudo pegar en Drive", "err");
      } finally {
        setBusy(btn, false);
      }
    });

    $("fx-dupes")?.addEventListener("click", () => reviewCourtDuplicates());

    $("fx-filters")?.addEventListener("click", (e) => {
      const dayBtn = e.target.closest("[data-fx-grid-day]");
      if (dayBtn) {
        gridDay = dayBtn.dataset.fxGridDay || "";
        render();
        return;
      }
      const catBtn = e.target.closest("[data-fx-grid-cat]");
      if (catBtn) {
        gridCat = catBtn.dataset.fxGridCat || "";
        render();
        return;
      }
      const venueBtn = e.target.closest("[data-fx-grid-venue]");
      if (venueBtn) {
        gridVenue = venueBtn.dataset.fxGridVenue || "";
        render();
      }
    });
    $("fx-filters")?.addEventListener("input", (e) => {
      const search = e.target.closest("[data-fx-grid-search]");
      if (!search) return;
      gridTerm = search.value;
      render();
      const again = $("fx-filters")?.querySelector("[data-fx-grid-search]");
      if (again) {
        again.focus();
        const len = again.value.length;
        again.setSelectionRange(len, len);
      }
    });

    $("fx-add")?.addEventListener("click", () => {
      if (!filterTemp || !filterWeek) return;
      newDraft = { cat: "", home: "", away: "", slot: "" };
      renderNewMatch();
      const box = $("fx-new");
      box?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      box?.querySelector('select[data-fx-new="cat"]')?.focus();
    });

    $("fx-new")?.addEventListener("change", (e) => {
      const sel = e.target.closest("[data-fx-new]");
      if (!sel || !newDraft) return;
      const k = sel.dataset.fxNew;
      newDraft[k] = sel.value;
      // Cada paso limpia los siguientes.
      if (k === "cat") Object.assign(newDraft, { home: "", away: "", slot: "" });
      if (k === "home") Object.assign(newDraft, { away: "", slot: "" });
      if (k === "away") newDraft.slot = "";
      renderNewMatch();
      const nextStep = { cat: "home", home: "away", away: "slot" }[k];
      const target = nextStep && $("fx-new")?.querySelector(`select[data-fx-new="${nextStep}"]:not([disabled])`);
      (target || $("fx-new")?.querySelector("[data-fx-new-ok]:not([disabled])"))?.focus();
    });

    $("fx-new")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-fx-new-cancel]")) {
        newDraft = null;
        renderNewMatch();
        return;
      }
      if (e.target.closest("[data-fx-new-ok]")) addNewMatch();
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
      const match = ctx.fixture[i];
      if (!match) return;
      const prev = match[k];
      const value = e.target.value;
      match[k] = value;

      if (k === "cat") {
        // Rivales fuera de la nueva categoría se limpian.
        const rivals = rivalOptionsFromPairs({ pairs: ctx.pairs || [], temp: filterTemp || match.temp, cat: value });
        if (match.home && !rivals.some((r) => pairsMatch(r, match.home))) match.home = "";
        if (match.away && !isPlaceholderPair(match.away) && !rivals.some((r) => pairsMatch(r, match.away))) {
          match.away = PENDING_AWAY;
        }
      }
      if (k === "venue") {
        const courts = scheduleOpts().courtsByVenue[value] || [];
        if (match.court && !courts.includes(match.court)) match.court = "";
      }
      if (k === "away" && isPlaceholderPair(value)) {
        match.pending = true;
        match.day = "";
        match.time = "";
        match.venue = "";
        match.court = "";
      } else if (k === "away" && match.pending) {
        delete match.pending;
        delete match.reason;
        delete match.avail;
        const rematch = isRealPairMatch(match) ? holdIfRematch(match) : [];
        if (rematch.length) {
          shell.markDirty("fixture");
          render();
          toast(`Cruce repetido (ya jugaron en ${rematch.join(", ")}) · quedó en Duplicados`, "ok");
          return;
        }
      }
      if (k === "home" && pairsMatch(match.home, match.away)) {
        match.away = PENDING_AWAY;
        match.pending = true;
        delete match.dupHold;
      }

      if (["day", "time", "venue", "court"].includes(k)) {
        const taken = (ctx.fixture || []).filter((other, idx) => {
          if (idx === i) return false;
          if (seasonOf(other) !== filterTemp || (other.week || "") !== filterWeek) return false;
          return String(other.venue || "").trim() && String(other.court || "").trim();
        });
        if (isCourtTaken(match, taken)) {
          match[k] = prev;
          e.target.value = prev || "";
          toast("Esa cancha ya está en uso en ese horario.", "err");
          return;
        }
        if (isRealPairMatch(match) && match.day && match.time) {
          const withDays = attachPairDaysFromPairs([match], ctx.pairs || [])[0];
          if (matchViolatesAvailability(withDays)) {
            match[k] = prev;
            e.target.value = prev || "";
            toast("Ese horario no entra en la disponibilidad de alguna de las dos parejas.", "err");
            return;
          }
        }
      }
      shell.markDirty("fixture");
      if (["home", "away", "cat", "venue"].includes(k)) {
        render();
        $("fx-body")?.querySelector(`tr[data-i="${i}"] select[data-k="${k}"]`)?.focus();
      } else updateSummary();
    });

    const onCoverChange = async (e) => {
      const coverSlot = e.target.closest("[data-fx-cover-slot]");
      if (coverSlot) {
        const i = Number(coverSlot.dataset.fxCoverSlot);
        const slot = ctx.fixture[i];
        const dup = !!slot?.dupHold && isRealPairMatch(slot);
        const cover = coverDraft.get(i) || (dup ? slot.away : "");
        const key = coverSlot.value;
        if (!slot || (!isPending(slot) && !dup) || !cover || !key) return;
        const choices = coverCourtChoices(slot, cover);
        const opt =
          choices.opts.find((o) => o.key === key) ||
          choices.nearOpts.find((o) => o.key === key) ||
          choices.estimateOpts.find((o) => o.key === key);
        if (!opt) {
          toast("Esa cancha ya no está libre.", "err");
          coverSlot.value = "";
          return;
        }
        if (opt.near || opt.estimate) {
          const okNear = await confirmModal({
            title: opt.estimate ? "Cubrir con horario estimable" : "Cubrir con horario cercano",
            body:
              `No entran exactas en 1:30 según Inscripciones. La cancha está libre: ${courtOptionText(opt)}` +
              (opt.nearLabel ? ` (${opt.nearLabel})` : "") +
              ". Alguna pareja afloja su disponibilidad. ¿Lo usamos igual?",
            confirmLabel: "Usar igual",
            danger: true,
          });
          if (!okNear) {
            coverSlot.value = "";
            return;
          }
        }
        if (dup) {
          slot.day = opt.day;
          slot.time = opt.time;
          slot.venue = opt.venue;
          slot.court = opt.court;
          if (opt.near) slot.flexAvail = true;
          else delete slot.flexAvail;
          shell.markDirty("fixture");
          render();
          toast(`Horario del duplicado · ${courtOptionText(opt)}`, "ok");
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
            recoverFrom: slot.recoverFrom || "",
            recoveredIn: slot.recoveredIn || "",
            ...(opt.near ? { flexAvail: true } : {}),
          },
          {},
          filterTemp || ctx.siteData.currentSeason || "T4"
        );
        delete next.pending;
        delete next.reason;
        delete next.avail;
        if (!opt.near) delete next.flexAvail;
        // Si el cruce ya se jugó → Duplicados (no entra al fixture hasta Autorizar).
        const rematch = holdIfRematch(next);
        ctx.fixture[i] = next;
        // Si quien cubre también estaba pendiente, sale de la lista (ambas van al partido).
        const before = ctx.fixture.length;
        ctx.fixture = absorbCoveredPending(ctx.fixture, next, cover);
        coverDraft.clear();
        shell.markDirty("fixture");
        render();
        const dropped = before - ctx.fixture.length;
        if (rematch.length) {
          toast(
            `Cruce repetido (ya jugaron en ${rematch.join(", ")}) · quedó en Duplicados · ${courtOptionText(opt)}`,
            "ok"
          );
          return;
        }
        toast(
          dropped
            ? `Cubierto · ambas pendientes → partido · ${courtOptionText(opt)}`
            : opt.near
              ? `Cubierto (cerca) · ${courtOptionText(opt)}`
              : `Cubierto · ${courtOptionText(opt)}`,
          "ok"
        );
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
        renderRecover();
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
      renderRecover();
      if (!loadedSlots.length) {
        toast("Leé el Drive para ver canchas libres.", "err");
        return;
      }
      const shared = coverCourtChoices(slot, cover);
      if (!shared.homeDays) {
        toast("Falta la disponibilidad de la pareja pendiente en Inscripciones.", "err");
        return;
      }
      if (!shared.coverDays) {
        toast("Falta la disponibilidad de quien cubre en Inscripciones.", "err");
        return;
      }
      const flexCount = shared.nearOpts.length + shared.estimateOpts.length;
      if (!shared.opts.length && !flexCount) {
        toast("Sin cancha libre en el Drive.", "err");
        return;
      }
      if (!shared.opts.length) {
        toast(
          `${flexCount} horario${flexCount === 1 ? "" : "s"} estimable${flexCount === 1 ? "" : "s"}: la cancha está libre, sin 1:30 en común.`,
          "ok"
        );
        return;
      }
      toast(
        `${shared.opts.length} turno${shared.opts.length === 1 ? "" : "s"} libre${shared.opts.length === 1 ? "" : "s"} donde entran las dos` +
          (flexCount ? ` · ${flexCount} estimable${flexCount === 1 ? "" : "s"} más` : ""),
        "ok"
      );
    };
    $("fx-pending")?.addEventListener("change", onCoverChange);
    $("fx-recover-box")?.addEventListener("change", onCoverChange);
    $("fx-dup-box")?.addEventListener("change", onCoverChange);

    const onDelete = async (e) => {
      const btn = e.target.closest("[data-fx-del]");
      if (!btn) return;
      const i = Number(btn.dataset.fxDel);
      const match = ctx.fixture[i];
      // Quitar de Duplicados → ambas puntas vuelven a Pendientes (no se borran).
      if (match?.dupHold && isRealPairMatch(match) && !isPending(match)) {
        const ok = await confirmModal({
          title: "Quitar de Duplicados",
          body: `Se anula el cruce repetido y ${match.home} y ${match.away} vuelven a Pendientes para cubrirlas de nuevo.`,
          confirmLabel: "A pendientes",
          danger: false,
        });
        if (!ok) return;
        const season = filterTemp || match.temp || ctx.siteData.currentSeason || "T4";
        const pendingRows = splitMatchToPending(match, ctx.pairs || []).map((row) => {
          const cleaned = cleanMatch(row, {}, season);
          delete cleaned.dupHold;
          return cleaned;
        });
        if (pendingRows.length < 2) {
          toast("No se pudieron armar las pendientes.", "err");
          return;
        }
        ctx.fixture.splice(i, 1, ...pendingRows);
        coverDraft.clear();
        foldOpen.add("pending");
        shell.markDirty("fixture");
        render();
        toast("Volvieron a Pendientes", "ok");
        return;
      }
      const ok = await confirmModal({
        title: "Eliminar partido",
        body: "Se quita del fixture local. Publicá para que impacte en la web.",
        confirmLabel: "Eliminar",
        danger: true,
      });
      if (!ok) return;
      ctx.fixture.splice(i, 1);
      shell.markDirty("fixture");
      render();
    };
    $("fx-body")?.addEventListener("click", onDelete);
    $("fx-pending")?.addEventListener("click", onDelete);
    $("fx-dup-box")?.addEventListener("click", onDelete);

    $("fx-detail")?.addEventListener("click", (e) => {
      const fold = e.target.closest("[data-fx-fold]");
      if (!fold) return;
      const key = fold.dataset.fxFold || "";
      if (foldOpen.has(key)) foldOpen.delete(key);
      else foldOpen.add(key);
      render();
    });

    $("fx-dup-box")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-fx-dup-ok]");
      if (!btn) return;
      const match = ctx.fixture[Number(btn.dataset.fxDupOk)];
      if (!match) return;
      delete match.dupHold;
      shell.markDirty("fixture");
      render();
      toast("Cruce autorizado · quedó en el fixture", "ok");
    });

    $("fx-recover-box")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-fx-recover-del]");
      if (!btn) return;
      const i = Number(btn.dataset.fxRecoverDel);
      const match = ctx.fixture[i];
      if (!match) return;
      const owed = match.week || match.recoverFrom || "la fecha que debe";
      const ok = await confirmModal({
        title: "Quitar recupero",
        body: `${match.home} sale de Recuperan fecha. El partido sigue en ${owed} y no se vuelve a traer solo.`,
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      releaseRecoveryDebt(ctx.fixture, match);
      delete match.recoverFrom;
      delete match.recoveredIn;
      match.recoverLater = true;
      match.pending = true;
      coverDraft.delete(i);
      shell.markDirty("fixture");
      render();
      toast("Salió de Recuperan fecha", "ok");
    });

    $("fx-body")?.addEventListener("click", async (e) => {
      const pendBtn = e.target.closest("[data-fx-to-pending]");
      if (!pendBtn) return;
      const i = Number(pendBtn.dataset.fxToPending);
      const match = ctx.fixture[i];
      if (!match || isPending(match) || !isRealPairMatch(match)) {
        toast("Ese partido ya está pendiente o incompleto.", "err");
        return;
      }
      const ok = await confirmModal({
        title: "Marcar como pendiente",
        body: `Se anula el partido y ambas parejas quedan en pendientes (${match.home} y ${match.away}). El PJ baja ahora. Si salís sin publicar, vuelve al valor anterior.`,
        confirmLabel: "A pendientes",
        danger: false,
      });
      if (!ok) return;
      const season = filterTemp || match.temp || ctx.siteData.currentSeason || "T4";
      const pendingRows = splitMatchToPending(match, ctx.pairs || []).map((row) => cleanMatch(row, {}, season));
      if (pendingRows.length < 2) {
        toast("No se pudieron armar las dos pendientes.", "err");
        return;
      }
      ctx.fixture.splice(i, 1, ...pendingRows);
      editing = -1;
      shell.markDirty("fixture");
      render();
      toast("Ambas parejas quedaron en pendientes", "ok");
    });

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
      const normalized = normalizeRecoveryWeeks(ctx.fixture || []);
      if (normalized.changed) {
        ctx.fixture = normalized.matches;
        shell.markDirty("fixture");
      }
      // Antes de publicar: si algún partido viola inscripción, ambas puntas a pendientes.
      // Frenamos acá para que veas el cambio en la grilla y vuelvas a tocar Publicar a propósito.
      const heldNow = (ctx.fixture || []).filter((m) => m.dupHold);
      const audited = parkAvailabilityViolations(
        attachPairDaysFromPairs(
          (ctx.fixture || []).filter((m) => !m.dupHold),
          ctx.pairs || []
        )
      );
      if (audited.parked) {
        ctx.fixture = [
          ...audited.matches.map((m) => {
          if (isPending(m)) {
            return cleanMatch(
              {
                ...m,
                pending: true,
                away: PENDING_AWAY,
                days: m.days || m.homeDays,
                homeDays: m.homeDays || m.days,
              },
              {},
              season
            );
          }
          const { days: _d, homeDays: _h, awayDays: _a, ...rest } = m;
          return cleanMatch(rest, {}, season);
        }),
          ...heldNow,
        ];
        shell.markDirty("fixture");
        render();
        const n = audited.parked;
        const why = (audited.details || []).slice(0, 3).join(" | ");
        setMsg(
          $("fx-msg"),
          `${n} partido${n === 1 ? "" : "s"} fuera de la disponibilidad de inscripción → pendientes` +
            (why ? ` (${why})` : "") +
            `. Revisá la grilla y tocá Publicar fixture de nuevo (los pendientes no salen al sitio).`,
          "err"
        );
        toast(
          why
            ? `${n} → pendientes · ${why}`
            : `${n} partido${n === 1 ? "" : "s"} → pendientes · revisá y publicá de nuevo`,
          "err"
        );
        return;
      }
      const draft = ctx.fixture.map((m) => cleanMatch(m, {}, season)).filter((m) => m.home || m.away);
      const draftLive = draft.filter((m) => !isPending(m) && !m.dupHold);
      const draftPending = draft.filter((m) => isPending(m));
      const draftDup = draft.filter((m) => m.dupHold);
      const incomplete = draftLive.filter((m) => !isRealPairMatch(m) || !m.day || !m.time);
      const openPending = draftPending.length;
      const repeated = draftLive.filter((m) => isRealPairMatch(m) && previousMeetings(m).length).length;
      const courtConflicts = findCourtConflicts(draftLive);
      if (courtConflicts.length) {
        const sample = courtConflicts
          .slice(0, 3)
          .map((g) => `${g.day} ${g.time} · ${g.venue} · ${g.court} (${g.matches.length} partidos)`)
          .join("; ");
        setMsg(
          $("fx-msg"),
          `No puedo publicar: ${courtConflicts.length} horario${courtConflicts.length === 1 ? "" : "s"} con cancha doble (${sample}).`,
          "err"
        );
        toast("Hay partidos en la misma cancha y horario", "err");
        return;
      }
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
        const owedLive = draftLive.filter((m) => m.recoverFrom);
        const regularLive = draftLive.filter((m) => !m.recoverFrom);
        const replacing = new Set([
          ...regularLive.map(weekKey),
          ...draftPending.filter((m) => !m.recoverFrom).map(weekKey),
          ...draftDup.filter((m) => !m.recoverFrom).map(weekKey),
        ]);
        const carryLive = remoteLive.filter((m) => !replacing.has(weekKey(m)));
        const carryPending = remotePending.filter((m) => isPending(m) && !replacing.has(weekKey(m)));
        // El borrador local puede no traer scores: no borrar result/appliedResult ya publicados.
        const liveWithScores = preserveRemoteMatchScores(regularLive, remoteLive);
        let nextPublished = [...carryLive, ...liveWithScores];
        const nextPending = [...carryPending, ...draftPending, ...draftDup];
        const keptWeeks = new Set([...nextPublished, ...nextPending.filter((m) => !m.recoverFrom)].map(weekKey));
        const toArchive = remoteLive.filter((m) => isRealPairMatch(m) && !m.recoverFrom && !keptWeeks.has(weekKey(m)));
        let nextResults = mergeArchivedMatches(
          (Array.isArray(remoteResults) ? remoteResults : []).map((m) => cleanMatch(m, {}, season)),
          toArchive
        );
        const placed = fileOwedRecoveries({ published: nextPublished, results: nextResults, owed: owedLive });
        nextPublished = placed.published;
        nextResults = placed.results;
        const adminFixture = [...nextPublished, ...nextPending];
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
        const liveCount = nextPublished.length;
        const pendingNote = openPending
          ? ` ${openPending} pendiente${openPending === 1 ? "" : "s"} solo en admin (no salen a la web hasta cubrirlos).`
          : "";
        const text =
          `Fixture publicado · ${liveCount} partido${liveCount === 1 ? "" : "s"} en el sitio (padel-fb.vercel.app/fixture/). Se ve en ~1 minuto.` +
          pendingNote +
          archived;
        setMsg($("fx-msg"), text, "ok");
        toast(
          openPending
            ? `Publicado · ${liveCount} en web · ${openPending} pendientes`
            : `Publicado · ${liveCount} en web`,
          "ok"
        );
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("fx-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("fx-publish"), false);
      }
    });
  }

  /**
   * Alinea fixture/pendientes con las inscripciones (altas, bajas, cambio de cat).
   * Marca dirty si hubo cambios. Pensado para llamarse desde Parejas.
   */
  function syncFromPairs({ toastResult = true } = {}) {
    const temp = ctx.siteData.currentSeason || filterTemp || "T4";
    const seasonMatches = (ctx.fixture || []).filter((m) => seasonOf(m) === temp);
    const historyWeek =
      latestWeek(seasonMatches.filter((m) => !isPending(m))) || latestWeek(seasonMatches) || "Fecha 1";
    const liveWeek = filterWeek || historyWeek;
    const before = JSON.stringify(ctx.fixture || []);
    const synced = syncFixtureWithPairs({
      matches: ctx.fixture || [],
      pairs: ctx.pairs || [],
      temp,
      liveWeek,
      historyWeek,
    });
    ctx.fixture = synced.matches.map((m) => cleanMatch(m, {}, temp));
    const changed = JSON.stringify(ctx.fixture) !== before;
    const differsFromPublished =
      JSON.stringify(ctx.fixture || []) !== JSON.stringify(ctx.fixturePublished || []);
    if (changed || differsFromPublished) {
      shell.markDirty("fixture");
    }
    if (changed) {
      if (filterTemp === temp || !filterTemp) render();
      const s = synced.stats;
      const bits = [];
      if (s.pendingFromRemoved) bits.push(`${s.pendingFromRemoved} rival${s.pendingFromRemoved === 1 ? "" : "es"} → pendiente`);
      if (s.pendingFromCatChange) bits.push(`${s.pendingFromCatChange} por cambio de categoría`);
      if (s.addedPending) bits.push(`${s.addedPending} pareja${s.addedPending === 1 ? "" : "s"} nueva${s.addedPending === 1 ? "" : "s"} en pendientes`);
      if (toastResult && bits.length) toast(`Fixture sync · ${bits.join(" · ")}`, "ok");
    }
    return { changed: changed || differsFromPublished, stats: synced.stats, liveWeek };
  }

  return { bind, render, fallbackWeek, syncWeek, buildFromFecha, syncFromPairs };
}
