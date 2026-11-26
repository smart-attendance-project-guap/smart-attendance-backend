import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prisma } from "../src/prisma.js";

const rl = createInterface({ input, output });

async function main() {
  console.log("Привязка существующего аккаунта преподавателя к расписанию\n");
  const email = (await rl.question("Email существующего преподавателя: ")).trim().toLowerCase();
  const teacher = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, firstName: true, lastName: true },
  });
  if (!teacher || teacher.role !== "TEACHER") {
    throw new Error("Аккаунт преподавателя не найден");
  }

  const assignedToThisTeacher = await prisma.scheduleEntry.findMany({
    where: { teacherId: teacher.id },
    select: { teacherName: true },
  });
  if (assignedToThisTeacher.length) {
    throw new Error("У аккаунта уже есть привязанное расписание. Повторную привязку отменили");
  }

  const all = await prisma.scheduleEntry.findMany({
    where: { teacherName: { not: null } },
    select: { teacherName: true, teacherId: true },
  });
  const names = new Map<string, { total: number; assigned: boolean }>();
  for (const row of all) {
    if (!row.teacherName) continue;
    const state = names.get(row.teacherName) ?? { total: 0, assigned: false };
    state.total++;
    if (row.teacherId !== null) state.assigned = true;
    names.set(row.teacherName, state);
  }
  const available = [...names.entries()]
    .filter(([, state]) => !state.assigned)
    .map(([name, state]) => ({ name, total: state.total }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (!available.length) {
    console.log("Нет свободных записей расписания с указанным преподавателем.");
    return;
  }
  available.forEach((item, index) => console.log(
    `${index + 1}. ${item.name} (${item.total} записей)`,
  ));

  const choice = (await rl.question("Номер преподавателя из расписания (0 — отмена): ")).trim();
  if (!/^(0|[1-9]\d*)$/.test(choice) || Number(choice) > available.length) {
    throw new Error("Неверный номер");
  }
  if (Number(choice) === 0) {
    console.log("Без изменений");
    return;
  }
  const selected = available[Number(choice) - 1]!;
  const confirm = (await rl.question(
    `Аккаунт ${teacher.lastName} ${teacher.firstName} (${email}) получит ${selected.total} записей ${selected.name}. Введите ДА: `,
  )).trim();
  if (confirm !== "ДА") {
    console.log("Отменено. Данные не изменены");
    return;
  }

  const count = await prisma.$transaction(async (tx) => {
    const existing = await tx.scheduleEntry.count({ where: { teacherId: teacher.id } });
    if (existing) throw new Error("У аккаунта появилось другое расписание. Отменено");

    const matching = await tx.scheduleEntry.findMany({
      where: { teacherName: selected.name },
      select: { id: true, teacherId: true },
    });
    if (matching.length !== selected.total || matching.some((row) => row.teacherId !== null)) {
      throw new Error("Это расписание уже привязано или было изменено. Отменено");
    }
    const result = await tx.scheduleEntry.updateMany({
      where: { teacherName: selected.name, teacherId: null },
      data: { teacherId: teacher.id },
    });
    if (result.count !== selected.total) throw new Error("Не все записи удалось привязать");
    return result.count;
  });
  console.log(`Успешно привязано ${count} записей к ${email}.\nПароль и группа студентов не менялись.`);
}

main().catch((error) => {
  console.error("Ошибка:", error);
  process.exitCode = 1;
}).finally(async () => {
  rl.close();
  await prisma.$disconnect();
});
