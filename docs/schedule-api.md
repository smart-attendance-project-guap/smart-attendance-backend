# Student upcoming lesson suggestion — frontend contract

The authenticated student sees **only the current lesson suggestion**, never the weekly timetable.

## API

`GET /api/schedule/current`
`Authorization: Bearer <student JWT>`

Response:
```json
{
  "lessons": [
    {
      "id": 42,
      "discipline": "Алгоритмы и структуры данных",
      "classroom": "53-07 (Б. Морская 67)",
      "teacherName": "Чернышев С.А.",
      "startsAt": "2026-11-24T18:40:00.000Z",
      "endsAt": "2026-11-24T20:10:00.000Z"
    }
  ]
}
```

- `lessons` is `[]` when no suitable lesson is within the visibility window; no manual timetable searching.
- Results are limited to the current student's `groupId`, from 15 minutes before the session start until its scheduled end.
- `id` is a **ScheduleEntry ID**, not the actual teacher Lesson ID. Never send it as `lessonId` to attendance endpoints.
- Dates are ISO UTC in API; display them in Europe/Moscow or convert to the student's device time as appropriate. Backend schedule was imported with +03:00 offsets.
- Re-fetch every 60 seconds while student dashboard is open; refetch when the tab becomes active.
- If multiple suggestions exist, let the student choose a card. Do not show the entire week's schedule.
- Before lesson starts, show the upcoming card but do not imply QR marking can already succeed. Backend accepts a QR only during the teacher's actual Lesson.
- Card's `Отметить посещение` button can navigate to the already-existing `/student/attendance` scanner. QR itself carries the real `lessonId` and `qrToken`; the scanner submits those to `POST /api/attendance/:lessonId/mark`.
- Schedule is **informational**: it does not create teacher Lessons, QR tokens or attendance automatically.

Known integration limitation: teacher's Lesson presently accepts only one `groupId`, even for lectures shared by 4514–4517. Multi-group QR needs a separate backend change before shared-lecture end-to-end tests.
