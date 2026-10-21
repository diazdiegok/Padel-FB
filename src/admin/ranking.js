import { CATS, RANK_COLS, RANK_PATH } from "./constants.js";
import { cleanRow, downloadCsv } from "./csv.js";
import { listSeasons } from "../lib/liga.js";
import { fold } from "../lib/scoring.js";
import { $, confirmModal, escAttr, num, setBusy, setMsg, toast } from "./ui.js";

export function createRanking(ctx, api, shell) {
  let filterTemp = ctx.siteData.currentSeason || "T4";
  let filterCat = "";
  const rowKey = (r) => `${String(r.temp).toUpperCase()}|${r.cat}|${fold(r.name)}`;
  let known = new Set(ctx.rows.map(rowKey));
  const removed = new Set();

  function temps() {
    return listSeasons(ctx.siteData, ctx.rows.map((r) => r.temp));
  }

  function catsInView() {
    const used = ctx.rows.filter((r) => r.temp === filterTemp).map((r) => r.cat);
    return [...new Set([...CATS, ...used])].filter(Boolean);
  }

  function fillFilters() {
    const tlist = temps();
    if (tlist.length && !tlist.includes(filterTemp)) {
      filterTemp = tlist.includes(ctx.siteData.currentSeason) ? ctx.siteData.currentSeason : tlist[tlist.length - 1];
    }
    const counts = Object.fromEntries(tlist.map((t) => [t, ctx.rows.filter((r) => r.temp === t).length]));
    $("f-temps").innerHTML = tlist
      .map(
        (t) =>
          `<button class="seg-item${t === filterTemp ? " on" : ""}" type="button" data-temp="${t}"><strong>${t}</strong><span>${counts[t] || 0}</span></button>`
      )
      .join("");
    const catList = catsInView();
    const catCount = (c) => ctx.rows.filter((r) => r.temp === filterTemp && r.cat === c).length;
    if (!catList.includes(filterCat)) filterCat = catList.find((c) => catCount(c)) || catList[0];
    $("f-cats").innerHTML = catList
      .map(
        (c) =>
          `<button class="pill${c === filterCat ? " on" : ""}" type="button" data-cat="${escAttr(c)}">${escAttr(c)} <small>${catCount(c)}</small></button>`
      )
      .join("");
  }

  function visible() {
    const q = ($("f-q").value || "").trim().toLowerCase();
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
    const list = visible();
    const q = ($("f-q").value || "").trim();
    $("rank-count").textContent = q
      ? `${list.length} resultado${list.length === 1 ? "" : "s"} en ${filterTemp}`
      : `${list.length} pareja${list.length === 1 ? "" : "s"} en ${filterCat}`;
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
    fillFilters();
    render();
  }

  function bind() {
    $("f-temps")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-temp]");
      if (!btn) return;
      filterTemp = btn.dataset.temp;
      refresh();
    });
    $("f-cats")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      filterCat = btn.dataset.cat;
      refresh();
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
      if (k === "cat") refresh();
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

  return { bind, refresh, render, fillFilters };
}
