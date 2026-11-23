# Shared teacher lessons (4514–4517)

One teacher lesson can accept attendance from several student groups using the **same QR**.

## Create a lesson

Existing request remains supported:
```json
{
  "discipline": "Теория вероятностей",
  "groupId": 1,
  "classroomId": 4,
  "startsAt": "2026-11-24T15:10:00+03:00",
  "endsAt": "2026-11-24T16:40:00+03:00"
}
```

For a shared lecture, send optional `groupIds` including the primary group if desired:
```json
{
  "discipline": "Теория вероятностей",
  "groupId": 1,
  "groupIds": [1, 2, 3, 4],
  "classroomId": 4,
  "startsAt": "2026-11-24T15:10:00+03:00",
  "endsAt": "2026-11-24T16:40:00+03:00"
}
```
All IDs are **database IDs** obtained from `GET /api/groups`, not group names. These numbers are illustrative only. The total number of distinct groups (primary `groupId` plus `groupIds`) is limited to **four**; a fifth group returns HTTP 400.

The primary group is in `Lesson.groupId` for compatibility with old clients, other groups are in `LessonGroup`. The backend validates all groups and prevents overlaps with existing single- or multi-group lessons, classrooms or teacher times.

- `GET /api/lessons` continues returning `group` and adds `lessonGroups` for extra groups.
- `GET /api/attendance/lesson/:id` includes all participating groups in absent-student list.
- Student attendance uses the real teacher `Lesson.id` from the scanned QR. All participating groups can mark their own attendance with this **one** lesson ID, but outsiders cannot.
- Student history, missing classes, stats, teacher per-lesson and per-group stats include shared attendance.
- Telegram recipients include all participating groups. PR #13 changes the **timing** of missed-notification scheduling independently; reconcile these changes before merging to `feature-backend`.

### Frontend handoff

Teacher creation form: keep the existing single-group selection for ordinary lessons; add multi-select of groups only when a shared lecture is created. No additional QR implementation is required. Student upcoming schedule card still links to the current QR scanner: scheduleEntry.id is **not** Lesson.id.

### Review requirements

- Prisma migration creates `LessonGroup` without deleting old `Lesson` rows.
- Confirm `npm.cmd run build`.
- Verify one shared lesson for groups 4514 and 4515 allows both, but rejects students from a third group.
- Confirm teacher absent lists and stats consider both groups.
- Run `npx.cmd tsx scripts/smokeSharedLectures.ts` to check HTTP creation, shared QR permissions, duplicate rejection, group-specific history, teacher decision, and summary statistics. The script creates temporary data and removes it afterwards.
- Confirm one reminder and missed notification per eligible student.
- Existing one-group lesson must still work.
