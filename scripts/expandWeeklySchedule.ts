import { readFile, writeFile } from "node:fs/promises";

type WeeklyEntry = {
  group: string;
  weekday: number; // 1=Monday, 7=Sunday
  start: string; // HH:MM local Saint Petersburg
  end: string;
  week: "every" | "upper" | "lower"; // ▲ / ▼ from GUAP
  discipline: string;
  classroom: string;
  teacherName?: string;
};

type WeeklyInput = {
  from: string; // YYYY-MM-DD
  through: string;
  upperWeekMonday: string; // Monday of a confirmed ▲ week
  entries: WeeklyEntry[];
};

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const GROUPS = new Set(["4514", "4515", "4516", "4517"]);

function dayMs(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date: " + value);
  const parsed = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid date: " + value);
  }
  return parsed;
}

function validateTime(value: string): void {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("Time must be HH:MM: " + value);
  }
}

function required(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing " + label);
}

async function main() {
  const source = process.argv[2] ?? "data/weekly-schedule-4514-4517.json";
  const output = process.argv[3] ?? "data/schedule-4514-4517.json";
  const config: WeeklyInput = JSON.parse(await readFile(source, "utf8"));

  const fromMs = dayMs(config.from);
  const throughMs = dayMs(config.through);
  const upperMondayMs = dayMs(config.upperWeekMonday);

  if (new Date(upperMondayMs).getUTCDay() !== 1) {
    throw new Error("upperWeekMonday must be a Monday of a confirmed ▲ (upper) week");
  }
  if (throughMs < fromMs || throughMs - fromMs > 120 * DAY_MS) {
    throw new Error("Choose a date period of at most 120 days");
  }
  if (!Array.isArray(config.entries) || config.entries.length === 0) {
    throw new Error("Provide verified weekly lessons in entries, not an empty list");
  }

  const rows = config.entries.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid entry " + i);
    required(entry.group, "group");
    required(entry.discipline, "discipline");
    required(entry.classroom, "classroom");
    if (!GROUPS.has(entry.group)) throw new Error("Unsupported group " + entry.group);
    if (!Number.isInteger(entry.weekday) || entry.weekday < 1 || entry.weekday > 7) {
      throw new Error("weekday must be 1..7 in entry " + i);
    }
    if (!["every", "upper", "lower"].includes(entry.week)) {
      throw new Error("week must be every, upper or lower in entry " + i);
    }
    validateTime(entry.start);
    validateTime(entry.end);
    if (entry.end <= entry.start) throw new Error("End must follow start in entry " + i);
    if (entry.teacherName !== undefined) required(entry.teacherName, "teacherName");
    return entry;
  });

  const dates: Array<{
    group: string; discipline: string; classroom: string; teacherName?: string;
    startsAt: string; endsAt: string;
  }> = [];

  for (let day = fromMs; day <= throughMs; day += DAY_MS) {
    const isoDate = new Date(day).toISOString().slice(0, 10);
    const dayOfWeek = new Date(day).getUTCDay() || 7;
    const mondayMs = day - (dayOfWeek - 1) * DAY_MS;
    const weeksSinceUpper = Math.round((mondayMs - upperMondayMs) / WEEK_MS);
    const isUpper = ((weeksSinceUpper % 2) + 2) % 2 === 0;

    for (const entry of rows) {
      if (entry.weekday !== dayOfWeek) continue;
      if (entry.week === "upper" && !isUpper) continue;
      if (entry.week === "lower" && isUpper) continue;
      dates.push({
        group: entry.group,
        discipline: entry.discipline.trim(),
        classroom: entry.classroom.trim(),
        ...(entry.teacherName ? { teacherName: entry.teacherName.trim() } : {}),
        startsAt: isoDate + "T" + entry.start + ":00+03:00",
        endsAt: isoDate + "T" + entry.end + ":00+03:00",
      });
    }
  }

  dates.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.group.localeCompare(b.group));
  const seen = new Set<string>();
  const unique = dates.filter((r) => {
    const key = [r.group, r.startsAt, r.discipline, r.classroom].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await writeFile(output, JSON.stringify(unique, null, 2) + "\n", "utf8");
  console.log("Created " + unique.length + " dated schedule entries in " + output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
