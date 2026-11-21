import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/prisma.js";

const VALID_GROUPS = ["4514", "4515", "4516", "4517"] as const;
type InputEntry = {
  group: string;
  discipline: string;
  classroom: string;
  teacherName?: string | null;
  startsAt: string;
  endsAt: string;
};

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value.trim();
}

function parseSaintPetersburgTime(value: unknown, field: string): Date {
  const text = requireString(value, field);
  // Explicit Moscow time offset avoids local Windows timezone differences.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\+03:00$/.test(text)) {
    throw new Error(`${field} must be ISO 8601 with +03:00, e.g. 2026-11-23T15:10:00+03:00`);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    throw new Error("Usage: npx tsx scripts/importSchedule.ts data/schedule-4514-4517.json");
  }

  const data: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Input must be a nonempty JSON array; no schedule data has been imported");
  }

  const groups = await prisma.group.findMany({
    where: { name: { in: [...VALID_GROUPS] } },
    select: { id: true, name: true },
  });
  const groupIds = new Map(groups.map((group) => [group.name, group.id]));
  if (groups.length !== VALID_GROUPS.length) {
    throw new Error("Create all four university groups first using seedUniversityReferences.ts");
  }

  // Validate every row before modifying the database.
  const rows = data.map((raw: unknown, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid entry at index ${index}`);
    }
    const row = raw as Partial<InputEntry>;
    const group = requireString(row.group, `row ${index} group`);
    if (!VALID_GROUPS.some((name) => name === group)) {
      throw new Error(`Unsupported group ${group} at index ${index}`);
    }
    const groupId = groupIds.get(group);
    if (!groupId) throw new Error(`Group ${group} missing from database`);
    const startsAt = parseSaintPetersburgTime(row.startsAt, `row ${index} startsAt`);
    const endsAt = parseSaintPetersburgTime(row.endsAt, `row ${index} endsAt`);
    if (endsAt <= startsAt) {
      throw new Error(`End time must follow start time at index ${index}`);
    }
    const teacherName =
      row.teacherName === undefined || row.teacherName === null || row.teacherName === ""
        ? null
        : requireString(row.teacherName, `row ${index} teacherName`);

    return {
      groupId,
      discipline: requireString(row.discipline, `row ${index} discipline`),
      classroom: requireString(row.classroom, `row ${index} classroom`),
      teacherName,
      startsAt,
      endsAt,
    };
  });

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const unique = {
        groupId: row.groupId,
        startsAt: row.startsAt,
        discipline: row.discipline,
        classroom: row.classroom,
      };
      await tx.scheduleEntry.upsert({
        where: { groupId_startsAt_discipline_classroom: unique },
        create: row,
        update: { teacherName: row.teacherName, endsAt: row.endsAt },
      });
    }
  });

  console.log(`Imported/updated ${rows.length} schedule entries for groups 4514–4517.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
