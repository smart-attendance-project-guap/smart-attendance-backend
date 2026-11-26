import { createRequire } from "node:module";

type Cell = string | number | null | undefined;

// ExcelJS emits a complete Office Open XML workbook, including styles,
// relationships and shared strings. Do not hand-write ZIP or workbook XML.
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as typeof import("exceljs");

export async function makeXlsx(rows: Cell[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Smart Attendance";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Посещаемость", {
    views: [{ state: "frozen", ySplit: 5 }],
  });

  for (const row of rows) {
    worksheet.addRow(row.map((value) => value ?? null));
  }

  const header = worksheet.getRow(5);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 32;

  worksheet.getColumn(1).width = 36;
  for (let col = 2; col <= (rows[4]?.length ?? 0); col++) {
    worksheet.getColumn(col).width = 23;
  }

  // No formula objects, images, macros, passwords or tokens are emitted.
  // Student names beginning with '=' remain literal strings in sharedStrings.
  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result);
}
