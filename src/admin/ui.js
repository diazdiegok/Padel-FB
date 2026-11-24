export const $ = (id) => document.getElementById(id);

export function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toast(text, kind = "") {
  const host = $("admin-toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "admin-toast" + (kind ? " " + kind : "");
  el.textContent = text;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 280);
  }, kind === "err" ? 5200 : 3200);
}

export function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.className = "admin-msg" + (kind ? " " + kind : "");
}

export function confirmModal({ title, body, confirmLabel = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    const dialog = $("admin-modal");
    const titleEl = $("admin-modal-title");
    const bodyEl = $("admin-modal-body");
    const okBtn = $("admin-modal-ok");
    const cancelBtn = $("admin-modal-cancel");
    if (!dialog || !titleEl || !bodyEl || !okBtn || !cancelBtn) {
      resolve(window.confirm(body || title));
      return;
    }
    titleEl.textContent = title;
    bodyEl.textContent = body;
    okBtn.hidden = false;
    okBtn.disabled = false;
    cancelBtn.hidden = false;
    cancelBtn.disabled = false;
    okBtn.textContent = confirmLabel || "Confirmar";
    okBtn.className = "btn " + (danger ? "btn-danger-solid" : "btn-lime");
    // Fondo/color inline: evita OK invisible si el CSS cacheado no trae btn-danger-solid.
    okBtn.style.background = danger ? "#ff5a3c" : "var(--lime)";
    okBtn.style.borderColor = danger ? "#ff5a3c" : "var(--lime)";
    okBtn.style.color = "#111";
    cancelBtn.style.background = "";
    cancelBtn.style.borderColor = "";
    cancelBtn.style.color = "";
    let settled = false;
    const cleanup = (value) => {
      if (settled) return;
      settled = true;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      dialog.onclose = null;
      okBtn.hidden = false;
      cancelBtn.hidden = false;
      okBtn.style.background = "";
      okBtn.style.borderColor = "";
      okBtn.style.color = "";
      if (dialog.open) dialog.close();
      resolve(value);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    dialog.onclose = () => cleanup(false);
    dialog.showModal();
    // Confirmar a la vista (en angosto a veces quedaba cortado a la derecha).
    requestAnimationFrame(() => okBtn.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });
}

/** Modal con varias opciones. Resuelve el `id` elegido o `null` si cancela. */
export function choiceModal({ title, body, choices = [], cancelLabel = "Cancelar" }) {
  return new Promise((resolve) => {
    const dialog = $("admin-modal");
    const titleEl = $("admin-modal-title");
    const bodyEl = $("admin-modal-body");
    const okBtn = $("admin-modal-ok");
    const cancelBtn = $("admin-modal-cancel");
    const list = (choices || []).filter((c) => c && c.id != null && c.label);
    if (!dialog || !titleEl || !bodyEl || !okBtn || !cancelBtn || !list.length) {
      resolve(null);
      return;
    }
    titleEl.textContent = title || "Elegí una opción";
    bodyEl.innerHTML = `${body ? `<span class="admin-modal-lead">${escAttr(body)}</span>` : ""}
      <div class="admin-modal-choices">
        ${list
          .map(
            (c) =>
              `<button class="btn btn-ghost admin-modal-choice" type="button" data-choice-id="${escAttr(c.id)}">${escAttr(c.label)}</button>`
          )
          .join("")}
      </div>`;
    okBtn.hidden = true;
    cancelBtn.hidden = false;
    cancelBtn.disabled = false;
    cancelBtn.textContent = cancelLabel || "Cancelar";
    let settled = false;
    const cleanup = (value) => {
      if (settled) return;
      settled = true;
      bodyEl.onclick = null;
      cancelBtn.onclick = null;
      dialog.onclose = null;
      okBtn.hidden = false;
      bodyEl.textContent = "";
      cancelBtn.textContent = "Cancelar";
      if (dialog.open) dialog.close();
      resolve(value);
    };
    bodyEl.onclick = (e) => {
      const btn = e.target.closest("[data-choice-id]");
      if (!btn) return;
      cleanup(btn.dataset.choiceId || null);
    };
    cancelBtn.onclick = () => cleanup(null);
    dialog.onclose = () => cleanup(null);
    dialog.showModal();
  });
}

export function noticeModal({ title, body, confirmLabel = "Listo" }) {
  return new Promise((resolve) => {
    const dialog = $("admin-modal");
    const titleEl = $("admin-modal-title");
    const bodyEl = $("admin-modal-body");
    const okBtn = $("admin-modal-ok");
    const cancelBtn = $("admin-modal-cancel");
    if (!dialog || !titleEl || !bodyEl || !okBtn || !cancelBtn) {
      window.alert(body || title);
      resolve();
      return;
    }
    titleEl.textContent = title;
    bodyEl.textContent = body;
    okBtn.hidden = false;
    okBtn.disabled = false;
    okBtn.textContent = confirmLabel;
    okBtn.className = "btn btn-lime";
    cancelBtn.hidden = true;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      okBtn.onclick = null;
      dialog.onclose = null;
      cancelBtn.hidden = false;
      if (dialog.open) dialog.close();
      resolve();
    };
    okBtn.onclick = () => cleanup();
    dialog.onclose = () => cleanup();
    dialog.showModal();
  });
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.prevLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add("is-busy");
    if (label) btn.textContent = label;
  } else {
    btn.disabled = false;
    btn.classList.remove("is-busy");
    if (btn.dataset.prevLabel) btn.textContent = btn.dataset.prevLabel;
  }
}

export function updateDirtyBadge(dirtySet) {
  const badge = $("admin-dirty");
  const cancel = $("admin-dirty-cancel");
  const n = dirtySet?.size || 0;
  const show = n > 0;
  if (badge) {
    badge.hidden = !show;
    badge.textContent = n === 1 ? "1 cambio sin guardar" : `${n} cambios sin guardar`;
  }
  // Solo junto al badge de cambios sin guardar (nunca solo).
  if (cancel) cancel.hidden = !show;
}
