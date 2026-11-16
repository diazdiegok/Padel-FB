import { $, setMsg } from "./ui.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function levelLabel(level) {
  if (level === "critical") return "Crítico";
  if (level === "warn") return "Atención";
  return "OK";
}

function setAlertDot(on) {
  const btn = $("admin-consumos-btn");
  const dot = $("consumos-alert-dot");
  btn?.classList.toggle("has-alert", !!on);
  if (dot) dot.hidden = !on;
}

function renderBoard(data) {
  const board = $("consumos-board");
  if (!board) return;
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const kpis = data?.kpis || {};
  const tips = Array.isArray(data?.tips) ? data.tips : [];
  const resetAt = data?.kv?.resetsAtLocal || data?.kv?.resetsAtUtc || "";

  const alertHtml = alerts.length
    ? `<div class="consumos-alerts">${alerts
        .map(
          (a) => `<article class="consumos-alert level-${esc(a.level || "ok")}">
            <h3>${esc(levelLabel(a.level))} · ${esc(a.title || "")}</h3>
            <p>${esc(a.body || "")}</p>
          </article>`
        )
        .join("")}</div>`
    : `<article class="consumos-alert level-ok"><h3>OK · Sin alertas</h3><p>No hay señales de cuota al límite ahora.</p></article>`;

  board.innerHTML = `
    ${alertHtml}
    <div class="consumos-kpis">
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Visitas hoy</span>
        <strong>${esc(kpis.visitsToday ?? "—")}</strong>
        <span class="consumos-kpi-sub">conteo del Worker</span>
      </article>
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Escritura KV</span>
        <strong>${esc(kpis.kvWriteStatus ?? "—")}</strong>
        <span class="consumos-kpi-sub">${esc(resetAt ? `reset ${resetAt}` : "plan free ~1000/día")}</span>
      </article>
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Contactos</span>
        <strong>${esc(kpis.contacts ?? "—")}</strong>
        <span class="consumos-kpi-sub">en KV</span>
      </article>
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Comprobantes</span>
        <strong>${esc(kpis.payments ?? "—")}</strong>
        <span class="consumos-kpi-sub">en KV</span>
      </article>
    </div>
    <article class="consumos-tips">
      <h3>Cómo evitar cortes</h3>
      <ul>
        ${tips.map((t) => `<li>${esc(t)}</li>`).join("") || "<li>Sin tips por ahora.</li>"}
      </ul>
    </article>
  `;
}

export function createConsumos(ctx, api) {
  let last = null;

  async function reload({ quiet = false } = {}) {
    if (!quiet) setMsg($("consumos-msg"), "Leyendo consumos…");
    try {
      const data = await api.worker("/usage");
      last = data;
      const bad = (data?.alerts || []).some((a) => a.level === "critical" || a.level === "warn");
      setAlertDot(bad);
      const tag = $("consumos-status-tag");
      if (tag) {
        tag.textContent = bad
          ? `${(data.alerts || []).filter((a) => a.level !== "ok").length} alerta(s)`
          : "Sin alertas";
      }
      renderBoard(data);
      if (!quiet) setMsg($("consumos-msg"), "");
      return data;
    } catch (err) {
      const msg = err?.message || "No se pudo leer consumos.";
      setAlertDot(true);
      if ($("consumos-status-tag")) $("consumos-status-tag").textContent = "Error";
      if (!quiet) setMsg($("consumos-msg"), msg, "err");
      // Si el propio error es cuota KV, mostrarlo como alerta local.
      if (/KV|cuota|limit exceeded|503/i.test(msg)) {
        renderBoard({
          alerts: [
            {
              level: "critical",
              title: "Cuota de escrituras KV agotada",
              body: msg,
            },
          ],
          kpis: { kvWriteStatus: "BLOQUEADA", visitsToday: "—", contacts: "—", payments: "—" },
          tips: [
            "Esperá el reset diario (00:00 UTC ≈ 21:00 Argentina).",
            "No hace falta tocar el fixture: los datos ya guardados siguen.",
            "El contador de visitas ya no debería quemar la cuota (Worker actualizado).",
          ],
          kv: { resetsAtLocal: "~21:00 Argentina" },
        });
      }
      return null;
    }
  }

  function bind() {
    $("consumos-reload")?.addEventListener("click", () => reload());
  }

  return { bind, reload, getLast: () => last };
}
