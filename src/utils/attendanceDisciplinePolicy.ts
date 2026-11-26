// Physical education is outside Smart Attendance's attendance and QR workflow.
export function isAttendanceExcluded(discipline: string | null | undefined): boolean {
  if (typeof discipline !== "string") return false;
  const name = discipline.toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
  return name.includes("физкульт") ||
    (name.includes("физическ") && name.includes("культур"));
}
