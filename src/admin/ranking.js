import { CATS, RANK_COLS, RANK_PATH } from "./constants.js";
import { cleanRow, downloadCsv } from "./csv.js";
import { listSeasons, seasonLabel } from "../lib/liga.js";
import { fold } from "../lib/scoring.js";
import { $, confirmModal, escAttr, num, setBusy, setMsg, toast } from "./ui.js";

export function createRanking(ctx, api, shell) {
  let filterTemp = ctx.siteData.currentSeason || "";
  let filterCat = "";
  let term = "";
  const rowKey = (r) => `${String(r.temp).toUpperCase()}|${r.cat}|${fold(r.name)}`;
  let known = new Set(ctx.rows.map(rowKey));
  const removed = new Set();

  function temps() {
    return listSeasons(ctx.siteData, ctx.rows.map((r) => r.temp)).slice().reverse();
  }

  function catsOf(temp) {
    const used = ctx.rows.filter((r) => r.temp === temp).map((r) => r.cat);
    return [...new Set([...CATS, ...used])].filter(Boolean);
  }

  function countIn(temp, cat = "") {
    return ctx.rows.filter((r) => r.temp === temp && (!cat || r.cat === cat)).length;
  }

  function visible() {
    const q = term.trim().toLowerCase();
    return ctx.rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (r.temp !== filterTemp) return false;
        if (q) return (r.name || "").toLowerCase().includes(q);
        return !filterCat || r.cat === filterCat;
      })
      .sort((a, b) => (q ? a.r.cat.localeCompare(b.r.cat, "es") : 0) || Number(a.r.pos) - Number(b.r.pos));
  }

  function tableHtml(list) {
    return list
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

  function catGrid(temp, open) {
    const n = countIn(temp);
    const cats = catsOf(temp);
    return `<div class="res-inner-grid">
      <button class="res-box${open && filterCat === "" ? " done" : ""}" type="button" data-rank-temp="${escAttr(temp)}" data-rank-cat="" style="min-height:96px">
        <span class="kicker">Ranking</span>
        <strong>Todas</strong>
        <p>${n} pareja${n === 1 ? "" : "s"}</p>
      </button>
      ${cats
        .map((c) => {
          const cn = countIn(temp, c);
          return `<button class="res-box${open && filterCat === c ? " done" : ""}" type="button" data-rank-temp="${escAttr(temp)}" data-rank-cat="${escAttr(c)}" style="min-height:96px">
            <span class="kicker">Categoría</span>
            <strong>${escAttr(c)}</strong>
            <p>${cn} pareja${cn === 1 ? "" : "s"}</p>
          </button>`;
        })
        .join("")}
    </div>`;
  }

  function render() {
    const tlist = temps();
    if (filterTemp && !tlist.includes(filterTemp)) filterTemp = tlist[0] || "";
    const current = ctx.siteData.currentSeason;
    if (!filterTemp) filterTemp = tlist.includes(current) ? current : tlist[0] || "";

    const openCats = catsOf(filterTemp);
    if (filterCat && !openCats.includes(filterCat)) filterCat = "";

    const list = filterTemp ? visible() : [];
    $("rank-count").textContent = filterTemp
      ? `${list.length} pareja${list.length === 1 ? "" : "s"} · ${seasonLabel(filterTemp)}`
      : `${ctx.rows.length} pareja${ctx.rows.length === 1 ? "" : "s"}`;

    // Cada temporada = UNA caja contenedora. Adentro: cajitas de categoría (+ tabla si está abierta).
    $("rank-boxes").innerHTML = tlist
      .map((temp) => {
        const open = temp === filterTemp;
        const n = countIn(temp);
        const live = temp === current;
        return `<article class="season-box${open ? " open" : ""}" data-rank-season="${escAttr(temp)}">
          <div class="season-box-head">
            <span class="kicker">Temporada${live ? " · En juego" : ""}</span>
            <strong>${escAttr(seasonLabel(temp))}</strong>
            <p>${n} pareja${n === 1 ? "" : "s"}</p>
          </div>
          <div class="season-box-body">
            ${catGrid(temp, open)}
            ${
              open
                ? `<input class="search" data-rank-q type="search" placeholder="Buscar pareja…" autocomplete="off" value="${escAttr(term)}" />
              <div class="admin-empty" ${list.length ? "hidden" : ""}>
                <p>Todavía no hay parejas en este filtro. Cuando se inscriban aparecen solas acá con 0 puntos.</p>
              </div>
              <div class="admin-scroll">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th class="col-pos">#</th>
                      <th>Nombre / pareja</th>
                      <th class="col-cat">Categoría</th>
                      <th class="col-num">PJ</th>
                      <th class="col-num">Dif</th>
                      <th class="col-num">Pts</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody data-rank-tbody>${tableHtml(list)}</tbody>
                </table>
              </div>`
                : ""
            }
          </div>
        </article>`;
      })
      .join("");
  }

  function refreshTable() {
    const box = $("rank-boxes")?.querySelector(`.season-box[data-rank-season="${filterTemp}"]`);
    if (!box) return;
    const list = visible();
    const tbody = box.querySelector("[data-rank-tbody]");
    const empty = box.querySelector(".admin-empty");
    if (tbody) tbody.innerHTML = tableHtml(list);
    if (empty) empty.hidden = list.length > 0;
    $("rank-count").textContent = `${list.length} pareja${list.length === 1 ? "" : "s"} · ${seasonLabel(filterTemp)}`;
  }

  function refresh() {
    render();
  }

  function bind() {
    $("rank-boxes")?.addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (del) {
        const ok = await confirmModal({
          title: "Eliminar pareja",
          body: "Se va a quitar de la tabla local. Publicá el ranking para que se vea en la web.",
          confirmLabel: "Eliminar",
          danger: true,
        });
        if (!ok) return;
        removed.add(rowKey(ctx.rows[Number(del.dataset.del)]));
        ctx.rows.splice(Number(del.dataset.del), 1);
        shell.markDirty("ranking");
        refresh();
        return;
      }

      const catBtn = e.target.closest("[data-rank-cat]");
      if (!catBtn) return;
      filterTemp = catBtn.dataset.rankTemp || filterTemp;
      filterCat = catBtn.dataset.rankCat || "";
      term = "";
      render();
      catBtn.closest(".season-box")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    $("rank-boxes")?.addEventListener("input", (e) => {
      const search = e.target.closest("[data-rank-q]");
      const field = e.target.closest("[data-k]");
      if (search) {
        term = search.value;
        refreshTable();
        return;
      }
      if (!field) return;
      const tr = field.closest("tr");
      if (!tr) return;
      const i = Number(tr.dataset.i);
      const k = field.dataset.k;
      ctx.rows[i][k] = k === "name" || k === "cat" ? field.value : num(field.value);
      shell.markDirty("ranking");
      if (k === "cat") render();
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

  return { bind, refresh, render, fillFilters: render };
}
