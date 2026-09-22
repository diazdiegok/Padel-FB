import { SECTIONS } from "./constants.js";
import { $, confirmModal, updateDirtyBadge } from "./ui.js";

export function createShell(ctx, { onEnterSection }) {
  function markDirty(section) {
    ctx.dirty.add(section);
    updateDirtyBadge(ctx.dirty);
  }

  function clearDirty(section) {
    if (section) ctx.dirty.delete(section);
    else ctx.dirty.clear();
    updateDirtyBadge(ctx.dirty);
  }

  function setSection(id, { force = false } = {}) {
    if (!SECTIONS[id]) id = "ranking";
    if (!force && ctx.currentSection && ctx.currentSection !== id && ctx.dirty.has(ctx.currentSection)) {
      return confirmModal({
        title: "Cambios sin guardar",
        body: "Hay cambios locales en esta sección que todavía no se publicaron. ¿Querés salir igual?",
        confirmLabel: "Salir sin guardar",
        danger: true,
      }).then((ok) => {
        if (!ok) return false;
        clearDirty(ctx.currentSection);
        applySection(id);
        return true;
      });
    }
    applySection(id);
    return Promise.resolve(true);
  }

  function applySection(id) {
    ctx.currentSection = id;
    const meta = SECTIONS[id];
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.nav === id);
    });
    document.querySelectorAll("section[data-section]").forEach((sec) => {
      sec.hidden = sec.dataset.section !== id;
    });
    const title = $("admin-page-title");
    const help = $("admin-page-help");
    if (title) title.textContent = meta.title;
    if (help) help.textContent = meta.help;
    const hash = "#" + id;
    if (location.hash !== hash) history.replaceState(null, "", hash);
    document.body.dataset.adminSection = id;
    $("admin-sidebar")?.classList.remove("open");
    $("admin-nav-backdrop")?.classList.remove("open");
    onEnterSection?.(id);
  }

  function bind() {
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await setSection(btn.dataset.nav);
      });
    });
    $("admin-menu-btn")?.addEventListener("click", () => {
      $("admin-sidebar")?.classList.toggle("open");
      $("admin-nav-backdrop")?.classList.toggle("open");
    });
    $("admin-nav-backdrop")?.addEventListener("click", () => {
      $("admin-sidebar")?.classList.remove("open");
      $("admin-nav-backdrop")?.classList.remove("open");
    });
    window.addEventListener("hashchange", () => {
      const id = location.hash.replace(/^#/, "") || "ranking";
      if (id !== ctx.currentSection) setSection(id, { force: true });
    });
  }

  function initialSection() {
    const fromHash = location.hash.replace(/^#/, "");
    return SECTIONS[fromHash] ? fromHash : "ranking";
  }

  return { bind, setSection, markDirty, clearDirty, initialSection };
}
