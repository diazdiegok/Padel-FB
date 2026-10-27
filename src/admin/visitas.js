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
        <span class="visitas-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round((n / max) * 100))}%"></i></span>
        <span class="visitas-n">${n}</span>
      </div>`
    )
    .join("")}</div>`;
}

function dailyChart(daily) {
  const rows = Array.isArray(daily) ? daily : [];
  if (!rows.some((d) => d.total > 0)) return `<p class="muted">Todavía no hay visitas registradas.</p>`;
  const max = Math.max(1, ...rows.map((d) => Number(d.total) || 0));
  return `<div class="visitas-daily">${rows
    .map((d) => {
      const n = Number(d.total) || 0;
      const h = Math.max(n ? 8 : 2, Math.round((n / max) * 72));
      const label = String(d.day || "").slice(5);
      return `<div class="visitas-day" title="${esc(d.day)}: ${n}">
        <span class="visitas-col" style="height:${h}px"></span>
        <span class="visitas-day-n">${n || ""}</span>
        <span class="visitas-day-l">${esc(label)}</span>
      </div>`;
    })
    .join("")}</div>`;
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
        <p class="muted">Últimos ${data.days || 14} días · sin IPs ni datos personales</p>
      </div>
      <div class="visitas-grid">
        <article class="admin-result-card">
          <h3>Por día</h3>
          ${dailyChart(data.daily)}
        </article>
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
      </div>`;
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
