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
    okBtn.textContent = confirmLabel;
    okBtn.className = "btn " + (danger ? "btn-danger-solid" : "btn-lime");
    let settled = false;
    const cleanup = (value) => {
      if (settled) return;
      settled = true;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    dialog.onclose = () => cleanup(false);
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
  if (!badge) return;
  const n = dirtySet?.size || 0;
  badge.hidden = n === 0;
  badge.textContent = n === 1 ? "1 cambio sin guardar" : `${n} cambios sin guardar`;
}
