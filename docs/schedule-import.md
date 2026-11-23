# Internal schedule import (4514–4517)

Schedule is stored in the backend and **is not displayed as a weekly timetable**. Student UI receives only current lesson suggestions from `GET /api/schedule/current`.

## Source data

Create `data/schedule-4514-4517.json` from the verified official GUAP schedule. Use actual dated sessions, not recurring guessed dates. For shared lectures, repeat the same session with each applicable group.

Each object must have:
- `group`: one of 4514, 4515, 4516, 4517;
- `discipline` and `classroom`: nonempty strings;
- `startsAt`, `endsAt`: ISO timestamps with **+03:00** (Saint Petersburg);
- optional `teacherName`.

Example **format only** (not an actual verified class; do not import this example):
```json
[
  {
    "group": "4514",
    "discipline": "Название предмета",
    "classroom": "Аудитория",
    "startsAt": "2026-11-23T15:10:00+03:00",
    "endsAt": "2026-11-23T16:40:00+03:00"
  }
]
```

After reviewing your source, use:
```powershell
npx.cmd prisma migrate dev
npx.cmd prisma generate
npx.cmd tsx scripts/importSchedule.ts data/schedule-4514-4517.json
npm run build
```

The importer upserts and does not duplicate existing matching sessions. It does **not delete** cancelled/changed sessions; remove stale rows separately when schedule changes. It never creates an actual teacher lesson or QR token.
