
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { prisma } from "../src/prisma.js";
import { hashPassword } from "../src/utils/password.js";

const rl = createInterface({ input, output });

async function main() {
  console.log("Создание аккаунта преподавателя\n");

  const email = (
    await rl.question("Email преподавателя: ")
  ).trim().toLowerCase();

  const firstName = (
    await rl.question("Имя: ")
  ).trim();

  const lastName = (
    await rl.question("Фамилия: ")
  ).trim();

  // Проверяем введённые данные
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    throw new Error("Некорректный email");
  }

  if (!firstName || !lastName) {
    throw new Error("Имя и фамилия обязательны");
  }

  // Проверяем, нет ли уже такого пользователя
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new Error("Пользователь с таким email уже существует");
  }

  // Создаём случайный надёжный пароль
  const password = randomBytes(24).toString("base64url");

  // Храним в базе только хеш пароля
  const hashedPassword = await hashPassword(password);

  // Создаём преподавателя
  const teacher = await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      password: hashedPassword,
      role: "TEACHER",
    },
  });

  console.log("\nПреподаватель успешно создан!");
  console.log("ID:", teacher.id);
  console.log("Email:", teacher.email);
  console.log("Временный пароль:", password);
  console.log("\nСохраните пароль в безопасном месте.");
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
