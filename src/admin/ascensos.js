import { ASCENSOS_PATH } from "./constants.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createAscensos(ctx, api, shell) {
  const BASE = ctx.BASE;
  const uploadedPreviews = new Map();

  function list() {
    if (!Array.isArray(ctx.ascensos)) ctx.ascensos = [];
    return ctx.ascensos;
  }

  function assetUrl(path) {
    if (!path) return "";
    if (String(path).startsWith("data:")) return path;
    return BASE + String(path).replace(/^\//, "");
  }

  function slugify(s) {
    return (
      String(s || "ascensos")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "ascensos"
    );
  }

  function fileExt(file) {
    const n = String(file?.name || "").split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(n)) return n === "jpeg" ? "jpg" : n;
    return "jpg";
  }

  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function photoBox(item) {
    const src = item._preview || uploadedPreviews.get(item.image) || item.image;
    if (src) {
      const url = escAttr(assetUrl(src));
      const alt = escAttr(item.title || "Ascensos");
      return `<button class="cms-photo-btn" type="button" data-asc-view="${url}" data-title="${alt}" aria-label="Ver ${alt}" title="Ver grande">
        <img class="cms-photo" src="${url}" alt="${alt}" />
      </button>`;
    }
    return `<div class="cms-photo cms-photo-empty">Sin foto · Ctrl+V</div>`;
  }

  function openPhoto(src, title) {
    const box = $("pay-lightbox");
    const body = $("pay-lightbox-body");
    if (!box || !body) return;
    body.innerHTML = `${title ? `<p class="pay-lightbox-title">${escAttr(title)}</p>` : ""}<img class="pay-img" src="${escAttr(src)}" alt="${escAttr(title || "Ascensos")}" />`;
    box.showModal();
  }

  function attachPhoto(item, file) {
    if (!item || !file || !String(file.type || "").startsWith("image/")) return false;
    item._file = file;
    const reader = new FileReader();
    reader.onload = () => {
      item._preview = String(reader.result);
      shell.markDirty("ascensos");
      render();
    };
    reader.readAsDataURL(file);
    return true;
  }

  function imageFromClipboard(e) {
    const items = [...(e.clipboardData?.items || [])];
    const image = items.find((item) => item.kind === "file" && String(item.type || "").startsWith("image/"));
    return image?.getAsFile() || null;
  }

  function targetForPaste() {
    const rows = list();
    const focused = document.activeElement?.closest?.("[data-asc]");
    if (focused) {
      const item = rows[Number(focused.dataset.asc)];
      if (item) return item;
    }
    return rows.find((item) => !(item.image || item._file || item._preview)) || rows[0] || null;
  }

  function readFromDom() {
    $("asc-list")
      ?.querySelectorAll("[data-asc]")
      .forEach((card) => {
        const i = Number(card.dataset.asc);
        const item = list()[i];
        if (!item) return;
        const title = card.querySelector('[data-k="title"]');
        if (title) item.title = String(title.value || "").trim().slice(0, 120);
      });
  }

  function moveInList(index, dir) {
    const rows = list();
    const from = Number(index);
    const to = from + Number(dir);
    if (from < 0 || to < 0 || to >= rows.length) return;
    const [item] = rows.splice(from, 1);
    rows.splice(to, 0, item);
  }

  function render() {
    const rows = list();
    const empty = $("asc-empty");
    if (empty) empty.hidden = rows.length > 0;
    const root = $("asc-list");
    if (!root) return;
    root.innerHTML = rows
      .map(
        (item, i) => `<article class="cms-card" data-asc="${i}">
          <div class="cms-card-actions">
            <div class="cms-order">
              <button class="btn cms-btn cms-btn-move" type="button" data-asc-move="${i}" data-dir="-1" aria-label="Subir" ${i === 0 ? "disabled" : ""}>↑ Subir</button>
              <button class="btn cms-btn cms-btn-move" type="button" data-asc-move="${i}" data-dir="1" aria-label="Bajar" ${i >= rows.length - 1 ? "disabled" : ""}>↓ Bajar</button>
            </div>
            <label class="btn btn-ghost cms-btn" style="cursor:pointer">Foto / Ctrl+V
              <input data-asc-photo type="file" accept="image/*" hidden />
            </label>
            <button class="btn cms-btn cms-btn-del" type="button" data-asc-del="${i}">Quitar</button>
          </div>
          <div class="cms-card-main">
            <div class="cms-media">${photoBox(item)}</div>
            <div class="cms-fields">
              <label class="cms-span">Nombre
                <input data-k="title" value="${escAttr(item.title || "")}" placeholder="Ascensos Temporada 4" maxlength="120" />
              </label>
            </div>
          </div>
        </article>`
      )
      .join("");
  }

  async function uploadPending() {
    for (const item of list()) {
      if (!item?._file) continue;
      const name = slugify(item.title || "ascensos") + "-" + Date.now() + "." + fileExt(item._file);
      const path = "public/images/" + name;
      await api.publishFile(path, await fileToB64(item._file), "Sube foto de ascensos: " + (item.title || name) + ".", true);
      item.image = "images/" + name;
      if (item._preview) uploadedPreviews.set(item.image, item._preview);
      delete item._file;
      delete item._preview;
    }
  }

  function cleanForPublish() {
    return list()
      .map((item) => ({
        id: String(item.id || `a${Date.now().toString(36)}`),
        title: String(item.title || "").trim().slice(0, 120),
        image: String(item.image || "").replace(/^\//, "").trim(),
      }))
      .filter((item) => item.title && item.image);
  }

  function bind() {
    $("asc-add")?.addEventListener("click", () => {
      readFromDom();
      list().unshift({
        id: `a${Date.now().toString(36)}`,
        title: "",
        image: "",
      });
      shell.markDirty("ascensos");
      render();
      $("asc-list")?.querySelector('[data-k="title"]')?.focus();
    });

    $("asc-list")?.addEventListener("input", (e) => {
      if (!e.target.closest("[data-asc]")) return;
      readFromDom();
      shell.markDirty("ascensos");
    });

    $("asc-list")?.addEventListener("change", (e) => {
      const input = e.target.closest("[data-asc-photo]");
      if (!input?.files?.[0]) return;
      const card = e.target.closest("[data-asc]");
      const item = list()[Number(card?.dataset.asc)];
      attachPhoto(item, input.files[0]);
    });

    document.addEventListener("paste", (e) => {
      if (ctx.currentSection !== "ascensos") return;
      const file = imageFromClipboard(e);
      if (!file) return;
      e.preventDefault();
      readFromDom();
      let item = targetForPaste();
      if (!item) {
        item = { id: `a${Date.now().toString(36)}`, title: "", image: "" };
        list().unshift(item);
      }
      if (attachPhoto(item, file)) {
        setMsg($("asc-msg"), "Foto pegada. Revisá el nombre y publicá.", "ok");
        toast("Foto pegada", "ok");
      }
    });

    $("asc-list")?.addEventListener("click", async (e) => {
      const view = e.target.closest("[data-asc-view]");
      if (view) {
        openPhoto(view.dataset.ascView, view.dataset.title);
        return;
      }
      const move = e.target.closest("[data-asc-move]");
      if (move) {
        readFromDom();
        moveInList(move.dataset.ascMove, move.dataset.dir);
        shell.markDirty("ascensos");
        render();
        return;
      }
      const del = e.target.closest("[data-asc-del]");
      if (!del) return;
      const ok = await confirmModal({
        title: "Quitar ascensos",
        body: "Se saca de la lista. Publicá para confirmarlo en la web.",
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      readFromDom();
      list().splice(Number(del.dataset.ascDel), 1);
      shell.markDirty("ascensos");
      render();
    });

    $("asc-publish")?.addEventListener("click", async () => {
      readFromDom();
      const missing = list().find((item) => !String(item.title || "").trim() || !(item.image || item._file));
      if (missing) {
        setMsg($("asc-msg"), "Cada ítem necesita nombre y foto.", "err");
        return;
      }
      const gate = api.usePublishToken();
      if (!gate.ok) {
        setMsg($("asc-msg"), gate.message, "err");
        return;
      }
      setBusy($("asc-publish"), true, "Publicando…");
      setMsg($("asc-msg"), "Subiendo fotos y publicando…");
      try {
        await uploadPending();
        const next = cleanForPublish();
        await api.publishFile(ASCENSOS_PATH, JSON.stringify(next, null, 2) + "\n", "Actualiza ascensos desde el admin.");
        ctx.ascensos = next;
        shell.clearDirty("ascensos");
        render();
        setMsg($("asc-msg"), "Listo. En ~1 minuto se ve en la web.", "ok");
        toast("Ascensos publicados", "ok");
      } catch (err) {
        setMsg($("asc-msg"), api.publishError(err), "err");
        toast(api.publishError(err), "err");
      } finally {
        setBusy($("asc-publish"), false);
      }
    });
  }

  return { bind, render };
}
