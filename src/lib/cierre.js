const SITE_TZ = "-03:00";

export function validDeadline(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || "") ? value : "";
}

export function deadlinePassed(value) {
  const deadline = validDeadline(value);
  return Boolean(deadline) && Date.now() > Date.parse(`${deadline}:00${SITE_TZ}`);
}

export function deadlineText(value) {
  const deadline = validDeadline(value);
  if (!deadline) return "";
  const [date, time] = deadline.split("T");
  const [, month, day] = date.split("-");
  return `${Number(day)}/${Number(month)} a las ${time}`;
}

export function closeStatus(open, value) {
  const when = deadlineText(value);
  if (!open) return when ? `Cerrada · cerró el ${when}` : "Inscripción cerrada";
  return when ? `Abierta hasta el ${when}` : "Inscripción abierta";
}
