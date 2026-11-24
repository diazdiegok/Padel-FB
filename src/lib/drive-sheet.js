import { isPendingMatch } from "./fixturer.js";
import { fold, pairsMatch } from "./scoring.js";

export const DRIVE_FIELDS = [
  "fecha",
  "dia",
  "horario",
  "categoria",
  "complejo",
  "cancha",
  "pareja1",
  "pareja2",
  "resultado",
];

const HEADER_ALIASES = {
  fecha: ["fecha"],
  dia: ["dia"],
  horario: ["horario"],
  categoria: ["categoria"],
  complejo: ["complejo"],
  cancha: ["cancha"],
  pareja1: ["pareja 1", "pareja1"],
  pareja2: ["pareja 2", "pareja2"],
  resultado: ["resultado", "result"],
};

function columnIndex(headerRow) {
  const cells = (headerRow || []).map((c) => fold(c));
  const idx = {};
  let hits = 0;
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const names = aliases.map((a) => fold(a));
    const at = cells.findIndex((c) => names.includes(c));
    if (at >= 0) {
      idx[key] = at;
      hits += 1;
    }
  }
  return { idx, hits };
}

/** Filas de la hoja (con o sin encabezado) → objetos de partido. */
export function parseDriveSheetValues(values = []) {
  if (!Array.isArray(values) || !values.length) return [];
  const { idx, hits } = columnIndex(values[0]);
  const header = hits >= 2;
  const map = header ? idx : Object.fromEntries(DRIVE_FIELDS.map((key, i) => [key, i]));
  const lines = header ? values.slice(1) : values;
  const rows = [];
  for (const line of lines) {
    if (!line || !line.some((c) => String(c || "").trim())) continue;
    const row = {};
    for (const key of DRIVE_FIELDS) {
      const i = map[key];
      row[key] = i == null ? "" : String(line[i] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

export function driveRowHasResult(row) {
  return String(row?.resultado || "").trim().length > 0;
}

/** Mismo partido: misma categoría y las dos parejas (aunque cambien de lado). */
export function sameDriveMatch(a, b) {
  if (!a || !b) return false;
  if (!String(a.pareja1 || "").trim() || !String(b.pareja1 || "").trim()) return false;
  if (!String(a.pareja2 || "").trim() || !String(b.pareja2 || "").trim()) return false;
  const catA = fold(a.categoria);
  const catB = fold(b.categoria);
  if (catA && catB && catA !== catB) return false;
  const direct = pairsMatch(a.pareja1, b.pareja1) && pairsMatch(a.pareja2, b.pareja2);
  const swap = pairsMatch(a.pareja1, b.pareja2) && pairsMatch(a.pareja2, b.pareja1);
  return direct || swap;
}

/**
 * El pegado reemplaza los partidos sin resultado.
 * Los que ya tienen resultado vuelven tal cual, aunque el fixture nuevo los traiga distinto o ya no los traiga.
 */
export function mergeDriveFixtureRows(existingRows = [], incomingRows = []) {
  const locked = (existingRows || []).filter(driveRowHasResult);
  const used = new Set();
  const out = [];
  for (const row of incomingRows || []) {
    const hit = locked.findIndex((prev, i) => !used.has(i) && sameDriveMatch(prev, row));
    if (hit >= 0) {
      used.add(hit);
      out.push({ ...locked[hit] });
    } else {
      out.push({ ...row });
    }
  }
  let keptExtra = 0;
  locked.forEach((row, i) => {
    if (used.has(i)) return;
    out.push({ ...row });
    keptExtra += 1;
  });
  return { rows: out, kept: locked.length, keptExtra };
}

function driveContactRows(matches, { includeRecover = false } = {}, puedeOf = () => "", phonesOf = () => ({})) {
  return (matches || [])
    .filter((m) => {
      if (!isPendingMatch(m)) return false;
      const owed = String(m?.recoverFrom || "").trim();
      return includeRecover ? !!owed : !owed;
    })
    .map((m) => {
      const bits = [];
      const owed = String(m?.recoverFrom || "").trim();
      if (includeRecover && owed) bits.push(`Le falta 1 partido en ${owed}.`);
      const reason = String(m?.reason || "").trim();
      if (reason) bits.push(reason);
      const phones = phonesOf(m) || {};
      return {
        // En Recuperan: la fecha en que aparecen (recoveredIn). En Pendientes: su week.
        fecha: String(
          includeRecover ? m?.recoveredIn || m?.week || "" : m?.week || ""
        ).trim(),
        categoria: String(m?.cat || "").trim(),
        pareja: String(m?.home || "").trim(),
        whatsapp1: String(phones.tel1 || phones.whatsapp1 || "").trim(),
        whatsapp2: String(phones.tel2 || phones.whatsapp2 || "").trim(),
        puede: String(puedeOf(m) || "").trim(),
        nota: bits.join(" "),
      };
    })
    .sort(
      (a, b) =>
        a.categoria.localeCompare(b.categoria, "es") || a.pareja.localeCompare(b.pareja, "es")
    );
}

/** Una fila por pareja pendiente de la fecha (sin rival). No incluye recuperos / W.O. (van a Recuperan). */
export function pendingDriveRows(matches = [], puedeOf = () => "", phonesOf = () => ({})) {
  return driveContactRows(matches, { includeRecover: false }, puedeOf, phonesOf);
}

/** Una fila por pareja que recupera fecha (W.O. / partido faltante). */
export function recoverDriveRows(matches = [], puedeOf = () => "", phonesOf = () => ({})) {
  return driveContactRows(matches, { includeRecover: true }, puedeOf, phonesOf);
}
