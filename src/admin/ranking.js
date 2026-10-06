import { CATS, RANK_COLS, RANK_PATH } from "./constants.js";
import { cleanRow, downloadCsv, parseRankingCsv } from "./csv.js";
import { $, confirmModal, escAttr, num, setBusy, setMsg, toast } from "./ui.js";

export function createRanking(ctx, api, shell) {
  let filterTemp = ctx.siteData.currentSeason || "T4";
  let filterCat = "TODAS";

  function temps() {
    return [...new Set(ctx.rows.map((r) => r.temp))].sort();
  }

  function catsInView() {
    const list = filterTemp === "TODAS" ? ctx.rows : ctx.rows.filter((r) => r.temp === filterTemp);
    return [...new Set(list.map((r) => r.cat))].sort();
  }

  function fillFilters() {
    const tlist = temps();
    if (filterTemp !== "TODAS" && tlist.length && !tlist.includes(filterTemp)) {
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
    if (filterCat !== "TODAS" && !catList.includes(filterCat)) filterCat = "TODAS";
    $("f-cats").innerHTML =
      `<button class="pill${filterCat === "TODAS" ? " on" : ""}" type="button" data-cat="TODAS">Todas</button>` +
      catList.map((c) => `<button class="pill${c === filterCat ? " on" : ""}" type="button" data-cat="${c}">${c}</button>`).join("");
  }

  function visible() {
    const q = ($("f-q").value || "").trim().toLowerCase();
    return ctx.rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (filterTemp !== "TODAS" && r.temp !== filterTemp) return false;
        if (filterCat !== "TODAS" && r.cat !== filterCat) return false;
        if (q && !(r.name || "").toLowerCase().includes(q)) return false;
        return true;
      });
  }

  function render() {
    const list = visible();
    $("rank-count").textContent = list.length + " visibles · " + ctx.rows.length + " total";
    const empty = $("rank-empty");
    if (empty) empty.hidden = list.length > 0;
    $("tbody").innerHTML = list
      .map(({ r, i }) => {
        const catOpts = [...new Set([...CATS, r.cat].filter(Boolean))]
          .map((c) => `<option ${c === r.cat ? "selected" : ""}>${c}</option>`)
          .join("");
        const tempOpts = [...new Set([...(temps().length ? temps() : ["T4"]), r.temp])]
          .map((t) => `<option ${t === r.temp ? "selected" : ""}>${t}</option>`)
          .join("");
        return `<tr data-i="${i}">
          <td class="col-pos"><input data-k="pos" type="number" inputmode="numeric" value="${r.pos}" /></td>
          <td><input class="admin-name" data-k="name" value="${escAttr(r.name)}" /></td>
          <td class="col-cat"><select data-k="cat">${catOpts}</select></td>
          <td class="col-num"><input data-k="pj" type="number" inputmode="numeric" value="${r.pj}" /></td>
          <td class="col-num"><input data-k="dif" type="number" inputmode="numeric" value="${r.dif}" /></td>
          <td class="col-num"><input data-k="pts" type="number" inputmode="numeric" value="${r.pts}" /></td>
          <td class="col-temp"><select data-k="temp">${tempOpts}</select></td>
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
      ctx.rows[i][k] = k === "name" || k === "cat" || k === "temp" ? e.target.value : num(e.target.value);
      shell.markDirty("ranking");
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
      ctx.rows.splice(Number(btn.dataset.del), 1);
      shell.markDirty("ranking");
      refresh();
    });

    $("add")?.addEventListener("click", () => {
      const temp = filterTemp === "TODAS" ? ctx.siteData.currentSeason || "T4" : filterTemp;
      const cat = filterCat === "TODAS" ? "A Masculina" : filterCat;
      ctx.rows.push(cleanRow({ name: "", cat, pts: 0, pj: 0, dif: 0, pos: 1, temp }, temp));
      $("f-q").value = "";
      shell.markDirty("ranking");
      render();
      $("tbody")?.querySelector("tr:last-child input[data-k=name]")?.focus();
    });

    $("csv-model")?.addEventListener("click", () => {
      downloadCsv("modelo-ranking.csv", RANK_COLS, [
        {
          name: "Apellido, Nombre / Apellido, Nombre",
          cat: "A Masculina",
          pts: 0,
          pj: 0,
          dif: 0,
          pos: 1,
          temp: ctx.siteData.currentSeason || "T4",
        },
      ]);
      toast("Modelo CSV descargado", "ok");
    });
    $("csv-export")?.addEventListener("click", () => {
      downloadCsv(
        "ranking-liga-fb.csv",
        RANK_COLS,
        ctx.rows.map((r) => cleanRow(r, ctx.siteData.currentSeason || "T4"))
      );
      toast("Ranking exportado", "ok");
    });

    $("csv")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const fallbackTemp = filterTemp === "TODAS" ? ctx.siteData.currentSeason || "T4" : filterTemp;
        const parsed = parseRankingCsv(await file.text(), { fallbackTemp });
        if (!parsed.length) throw new Error("El CSV no tiene filas válidas.");
        if ($("replace-temp").checked) {
          const tempsIn = [...new Set(parsed.map((r) => r.temp))];
          ctx.rows = ctx.rows.filter((r) => !tempsIn.includes(r.temp)).concat(parsed);
          toast(`Reemplacé ${tempsIn.join(", ")} · ${parsed.length} filas`, "ok");
        } else {
          ctx.rows = ctx.rows.concat(parsed);
          toast(`Agregué ${parsed.length} filas`, "ok");
        }
        shell.markDirty("ranking");
        refresh();
      } catch (err) {
        toast(err.message, "err");
      }
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
      ctx.rows = ctx.rows
        .map((r) => cleanRow(r, ctx.siteData.currentSeason || "T4"))
        .filter((r) => r.name && r.cat.toLowerCase() !== "s masculina");
      setBusy($("publish"), true, "Publicando…");
      setMsg($("rank-msg"), "Publicando ranking…");
      try {
        await api.publishFile(RANK_PATH, JSON.stringify(ctx.rows, null, 2) + "\n", "Actualiza ranking desde el admin.");
        shell.clearDirty("ranking");
        setMsg($("rank-msg"), "Ranking publicado. El sitio se actualiza en ~1 minuto.", "ok");
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

    $("rank-csv-toggle")?.addEventListener("click", () => {
      const panel = $("rank-csv-panel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      $("rank-csv-toggle").setAttribute("aria-expanded", String(!panel.hidden));
    });
  }

  return { bind, refresh, render, fillFilters };
}
