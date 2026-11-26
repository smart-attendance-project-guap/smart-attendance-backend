import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { isAttendanceExcluded } from "../src/utils/attendanceDisciplinePolicy.js";

type Entry = {
  group?: string; groups?: string[]; discipline: string; classroom: string;
  startsAt: string; endsAt: string; teacherName?: string;
};
const source = JSON.parse(await readFile("data/schedule-4514-4517.json", "utf8")) as Entry[];
const active = JSON.parse(await readFile("data/schedule-4514-4517.import-ready.json", "utf8")) as Entry[];
assert.equal(isAttendanceExcluded("Прикладная физическая культура (элективный модуль)"), true);
assert.equal(isAttendanceExcluded("Физкультура"), true);
assert.equal(isAttendanceExcluded("Компьютерная графика"), false);
assert.equal(isAttendanceExcluded(null), false);
assert.equal(source.length, 176);
assert.equal(source.filter((e) => isAttendanceExcluded(e.discipline)).length, 16);
assert.equal(active.length, 106);
assert.equal(active.filter((e) => (e.groups?.length ?? 0) > 1).length, 18);
assert.equal(active.some((e) => isAttendanceExcluded(e.discipline)), false);

const expanded = active.flatMap(({ groups, group, ...rest }) =>
  (groups ?? (group ? [group] : [])).map((name) => ({ group: name, ...rest })));
function key(e: Entry) {
  return JSON.stringify([e.group, e.discipline, e.classroom,
    e.teacherName ?? null, e.startsAt, e.endsAt]);
}
assert.deepEqual(
  expanded.map(key).sort(),
  source.filter((e) => !isAttendanceExcluded(e.discipline)).map(key).sort(),
);
console.log("PE exclusion smoke passed: 106 import rows = 160 non-PE lessons, 18 shared entries.");
