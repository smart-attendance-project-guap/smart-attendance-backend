import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { makeXlsx } from "../src/utils/makeXlsx.js";

const bytes = makeXlsx([
  ["Группа: 4515"],
  ["Дисциплина: Базы данных"],
  ["Период: 2026-11-01 — 2026-11-30"],
  ["Студент", "Дата", "Посещений", "Пропусков"],
  ["=HYPERLINK(\"https://malicious.example\")", "Опоздал", 1, 0],
  ["А & Б <В>", "Пропуск", 0, 1],
]);
assert.equal(bytes.readUInt32LE(0), 0x04034b50);
const expectedFlags = 0x0800; // UTF-8 only; bit 3 would claim a trailing data descriptor
assert.equal(bytes.readUInt16LE(6), expectedFlags, "Invalid ZIP general-purpose flags");
let offset = 0;
const files = new Map<string, string>();
while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
  assert.equal(bytes.readUInt16LE(offset + 6), expectedFlags, "Local ZIP flags mismatch");
  const compressedLength = bytes.readUInt32LE(offset + 18);
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
  const start = offset + 30 + nameLength + extraLength;
  files.set(name, inflateRawSync(bytes.subarray(start, start + compressedLength)).toString("utf8"));
  offset = start + compressedLength;
}
// Validate central directory metadata too; Excel is stricter than some unzip libraries.
const footer = bytes.length - 22;
assert.equal(bytes.readUInt32LE(footer), 0x06054b50, "Missing ZIP end-of-central-directory");
const count = bytes.readUInt16LE(footer + 10);
assert.equal(count, files.size, "ZIP entry count mismatch");
let central = bytes.readUInt32LE(footer + 16);
for (let i = 0; i < count; i++) {
  assert.equal(bytes.readUInt32LE(central), 0x02014b50, "Broken central-directory signature");
  assert.equal(bytes.readUInt16LE(central + 8), expectedFlags, "Central ZIP flags mismatch");
  const nameLength = bytes.readUInt16LE(central + 28);
  const extraLength = bytes.readUInt16LE(central + 30);
  const commentLength = bytes.readUInt16LE(central + 32);
  central += 46 + nameLength + extraLength + commentLength;
}
assert.equal(central, footer, "Central directory has unexpected trailing data");

for (const entry of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]) {
  assert.ok(files.has(entry), "Missing XLSX part: " + entry);
}
const sheet = files.get("xl/worksheets/sheet1.xml")!;
assert.ok(sheet.includes("4515"));
assert.ok(sheet.includes("Опоздал"));
assert.ok(sheet.includes("Пропуск"));
assert.ok(sheet.includes("А &amp; Б &lt;В&gt;"));
assert.ok(sheet.includes('t="inlineStr"'));
assert.ok(!sheet.includes("<f>"), "Unexpected executable Excel formula");
console.log("PASS: XLSX ZIP parts, text encoding, labels and formula safety");
