import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { generateToken } from "../utils/jwt.js";

export async function register(req: Request, res: Response) {
  try {
    const { email, password, firstName, lastName, role, groupId } = req.body;

    // Проверяем типы обязательных полей
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      typeof role !== "string"
    ) {
      return res.status(400).json({
        message: "Invalid registration data",
      });
    }

    // Убираем случайные пробелы
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();

    // Проверяем, что обязательные строки не пустые
    if (
      !normalizedEmail ||
      !password ||
      !normalizedFirstName ||
      !normalizedLastName ||
      !role
    ) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    // Базовая проверка формата email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Invalid email format",
      });
    }

    // Разрешаем только роли из нашей системы
    if (role !== "STUDENT" && role !== "TEACHER") {
      return res.status(400).json({
        message: "Role must be STUDENT or TEACHER",
      });
    }

    let normalizedGroupId: number | null = null;

    // Группа относится к студенту
    if (role === "STUDENT" && groupId !== undefined && groupId !== null) {
      normalizedGroupId = Number(groupId);

      if (
        !Number.isInteger(normalizedGroupId) ||
        normalizedGroupId <= 0
      ) {
        return res.status(400).json({
          message: "Invalid groupId",
        });
      }

      const group = await prisma.group.findUnique({
        where: {
          id: normalizedGroupId,
        },
      });

      if (!group) {
        return res.status(400).json({
          message: "Group not found",
        });
      }
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "User with this email already exists",
      });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        role,
        groupId: role === "STUDENT" ? normalizedGroupId : null,
      },
    });

    return res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        groupId: user.groupId,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Registration failed",
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const passwordMatch = await comparePassword(
      password,
      user.password,
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = generateToken(user.id, user.role);

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        groupId: user.groupId,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Login failed",
    });
  }
}