export const AUTH_KEY = "liga-fb-admin-ok";
export const HIDDEN_CATS = new Set(["S Masculina"]);
export const RANK_PATH = "src/data/ranking.json";
export const SITE_PATH = "src/data/site.json";
export const FIXTURE_PATH = "src/data/fixture.json";
export const RESULTS_PATH = "src/data/results.json";
export const PLAYOFF_PATH = "src/data/playoff.json";
export const PAIRS_CONFIG_PATH = "src/data/inscripcion-parejas.json";
export const PAIRS_PATH = "src/data/parejas.json";
export const RANK_COLS = ["name", "cat", "pts", "pj", "dif", "pos", "temp"];
export const FX_COLS = ["categoria", "partido", "complejo", "cancha", "dia", "horario"];
export const CATS = [
  "A Masculina",
  "B Masculina",
  "C Masculina",
  "A Femenino",
  "B Femenino",
  "C Femenino",
];
export const CAT_MAP = {
  "A MASC": "A Masculina",
  "A MASCULINA": "A Masculina",
  "B MASC": "B Masculina",
  "B MASCULINA": "B Masculina",
  "C MASC": "C Masculina",
  "C MASCULINA": "C Masculina",
  "A FEM": "A Femenino",
  "A FEMENINO": "A Femenino",
  "B FEM": "B Femenino",
  "B FEMENINO": "B Femenino",
  "C FEM": "C Femenino",
  "C FEMENINO": "C Femenino",
};
export const VENUE_MAP = {
  OPEN: "Open Padel",
  "OPEN PADEL": "Open Padel",
  AMERICAS: "Americas Padel",
  AMÉRICAS: "Americas Padel",
  "AMERICAS PADEL": "Americas Padel",
  PALERMO: "Palermo Padel",
  "PALERMO PÁDEL": "Palermo Padel",
  "PALERMO PADEL": "Palermo Padel",
  TERRAZAS: "Terrazas Padel",
  "TERRAZAS PADEL": "Terrazas Padel",
  BENGURION: "Bengurion Padel",
  "BEN GURION": "Bengurion Padel",
};

export const SECTIONS = {
  sitio: { group: "Inicio", title: "Inicio", help: "Contacto, ciudad, texto de inicio y si se muestra el botón Ver playoff." },
  temporadas: {
    group: "Liga",
    title: "Temporadas",
    help: "Próximamente / En juego siguen al inicio. Creá temporadas y marcá cuál usa el sistema o cuál es la siguiente.",
  },
  ranking: { group: "Liga", title: "Ranking", help: "La tabla se arma con las parejas inscriptas y los resultados. Acá corregís a mano y publicás." },
  fixture: { group: "Liga", title: "Fixture", help: "Armá Fecha 1, Fecha 2… con las parejas inscriptas, revisá y publicá. Los resultados se cargan en Resultados." },
  resultados: { group: "Liga", title: "Resultados", help: "Cargá el score de cada partido. Al publicar se actualiza el ranking." },
  playoff: { group: "Liga", title: "Playoff", help: "Armá el cuadro de cada categoría. Las temporadas anteriores quedan en el historial de /playoff/. Con Editar cambiás una pareja a mano." },
  parejas: {
    group: "Liga",
    title: "Inscripciones de parejas",
    help: "Usa la temporada del sistema (la misma que Temporadas). Acá ves textos, contactos y disponibilidad; con eso se arma el fixture.",
  },
  sedes: { group: "Liga", title: "Sedes", help: "Complejos de la liga y la academia. Marcá dónde se muestra cada uno." },
  acadinsc: { group: "Academia", title: "Inscripciones", help: "Quienes se anotaron a las clases desde la web. El teléfono solo se ve acá." },
  academia: { group: "Academia", title: "Adultos", help: "Profes, programas y textos de las clases de adultos." },
  infantiles: { group: "Academia", title: "Infantiles", help: "Textos, sedes y horarios de las clases infantiles." },
  torneos: { group: "Torneos", title: "Torneos", help: "Listado de torneos. Si está vacío, la web muestra el aviso." },
  visitas: {
    group: "Torneos",
    title: "Visitas",
    help: "Tráfico de la web: totales de 14 días y últimas visitas con IP (solo visibles en el admin).",
  },
};
