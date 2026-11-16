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

/** Solo un puntito ámbar: no pinta Consumos de rojo (eso queda para Salir). */
function setAlertDot(on) {
  const btn = $("admin-consumos-btn");
  const dot = $("consumos-alert-dot");
  btn?.classList.toggle("has-alert", !!on);
  if (dot) {
    dot.hidden = !on;
    dot.title = on ? "Hay avisos en Consumos (abrí el panel)" : "";
  }
}

function isHacerDeployAlert(a) {
  return a?.id === "hacer-deploy" || /HACER DEPLOY/i.test(`${a?.title || ""} ${a?.body || ""}`);
}

function isWaitOnlyAlert(a) {
  if (isHacerDeployAlert(a)) return true;
  const t = `${a?.title || ""} ${a?.body || ""}`;
  return /vercel|rate.?limit|deploy|24\s*h|hobby/i.test(t) && !/KV|escritur|inscripci/i.test(t);
}

function formatRemaining(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "";
  const diff = Math.max(0, n - Date.now());
  if (diff <= 0) return "ahora";
  const min = Math.round(diff / 60000);
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 48) return m ? `en ${h} h ${m} min` : `en ${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `en ${d} d ${rh} h` : `en ${d} d`;
}

function renewLine(absolute, ms) {
  const abs = String(absolute || "").trim();
  const rel = formatRemaining(ms);
  if (abs && rel) return `${abs} · ${rel}`;
  return abs || rel || "";
}

const PROVIDER_META = {
  cloudflare: {
    title: "Cloudflare",
    blurb: "API del sitio: login, inscripción, comprobantes, visitas (KV).",
  },
  vercel: {
    title: "Vercel",
    blurb: "Deploys del sitio público (padel-fb.vercel.app).",
  },
  github: {
    title: "GitHub",
    blurb: "Publish del admin al repo (fixture, ranking, parejas).",
  },
};

function meterCard(m, providerRenew = "") {
  const usedPct = Number(m.usedPct || 0);
  const leftPct = Number(m.leftPct || Math.max(0, 100 - usedPct));
  const left = m.left != null ? m.left : Math.max(0, Number(m.limit || 0) - Number(m.used || 0));
  const renew = renewLine(m.renewsAt || providerRenew, m.renewsAtMs);
  return `<article class="consumos-meter tone-${esc(m.tone || "ok")}">
    <div class="consumos-meter-head">
      <strong>${esc(m.label || "")}</strong>
      <span class="consumos-meter-pct">${esc(usedPct)}% usado · ${esc(leftPct)}% libre</span>
    </div>
    <div class="consumos-meter-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(usedPct)}" aria-label="${esc(m.label)}">
      <i style="width:${Math.min(100, Math.max(0, usedPct))}%"></i>
    </div>
    <div class="consumos-meter-foot">
      <span>Usado <b>${esc(m.used)}</b> / ${esc(m.limit)} ${esc(m.unit || "")}</span>
      <span class="consumos-meter-left">Quedan <b>${esc(left)}</b> ${esc(m.unit || "")}</span>
    </div>
    ${renew ? `<div class="consumos-meter-renew">Se renueva: <b>${esc(renew)}</b></div>` : ""}
  </article>`;
}

function providerSection(p) {
  const id = p?.id || "";
  const meta = PROVIDER_META[id] || { title: p?.name || "Proveedor", blurb: p?.explain || "" };
  const alerts = Array.isArray(p?.alerts) ? p.alerts : [];
  const meters = Array.isArray(p?.meters) ? p.meters : [];
  const kpis = Array.isArray(p?.kpis) ? p.kpis : [];
  const tips = Array.isArray(p?.tips) ? p.tips : [];
  const renew = renewLine(p?.renewsAt, p?.renewsAtMs);

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

  const metersHtml = meters.length
    ? `<div class="consumos-meters">${meters.map((m) => meterCard(m, p?.renewsAt || "")).join("")}</div>`
    : `<p class="admin-help">Sin medidores para este proveedor ahora.</p>`;

  const deployBanner =
    id === "vercel" && p?.hacerDeployBanner
      ? `<article class="consumos-hacer-deploy" data-hacer-deploy>
      <div>
        <strong>HACER DEPLOY</strong>
        <p>Falta el deploy de Vercel para la UI pendiente (Consumos en 3 bloques, alerta ámbar, contraste Resultados). No toca Fixture.</p>
      </div>
      <button type="button" class="btn btn-ghost consumos-hacer-deploy-btn" data-hide-hacer-deploy>Ocultar cartel</button>
    </article>`
      : "";

  // No repetir el aviso HACER DEPLOY dentro de alertas si ya hay cartel.
  const alertsForUi = deployBanner ? alerts.filter((a) => !isHacerDeployAlert(a)) : alerts;
  const alertHtmlFinal = alertsForUi.length
    ? `<div class="consumos-alerts">${alertsForUi
        .map(
          (a) => `<article class="consumos-alert level-${esc(a.level || "ok")}">
            <h3>${esc(levelLabel(a.level))} · ${esc(a.title || "")}</h3>
            <p>${esc(a.body || "")}</p>
          </article>`
        )
        .join("")}</div>`
    : `<article class="consumos-alert level-ok"><h3>OK · Sin alertas</h3><p>Sin señales de cuota al límite en ${esc(meta.title)}.</p></article>`;

  return `<section class="consumos-provider" data-provider="${esc(id)}">
    <header class="consumos-provider-head">
      <div>
        <p class="consumos-provider-kicker">Proveedor</p>
        <h2>${esc(meta.title)}</h2>
      </div>
      ${renew ? `<span class="consumos-provider-renew">Próximo reset<br><b>${esc(renew)}</b></span>` : ""}
    </header>
    <p class="consumos-explain">${esc(p?.explain || meta.blurb)}</p>
    ${deployBanner}
    <h3 class="consumos-block-title">Cuotas</h3>
    ${metersHtml}
    ${kpiHtml ? `<h3 class="consumos-block-title">Resumen</h3>${kpiHtml}` : ""}
    <h3 class="consumos-block-title">Alertas</h3>
    ${alertHtmlFinal}
    ${p?.kpiNote ? `<p class="admin-help consumos-kpi-note">${esc(p.kpiNote)}</p>` : ""}
    ${
      tips.length
        ? `<article class="consumos-tips">
      <h3>Tips · ${esc(meta.title)}</h3>
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

function orderProviders(list) {
  const order = ["cloudflare", "vercel", "github"];
  return [...list].sort((a, b) => {
    const ia = order.indexOf(a?.id);
    const ib = order.indexOf(b?.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function renderBoard(data) {
  const board = $("consumos-board");
  if (!board) return;
  const providers = orderProviders(
    Array.isArray(data?.providers) && data.providers.length ? data.providers : [legacyAsCloudflare(data || {})]
  );

  board.innerHTML = `
    <p class="consumos-explain consumos-explain-top">
      Tres proveedores <b>separados</b>. Cada uno con su barra, lo que queda y cuándo se renueva (hora AR + cuenta regresiva).
    </p>
    <div class="consumos-providers">
      ${providers.map(providerSection).join("")}
    </div>
  `;
}

export function createConsumos(ctx, api) {
  let last = null;

  function syncHideDeployBtn(on) {
    const btn = $("consumos-hide-deploy");
    if (btn) btn.hidden = !on;
  }

  async function hideHacerDeploy() {
    try {
      setMsg($("consumos-msg"), "Ocultando cartel…");
      await api.worker("/usage/hacer-deploy", { hide: true });
      syncHideDeployBtn(false);
      setMsg($("consumos-msg"), "Cartel «HACER DEPLOY» oculto.", "ok");
      await reload({ quiet: true });
    } catch (err) {
      setMsg($("consumos-msg"), err?.message || "No se pudo ocultar el cartel.", "err");
    }
  }

  async function reload({ quiet = false } = {}) {
    if (!quiet) setMsg($("consumos-msg"), "Leyendo consumos…");
    try {
      const data = await api.worker("/usage");
      last = data;
      const actionable = (data?.alerts || []).some(
        (a) => (a.level === "critical" || a.level === "warn") && !isWaitOnlyAlert(a)
      );
      const anyNotice = (data?.alerts || []).some((a) => a.level === "critical" || a.level === "warn");
      setAlertDot(anyNotice);
      syncHideDeployBtn(!!data?.hacerDeployBanner);
      const tag = $("consumos-status-tag");
      if (tag) {
        const parts = [];
        if (data?.hacerDeployBanner) parts.push("HACER DEPLOY");
        const providers = Array.isArray(data?.providers) ? data.providers : [];
        for (const p of providers) {
          const crit = (p.alerts || []).some((a) => a.level === "critical" && !isWaitOnlyAlert(a));
          const warn = (p.alerts || []).some(
            (a) => a.level === "warn" && !isWaitOnlyAlert(a) && !isHacerDeployAlert(a)
          );
          const waiting = (p.alerts || []).some(
            (a) => (a.level === "critical" || a.level === "warn") && isWaitOnlyAlert(a) && !isHacerDeployAlert(a)
          );
          if (crit) parts.push(`${p.name} crítico`);
          else if (warn) parts.push(`${p.name} atención`);
          else if (waiting) parts.push(`${p.name} en espera`);
        }
        const w = data?.kpis?.writesUsedPct;
        tag.textContent = parts.length ? parts.join(" · ") : w != null ? `CF escrituras ${w}%` : "Sin alertas";
        void actionable;
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

  async function editStorageGb() {
    const cur = last?.providers?.find((p) => p.id === "vercel")?.storage?.usedGb;
    const raw = window.prompt(
      "Deployment Storage usado (GB), como en Vercel → Usage.\nEj: 4.94",
      cur != null ? String(cur) : "4.94"
    );
    if (raw == null) return;
    const usedGb = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(usedGb) || usedGb < 0) {
      setMsg($("consumos-msg"), "Número inválido.", "err");
      return;
    }
    try {
      setMsg($("consumos-msg"), "Guardando storage…");
      await api.worker("/usage/vercel-storage", { usedGb, limitGb: 10, source: "admin" });
      setMsg($("consumos-msg"), `Storage actualizado: ${usedGb} GB / 10 GB.`, "ok");
      await reload({ quiet: true });
    } catch (err) {
      setMsg($("consumos-msg"), err?.message || "No se pudo guardar storage.", "err");
    }
  }

  function bind() {
    $("consumos-reload")?.addEventListener("click", () => reload());
    $("consumos-hide-deploy")?.addEventListener("click", () => hideHacerDeploy());
    $("consumos-storage-edit")?.addEventListener("click", () => editStorageGb());
    $("consumos-board")?.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("[data-hide-hacer-deploy]");
      if (btn) hideHacerDeploy();
    });
  }

  return { bind, reload, getLast: () => last };
}
