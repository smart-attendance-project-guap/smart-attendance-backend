import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { prisma } from "../src/prisma.js";
import { hashPassword } from "../src/utils/password.js";

const rl = createInterface({ input, output });

async function main() {
  console.log("Создание аккаунта преподавателя\n");

  const email = (await rl.question("Email (логин) преподавателя: ")).trim().toLowerCase();
  const firstName = (await rl.question("Имя: ")).trim();
  const lastName = (await rl.question("Фамилия: ")).trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Некорректный email");
  }
  if (!firstName || !lastName) {
    throw new Error("Имя и фамилия обязательны");
  }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new Error("Пользователь с таким email уже существует");
  }

  // Schedule teacher names are initials in imported GUAP timetable.
  // Never infer identities from a surname: an operator must choose an exact name.
  const scheduleNames = await prisma.scheduleEntry.findMany({
    where: { teacherName: { not: null } },
    select: { teacherName: true, teacherId: true },
  });
  const counts = new Map<string, { total: number; assigned: boolean }>();
  for (const row of scheduleNames) {
    if (!row.teacherName) continue;
    const item = counts.get(row.teacherName) ?? { total: 0, assigned: false };
    item.total++;
    if (row.teacherId !== null) item.assigned = true;
    counts.set(row.teacherName, item);
  }
  const available = [...counts.entries()]
    .filter(([, value]) => !value.assigned)
    .map(([name, value]) => ({ name, total: value.total }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  let selected: { name: string; total: number } | null = null;
  if (available.length) {
    console.log("\nПреподаватели из расписания без привязанного аккаунта:");
    available.forEach((item, index) => {
      console.log(`${index + 1}. ${item.name} (${item.total} записей)`);
    });
    const answer = (await rl.question("Номер для привязки (0 — создать без привязки): ")).trim();
    if (!/^(0|[1-9]\d*)$/.test(answer) || Number(answer) > available.length) {
      throw new Error("Неверный номер");
    }
    if (Number(answer) > 0) {
      selected = available[Number(answer) - 1]!;
      const confirmation = (await rl.question(
        `Привязать ${selected.name} к аккаунту ${email}? Напишите ДА: `,
      )).trim();
      if (confirmation !== "ДА") {
        throw new Error("Операция отменена; аккаунт не создан");
      }
    }
  }

  const password = randomBytes(24).toString("base64url");
  const hashedPassword = await hashPassword(password);

  // Both account creation and optional linking succeed or roll back together.
  const teacher = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, firstName, lastName, password: hashedPassword, role: "TEACHER" },
    });
    if (selected) {
      const matching = await tx.scheduleEntry.findMany({
        where: { teacherName: selected.name },
        select: { id: true, teacherId: true },
      });
      if (matching.length !== selected.total || matching.some((row) => row.teacherId !== null)) {
        throw new Error("Расписание уже изменилось или привязано. Повторите создание");
      }
      const linked = await tx.scheduleEntry.updateMany({
        where: { teacherName: selected.name, teacherId: null },
        data: { teacherId: created.id },
      });
      if (linked.count !== selected.total) throw new Error("Не все пары удалось привязать");
    }
    return created;
  });

  console.log("\nПреподаватель успешно создан!");
  console.log("ID:", teacher.id);
  console.log("Email:", teacher.email);
  console.log("Связано записей расписания:", selected?.total ?? 0);
  console.log("Временный пароль:", password);
  console.log("\nПередайте пароль только владельцу аккаунта, не публикуйте его в чате или таблице.");
}

main()
  .catch((error) => {
    console.error("Ошибка:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
