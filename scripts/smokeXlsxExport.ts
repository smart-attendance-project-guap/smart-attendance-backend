import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { makeXlsx } from "../src/utils/makeXlsx.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as typeof import("exceljs");

const rows = [
  ["Группа: 4515"],
  ["Дисциплина: Базы данных"],
  ["Период: 2026-11-01 — 2026-11-30"],
  ["Пропуски считаются только по завершённым занятиям"],
  ["Студент", "Дата", "Посещений", "Пропусков"],
  ["=HYPERLINK(\"https://malicious.example\")", "Опоздал", 1, 0],
  ["А & Б <В>", "Пропуск", 0, 1],
];

const bytes = await makeXlsx(rows);
assert.equal(bytes.readUInt32LE(0), 0x04034b50, "Not a ZIP archive");

// Unlike checking ZIP entries only, actually parse the workbook that was written.
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(bytes);
const sheet = workbook.getWorksheet("Посещаемость");
assert.ok(sheet, "Expected worksheet missing");
assert.equal(sheet.getCell("A1").value, "Группа: 4515");
assert.equal(sheet.getCell("A5").value, "Студент");
assert.equal(sheet.getCell("B6").value, "Опоздал");
assert.equal(sheet.getCell("C6").value, 1);
assert.equal(sheet.getCell("A7").value, "А & Б <В>");
assert.equal(sheet.getCell("D7").value, 1);
assert.equal(sheet.getCell("A6").value, '=HYPERLINK("https://malicious.example")');
assert.equal(sheet.getCell("A6").type, ExcelJS.ValueType.String, "Unsafe formula conversion");
console.log("PASS: ExcelJS generated a readable XLSX with correct rows, Unicode and literal strings");
