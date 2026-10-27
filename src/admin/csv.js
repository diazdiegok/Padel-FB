import { CAT_MAP, CATS, FX_COLS, RANK_COLS, VENUE_MAP } from "./constants.js";
import { num } from "./ui.js";

export function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, cols, data) {
  const body = [cols.join(","), ...data.map((row) => cols.map((c) => csvCell(row[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + body + "\n"], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
}

export function splitLine(line, sep) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === sep && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function normCat(c) {
  const s = String(c || "").trim().toUpperCase().replace(/\s+/g, " ");
  return CAT_MAP[s] || String(c || "").trim();
}

export function normVenue(v) {
  const s = String(v || "").trim().toUpperCase();
  return VENUE_MAP[s] || String(v || "").trim();
}

export function normTime(t) {
  return String(t || "")
    .replace(/(\d):\.(?=\d)/g, "$1:")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitPartido(partido) {
  const raw = String(partido || "").trim();
  const parts = raw.split(/\s+vs\.?\s+/i);
  const pair = (s) => s.trim().replace(/\s*[–—-]\s*/g, " / ");
  if (parts.length >= 2) return { home: pair(parts[0]), away: pair(parts.slice(1).join(" vs ")) };
  return { home: pair(raw), away: "" };
}

export function cleanRow(r, currentSeason = "T4") {
  return {
    name: String(r.name || "").trim(),
    cat: String(r.cat || "").trim(),
    pts: num(r.pts),
    pj: num(r.pj),
    dif: num(r.dif),
    pos: num(r.pos),
    temp: String(r.temp || currentSeason).trim().toUpperCase(),
  };
}

export function cleanMatch(m, defaults = {}, currentSeason = "T4") {
  const fromPartido =
    !m.home && !m.away && (m.partido || "")
      ? splitPartido(m.partido)
      : { home: m.home, away: m.away };
  const away = String(fromPartido.away || "").trim();
  const extra = {};
  if (m.pending && !away) {
    extra.pending = true;
    if (m.reason) extra.reason = String(m.reason).trim();
    if (m.avail) extra.avail = String(m.avail).trim();
    if (m.note) extra.note = String(m.note).trim();
  }
  return {
    ...extra,
    week: String(m.week || defaults.week || "").trim(),
    day: String(m.day || m.dia || "").trim(),
    date: String(m.date || "").trim(),
    temp: String(m.temp || defaults.temp || currentSeason).trim().toUpperCase(),
    cat: normCat(m.cat || m.categoria || m.categoría || ""),
    time: normTime(m.time || m.horario || m.hora || ""),
    venue: normVenue(m.venue || m.complejo || m.sede || ""),
    court: String(m.court || m.cancha || "").trim(),
    home: String(fromPartido.home || "").trim(),
    away,
    result: String(m.result || m.resultado || "").trim(),
    appliedResult: String(m.appliedResult || "").trim(),
  };
}

export function driveRow(m) {
  return {
    categoria: m.cat,
    partido: [m.home, m.away].filter(Boolean).join(" vs "),
    complejo: m.venue,
    cancha: m.court,
    dia: m.day,
    horario: m.time,
  };
}

export function matchKey(m) {
  return [m.week, m.temp, m.cat, m.home, m.away, m.day, m.time]
    .map((v) => String(v || "").toLowerCase().trim())
    .join("|");
}

export function parseRankingCsv(text, { fallbackTemp = "T4" } = {}) {
  const raw = text.replace(/^\uFEFF/, "").trim();
  const first = raw.split(/\r?\n/, 1)[0] || "";
  const sep = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const header = splitLine(lines[0], sep).map((h) => h.toLowerCase());
  const idx = (names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const map = {
    name: idx(["name", "nombre", "jugador", "pareja", "player"]),
    cat: idx(["cat", "categoria", "categoría"]),
    pts: idx(["pts", "puntos", "points"]),
    pj: idx(["pj", "jugados", "played"]),
    dif: idx(["dif", "diferencia", "sets"]),
    pos: idx(["pos", "posicion", "posición", "#"]),
    temp: idx(["temp", "temporada", "season"]),
  };
  const hasHeader = map.name >= 0;
  return (hasHeader ? lines.slice(1) : lines)
    .map((line) => {
      const cols = splitLine(line, sep);
      if (hasHeader) {
        const get = (k) => (map[k] >= 0 ? cols[map[k]] : "");
        return cleanRow(
          {
            name: get("name"),
            cat: get("cat"),
            pts: get("pts"),
            pj: get("pj"),
            dif: get("dif"),
            pos: get("pos") || 0,
            temp: get("temp") || fallbackTemp,
          },
          fallbackTemp
        );
      }
      return cleanRow(
        {
          pos: cols[0],
          name: cols[1],
          cat: cols[2],
          pj: cols[3],
          dif: cols[4],
          pts: cols[5],
          temp: cols[6] || fallbackTemp,
        },
        fallbackTemp
      );
    })
    .filter((r) => r.name && r.cat.toLowerCase() !== "s masculina");
}

export function parseFixtureText(text, defaults = {}, currentSeason = "T4") {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!raw) throw new Error("No hay datos para cargar.");
  const first = raw.split(/\r?\n/, 1)[0] || "";
  const sep = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const headerCells = splitLine(lines[0], sep).map((h) =>
    h
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  );
  const looksHeader = headerCells.some((h) =>
    ["categoria", "partido", "complejo", "cancha", "dia", "horario", "home", "local", "week", "cat"].includes(h)
  );
  const header = looksHeader ? headerCells : [];
  const dataLines = looksHeader ? lines.slice(1) : lines;
  const idx = (names) => {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const parsed = dataLines
    .map((line) => {
      const cols = splitLine(line, sep);
      const get = (...names) => {
        const i = idx(names);
        return i >= 0 ? cols[i] : "";
      };
      const row = looksHeader
        ? {
            week: get("week", "semana"),
            day: get("dia", "day"),
            date: get("date"),
            temp: get("temp", "temporada"),
            cat: get("cat", "categoria"),
            time: get("horario", "hora", "time"),
            venue: get("complejo", "venue", "sede"),
            court: get("cancha", "court"),
            home: get("home", "local", "pareja 1", "pareja1"),
            away: get("away", "visitante", "pareja 2", "pareja2"),
            partido: get("partido"),
            result: get("result", "resultado"),
          }
        : {
            cat: cols[0],
            partido: cols[1],
            venue: cols[2],
            court: cols[3],
            day: cols[4],
            time: cols[5],
          };
      return cleanMatch(row, defaults, currentSeason);
    })
    .filter((m) => m.home || m.away);
  if (!parsed.length) {
    throw new Error("No encontré partidos. Revisá que estén las columnas categoria, partido, complejo, cancha, dia, horario.");
  }
  return parsed;
}

export const RES_IMPORT_COLS = ["fecha", "categoria", "pareja1", "pareja2", "resultado"];

function foldHeader(h) {
  return String(h || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickField(map, names) {
  for (const name of names) {
    if (map[name] != null && String(map[name]).trim() !== "") return String(map[name]).trim();
  }
  return "";
}

function importRowFromMap(map, currentSeason) {
  return cleanMatch(
    {
      week: pickField(map, ["fecha", "week", "jornada", "semana"]),
      temp: pickField(map, ["temp", "temporada", "season"]) || currentSeason,
      cat: pickField(map, ["categoria", "cat", "category"]),
      home: pickField(map, ["pareja1", "pareja 1", "home", "local", "jugador1"]),
      away: pickField(map, ["pareja2", "pareja 2", "away", "visitante", "jugador2"]),
      partido: pickField(map, ["partido", "match"]),
      result: pickField(map, ["resultado", "result", "score", "resultado final"]),
      day: pickField(map, ["dia", "day"]),
      time: pickField(map, ["horario", "hora", "time"]),
    },
    {},
    currentSeason
  );
}

/** Filas de objetos (Excel) → partidos con resultado. */
export function parseResultsImportObjects(objects, currentSeason = "T4") {
  const parsed = (objects || [])
    .map((obj) => {
      const map = {};
      Object.entries(obj || {}).forEach(([k, v]) => {
        map[foldHeader(k)] = v;
      });
      return importRowFromMap(map, currentSeason);
    })
    .filter((m) => m.home && m.away && String(m.result || "").trim());
  if (!parsed.length) {
    throw new Error(
      "No encontré filas con resultado. Columnas: fecha, categoria, pareja1, pareja2, resultado."
    );
  }
  return parsed;
}

/** CSV/texto → partidos con resultado. */
export function parseResultsImportText(text, currentSeason = "T4") {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!raw) throw new Error("El archivo está vacío.");
  const first = raw.split(/\r?\n/, 1)[0] || "";
  const sep = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const header = splitLine(lines[0], sep).map(foldHeader);
  const looksHeader = header.some((h) =>
    ["fecha", "week", "jornada", "categoria", "cat", "pareja1", "pareja 1", "home", "partido", "resultado", "result"].includes(h)
  );
  if (!looksHeader) {
    throw new Error("Falta la fila de títulos: fecha, categoria, pareja1, pareja2, resultado.");
  }
  const objects = lines.slice(1).map((line) => {
    const cols = splitLine(line, sep);
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = cols[i] || "";
    });
    return obj;
  });
  return parseResultsImportObjects(objects, currentSeason);
}

export { RANK_COLS, FX_COLS, CATS };
