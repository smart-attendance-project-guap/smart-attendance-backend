# Smart Attendance: API for timetable / export MVP

**Base:** `http://localhost:3000`. Every request below requires `Authorization: Bearer <JWT>`.
New APIs are designed for `feature-reports-and-schedule-mvp` (not merged into `feature-backend`).

## 1. Excel journal — Dasha (teacher UI)

`GET /api/attendance/teacher/export?groupId=2&discipline=Алгоритмы%20и%20структуры%20данных&from=2026-11-01&to=2026-11-30`

Requires TEACHER; only own lessons for the selected group and discipline. Returns binary XLSX:
`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
Download via `fetch`, `response.blob()`, `URL.createObjectURL` and an `<a download="attendance.xlsx">`.
Filter UI needs group, discipline, from, to. Max range 180 days.
The sheet lists students, lesson dates in Moscow time, statuses and two totals. Totals count
only `PRESENT`/`LATE` as attended and only teacher-finished, scheduled-end-passed
lessons in the denominator, matching current `getAttendanceStats`. PENDING and
REJECTED are distinguished, but counted as not attended on completed lessons.

## Prepared schedule already in repository

The preserved source timetable `data/schedule-4514-4517.json` has 176
group-specific rows including 16 rows of physical education.
**Physical education is excluded from Smart Attendance's lesson and QR workflow.**
The operational import file `data/schedule-4514-4517.import-ready.json`
has **106 items expanding to 160 non-PE rows**, including **18 shared-group
entries**. The 12 PE import objects (16 group-specific rows) are deliberately
omitted. The six types of original shared lessons were audited in
`docs/schedule-shared-lecture-audit.md`; the active file has five types.

Existing classroom labels, including building suffixes such as
`52-17 (Б. Морская 67)`, were preserved intentionally: the import
`upsert` key includes the classroom string. The lesson-start endpoint
resolves the building suffix to the actual `Classroom` record.

**Teacher account mapping is not complete:** the source contains names but
no account emails. 15 named teachers are in the source; 16 PE rows with missing
teacher names are excluded from the operational file. It contains no `teacherEmail`. After import, the operator can provision teacher accounts
and select the exact `teacherName` from the imported schedule, or link an
existing teacher account with the standalone script described below.
No real-world teacher email list is necessary for the test environment.
No physical education account mapping is needed.

## 2. Schedule upload — Dasha (authorized staff)

**Supported file format: UTF-8 JSON**, array of entries. Browser reads a
`.json` file and POSTs `{"entries": <parsed-array>}` as `application/json`
to `POST /api/schedule/import`. No multipart/form-data support.

Example file:
```json
[
  {
    "groups": ["4514", "4515"],
    "discipline": "Алгоритмы и структуры данных",
    "classroom": "52-17",
    "teacherEmail": "replace-with-real-teacher@example.org",
    "teacherName": "Фамилия Имя",
    "startsAt": "2026-12-01T10:00:00+03:00",
    "endsAt": "2026-12-01T11:30:00+03:00"
  },
  {
    "group": "4516",
    "discipline": "Экономика",
    "classroom": "53-07",
    "teacherName": "Фамилия Имя",
    "startsAt": "2026-12-01T12:00:00+03:00",
    "endsAt": "2026-12-01T13:30:00+03:00"
  }
]
```

`groups` (1–4) marks one **shared lecture** across groups. A single `group` is
accepted for backward compatibility. All entries are expanded into per-group
`ScheduleEntry` rows with one common `sharedKey`. A retry uses `upsert`,
so it does not create duplicate timetable rows. Response:
`{"imported":3,"sourceEntries":2}`.
Errors: HTTP 400 `{"errors":[{"row":1,"message":"..."}]}`. Rows numbered
starting at 1. The entire import is validated before writing.

Importing other teachers' schedules is a privileged operation. The importing user
must be TEACHER and their email must be in backend environment variable
`SCHEDULE_IMPORT_ALLOWED_EMAILS=teacher@example.org` (comma-separated; disabled by default).
`teacherEmail` must refer to a **registered teacher**; otherwise that row is
rejected. When it is absent, `teacherName` is stored for display. If that exact name has
previously been linked to exactly one teacher account by the trusted provisioning
script, the importer preserves/reuses its `teacherId` on repeated imports.
Unlinked names cannot be offered to a teacher account yet.
Do not place this allowlist or admin credentials in frontend JavaScript.

API import rejects PE rows with HTTP 400 and a row error. Existing older PE
records in local databases are preserved for audit but filtered out of lesson
lists, attendance history, statistics, and Telegram reminders/missed alerts.
Teacher creation, QR marking and XLSX export for PE are not supported.

The backend currently accepts Express's default ~100 KB JSON request body limit.
Split large exports into smaller files.

## 3. Schedule suggestions — Zhenya / Dasha

PE does not appear in `/api/schedule/current`, `/suggestions` or
`/available-lessons`, in the teacher's lesson list or discipline dropdown.
Students will not be asked to scan QR for physical education.


`GET /api/schedule/suggestions` (TEACHER or STUDENT)

Returns `{"suggestions":[...]}` for starts no later than **now + 30 minutes**
and ends later than now. Students see their own group. Teachers see entries linked
to their account by `teacherEmail` at import or by the trusted provisioning scripts. Each item includes:
`id`, `scheduleEntryId`, `canonicalScheduleId`,
`discipline`, `teacherId`, `teacherName`, `classroom`,
`groups: [{id,name}]`, `startsAt`, `endsAt`.

For existing student-site 15-minute notification, legacy
`GET /api/schedule/current` remains unchanged. Thirty-minute suggestions are
**not** permission to check in early: `POST /api/attendance/:id/mark` still
uses the actual lesson start time.

Teacher chooses a suggestion:
`POST /api/schedule/:id/start` (TEACHER; optional JSON `{"classroomId": 123}`).
Response `{"lessonId":42,"created":true}`. Repeating the same start returns
`{"lessonId":42,"created":false}`. If more than one registered classroom has
the same name, HTTP 409 returns `{"classrooms":[{"id":...,"building":...}]}`;
show these choices to the teacher and retry with `classroomId`.
If the discipline is missing from reference data, add it to the reference seed
first or return an actionable UI error.

**Frontend:** let users dismiss suggestions locally; this must not mutate
their student group or the source timetable. Present multiple suggestions as a list.

## 4. Choosing another lesson / cross-group guest attendance — Zhenya / Dasha

`GET /api/schedule/available-lessons` (STUDENT)
returns currently running actual lessons for which the student is **eligible**:
own group, participating group of a shared lecture, or one-time teacher-approved
guest. No unauthorized lessons are offered.

Teacher can authorize an individual student's visit to a different group's lesson:
`POST /api/lessons/:id/guests` (TEACHER of the lesson), JSON:
`{"studentEmail":"student@example.org"}`.
Returns `{"lessonId":42,"studentId":51,"allowed":true}`.
`GET /api/lessons/:id/guests` lists invited students, only to the owner.
Student then sees the allowed lesson in `available-lessons` and may select
and scan its QR **during that lesson's active period**. Existing
`POST /api/attendance/:lessonId/mark` accepts such a permitted guest.
One-time guest authorization **does not update `User.groupId`** or the
original schedule. The student's record appears in the teacher's lesson
attendance list and in student history, but does not retroactively change
the group's scheduled-lesson statistics.

For other groups' classes not shared and not individually authorized, don't
offer them as selectable. A different policy would need agreement and changes
to security rules.

## Creating and linking teacher accounts (backend operator only)

Public `/api/auth/register` allows STUDENT accounts only. Provision teacher
accounts from a trusted terminal while connected to the correct development DB:

- `npx.cmd tsx scripts/createTeacher.ts` creates a TEACHER and offers a numbered,
  **exact** `teacherName` from already imported timetable entries; enter 0 to
  create a test teacher without linking. Confirm with `ДА` before linking.
  Account creation and link are one DB transaction (rollback on failure).
- `npx.cmd tsx scripts/linkTeacherSchedule.ts` links an **existing** TEACHER
  account to a chosen unassigned timetable name. Useful for test teachers that
  were created before the import. It refuses to overwrite an existing assignment.
- Always inspect the intended teacher-name selection before confirming. Names in
  the imported timetable use initials; do not guess an identity from just a surname.
- Neither script generates new passwords for existing accounts. The creation
  script displays a one-time random password: hand it to that teacher securely,
  never save it to a shared spreadsheet, chat, or source control.
- These scripts update only entries with an **exact matching `teacherName`**
  in the currently connected DB. Confirm `DATABASE_URL` before running.
  Timetable rows with no teacher name require manual source review.

## Rollout and checks

1. Apply both Prisma migrations, then `npx.cmd prisma generate`.
2. `npm.cmd run build`; `npx.cmd tsx scripts/smokeXlsxExport.ts`.
3. Log in with allowed TEACHER account; upload the sample file twice and verify
   same timetable rows, then try invalid date and unknown teacher email.
4. Test student vs teacher suggestions, ownership, and 30-minute boundary.
5. Start an imported teacher suggestion twice and verify same lesson ID.
6. Test guest: student 4515 is denied another group's QR before invitation,
   allowed after teacher's invitation; permanent group remains 4515.
7. Confirm download has no tokens/passwords and totals match completed lessons.
8. Full integrated browser/device tests require live PostgreSQL, Redis,
   frontend and a device/HTTPS for WebAuthn.

Backend has not been executed against the real team's database by this change.
Review migrations and test on a local or staging copy before merging.
