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

function meterCard(m, renewLabel = "") {
  const usedPct = Number(m.usedPct || 0);
  const leftPct = Number(m.leftPct || Math.max(0, 100 - usedPct));
  const renew = m.renewsAt || renewLabel || "";
  return `<article class="consumos-meter tone-${esc(m.tone || "ok")}">
    <div class="consumos-meter-head">
      <strong>${esc(m.label || "")}</strong>
      <span class="consumos-meter-pct">${esc(usedPct)}% usado · ${esc(leftPct)}% libre</span>
    </div>
    <div class="consumos-meter-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(usedPct)}" aria-label="${esc(m.label)}">
      <i style="width:${Math.min(100, Math.max(0, usedPct))}%"></i>
    </div>
    <div class="consumos-meter-foot">
      <span>${esc(m.used)} / ${esc(m.limit)} ${esc(m.unit || "")}</span>
      <span>quedan ${esc(m.left)} ${esc(m.unit || "")}</span>
    </div>
    ${renew ? `<div class="consumos-meter-renew">Se renueva: <b>${esc(renew)}</b></div>` : ""}
  </article>`;
}

function fallbackMeters(kpis = {}, blocked = false) {
  const writes = blocked ? 1000 : Number(kpis.writesUsed || 0);
  return [
    {
      id: "writes",
      label: "Escrituras KV (hoy)",
      used: writes,
      limit: 1000,
      left: Math.max(0, 1000 - writes),
      usedPct: blocked ? 100 : Math.min(100, Math.round((writes / 1000) * 1000) / 10),
      leftPct: blocked ? 0 : Math.max(0, 100 - Math.min(100, Math.round((writes / 1000) * 1000) / 10)),
      unit: "puts",
      tone: blocked ? "critical" : "ok",
    },
  ];
}

function renderBoard(data) {
  const board = $("consumos-board");
  if (!board) return;
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const kpis = data?.kpis || {};
  const tips = Array.isArray(data?.tips) ? data.tips : [];
  const resetAt = data?.kv?.resetsAtLocal || data?.kv?.resetsAtUtc || "";
  const meters = Array.isArray(data?.meters) && data.meters.length ? data.meters : fallbackMeters(kpis, /BLOQUEADA/i.test(String(kpis.kvWriteStatus || "")));

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
    <p class="consumos-explain">
      Acá ves <b>cuánto del plan free de Cloudflare se está usando hoy</b>.
      Lo crítico es <b>Escrituras KV</b>: si llega a 100%, se cortan inscripción, login y comprobantes hasta el reset.
      Las cuotas diarias se renuevan a las <b>21:00 AR</b> (00:00 UTC)${resetAt ? ` · próximo: <b>${esc(resetAt)}</b>` : ""}.
    </p>
    ${alertHtml}
    <div class="consumos-meters">
      ${meters.map((m) => meterCard(m, m.renewsAt || (m.id === "keys" ? "no renueva (acumulado)" : resetAt))).join("")}
    </div>
    <div class="consumos-kpis">
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Estado escritura</span>
        <strong>${esc(kpis.kvWriteStatus ?? "—")}</strong>
        <span class="consumos-kpi-sub">${esc(kpis.writesLeftPct != null ? `${kpis.writesLeftPct}% libre` : "")}</span>
      </article>
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Visitas hoy</span>
        <strong>${esc(kpis.visitsToday ?? "—")}</strong>
        <span class="consumos-kpi-sub">tráfico web</span>
      </article>
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Contactos</span>
        <strong>${esc(kpis.contacts ?? "—")}</strong>
        <span class="consumos-kpi-sub">tel/mail en KV</span>
      </article>
      <article class="consumos-kpi">
        <span class="consumos-kpi-label">Comprobantes</span>
        <strong>${esc(kpis.payments ?? "—")}</strong>
        <span class="consumos-kpi-sub">pagos subidos en KV</span>
      </article>
    </div>
    <p class="admin-help consumos-kpi-note">
      Contactos y comprobantes no tienen por qué coincidir: una pareja puede tener WhatsApp/mail guardado y todavía no haber subido el pago (o al revés). No son el contador de pendientes ni de inscriptas.
    </p>
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
        const w = data?.kpis?.writesUsedPct;
        tag.textContent = bad
          ? `${(data.alerts || []).filter((a) => a.level !== "ok").length} alerta(s)` +
            (w != null ? ` · escrituras ${w}%` : "")
          : w != null
            ? `Escrituras ${w}%`
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
      if (/KV|cuota|limit exceeded|503/i.test(msg)) {
        renderBoard({
          alerts: [
            {
              level: "critical",
              title: "Cuota de escrituras KV agotada (100%)",
              body: msg,
            },
          ],
          kpis: {
            kvWriteStatus: "BLOQUEADA",
            visitsToday: "—",
            contacts: "—",
            payments: "—",
            writesUsed: 1000,
            writesLeftPct: 0,
            writesUsedPct: 100,
          },
          meters: [
            {
              id: "writes",
              label: "Escrituras KV (hoy)",
              used: 1000,
              limit: 1000,
              left: 0,
              usedPct: 100,
              leftPct: 0,
              unit: "puts",
              tone: "critical",
            },
          ],
          tips: [
            "Esperá el reset diario (00:00 UTC ≈ 21:00 Argentina).",
            "No hace falta tocar el fixture: los datos ya guardados siguen.",
          ],
          kv: { resetsAtLocal: "21:00 AR" },
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
