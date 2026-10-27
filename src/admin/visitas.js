import { $, escAttr as esc, setMsg } from "./ui.js";

function topEntries(map, limit = 10) {
  return Object.entries(map || {})
    .map(([k, v]) => [k, Number(v) || 0])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function bars(map, empty) {
  const rows = topEntries(map);
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  const max = rows[0][1] || 1;
  return `<div class="visitas-bars">${rows
    .map(
      ([label, n]) => `<div class="visitas-row">
        <span class="visitas-label" title="${esc(label)}">${esc(label)}</span>
        <span class="visitas-bar" aria-hidden="true"><i style="width:${Math.max(6, Math.round((n / max) * 100))}%"></i></span>
        <span class="visitas-n">${n}</span>
      </div>`
    )
    .join("")}</div>`;
}

function dailyChart(daily) {
  const rows = Array.isArray(daily) ? daily : [];
  if (!rows.length) return `<p class="muted">Todavía no hay visitas registradas.</p>`;
  const max = Math.max(1, ...rows.map((d) => Number(d.total) || 0));
  const chartH = 180;
  return `<div class="visitas-daily visitas-daily-lg">${rows
    .map((d) => {
      const n = Number(d.total) || 0;
      const h = n ? Math.max(28, Math.round((n / max) * chartH)) : 6;
      const label = String(d.day || "").slice(5);
      return `<div class="visitas-day" title="${esc(d.day)}: ${n}">
        <span class="visitas-day-n">${n || "·"}</span>
        <span class="visitas-col" style="height:${h}px"></span>
        <span class="visitas-day-l">${esc(label)}</span>
      </div>`;
    })
    .join("")}</div>`;
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
    return `<p class="muted">Todavía no hay visitas con IP. Entrá a la web pública y volvé a Actualizar.</p>`;
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
          <td>${esc(r.path || "/")}</td>
          <td>${esc(r.country || "—")}</td>
          <td>${esc(r.device || "—")}</td>
          <td>${esc(r.ref || "Directo")}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table></div>`;
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
    $("visitas-range").textContent = `${data.total || 0} visita${data.total === 1 ? "" : "s"} · ${data.days || 14} días`;
    board.innerHTML = `
      <div class="visitas-hero admin-result-card">
        <div class="admin-result-meta"><span>Totales</span><span>UTC</span></div>
        <strong>${data.total || 0}</strong>
        <p class="muted">Últimos ${data.days || 14} días · abajo las últimas ${Math.min(50, (data.recent || []).length)} con IP</p>
      </div>
      <article class="admin-result-card visitas-chart-wide">
        <h3>Por día</h3>
        ${dailyChart(data.daily)}
      </article>
      <div class="visitas-grid">
        <article class="admin-result-card">
          <h3>Países</h3>
          ${bars(data.countries, "Sin datos de país todavía.")}
        </article>
        <article class="admin-result-card">
          <h3>Dispositivos</h3>
          ${bars(data.devices, "Sin datos de dispositivo todavía.")}
        </article>
        <article class="admin-result-card">
          <h3>Páginas</h3>
          ${bars(data.paths, "Sin páginas todavía.")}
        </article>
        <article class="admin-result-card">
          <h3>Orígenes</h3>
          ${bars(data.refs, "Sin orígenes externos todavía.")}
        </article>
      </div>
      <article class="admin-result-card visitas-recent">
        <h3>Últimas visitas (con IP)</h3>
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
