import { CATS, RANK_COLS, RANK_PATH } from "./constants.js";
import { cleanRow, downloadCsv } from "./csv.js";
import { listSeasons, seasonLabel } from "../lib/liga.js";
import { fold } from "../lib/scoring.js";
import { $, confirmModal, escAttr, num, setBusy, setMsg, toast } from "./ui.js";

export function createRanking(ctx, api, shell) {
  let filterTemp = "";
  let filterCat = "";
  const rowKey = (r) => `${String(r.temp).toUpperCase()}|${r.cat}|${fold(r.name)}`;
  let known = new Set(ctx.rows.map(rowKey));
  const removed = new Set();

  function temps() {
    return listSeasons(ctx.siteData, ctx.rows.map((r) => r.temp)).slice().reverse();
  }

  function catsInView() {
    const used = ctx.rows.filter((r) => r.temp === filterTemp).map((r) => r.cat);
    return [...new Set([...CATS, ...used])].filter(Boolean);
  }

  function countIn(temp) {
    return ctx.rows.filter((r) => r.temp === temp).length;
  }

  function renderCrumbs() {
    const el = $("rank-crumbs");
    if (!el) return;
    if (!filterTemp) {
      el.innerHTML = `<b>Temporadas</b>`;
      return;
    }
    el.innerHTML = `<button type="button" data-rank-go="">Temporadas</button> <span>›</span> <b>${escAttr(seasonLabel(filterTemp))}</b>`;
  }

  function renderBoxes() {
    const box = $("rank-boxes");
    if (!box) return;
    if (filterTemp) {
      box.innerHTML = "";
      return;
    }
    const tlist = temps();
    const current = ctx.siteData.currentSeason;
    box.innerHTML = tlist
      .map((temp) => {
        const n = countIn(temp);
        const live = temp === current;
        return `<button class="res-box" type="button" data-rank-temp="${escAttr(temp)}">
          <span class="kicker">Temporada</span>
          <strong>${escAttr(seasonLabel(temp))}</strong>
          <p>${n} pareja${n === 1 ? "" : "s"}</p>
          ${live ? `<span class="admin-chip-live">En juego</span>` : ""}
        </button>`;
      })
      .join("");
  }

  function fillCats() {
    const catList = catsInView();
    const catCount = (c) => ctx.rows.filter((r) => r.temp === filterTemp && r.cat === c).length;
    if (!catList.includes(filterCat)) filterCat = catList.find((c) => catCount(c)) || catList[0] || "";
    $("f-cats").innerHTML = catList
      .map(
        (c) =>
          `<button class="pill${c === filterCat ? " on" : ""}" type="button" data-cat="${escAttr(c)}">${escAttr(c)} <small>${catCount(c)}</small></button>`
      )
      .join("");
  }

  function visible() {
    const q = ($("f-q")?.value || "").trim().toLowerCase();
    return ctx.rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (r.temp !== filterTemp) return false;
        if (q) return (r.name || "").toLowerCase().includes(q);
        return r.cat === filterCat;
      })
      .sort((a, b) => (q ? a.r.cat.localeCompare(b.r.cat, "es") : 0) || Number(a.r.pos) - Number(b.r.pos));
  }

  function render() {
    const detail = $("rank-detail");
    const inSeason = !!filterTemp;
    if (detail) detail.hidden = !inSeason;
    renderCrumbs();
    renderBoxes();

    if (!inSeason) {
      const total = ctx.rows.length;
      $("rank-count").textContent = `${total} pareja${total === 1 ? "" : "s"}`;
      return;
    }

    fillCats();
    const list = visible();
    const q = ($("f-q")?.value || "").trim();
    $("rank-count").textContent = q
      ? `${list.length} resultado${list.length === 1 ? "" : "s"} en ${seasonLabel(filterTemp)}`
      : `${list.length} pareja${list.length === 1 ? "" : "s"} en ${filterCat || "—"}`;
    const empty = $("rank-empty");
    if (empty) empty.hidden = list.length > 0;
    $("tbody").innerHTML = list
      .map(({ r, i }) => {
        const catOpts = [...new Set([...CATS, r.cat].filter(Boolean))]
          .map((c) => `<option ${c === r.cat ? "selected" : ""}>${c}</option>`)
          .join("");
        return `<tr data-i="${i}">
          <td class="col-pos"><input data-k="pos" type="number" inputmode="numeric" value="${r.pos}" /></td>
          <td><input class="admin-name" data-k="name" value="${escAttr(r.name)}" /></td>
          <td class="col-cat"><select data-k="cat">${catOpts}</select></td>
          <td class="col-num"><input data-k="pj" type="number" inputmode="numeric" value="${r.pj}" /></td>
          <td class="col-num"><input data-k="dif" type="number" inputmode="numeric" value="${r.dif}" /></td>
          <td class="col-num"><input data-k="pts" type="number" inputmode="numeric" value="${r.pts}" /></td>
          <td class="col-del"><button class="admin-del" type="button" data-del="${i}" aria-label="Eliminar">×</button></td>
        </tr>`;
      })
      .join("");
  }

  function refresh() {
    const tlist = temps();
    if (filterTemp && !tlist.includes(filterTemp)) filterTemp = "";
    render();
  }

  function bind() {
    $("rank-boxes")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rank-temp]");
      if (!btn) return;
      filterTemp = btn.dataset.rankTemp;
      filterCat = "";
      const search = $("f-q");
      if (search) search.value = "";
      render();
      $("rank-crumbs")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("rank-crumbs")?.addEventListener("click", (e) => {
      const go = e.target.closest("[data-rank-go]");
      if (!go) return;
      filterTemp = "";
      filterCat = "";
      const search = $("f-q");
      if (search) search.value = "";
      render();
    });
    $("f-cats")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      filterCat = btn.dataset.cat;
      render();
    });
    $("f-q")?.addEventListener("input", render);

    $("tbody")?.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const i = Number(tr.dataset.i);
      const k = e.target.dataset.k;
      if (!k) return;
      ctx.rows[i][k] = k === "name" || k === "cat" ? e.target.value : num(e.target.value);
      shell.markDirty("ranking");
      if (k === "cat") render();
    });
    $("tbody")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      const ok = await confirmModal({
        title: "Eliminar pareja",
        body: "Se va a quitar de la tabla local. Publicá el ranking para que se vea en la web.",
        confirmLabel: "Eliminar",
        danger: true,
      });
      if (!ok) return;
      removed.add(rowKey(ctx.rows[Number(btn.dataset.del)]));
      ctx.rows.splice(Number(btn.dataset.del), 1);
      shell.markDirty("ranking");
      refresh();
    });

    $("csv-export")?.addEventListener("click", () => {
      downloadCsv(
        "ranking-liga-fb.csv",
        RANK_COLS,
        ctx.rows.map((r) => cleanRow(r, ctx.siteData.currentSeason || "T4"))
      );
      toast("Ranking exportado", "ok");
    });

    $("publish")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) {
        toast(gate.message, "err");
        return;
      }
      const ok = await confirmModal({
        title: "Publicar ranking",
        body: "Se va a subir ranking.json al repositorio. El sitio público se actualiza en ~1 minuto.",
        confirmLabel: "Publicar ranking",
      });
      if (!ok) return;
      setBusy($("publish"), true, "Publicando…");
      setMsg($("rank-msg"), "Publicando ranking…");
      try {
        const remote = await api.readRemoteJson(RANK_PATH, []);
        const local = new Set(ctx.rows.map(rowKey));
        const fresh = (Array.isArray(remote) ? remote : []).filter(
          (r) => !known.has(rowKey(r)) && !local.has(rowKey(r)) && !removed.has(rowKey(r))
        );
        ctx.rows = [...ctx.rows, ...fresh]
          .map((r) => cleanRow(r, ctx.siteData.currentSeason || "T4"))
          .filter((r) => r.name && r.cat.toLowerCase() !== "s masculina");
        await api.publishFile(RANK_PATH, JSON.stringify(ctx.rows, null, 2) + "\n", "Actualiza ranking desde el admin.");
        known = new Set(ctx.rows.map(rowKey));
        removed.clear();
        shell.clearDirty("ranking");
        const extra = fresh.length
          ? ` Se sumaron ${fresh.length} pareja${fresh.length === 1 ? "" : "s"} que se inscribieron mientras editabas.`
          : "";
        setMsg($("rank-msg"), "Ranking publicado. El sitio se actualiza en ~1 minuto." + extra, "ok");
        toast("Ranking publicado", "ok");
        refresh();
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("rank-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("publish"), false);
      }
    });
  }

  return { bind, refresh, render, fillFilters: fillCats };
}
