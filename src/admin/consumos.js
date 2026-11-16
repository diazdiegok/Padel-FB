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

function providerSection(p) {
  const alerts = Array.isArray(p?.alerts) ? p.alerts : [];
  const meters = Array.isArray(p?.meters) ? p.meters : [];
  const kpis = Array.isArray(p?.kpis) ? p.kpis : [];
  const tips = Array.isArray(p?.tips) ? p.tips : [];
  const alertHtml = alerts.length
    ? `<div class="consumos-alerts">${alerts
        .map(
          (a) => `<article class="consumos-alert level-${esc(a.level || "ok")}">
            <h3>${esc(levelLabel(a.level))} · ${esc(a.title || "")}</h3>
            <p>${esc(a.body || "")}</p>
          </article>`
        )
        .join("")}</div>`
    : `<article class="consumos-alert level-ok"><h3>OK · Sin alertas</h3><p>Sin señales de cuota al límite en ${esc(p?.name || "este proveedor")}.</p></article>`;

  const kpiHtml = kpis.length
    ? `<div class="consumos-kpis">${kpis
        .map(
          (k) => `<article class="consumos-kpi">
            <span class="consumos-kpi-label">${esc(k.label || "")}</span>
            <strong>${esc(k.value ?? "—")}</strong>
            <span class="consumos-kpi-sub">${esc(k.sub || "")}</span>
          </article>`
        )
        .join("")}</div>`
    : "";

  return `<section class="consumos-provider" data-provider="${esc(p?.id || "")}">
    <header class="consumos-provider-head">
      <h2>${esc(p?.name || "Proveedor")}</h2>
      ${p?.renewsAt ? `<span class="consumos-provider-renew">Próximo reset · <b>${esc(p.renewsAt)}</b></span>` : ""}
    </header>
    ${p?.explain ? `<p class="consumos-explain">${esc(p.explain)}</p>` : ""}
    ${alertHtml}
    ${meters.length ? `<div class="consumos-meters">${meters.map((m) => meterCard(m, m.renewsAt || p?.renewsAt || "")).join("")}</div>` : ""}
    ${kpiHtml}
    ${p?.kpiNote ? `<p class="admin-help consumos-kpi-note">${esc(p.kpiNote)}</p>` : ""}
    ${
      tips.length
        ? `<article class="consumos-tips">
      <h3>Tips · ${esc(p?.name || "")}</h3>
      <ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </article>`
        : ""
    }
  </section>`;
}

function legacyAsCloudflare(data) {
  const kpis = data?.kpis || {};
  const meters = Array.isArray(data?.meters) ? data.meters : [];
  return {
    id: "cloudflare",
    name: "Cloudflare",
    explain: "Worker + KV (plan free).",
    meters,
    kpis: [
      { label: "Estado escritura", value: kpis.kvWriteStatus ?? "—", sub: kpis.writesLeftPct != null ? `${kpis.writesLeftPct}% libre` : "" },
      { label: "Visitas hoy", value: String(kpis.visitsToday ?? "—"), sub: "tráfico web" },
      { label: "Contactos", value: String(kpis.contacts ?? "—"), sub: "tel/mail en KV" },
      { label: "Comprobantes", value: String(kpis.payments ?? "—"), sub: "pagos subidos en KV" },
    ],
    alerts: data?.alerts || [],
    tips: data?.tips || [],
    renewsAt: data?.kv?.resetsAtLocal || "",
  };
}

function renderBoard(data) {
  const board = $("consumos-board");
  if (!board) return;
  const providers =
    Array.isArray(data?.providers) && data.providers.length
      ? data.providers
      : [legacyAsCloudflare(data || {})];

  board.innerHTML = `
    <p class="consumos-explain">
      Cada bloque es un proveedor distinto. <b>No se mezclan</b>: Cloudflare (API/KV), Vercel (deploys del sitio) y GitHub (publish al repo).
    </p>
    <div class="consumos-providers">
      ${providers.map(providerSection).join("")}
    </div>
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
        const parts = [];
        const providers = Array.isArray(data?.providers) ? data.providers : [];
        for (const p of providers) {
          const crit = (p.alerts || []).some((a) => a.level === "critical");
          const warn = (p.alerts || []).some((a) => a.level === "warn");
          if (crit) parts.push(`${p.name} crítico`);
          else if (warn) parts.push(`${p.name} atención`);
        }
        const w = data?.kpis?.writesUsedPct;
        tag.textContent = parts.length
          ? parts.join(" · ")
          : w != null
            ? `CF escrituras ${w}%`
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
          providers: [
            {
              id: "cloudflare",
              name: "Cloudflare",
              explain: "Worker + KV.",
              alerts: [{ level: "critical", title: "Cuota de escrituras KV agotada (100%)", body: msg }],
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
                  renewsAt: "21:00 AR",
                },
              ],
              tips: ["Esperá el reset diario (00:00 UTC ≈ 21:00 Argentina)."],
              renewsAt: "21:00 AR",
            },
          ],
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
