import { $, escAttr as esc, setMsg } from "./ui.js";

function pathLabel(path) {
  const p = String(path || "/").replace(/\/+$/, "") || "/";
  if (p === "/") return "Inicio / Home";
  return p;
}

function topEntries(map, limit = 8) {
  return Object.entries(map || {})
    .map(([k, v]) => [k, Number(v) || 0])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function bars(map, empty, { labelOf, total } = {}) {
  const rows = topEntries(map);
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  const max = rows[0][1] || 1;
  const sum = total || rows.reduce((a, [, n]) => a + n, 0);
  return `<div class="visitas-bars">${rows
    .map(([key, n], i) => {
      const label = labelOf ? labelOf(key) : key;
      const w = Math.max(4, Math.round((n / max) * 100));
      return `<div class="visitas-row">
        <span class="visitas-rank">${i + 1}</span>
        <div class="visitas-bar-block">
          <div class="visitas-bar-head">
            <span class="visitas-label" title="${esc(key)}">${esc(label)}</span>
            <span class="visitas-n">${n} <small>${pct(n, sum)}%</small></span>
          </div>
          <span class="visitas-bar" aria-hidden="true"><i style="width:${w}%"></i></span>
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

function dayName(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
}

function dailyChart(daily) {
  const rows = Array.isArray(daily) ? daily : [];
  if (!rows.length) return `<p class="muted">Todavía no hay visitas registradas.</p>`;
  const values = rows.map((d) => Number(d.total) || 0);
  const max = Math.max(1, ...values);
  return `<div class="visitas-daily" role="img" aria-label="Visitas por día">
    ${rows
      .map((d, i) => {
        const v = values[i];
        const h = v ? Math.max(8, Math.round((v / max) * 140)) : 3;
        const label = String(d.day || "").slice(5);
        const wd = dayName(d.day);
        return `<div class="visitas-day" title="${esc(d.day)}: ${v} visita${v === 1 ? "" : "s"}">
          <span class="visitas-day-n">${v ? v : ""}</span>
          <span class="visitas-col" style="height:${h}px"></span>
          <span class="visitas-day-l">${esc(label)}</span>
          <span class="visitas-day-w">${esc(wd)}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function recentTable(recent) {
  const rows = Array.isArray(recent) ? recent : [];
  if (!rows.length) {
    return `<p class="muted">Todavía no hay filas con IP. Entrá a la web pública y tocá Actualizar.</p>`;
  }
  return `<div class="visitas-table-wrap"><table class="visitas-table">
    <thead>
      <tr>
        <th>Cuándo</th>
        <th>IP</th>
        <th>Página</th>
        <th>País</th>
        <th>Dispositivo</th>
        <th>Origen</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
          <td>${esc(formatWhen(r.at))}</td>
          <td class="visitas-ip">${esc(r.ip || "—")}</td>
          <td title="${esc(r.path || "/")}">${esc(pathLabel(r.path))}</td>
          <td>${esc(r.country || "—")}</td>
          <td>${esc(r.device || "—")}</td>
          <td>${esc(r.ref || "Directo")}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table></div>`;
}

function topKey(map, labelOf) {
  const top = topEntries(map, 1)[0];
  if (!top) return "—";
  return labelOf ? labelOf(top[0]) : top[0];
}

export function createVisitas(ctx, api) {
  let loading = false;

  function render(data) {
    const board = $("visitas-board");
    if (!board) return;
    if (!data) {
      board.innerHTML = "";
      return;
    }
    const days = data.days || 14;
    const total = data.total || 0;
    const avg = days ? Math.round((total / days) * 10) / 10 : 0;
    const peak = Math.max(0, ...(data.daily || []).map((d) => Number(d.total) || 0));
    $("visitas-range").textContent = `${total} visita${total === 1 ? "" : "s"} · ${days} días`;
    board.innerHTML = `
      <div class="visitas-kpis">
        <article class="visitas-kpi">
          <span class="visitas-kpi-label">Totales</span>
          <strong>${total}</strong>
          <span class="visitas-kpi-sub">últimos ${days} días</span>
        </article>
        <article class="visitas-kpi">
          <span class="visitas-kpi-label">Promedio / día</span>
          <strong>${avg}</strong>
          <span class="visitas-kpi-sub">pico ${peak}</span>
        </article>
        <article class="visitas-kpi">
          <span class="visitas-kpi-label">Página top</span>
          <strong class="visitas-kpi-text">${esc(topKey(data.paths, pathLabel))}</strong>
          <span class="visitas-kpi-sub">más visitada</span>
        </article>
        <article class="visitas-kpi">
          <span class="visitas-kpi-label">Dispositivo top</span>
          <strong class="visitas-kpi-text">${esc(topKey(data.devices))}</strong>
          <span class="visitas-kpi-sub">más usado</span>
        </article>
      </div>
      <article class="admin-result-card visitas-chart-wide">
        <div class="visitas-card-head">
          <h3>Por día</h3>
          <span class="muted">Últimos ${days} días</span>
        </div>
        ${dailyChart(data.daily)}
      </article>
      <div class="visitas-grid">
        <article class="admin-result-card">
          <h3>Países</h3>
          ${bars(data.countries, "Sin datos de país todavía.", { total })}
        </article>
        <article class="admin-result-card">
          <h3>Dispositivos</h3>
          ${bars(data.devices, "Sin datos de dispositivo todavía.", { total })}
        </article>
        <article class="admin-result-card">
          <h3>Páginas</h3>
          ${bars(data.paths, "Sin páginas todavía.", { labelOf: pathLabel, total })}
        </article>
        <article class="admin-result-card">
          <h3>Orígenes</h3>
          ${bars(data.refs, "Sin orígenes externos todavía.", { total })}
        </article>
      </div>
      <article class="admin-result-card visitas-recent">
        <div class="visitas-card-head">
          <h3>Últimas visitas</h3>
          <span class="muted">${Math.min(50, (data.recent || []).length)} con IP</span>
        </div>
        ${recentTable(data.recent)}
      </article>`;
  }

  async function reload() {
    if (loading) return;
    loading = true;
    setMsg($("visitas-msg"), "Cargando visitas…");
    try {
      const data = await api.worker("/stats?days=14");
      render(data);
      setMsg($("visitas-msg"), "");
    } catch (err) {
      render(null);
      setMsg($("visitas-msg"), err?.message || "No se pudieron leer las visitas.", "err");
    } finally {
      loading = false;
    }
  }

  function bind() {
    $("visitas-reload")?.addEventListener("click", () => reload());
  }

  return { bind, reload };
}
