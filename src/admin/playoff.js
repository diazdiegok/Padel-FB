import { CATS, PLAYOFF_PATH } from "./constants.js";
import { describeResult } from "../lib/scoring.js";
import { listSeasons, seasonLabel } from "../lib/liga.js";
import {
  BYE,
  PLAYOFF_SIZES,
  invalidResults,
  normalizeCategory,
  normalizePlayoff,
  resolveCategory,
  roundName,
  seedCategory,
  serializePlayoff,
} from "../lib/playoff.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createPlayoff(ctx, api, shell) {
  let activeCat = "";
  let loaded = false;

  function data() {
    return ctx.playoff;
  }

  function temp() {
    return data().temp || ctx.siteData.currentSeason || "T4";
  }

  function category() {
    return data().categories.find((c) => c.cat === activeCat) || null;
  }

  function rankingPairs(cat) {
    return ctx.rows
      .filter((r) => r.temp === temp() && r.cat === cat && r.name)
      .sort((a, b) => Number(a.pos) - Number(b.pos))
      .map((r) => r.name);
  }

  function markDirty() {
    shell.markDirty("playoff");
  }

  function fillHeader() {
    const seasons = listSeasons(ctx.siteData, ctx.rows.map((r) => r.temp));
    const current = temp();
    $("po-temp").innerHTML = [...new Set([...seasons, current])]
      .map((t) => `<option value="${escAttr(t)}" ${t === current ? "selected" : ""}>${escAttr(seasonLabel(t))}</option>`)
      .join("");
    $("po-title").value = data().title || "";
    $("po-dates").value = data().dates || "";
    $("po-note").value = data().note || "";
    $("po-visible").checked = Boolean(data().visible);
    updateStatus();
  }

  function updateStatus() {
    const pill = $("po-status");
    if (!pill) return;
    const on = Boolean(data().visible);
    pill.textContent = on ? "Visible en la web" : "Oculto en la web";
    pill.className = "admin-status-pill " + (on ? "open" : "closed");
  }

  function fillCats() {
    const list = data().categories;
    if (!list.some((c) => c.cat === activeCat)) activeCat = list[0]?.cat || "";
    $("po-cats").innerHTML = list
      .map((c) => {
        const champion = resolveCategory(c).champion;
        return `<button class="pill${c.cat === activeCat ? " on" : ""}" type="button" data-po-cat="${escAttr(c.cat)}">${escAttr(c.cat)}${champion ? " ✓" : ""}</button>`;
      })
      .join("");
    const missing = CATS.filter((cat) => !list.some((c) => c.cat === cat));
    const add = $("po-cat-add");
    add.innerHTML =
      `<option value="">+ Categoría</option>` + missing.map((cat) => `<option value="${escAttr(cat)}">${escAttr(cat)}</option>`).join("");
    add.hidden = missing.length === 0;
  }

  function fillLists() {
    const cat = category();
    $("po-pairs").innerHTML = [BYE, ...(cat ? rankingPairs(cat.cat) : [])]
      .map((name) => `<option value="${escAttr(name)}"></option>`)
      .join("");
    $("po-venues").innerHTML = (ctx.siteData.venues || [])
      .filter((v) => v.liga !== false)
      .map((v) => `<option value="${escAttr(v.name)}"></option>`)
      .join("");
  }

  function scoreHint(m) {
    if (m.bye) return m.winnerName ? `Pasa directo ${m.winnerName}` : "Libre";
    if (!m.home || !m.away) return "Esperando parejas";
    if (m.wo) return `Gana ${m.winnerName} por W.O.`;
    if (!m.result) return "Sin resultado";
    if (!m.info) return "Resultado inválido";
    return `${m.info.score} · pasa ${m.winnerName}`;
  }

  function sideInput(m, side) {
    const name = m[side];
    const seed = m[`${side}Seed`];
    const from = m[`${side}From`];
    const win = m.winner === side;
    if (m.round === 1) {
      return `<div class="po-side${win ? " win" : ""}">
        <input class="po-seed" data-po-field="${side}Seed" type="number" min="1" inputmode="numeric" value="${seed ?? ""}" aria-label="Posición" />
        <input class="po-name" data-po-field="${side}" list="po-pairs" value="${escAttr(name)}" placeholder="Pareja o ${BYE}" />
      </div>`;
    }
    return `<div class="po-side${win ? " win" : ""}">
      <span class="po-seed-tag">${seed ?? "–"}</span>
      <span class="po-name-ro${name ? "" : " muted"}">${escAttr(name || `Ganador ${from}`)}</span>
    </div>`;
  }

  function matchCard(m) {
    const ready = m.home && m.away && !m.bye;
    return `<article class="po-match${m.winner ? " done" : ""}" data-po-id="${m.id}">
      <header><span>${escAttr(m.label)}</span>${m.winner ? `<span class="admin-chip-live">Definido</span>` : ""}</header>
      ${sideInput(m, "home")}
      ${sideInput(m, "away")}
      <div class="po-grid">
        <input data-po-field="day" value="${escAttr(m.day)}" placeholder="Día" />
        <input data-po-field="time" value="${escAttr(m.time)}" placeholder="Horario" />
        <input data-po-field="venue" list="po-venues" value="${escAttr(m.venue)}" placeholder="Sede" />
        <input data-po-field="court" value="${escAttr(m.court)}" placeholder="Cancha" />
      </div>
      <div class="po-score">
        <input data-po-field="result" value="${escAttr(m.result)}" placeholder="6-4 6-2" ${ready ? "" : "disabled"} aria-label="Resultado" />
        <select data-po-field="wo" ${ready ? "" : "disabled"} aria-label="W.O.">
          <option value="">Sin W.O.</option>
          <option value="home" ${m.wo === "home" ? "selected" : ""}>W.O. gana Pareja 1</option>
          <option value="away" ${m.wo === "away" ? "selected" : ""}>W.O. gana Pareja 2</option>
        </select>
      </div>
      <p class="admin-hint${m.result && !m.info && !m.wo ? " err" : ""}">${escAttr(scoreHint(m))}</p>
    </article>`;
  }

  function renderBracket() {
    const cat = category();
    $("po-empty").hidden = Boolean(cat);
    $("po-cat-tools").hidden = !cat;
    if (!cat) {
      $("po-bracket").innerHTML = "";
      return;
    }
    $("po-size").innerHTML = PLAYOFF_SIZES.map(
      (n) => `<option value="${n}" ${n === cat.size ? "selected" : ""}>${n} parejas (${roundName(n, 1)})</option>`
    ).join("");
    const resolved = resolveCategory(cat);
    $("po-bracket").innerHTML =
      resolved.rounds
        .map(
          (r) => `<div class="po-round">
            <h3>${escAttr(r.name)}</h3>
            ${r.matches.map(matchCard).join("")}
          </div>`
        )
        .join("") +
      `<div class="po-round po-champ">
        <h3>Campeón</h3>
        <div class="po-match${resolved.champion ? " done" : ""}"><strong>${escAttr(resolved.champion || "A definir")}</strong></div>
      </div>`;
  }

  function render() {
    fillHeader();
    fillCats();
    fillLists();
    renderBracket();
  }

  function focusKey(el) {
    const card = el?.closest?.("[data-po-id]");
    return card && el.dataset.poField ? `${card.dataset.poId}|${el.dataset.poField}` : "";
  }

  function rerenderKeepingFocus() {
    setTimeout(() => {
      const key = focusKey(document.activeElement);
      renderBracket();
      fillCats();
      if (!key) return;
      const [id, field] = key.split("|");
      document.querySelector(`[data-po-id="${id}"] [data-po-field="${field}"]`)?.focus();
    }, 0);
  }

  function updateMatch(id, field, value) {
    const cat = category();
    const m = cat?.matches.find((x) => x.id === id);
    if (!m) return;
    if (field === "homeSeed" || field === "awaySeed") {
      const n = Number(value);
      m[field] = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    } else {
      m[field] = String(value || "").trim();
    }
    markDirty();
  }

  async function reload({ force = false } = {}) {
    if (ctx.dirty.has("playoff") && !force) return;
    try {
      const remote = await api.readRemoteJson(PLAYOFF_PATH, null);
      if (remote) ctx.playoff = normalizePlayoff(remote);
      loaded = true;
      shell.clearDirty("playoff");
      render();
    } catch (err) {
      if (!loaded) render();
      toast(err.message, "err");
    }
  }

  function bind() {
    $("po-temp")?.addEventListener("change", (e) => {
      data().temp = e.target.value;
      markDirty();
      fillLists();
    });
    for (const [id, key] of [
      ["po-title", "title"],
      ["po-dates", "dates"],
      ["po-note", "note"],
    ]) {
      $(id)?.addEventListener("input", (e) => {
        data()[key] = e.target.value;
        markDirty();
      });
    }
    $("po-visible")?.addEventListener("change", (e) => {
      data().visible = e.target.checked;
      markDirty();
      updateStatus();
    });

    $("po-cats")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-po-cat]");
      if (!btn) return;
      activeCat = btn.dataset.poCat;
      fillCats();
      fillLists();
      renderBracket();
    });

    $("po-cat-add")?.addEventListener("change", (e) => {
      const cat = e.target.value;
      if (!cat) return;
      const base = normalizeCategory({ cat, size: 8 });
      data().categories.push(seedCategory(base, rankingPairs(cat)));
      data().categories.sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat));
      activeCat = cat;
      markDirty();
      render();
    });

    $("po-size")?.addEventListener("change", async (e) => {
      const cat = category();
      if (!cat) return;
      const size = Number(e.target.value);
      const ok = await confirmModal({
        title: `Cuadro de ${size} parejas`,
        body: `Se rearma ${cat.cat} con las ${size} mejores del ranking de ${seasonLabel(temp())}. Los resultados cargados en esta categoría se borran.`,
        confirmLabel: "Rearmar cuadro",
        danger: true,
      });
      if (!ok) {
        e.target.value = String(cat.size);
        return;
      }
      const next = seedCategory(normalizeCategory({ cat: cat.cat, size }), rankingPairs(cat.cat));
      Object.assign(cat, next);
      markDirty();
      render();
    });

    $("po-arm")?.addEventListener("click", async () => {
      const cat = category();
      if (!cat) return;
      const pairs = rankingPairs(cat.cat);
      if (!pairs.length) {
        toast(`No hay parejas de ${cat.cat} en el ranking de ${seasonLabel(temp())}.`, "err");
        return;
      }
      const ok = await confirmModal({
        title: `Armar ${cat.cat} desde el ranking`,
        body: `Se cargan las ${Math.min(cat.size, pairs.length)} mejores de ${seasonLabel(temp())} (1 vs ${cat.size}, 2 vs ${cat.size - 1}…). Los días y horarios quedan; los resultados se borran.`,
        confirmLabel: "Armar cuadro",
      });
      if (!ok) return;
      Object.assign(cat, seedCategory(cat, pairs));
      markDirty();
      render();
      toast(`Cuadro de ${cat.cat} armado`, "ok");
    });

    $("po-cat-remove")?.addEventListener("click", async () => {
      const cat = category();
      if (!cat) return;
      const ok = await confirmModal({
        title: `Quitar ${cat.cat}`,
        body: "La categoría sale del playoff. Publicá para que impacte en la web.",
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      data().categories = data().categories.filter((c) => c !== cat);
      markDirty();
      render();
    });

    $("po-bracket")?.addEventListener("input", (e) => {
      const el = e.target.closest("[data-po-field]");
      const card = e.target.closest("[data-po-id]");
      if (!el || !card) return;
      updateMatch(card.dataset.poId, el.dataset.poField, el.value);
      if (el.dataset.poField === "result") {
        const hint = card.querySelector(".admin-hint");
        const parsed = describeResult(el.value);
        if (hint) hint.textContent = parsed ? parsed.score : el.value.trim() ? "Resultado inválido" : "Sin resultado";
      }
    });
    $("po-bracket")?.addEventListener("change", (e) => {
      const el = e.target.closest("[data-po-field]");
      const card = e.target.closest("[data-po-id]");
      if (!el || !card) return;
      updateMatch(card.dataset.poId, el.dataset.poField, el.value);
      if (["home", "away", "result", "wo"].includes(el.dataset.poField)) rerenderKeepingFocus();
    });

    $("po-reload")?.addEventListener("click", async () => {
      if (ctx.dirty.has("playoff")) {
        const ok = await confirmModal({
          title: "Descartar cambios",
          body: "Se vuelve a lo último publicado y se pierden los cambios sin guardar del playoff.",
          confirmLabel: "Descartar",
          danger: true,
        });
        if (!ok) return;
      }
      await reload({ force: true });
    });

    $("po-publish")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const bad = invalidResults(data());
      if (bad.length) {
        const { cat, match } = bad[0];
        activeCat = cat;
        render();
        const message = `Resultado inválido en ${cat} (${match.home || "pareja"} vs ${match.away || "pareja"}). Usá 6-4 6-2 o 6-4 3-6 10-8.`;
        setMsg($("po-msg"), message, "err");
        toast(message, "err");
        return;
      }
      const ok = await confirmModal({
        title: "Publicar playoff",
        body: data().visible
          ? "Se publica el cuadro y los resultados en /playoff/. El sitio se actualiza en ~1 minuto."
          : "Se guarda el cuadro, pero queda oculto en la web hasta que marques Mostrar en la web.",
        confirmLabel: "Publicar playoff",
      });
      if (!ok) return;
      const next = serializePlayoff(data());
      setBusy($("po-publish"), true, "Publicando…");
      setMsg($("po-msg"), "Publicando playoff…");
      try {
        await api.publishFile(PLAYOFF_PATH, JSON.stringify(next, null, 2) + "\n", "Actualiza el playoff desde el admin.");
        ctx.playoff = normalizePlayoff(next);
        shell.clearDirty("playoff");
        render();
        const text = next.visible
          ? "Playoff publicado. El sitio se actualiza en ~1 minuto."
          : "Playoff guardado. Sigue oculto en la web.";
        setMsg($("po-msg"), text, "ok");
        toast("Playoff publicado", "ok");
      } catch (err) {
        const message = api.publishError(err);
        setMsg($("po-msg"), message, "err");
        toast(message, "err");
      } finally {
        setBusy($("po-publish"), false);
      }
    });
  }

  return { bind, render, reload };
}
