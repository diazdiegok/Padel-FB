import { downloadCsv } from "./csv.js";
import { fold } from "../lib/disponibilidad.js";
import { $, confirmModal, escAttr as esc, setBusy, setMsg, toast } from "./ui.js";

const waNumber = (tel) => {
  let n = String(tel || "").replace(/\D/g, "");
  if (n.startsWith("0")) n = n.slice(1);
  if (n && !n.startsWith("54")) n = `549${n}`;
  return n;
};

const sentAt = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function createAcademiaInscripciones(ctx, api) {
  let rows = [];
  let term = "";

  function render() {
    const q = fold(term);
    const shown = q
      ? rows.filter((r) => fold([r.nombre, r.tel, r.sede, r.nota, r.para].join(" ")).includes(q))
      : rows;
    const adults = rows.filter((r) => r.para !== "Infantiles").length;
    $("acad-count").textContent = `${rows.length} inscripto${rows.length === 1 ? "" : "s"} · ${adults} adultos · ${rows.length - adults} infantiles`;
    $("acad-list").innerHTML = shown.length
      ? `<div class="acad-leads">${shown
          .map(
            (r) => `<article class="admin-result-card acad-lead">
              <div class="admin-season-head">
                <div>
                  <div class="admin-result-meta"><span>${esc(r.para || "Adultos")}</span><span>${esc(sentAt(r.createdAt))}</span></div>
                  <strong>${esc(r.nombre || "Sin nombre")}</strong>
                </div>
                <button class="admin-del" type="button" data-acad-del="${esc(r.id)}" aria-label="Quitar">×</button>
              </div>
              <p><a href="https://wa.me/${esc(waNumber(r.tel))}" target="_blank" rel="noopener">${esc(r.tel || "Sin WhatsApp")}</a>${
                r.edad ? ` · ${esc(r.edad)} años` : ""
              } · ${esc(r.nivel || "Sin nivel")} · ${esc(r.sede || "Sin sede")}</p>
              ${r.horario ? `<p>${esc(r.horario)}</p>` : ""}
              ${r.nota ? `<p class="acad-note">${esc(r.nota)}</p>` : ""}
            </article>`
          )
          .join("")}</div>`
      : `<div class="admin-empty"><p>${
          rows.length ? "Nadie coincide con la búsqueda." : "Todavía no se inscribió nadie a la academia."
        }</p></div>`;
  }

  async function reload({ quiet = true } = {}) {
    if (!ctx.token) {
      render();
      return;
    }
    try {
      const list = await api.worker("/academia");
      rows = Array.isArray(list) ? list : [];
      render();
      if (!quiet) toast("Inscripciones actualizadas", "ok");
    } catch (err) {
      setMsg($("acad-msg"), err.message, "err");
      if (!quiet) toast(err.message, "err");
    }
  }

  function bind() {
    $("acad-search")?.addEventListener("input", (e) => {
      term = e.target.value;
      render();
    });
    $("acad-reload")?.addEventListener("click", () => reload({ quiet: false }));
    $("acad-export")?.addEventListener("click", () => {
      if (!rows.length) {
        toast("No hay inscripciones para exportar", "err");
        return;
      }
      downloadCsv(
        "inscripciones-academia.csv",
        ["fecha", "clases", "nombre", "whatsapp", "edad", "nivel", "sede", "horarios", "comentario"],
        rows.map((r) => ({
          fecha: sentAt(r.createdAt),
          clases: r.para,
          nombre: r.nombre,
          whatsapp: r.tel,
          edad: r.edad,
          nivel: r.nivel,
          sede: r.sede,
          horarios: r.horario,
          comentario: r.nota,
        }))
      );
      toast("Inscripciones exportadas", "ok");
    });
    $("acad-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-acad-del]");
      if (!btn) return;
      const row = rows.find((r) => r.id === btn.dataset.acadDel);
      const ok = await confirmModal({
        title: "Quitar inscripción",
        body: `${row?.nombre || "Esta persona"} se borra del registro. No se puede deshacer.`,
        confirmLabel: "Quitar",
        danger: true,
      });
      if (!ok) return;
      setBusy(btn, true, "…");
      try {
        await api.worker("/academia/delete", { id: btn.dataset.acadDel });
        rows = rows.filter((r) => r.id !== btn.dataset.acadDel);
        render();
        toast("Inscripción quitada", "ok");
      } catch (err) {
        toast(err.message, "err");
        setBusy(btn, false);
      }
    });
  }

  return { bind, render, reload };
}
