# Convert weekly GUAP schedule into dated sessions

1. Verify the up-to-date schedule for each group 4514–4517 and identify **one real Monday of an ▲ (upper) week**.
2. Copy `data/weekly-schedule-4514-4517.example.json` to `data/weekly-schedule-4514-4517.json`.
3. Change `from`, `through`, and `upperWeekMonday`. The example date in `upperWeekMonday` is **a placeholder, not a verified week**.
4. Enter each weekly class once into the `entries` array. `weekday`: 1=Monday to 7=Sunday. `week`: `every`, `upper` (▲), or `lower` (▼).
5. For shared lectures repeat the entry per group. Leave out out-of-grid sessions unless an actual date is known.

An example of **format only** (not a verified class):
```json
{
  "group": "4514", "weekday": 1,
  "start": "15:10", "end": "16:40",
  "week": "every", "discipline": "Пример дисциплины",
  "classroom": "Пример аудитории"
}
```

Then run:
```powershell
npx.cmd tsx scripts/expandWeeklySchedule.ts
npx.cmd tsx scripts/importSchedule.ts data/schedule-4514-4517.json
```

The first command generates dated JSON in Saint Petersburg time (+03:00), the second upserts it into the database. Do not run until both the weekly entries and upper-week anchor have been verified.
