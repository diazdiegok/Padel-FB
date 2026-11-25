import { escAttr } from "./ui.js";

/** Normaliza un teléfono argentino para WhatsApp (solo dígitos, con 549 si falta). */
export function waNumber(tel) {
  let n = String(tel || "").replace(/\D/g, "");
  if (n.startsWith("0")) n = n.slice(1);
  if (n && !n.startsWith("54")) n = `549${n}`;
  return n;
}

/** Link web (fallback). Preferir openWhatsApp para no sacar al admin del lugar. */
export function waHref(tel) {
  const n = waNumber(tel);
  return n.length >= 8 ? `https://api.whatsapp.com/send?phone=${n}` : "";
}

const WA_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

function isMobileUa() {
  if (typeof navigator === "undefined") return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")) return true;
  try {
    return !!matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * Abre WhatsApp sin navegar el admin (así al volver seguís en la misma fecha).
 * En el celu usa el esquema nativo (sin la página intermedia de wa.me).
 */
export function openWhatsApp(tel) {
  const n = waNumber(tel);
  if (n.length < 8) return false;
  const web = `https://api.whatsapp.com/send?phone=${n}`;
  const native = `whatsapp://send?phone=${n}`;

  if (!isMobileUa()) {
    window.open(web, "_blank", "noopener,noreferrer");
    return true;
  }

  let left = false;
  const markLeft = () => {
    left = true;
  };
  document.addEventListener("visibilitychange", markLeft, { once: true });
  window.addEventListener("pagehide", markLeft, { once: true });
  window.addEventListener("blur", markLeft, { once: true });

  // Misma acción de usuario → el OS abre la app y el admin queda debajo.
  const a = document.createElement("a");
  a.href = native;
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => {
    document.removeEventListener("visibilitychange", markLeft);
    window.removeEventListener("pagehide", markLeft);
    window.removeEventListener("blur", markLeft);
    if (!left && document.visibilityState === "visible") {
      window.open(web, "_blank", "noopener,noreferrer");
    }
  }, 900);

  return true;
}

/** Botón (no <a>) para no empujar historial ni salir de la pantalla. */
export function waIconHtml(tel, label = "") {
  const n = waNumber(tel);
  if (n.length < 8) return "";
  const who = String(label || "").trim() || "WhatsApp";
  return `<button class="wa-ico" type="button" data-wa="${escAttr(n)}" title="WhatsApp · ${escAttr(who)}" aria-label="WhatsApp ${escAttr(who)}">${WA_SVG}</button>`;
}

/** Uno o dos íconos a partir de tel1/tel2 (con nombre opcional por integrante). */
export function waIconsHtml(phones = {}, labels = {}) {
  const a = waIconHtml(phones.tel1 || phones.whatsapp1, labels.p1 || labels.name1 || "");
  const b = waIconHtml(phones.tel2 || phones.whatsapp2, labels.p2 || labels.name2 || "");
  if (!a && !b) return "";
  return `<span class="wa-icos">${a}${b}</span>`;
}

/** Delegado global: un solo bind en el admin. */
export function bindWhatsAppLinks(root = document) {
  if (root.__waBound) return;
  root.__waBound = true;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".wa-ico[data-wa]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openWhatsApp(btn.getAttribute("data-wa") || "");
  });
}
