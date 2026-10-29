import { SITE_PATH } from "./constants.js";
import { syncKidsGroups } from "../lib/venues.js";
import { $, confirmModal, escAttr, setBusy, setMsg, toast } from "./ui.js";

export function createCms(ctx, api, shell) {
  const BASE = ctx.BASE;
  // Pages tarda ~1 min en publicar las fotos subidas; hasta entonces se muestra la copia local.
  const uploadedPreviews = new Map();

  function ensureCms() {
    if (!ctx.siteData.academia) ctx.siteData.academia = {};
    if (!Array.isArray(ctx.siteData.academia.programs)) {
      ctx.siteData.academia.programs = [
        { n: "01", title: "Adultos", text: "" },
        { n: "02", title: "Niños", text: "" },
        { n: "03", title: "Personalizado", text: "" },
      ];
    }
    if (!Array.isArray(ctx.siteData.staff)) ctx.siteData.staff = [];
    if (!ctx.siteData.torneos) ctx.siteData.torneos = {};
    if (!Array.isArray(ctx.siteData.torneos.items)) ctx.siteData.torneos.items = [];
    if (!Array.isArray(ctx.siteData.venues)) ctx.siteData.venues = [];
    if (!Array.isArray(ctx.siteData.moreVenues)) ctx.siteData.moreVenues = [];
    if (!Array.isArray(ctx.siteData.sponsors)) ctx.siteData.sponsors = [];
    const speed = Number(ctx.siteData.sponsorsSpeed);
    ctx.siteData.sponsorsSpeed = Number.isFinite(speed) ? Math.min(90, Math.max(20, Math.round(speed))) : 48;
    if (!ctx.siteData.kids) ctx.siteData.kids = {};
    if (!Array.isArray(ctx.siteData.kids.features)) ctx.siteData.kids.features = [];
    if (!Array.isArray(ctx.siteData.kids.groups)) ctx.siteData.kids.groups = [];
    if (!Array.isArray(ctx.siteData.kids.prices)) ctx.siteData.kids.prices = [];
    if (!ctx.siteData.kids.profeId) ctx.siteData.kids.profeId = "barrionuevo-sebastian";
  }

  function assetUrl(path) {
    if (!path) return "";
    if (String(path).startsWith("data:")) return path;
    return BASE + String(path).replace(/^\//, "");
  }

  function slugify(s) {
    return (
      String(s || "foto")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "foto"
    );
  }

  function fileExt(file) {
    const n = String(file?.name || "").split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(n)) return n === "jpeg" ? "jpg" : n;
    return "png";
  }

  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function photoBox(src, alt) {
    if (src) return `<img class="cms-photo" src="${escAttr(uploadedPreviews.get(src) || assetUrl(src))}" alt="${escAttr(alt)}" />`;
    return `<div class="cms-photo cms-photo-empty">Sin foto</div>`;
  }

  function cmsMedia(src, alt, actions) {
    return `<div class="cms-media">${photoBox(src, alt)}<div class="cms-card-actions">${actions}</div></div>`;
  }

  function moveInList(list, index, dir) {
    const from = Number(index);
    const to = from + Number(dir);
    if (!Array.isArray(list) || from < 0 || to < 0 || to >= list.length) return false;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    return true;
  }

  function cmsMoveBtns(kind, i, n) {
    return `<div class="cms-order">
      <button class="btn cms-btn cms-btn-move" type="button" data-move="${kind}" data-i="${i}" data-dir="-1" aria-label="Subir" ${i === 0 ? "disabled" : ""}>↑ Subir</button>
      <button class="btn cms-btn cms-btn-move" type="button" data-move="${kind}" data-i="${i}" data-dir="1" aria-label="Bajar" ${i >= n - 1 ? "disabled" : ""}>↓ Bajar</button>
    </div>`;
  }

  function fillSiteForm() {
    ensureCms();
    const form = $("site-form");
    if (!form) return;
    form.whatsapp.value = ctx.siteData.whatsapp || "";
    form.instagram.value = ctx.siteData.instagram || "";
    form.city.value = ctx.siteData.city || "";
    form.province.value = ctx.siteData.province || "";
    form.ligaIntro.value = ctx.siteData.ligaIntro || "";
    if (form.showPlayoff) form.showPlayoff.checked = Boolean(ctx.siteData.showPlayoff);
    if (form.sponsorsSpeed) form.sponsorsSpeed.value = String(ctx.siteData.sponsorsSpeed || 48);
    const speedVal = $("sponsors-speed-val");
    if (speedVal) speedVal.textContent = `${ctx.siteData.sponsorsSpeed || 48}s`;
    const help = $("site-playoff-help");
    if (help) {
      help.textContent =
        "Si está tildado, el inicio muestra Ver playoff y lleva al cuadro de la temporada en juego. Destildalo mientras se juega la fase regular; cuando armes el playoff, volvé a tildarlo.";
    }
    fillSponsorsForm();
  }

  function fillSponsorsForm() {
    ensureCms();
    const list = ctx.siteData.sponsors;
    const empty = $("sponsor-empty");
    if (empty) empty.hidden = list.length > 0;
    const root = $("sponsor-list");
    if (!root) return;
    root.innerHTML = list
      .map(
        (s, i) => `<article class="cms-card cms-card-sponsor" data-sponsor="${i}">
          ${cmsMedia(
            s._preview || s.image,
            s.name || "Sponsor",
            `<label class="btn cms-btn">Cambiar foto
              <input data-photo="sponsor" type="file" accept="image/*" hidden />
            </label>
            <button class="btn cms-btn cms-btn-del" type="button" data-sponsor-del="${i}">Quitar</button>`
          )}
          <div class="cms-fields">
            <label class="sponsor-name-field">Nombre
              <input data-s="name" value="${escAttr(s.name || "")}" placeholder="Ej. EVOXX" />
            </label>
            ${cmsMoveBtns("sponsor", i, list.length)}
          </div>
        </article>`
      )
      .join("");
  }

  function readSponsorsFromDom() {
    ensureCms();
    $("sponsor-list")?.querySelectorAll("[data-sponsor]").forEach((card) => {
      const i = Number(card.dataset.sponsor);
      const s = ctx.siteData.sponsors[i];
      if (!s) return;
      s.name = card.querySelector("[data-s='name']")?.value.trim() || "";
    });
    const form = $("site-form");
    if (form?.sponsorsSpeed) {
      const speed = Number(form.sponsorsSpeed.value);
      ctx.siteData.sponsorsSpeed = Number.isFinite(speed) ? Math.min(90, Math.max(20, Math.round(speed))) : 48;
    }
  }

  /** Adapta cualquier imagen al formato del carrusel: cuadrado negro 1024×1024 JPEG. */
  async function fitSponsorImage(file) {
    const SIZE = 1024;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, SIZE, SIZE);
    const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    c.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    bitmap.close?.();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen"))), "image/jpeg", 0.92);
    });
    return new File([blob], "sponsor.jpg", { type: "image/jpeg" });
  }

  async function attachSponsorPhoto(item, file) {
    if (!item || !file || !String(file.type || "").startsWith("image/")) return;
    const fitted = await fitSponsorImage(file);
    item._file = fitted;
    const reader = new FileReader();
    reader.onload = () => {
      item._preview = String(reader.result);
      fillSponsorsForm();
    };
    reader.readAsDataURL(fitted);
  }

  async function uploadPendingSponsors() {
    ensureCms();
    for (const item of ctx.siteData.sponsors) {
      if (!item?._file) continue;
      const name = slugify(item.name || "sponsor") + "-" + Date.now() + ".jpg";
      const path = "public/images/sponsors/" + name;
      await api.publishFile(path, await fileToB64(item._file), "Sube sponsor: " + (item.name || name) + ".", true);
      item.image = "/images/sponsors/" + name;
      if (item._preview) uploadedPreviews.set(item.image, item._preview);
      delete item._file;
      delete item._preview;
    }
  }

  function fillAcademiaForm() {
    ensureCms();
    const ac = ctx.siteData.academia;
    const form = $("ac-copy");
    if (form.kicker) form.kicker.value = ac.kicker || "Clases adultos";
    form.title.value = ac.title || "";
    form.intro.value = ac.intro || "";
    form.teamNote.value = ac.teamNote || "";
    form.cta.value = ac.cta || "";
    const staffEmpty = $("staff-empty");
    if (staffEmpty) staffEmpty.hidden = ctx.siteData.staff.length > 0;
    $("staff-list").innerHTML = ctx.siteData.staff
      .map(
        (p, i) => `<article class="cms-card" data-staff="${i}">
          ${cmsMedia(
            p._preview || p.image,
            p.name,
            `
            ${cmsMoveBtns("staff", i, ctx.siteData.staff.length)}
            <label class="btn btn-ghost cms-btn" style="cursor:pointer">Foto
              <input data-photo="staff" type="file" accept="image/*" hidden />
            </label>
            <button class="btn cms-btn cms-btn-del" type="button" data-staff-del="${i}">Quitar</button>
          `
          )}
          <div class="cms-fields">
            <label>Nombre <input data-k="name" value="${escAttr(p.name)}" /></label>
            <label>Rol <input data-k="role" value="${escAttr(p.role)}" placeholder="Profe" /></label>
            <label class="cms-span">Texto <textarea data-k="bio" rows="3">${escAttr(p.bio)}</textarea></label>
            <label class="cms-span">Viñetas (un renglón cada una)
              <textarea data-k="bullets" rows="3">${escAttr((p.bullets || []).join("\n"))}</textarea>
            </label>
          </div>
        </article>`
      )
      .join("");
    $("prog-list").innerHTML = ctx.siteData.academia.programs
      .map(
        (pr, i) => `<article class="cms-card cms-card-plain" data-prog="${i}">
          <div class="cms-fields">
            <div class="cms-card-actions cms-span">${cmsMoveBtns("prog", i, ctx.siteData.academia.programs.length)}</div>
            <label>Programa <input data-k="title" value="${escAttr(pr.title)}" /></label>
            <label class="cms-span">Texto <textarea data-k="text" rows="2">${escAttr(pr.text)}</textarea></label>
          </div>
        </article>`
      )
      .join("");
  }

  function fillVenueForm() {
    ensureCms();
    const venueEmpty = $("venue-empty");
    if (venueEmpty) venueEmpty.hidden = ctx.siteData.venues.length > 0;
    $("venue-list").innerHTML = ctx.siteData.venues
      .map(
        (v, i) => `<article class="cms-card" data-venue="${i}">
          ${cmsMedia(
            v._preview || v.image,
            v.name,
            `
            ${cmsMoveBtns("venue", i, ctx.siteData.venues.length)}
            <label class="btn btn-ghost cms-btn" style="cursor:pointer">Foto
              <input data-photo="venue" type="file" accept="image/*" hidden />
            </label>
            <button class="btn cms-btn cms-btn-del" type="button" data-venue-del="${i}">Quitar</button>
          `
          )}
          <div class="cms-fields">
            <label>Nombre <input data-k="name" value="${escAttr(v.name)}" /></label>
            <label>Ciudad <input data-k="city" value="${escAttr(v.city)}" /></label>
            <label class="cms-span">Dirección <input data-k="address" value="${escAttr(v.address)}" /></label>
            <label class="cms-span">Qué es <input data-k="type" value="${escAttr(v.type)}" placeholder="Cancha abierta · Liga y academia" /></label>
            <label>WhatsApp <input data-k="whatsapp" value="${escAttr(v.whatsapp)}" placeholder="549..." /></label>
            <label>Instagram <input data-k="instagram" value="${escAttr(v.instagram)}" /></label>
            <label class="cms-span">Maps <input data-k="maps" value="${escAttr(v.maps)}" /></label>
            <div class="cms-checks cms-span">
              <label class="cms-chip"><input data-k="liga" type="checkbox" ${v.liga !== false ? "checked" : ""} /> Liga</label>
              <label class="cms-chip"><input data-k="academia" type="checkbox" ${v.academia ? "checked" : ""} /> Academia</label>
              <label class="cms-chip"><input data-k="infantiles" type="checkbox" ${v.infantiles ? "checked" : ""} /> Infantiles</label>
            </div>
          </div>
        </article>`
      )
      .join("");
    $("more-list").innerHTML = ctx.siteData.moreVenues
      .map(
        (v, i) => `<article class="cms-card" data-more="${i}">
          ${cmsMedia(
            v._preview || v.image,
            v.name,
            `
            ${cmsMoveBtns("more", i, ctx.siteData.moreVenues.length)}
            <label class="btn btn-ghost cms-btn" style="cursor:pointer">Foto
              <input data-photo="more" type="file" accept="image/*" hidden />
            </label>
            <button class="btn cms-btn cms-btn-del" type="button" data-more-del="${i}">Quitar</button>
          `
          )}
          <div class="cms-fields">
            <label class="cms-span">Nombre <input data-k="name" value="${escAttr(v.name)}" /></label>
          </div>
        </article>`
      )
      .join("");
  }

  function fillTorneosForm() {
    ensureCms();
    const t = ctx.siteData.torneos;
    const form = $("tn-copy");
    form.title.value = t.title || "";
    form.intro.value = t.intro || "";
    form.emptyTitle.value = t.emptyTitle || "";
    form.emptyText.value = t.emptyText || "";
    const tnEmpty = $("tn-empty");
    if (tnEmpty) tnEmpty.hidden = (t.items || []).length > 0;
    $("tn-list").innerHTML = (t.items || [])
      .map(
        (item, i) => `<article class="cms-card cms-card-plain" data-tn="${i}">
          <div class="cms-fields">
            <div class="cms-card-actions cms-span">
              ${cmsMoveBtns("tn", i, (t.items || []).length)}
              <button class="btn cms-btn cms-btn-del" type="button" data-tn-del="${i}">Quitar</button>
            </div>
            <label>Nombre <input data-k="title" value="${escAttr(item.title)}" /></label>
            <label>Cuándo <input data-k="when" value="${escAttr(item.when)}" placeholder="Ej. 20 de septiembre" /></label>
            <label class="cms-span">Texto <textarea data-k="text" rows="3">${escAttr(item.text)}</textarea></label>
          </div>
        </article>`
      )
      .join("");
  }

  function fillKidsForm() {
    ensureCms();
    const k = ctx.siteData.kids;
    k.groups = syncKidsGroups(ctx.siteData.venues, k.groups);
    const form = $("kids-copy");
    form.title.value = k.title || "";
    form.age.value = k.age || "";
    form.intro.value = k.intro || "";
    form.features.value = (k.features || []).join("\n");
    form.profeRole.value = k.profeRole || "";
    form.cta.value = k.cta || "";
    form.profeId.innerHTML = (ctx.siteData.staff || [])
      .map((p) => `<option value="${escAttr(p.id)}" ${p.id === k.profeId ? "selected" : ""}>${escAttr(p.name || p.id)}</option>`)
      .join("");
    $("kids-group-list").innerHTML = (k.groups || [])
      .map(
        (g, i) => `<article class="cms-card cms-card-plain" data-kids-group="${i}">
          <div class="cms-fields">
            <div class="cms-card-actions cms-span">
              ${cmsMoveBtns("kids-group", i, (k.groups || []).length)}
              <button class="btn cms-btn cms-btn-del" type="button" data-kids-group-del="${i}">Quitar</button>
            </div>
            <label>Sede <input data-k="venue" list="kids-venue-options" value="${escAttr(g.venue)}" /></label>
            <label>Días <input data-k="when" value="${escAttr(g.when)}" placeholder="Lunes y jueves" /></label>
            <label class="cms-span">Horarios (un renglón: 17:00 hs | Avanzados)
              <textarea data-k="rows" rows="3">${escAttr((g.rows || []).map((r) => [r.time, r.level].filter(Boolean).join(" | ")).join("\n"))}</textarea>
            </label>
          </div>
        </article>`
      )
      .join("") +
      `<datalist id="kids-venue-options">${(ctx.siteData.venues || [])
        .filter((v) => v.infantiles && v.name)
        .map((v) => `<option value="${escAttr(v.name)}"></option>`)
        .join("")}</datalist>`;
    $("kids-price-list").innerHTML = (k.prices || [])
      .map(
        (p, i) => `<article class="cms-card cms-card-plain" data-kids-price="${i}">
          <div class="cms-fields">
            <div class="cms-card-actions cms-span">
              ${cmsMoveBtns("kids-price", i, (k.prices || []).length)}
              <button class="btn cms-btn cms-btn-del" type="button" data-kids-price-del="${i}">Quitar</button>
            </div>
            <label>Valor <input data-k="amount" value="${escAttr(p.amount)}" placeholder="$70.000" /></label>
            <label>Texto <input data-k="text" value="${escAttr(p.text)}" placeholder="Dos veces por semana" /></label>
          </div>
        </article>`
      )
      .join("");
  }

  function readAcademiaFromDom() {
    ensureCms();
    const form = $("ac-copy");
    ctx.siteData.academia = {
      ...ctx.siteData.academia,
      kicker: form.kicker?.value.trim() || "Clases adultos",
      title: form.title.value.trim(),
      intro: form.intro.value.trim(),
      teamNote: form.teamNote.value.trim(),
      cta: form.cta.value.trim(),
    };
    $("staff-list").querySelectorAll("[data-staff]").forEach((card) => {
      const i = Number(card.dataset.staff);
      const p = ctx.siteData.staff[i];
      if (!p) return;
      p.name = card.querySelector("[data-k='name']")?.value.trim() || "";
      p.role = card.querySelector("[data-k='role']")?.value.trim() || "Profe";
      p.bio = card.querySelector("[data-k='bio']")?.value.trim() || "";
      p.bullets = (card.querySelector("[data-k='bullets']")?.value || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    });
    $("prog-list").querySelectorAll("[data-prog]").forEach((card) => {
      const i = Number(card.dataset.prog);
      const pr = ctx.siteData.academia.programs[i];
      if (!pr) return;
      pr.title = card.querySelector("[data-k='title']")?.value.trim() || "";
      pr.text = card.querySelector("[data-k='text']")?.value.trim() || "";
    });
  }

  function readVenuesFromDom() {
    ensureCms();
    $("venue-list").querySelectorAll("[data-venue]").forEach((card) => {
      const i = Number(card.dataset.venue);
      const v = ctx.siteData.venues[i];
      if (!v) return;
      v.name = card.querySelector("[data-k='name']")?.value.trim() || "";
      v.address = card.querySelector("[data-k='address']")?.value.trim() || "";
      v.city = card.querySelector("[data-k='city']")?.value.trim() || "";
      v.type = card.querySelector("[data-k='type']")?.value.trim() || "";
      v.whatsapp = card.querySelector("[data-k='whatsapp']")?.value.trim() || "";
      v.instagram = card.querySelector("[data-k='instagram']")?.value.trim() || "";
      v.maps = card.querySelector("[data-k='maps']")?.value.trim() || "";
      v.liga = !!card.querySelector("[data-k='liga']")?.checked;
      v.academia = !!card.querySelector("[data-k='academia']")?.checked;
      v.infantiles = !!card.querySelector("[data-k='infantiles']")?.checked;
      if (!v.id) v.id = slugify(v.name);
    });
    $("more-list").querySelectorAll("[data-more]").forEach((card) => {
      const i = Number(card.dataset.more);
      const v = ctx.siteData.moreVenues[i];
      if (!v) return;
      v.name = card.querySelector("[data-k='name']")?.value.trim() || "";
    });
  }

  function readTorneosFromDom() {
    ensureCms();
    const form = $("tn-copy");
    ctx.siteData.torneos = {
      ...ctx.siteData.torneos,
      title: form.title.value.trim() || "Torneos",
      intro: form.intro.value.trim(),
      emptyTitle: form.emptyTitle.value.trim(),
      emptyText: form.emptyText.value.trim(),
    };
    $("tn-list").querySelectorAll("[data-tn]").forEach((card) => {
      const i = Number(card.dataset.tn);
      const item = ctx.siteData.torneos.items[i];
      if (!item) return;
      item.title = card.querySelector("[data-k='title']")?.value.trim() || "";
      item.when = card.querySelector("[data-k='when']")?.value.trim() || "";
      item.text = card.querySelector("[data-k='text']")?.value.trim() || "";
    });
  }

  function parseKidsRows(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|").map((s) => s.trim());
        return { time: parts[0] || "", level: parts.slice(1).join(" | ") };
      });
  }

  function readKidsFromDom() {
    ensureCms();
    const form = $("kids-copy");
    ctx.siteData.kids = {
      ...ctx.siteData.kids,
      title: form.title.value.trim(),
      age: form.age.value.trim(),
      intro: form.intro.value.trim(),
      features: form.features.value.split("\n").map((s) => s.trim()).filter(Boolean),
      profeId: form.profeId.value,
      profeRole: form.profeRole.value.trim(),
      cta: form.cta.value.trim(),
    };
    $("kids-group-list").querySelectorAll("[data-kids-group]").forEach((card) => {
      const i = Number(card.dataset.kidsGroup);
      const g = ctx.siteData.kids.groups[i];
      if (!g) return;
      g.venue = card.querySelector("[data-k='venue']")?.value.trim() || "";
      g.when = card.querySelector("[data-k='when']")?.value.trim() || "";
      g.rows = parseKidsRows(card.querySelector("[data-k='rows']")?.value);
    });
    $("kids-price-list").querySelectorAll("[data-kids-price]").forEach((card) => {
      const i = Number(card.dataset.kidsPrice);
      const p = ctx.siteData.kids.prices[i];
      if (!p) return;
      p.amount = card.querySelector("[data-k='amount']")?.value.trim() || "";
      p.text = card.querySelector("[data-k='text']")?.value.trim() || "";
    });
  }

  function cleanSiteForSave() {
    const copy = structuredClone(ctx.siteData);
    const strip = (obj) => {
      if (!obj) return;
      delete obj._file;
      delete obj._preview;
    };
    (copy.staff || []).forEach(strip);
    (copy.venues || []).forEach(strip);
    (copy.moreVenues || []).forEach(strip);
    (copy.sponsors || []).forEach(strip);
    copy.sponsors = (copy.sponsors || [])
      .map((s) => ({
        name: String(s.name || "").trim(),
        image: String(s.image || "").trim(),
      }))
      .filter((s) => s.image);
    const speed = Number(copy.sponsorsSpeed);
    copy.sponsorsSpeed = Number.isFinite(speed) ? Math.min(90, Math.max(20, Math.round(speed))) : 48;
    return copy;
  }

  async function readRemoteSite() {
    const file = await api.api(`/repos/${ctx.owner}/${ctx.repo}/contents/${SITE_PATH}?ref=main`);
    const raw = String(file.content || "").replace(/\n/g, "");
    return JSON.parse(api.fromB64(raw));
  }

  async function publishSiteFields(fields, message) {
    const remote = await readRemoteSite();
    const next = { ...remote, ...fields };
    await api.publishFile(SITE_PATH, JSON.stringify(next, null, 2) + "\n", message);
    Object.assign(ctx.siteData, next);
  }

  async function uploadPending(list, kind) {
    for (const item of list) {
      if (!item?._file) continue;
      const name = slugify(item.name || kind) + "-" + Date.now() + "." + fileExt(item._file);
      const path = "public/images/" + name;
      await api.publishFile(path, await fileToB64(item._file), "Sube foto de " + (item.name || kind) + ".", true);
      item.image = "images/" + name;
      if (kind === "venue" || kind === "more") item.image = "/images/" + name;
      if (item._preview) uploadedPreviews.set(item.image, item._preview);
      delete item._file;
      delete item._preview;
    }
  }

  function attachPhoto(item, file) {
    item._file = file;
    const reader = new FileReader();
    reader.onload = () => {
      item._preview = String(reader.result);
      if (ctx.siteData.staff?.includes(item)) fillAcademiaForm();
      else fillVenueForm();
    };
    reader.readAsDataURL(file);
  }

  function bind() {
    $("site-form")?.addEventListener("input", (e) => {
      shell.markDirty("sitio");
      if (e.target?.name === "sponsorsSpeed" || e.target?.id === "sponsors-speed") {
        const speedVal = $("sponsors-speed-val");
        if (speedVal) speedVal.textContent = `${e.target.value}s`;
      }
    });
    $("ac-copy")?.addEventListener("input", () => shell.markDirty("academia"));
    $("kids-copy")?.addEventListener("input", () => shell.markDirty("infantiles"));
    $("tn-copy")?.addEventListener("input", () => shell.markDirty("torneos"));

    $("sponsor-add")?.addEventListener("click", () => {
      readSponsorsFromDom();
      ctx.siteData.sponsors.push({ name: "", image: "" });
      shell.markDirty("sitio");
      fillSponsorsForm();
    });
    $("sponsor-list")?.addEventListener("click", async (e) => {
      const move = e.target.closest("[data-move='sponsor']");
      if (move) {
        readSponsorsFromDom();
        moveInList(ctx.siteData.sponsors, move.dataset.i, move.dataset.dir);
        shell.markDirty("sitio");
        fillSponsorsForm();
        return;
      }
      const del = e.target.closest("[data-sponsor-del]");
      if (!del) return;
      const ok = await confirmModal({
        title: "Quitar sponsor",
        body: "Se saca de la lista local. Publicá inicio para confirmarlo en la web.",
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      readSponsorsFromDom();
      ctx.siteData.sponsors.splice(Number(del.dataset.sponsorDel), 1);
      shell.markDirty("sitio");
      fillSponsorsForm();
    });
    $("sponsor-list")?.addEventListener("change", async (e) => {
      const input = e.target.closest("[data-photo='sponsor']");
      const file = input?.files?.[0];
      if (!file) return;
      const i = Number(input.closest("[data-sponsor]")?.dataset.sponsor);
      readSponsorsFromDom();
      try {
        await attachSponsorPhoto(ctx.siteData.sponsors[i], file);
        shell.markDirty("sitio");
      } catch (err) {
        toast(err?.message || "No se pudo procesar la imagen", "err");
      }
      if (input) input.value = "";
    });
    $("sponsor-list")?.addEventListener("input", () => shell.markDirty("sitio"));

    $("staff-add")?.addEventListener("click", () => {
      readAcademiaFromDom();
      ctx.siteData.staff.push({
        id: "profe-" + Date.now(),
        name: "",
        role: "Profe",
        image: "",
        bio: "",
        bullets: [],
      });
      shell.markDirty("academia");
      fillAcademiaForm();
    });
    $("staff-list")?.addEventListener("click", async (e) => {
      const move = e.target.closest("[data-move]");
      if (move) {
        readAcademiaFromDom();
        moveInList(ctx.siteData.staff, move.dataset.i, move.dataset.dir);
        shell.markDirty("academia");
        fillAcademiaForm();
        return;
      }
      const del = e.target.closest("[data-staff-del]");
      if (!del) return;
      const ok = await confirmModal({
        title: "Quitar profe",
        body: "Se elimina de la lista local. Publicá academia para confirmarlo.",
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      readAcademiaFromDom();
      ctx.siteData.staff.splice(Number(del.dataset.staffDel), 1);
      shell.markDirty("academia");
      fillAcademiaForm();
    });
    $("prog-list")?.addEventListener("click", (e) => {
      const move = e.target.closest("[data-move]");
      if (!move) return;
      readAcademiaFromDom();
      moveInList(ctx.siteData.academia.programs, move.dataset.i, move.dataset.dir);
      shell.markDirty("academia");
      fillAcademiaForm();
    });
    $("staff-list")?.addEventListener("change", (e) => {
      const input = e.target.closest("[data-photo='staff']");
      const file = input?.files?.[0];
      if (!file) return;
      const i = Number(input.closest("[data-staff]").dataset.staff);
      readAcademiaFromDom();
      attachPhoto(ctx.siteData.staff[i], file);
      shell.markDirty("academia");
    });

    $("venue-add")?.addEventListener("click", () => {
      readVenuesFromDom();
      ctx.siteData.venues.push({
        id: "sede-" + Date.now(),
        name: "",
        address: "",
        city: ctx.siteData.city || "Paraná, Entre Ríos",
        type: "",
        image: "",
        maps: "",
        instagram: "",
        whatsapp: "",
        liga: true,
        academia: false,
        infantiles: false,
      });
      shell.markDirty("sedes");
      fillVenueForm();
    });
    $("venue-list")?.addEventListener("click", async (e) => {
      const move = e.target.closest("[data-move]");
      if (move) {
        readVenuesFromDom();
        moveInList(ctx.siteData.venues, move.dataset.i, move.dataset.dir);
        shell.markDirty("sedes");
        fillVenueForm();
        return;
      }
      const del = e.target.closest("[data-venue-del]");
      if (!del) return;
      const ok = await confirmModal({
        title: "Quitar sede",
        body: "Se elimina de la lista local. Publicá sedes para confirmarlo.",
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      readVenuesFromDom();
      ctx.siteData.venues.splice(Number(del.dataset.venueDel), 1);
      shell.markDirty("sedes");
      fillVenueForm();
    });
    $("venue-list")?.addEventListener("change", (e) => {
      shell.markDirty("sedes");
      if (e.target.matches("[data-k='infantiles'], [data-k='name']")) {
        readVenuesFromDom();
        readKidsFromDom();
        fillKidsForm();
        return;
      }
      const input = e.target.closest("[data-photo='venue']");
      const file = input?.files?.[0];
      if (!file) return;
      const i = Number(input.closest("[data-venue]").dataset.venue);
      readVenuesFromDom();
      attachPhoto(ctx.siteData.venues[i], file);
    });
    $("more-add")?.addEventListener("click", () => {
      readVenuesFromDom();
      ctx.siteData.moreVenues.push({ name: "", image: "" });
      shell.markDirty("sedes");
      fillVenueForm();
    });
    $("more-list")?.addEventListener("click", async (e) => {
      const move = e.target.closest("[data-move]");
      if (move) {
        readVenuesFromDom();
        moveInList(ctx.siteData.moreVenues, move.dataset.i, move.dataset.dir);
        shell.markDirty("sedes");
        fillVenueForm();
        return;
      }
      const del = e.target.closest("[data-more-del]");
      if (!del) return;
      readVenuesFromDom();
      ctx.siteData.moreVenues.splice(Number(del.dataset.moreDel), 1);
      shell.markDirty("sedes");
      fillVenueForm();
    });
    $("more-list")?.addEventListener("change", (e) => {
      shell.markDirty("sedes");
      const input = e.target.closest("[data-photo='more']");
      const file = input?.files?.[0];
      if (!file) return;
      const i = Number(input.closest("[data-more]").dataset.more);
      readVenuesFromDom();
      attachPhoto(ctx.siteData.moreVenues[i], file);
    });

    $("tn-add")?.addEventListener("click", () => {
      readTorneosFromDom();
      ctx.siteData.torneos.items.push({ title: "", when: "", text: "" });
      shell.markDirty("torneos");
      fillTorneosForm();
    });
    $("tn-list")?.addEventListener("click", async (e) => {
      const move = e.target.closest("[data-move]");
      if (move) {
        readTorneosFromDom();
        moveInList(ctx.siteData.torneos.items, move.dataset.i, move.dataset.dir);
        shell.markDirty("torneos");
        fillTorneosForm();
        return;
      }
      const del = e.target.closest("[data-tn-del]");
      if (!del) return;
      readTorneosFromDom();
      ctx.siteData.torneos.items.splice(Number(del.dataset.tnDel), 1);
      shell.markDirty("torneos");
      fillTorneosForm();
    });

    $("kids-group-add")?.addEventListener("click", () => {
      readKidsFromDom();
      ctx.siteData.kids.groups.push({ venue: "", when: "", rows: [] });
      shell.markDirty("infantiles");
      fillKidsForm();
    });
    $("kids-group-list")?.addEventListener("click", (e) => {
      const move = e.target.closest("[data-move]");
      if (move) {
        readKidsFromDom();
        moveInList(ctx.siteData.kids.groups, move.dataset.i, move.dataset.dir);
        shell.markDirty("infantiles");
        fillKidsForm();
        return;
      }
      const del = e.target.closest("[data-kids-group-del]");
      if (!del) return;
      readKidsFromDom();
      ctx.siteData.kids.groups.splice(Number(del.dataset.kidsGroupDel), 1);
      shell.markDirty("infantiles");
      fillKidsForm();
    });
    $("kids-price-add")?.addEventListener("click", () => {
      readKidsFromDom();
      ctx.siteData.kids.prices.push({ amount: "", text: "" });
      shell.markDirty("infantiles");
      fillKidsForm();
    });
    $("kids-price-list")?.addEventListener("click", (e) => {
      const move = e.target.closest("[data-move]");
      if (move) {
        readKidsFromDom();
        moveInList(ctx.siteData.kids.prices, move.dataset.i, move.dataset.dir);
        shell.markDirty("infantiles");
        fillKidsForm();
        return;
      }
      const del = e.target.closest("[data-kids-price-del]");
      if (!del) return;
      readKidsFromDom();
      ctx.siteData.kids.prices.splice(Number(del.dataset.kidsPriceDel), 1);
      shell.markDirty("infantiles");
      fillKidsForm();
    });

    $("kids-save")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) return toast(gate.message, "err");
      readKidsFromDom();
      setBusy($("kids-save"), true, "Publicando…");
      setMsg($("kids-msg"), "Publicando infantiles…");
      try {
        const local = cleanSiteForSave();
        await publishSiteFields({ kids: local.kids }, "Actualiza clases infantiles desde el admin.");
        shell.clearDirty("infantiles");
        fillKidsForm();
        setMsg($("kids-msg"), "Listo. En ~1 minuto se ve en la web.", "ok");
        toast("Infantiles publicados", "ok");
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("kids-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("kids-save"), false);
      }
    });

    $("ac-save")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) return toast(gate.message, "err");
      readAcademiaFromDom();
      setBusy($("ac-save"), true, "Publicando…");
      setMsg($("ac-msg"), "Publicando adultos…");
      try {
        await uploadPending(ctx.siteData.staff, "staff");
        const local = cleanSiteForSave();
        await publishSiteFields(
          { academia: local.academia, staff: local.staff },
          "Actualiza clases de adultos desde el admin."
        );
        shell.clearDirty("academia");
        fillAcademiaForm();
        setMsg($("ac-msg"), "Listo. En ~1 minuto se ve en la web.", "ok");
        toast("Adultos publicados", "ok");
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("ac-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("ac-save"), false);
      }
    });

    $("venue-save")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) return toast(gate.message, "err");
      readVenuesFromDom();
      readKidsFromDom();
      fillKidsForm();
      setBusy($("venue-save"), true, "Publicando…");
      setMsg($("venue-msg"), "Publicando sedes…");
      try {
        await uploadPending(ctx.siteData.venues, "venue");
        await uploadPending(ctx.siteData.moreVenues, "more");
        const local = cleanSiteForSave();
        await publishSiteFields(
          { venues: local.venues, moreVenues: local.moreVenues, kids: local.kids },
          "Actualiza sedes desde el admin."
        );
        shell.clearDirty("sedes");
        shell.clearDirty("infantiles");
        fillVenueForm();
        setMsg($("venue-msg"), "Listo. En ~1 minuto se ve en la web.", "ok");
        toast("Sedes publicadas", "ok");
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("venue-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("venue-save"), false);
      }
    });

    $("tn-save")?.addEventListener("click", async () => {
      const gate = api.usePublishToken();
      if (!gate.ok) return toast(gate.message, "err");
      readTorneosFromDom();
      ctx.siteData.torneos.items = (ctx.siteData.torneos.items || []).filter(
        (item) => item.title || item.text || item.when
      );
      setBusy($("tn-save"), true, "Publicando…");
      setMsg($("tn-msg"), "Publicando torneos…");
      try {
        const local = cleanSiteForSave();
        await publishSiteFields({ torneos: local.torneos }, "Actualiza torneos desde el admin.");
        shell.clearDirty("torneos");
        fillTorneosForm();
        setMsg($("tn-msg"), "Listo. En ~1 minuto se ve en la web.", "ok");
        toast("Torneos publicados", "ok");
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("tn-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("tn-save"), false);
      }
    });

    $("site-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const gate = api.usePublishToken();
      if (!gate.ok) return toast(gate.message, "err");
      const form = e.target;
      readSponsorsFromDom();
      ctx.siteData = {
        ...ctx.siteData,
        whatsapp: form.whatsapp.value.trim(),
        instagram: form.instagram.value.trim(),
        city: form.city.value.trim(),
        province: form.province.value.trim(),
        ligaIntro: form.ligaIntro.value.trim(),
        showPlayoff: Boolean(form.showPlayoff?.checked),
      };
      const pending = (ctx.siteData.sponsors || []).find((s) => !s.image && !s._file);
      if (pending) {
        setMsg($("site-msg"), "Hay un sponsor sin foto. Subí la imagen o quitálo.", "err");
        return toast("Falta la foto de un sponsor", "err");
      }
      setBusy($("site-save"), true, "Publicando…");
      setMsg($("site-msg"), "Publicando inicio…");
      try {
        await uploadPendingSponsors();
        const local = cleanSiteForSave();
        await publishSiteFields(
          {
            whatsapp: local.whatsapp,
            instagram: local.instagram,
            city: local.city,
            province: local.province,
            ligaIntro: local.ligaIntro,
            showPlayoff: Boolean(local.showPlayoff),
            sponsors: local.sponsors,
            sponsorsSpeed: local.sponsorsSpeed,
          },
          "Actualiza el inicio y sponsors desde el admin."
        );
        shell.clearDirty("sitio");
        fillSponsorsForm();
        setMsg($("site-msg"), "Inicio publicado. El sitio se actualiza en ~1 minuto.", "ok");
        toast("Inicio publicado", "ok");
      } catch (err) {
        const m = api.publishError(err);
        setMsg($("site-msg"), m, "err");
        toast(m, "err");
      } finally {
        setBusy($("site-save"), false);
      }
    });
  }

  function refreshAll() {
    fillSiteForm();
    fillAcademiaForm();
    fillKidsForm();
    fillVenueForm();
    fillTorneosForm();
  }

  return {
    bind,
    refreshAll,
    fillSiteForm,
    fillAcademiaForm,
    fillKidsForm,
    fillVenueForm,
    fillTorneosForm,
  };
}
