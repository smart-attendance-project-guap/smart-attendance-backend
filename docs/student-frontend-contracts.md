# Smart Attendance — студенческий Frontend: контракты Backend

Актуально для ветки `feature-reports-and-schedule-mvp`. База `http://localhost:3000`.
Все маршруты, кроме публичного получения групп и регистрации/входа,
требуют `Authorization: Bearer <JWT>` с ролью `STUDENT`.
JSON-примеры содержат **условные** ID, значения и даты.

## 1. Группа при регистрации

`GET /api/registration/groups` — без JWT.

```json
{"groups":[{"id":2,"name":"4515"},{"id":4,"name":"4516"}]}
```

Frontend предлагает выбор по `name`, а при регистрации отправляет полученный `id`.

`POST /api/auth/register` — без JWT:

```json
{
  "email":"student@example.com",
  "password":"example-password",
  "firstName":"Иван",
  "lastName":"Иванов",
  "role":"STUDENT",
  "groupId":2
}
```

Успех `201`:
```json
{
  "message":"User registered successfully",
  "user":{
    "id":51,
    "email":"student@example.com",
    "firstName":"Иван",
    "lastName":"Иванов",
    "role":"STUDENT",
    "groupId":2
  }
}
```

Сейчас Backend технически допускает отсутствие `groupId` и сохраняет `null`;
для рабочего сценария Frontend **должен требовать выбор группы**. Несуществующий
`groupId` → `400 {"message":"Group not found"}`. Регистрация не выдаёт JWT:
`POST /api/auth/login` с `{"email":"...","password":"..."}` возвращает
`{"message":"Login successful","token":"...","user":{...}}`.

## 2. История и пропуски

`GET /api/attendance/history` → `{"attendances":[...]}` с созданными
отметками. У каждой есть `id` (ID отметки), `lessonId`, `studentId`,
`status`, `markedAt`, `faceChecked`, `deviceChecked`,
`locationChecked`, `reviewed`, `reviewedAt`, `rejectionReason` и
`lesson` (дисциплина, даты, группа, аудитория и др.). Поля QR-секрета
в истории не возвращаются. Отсутствие отметки не создаёт строку Attendance.

`GET /api/attendance/missed` → занятия без отметки **и** с отклонённой
отметкой, если преподаватель завершил пару и плановый `endsAt` наступил.
`PENDING` сюда не включается:

```json
{
  "missedLessons":[{
    "id":42,
    "discipline":"Базы данных",
    "startsAt":"2026-11-26T14:00:00.000Z",
    "endsAt":"2026-11-26T15:30:00.000Z",
    "finishedAt":"2026-11-26T15:00:00.000Z",
    "group":{"id":2,"name":"4515"},
    "classroom":{"id":11,"name":"101"}
  }]
}
```

Для общего списка можно объединить `history.attendances` и
`missed.missedLessons` по `lessonId`, **не допуская дублей**.
Точный статус `REJECTED` и причина доступны через `/history`.
Физкультура исключена из этих ответов.

## 3. Создание отметки и обновление статуса

`GET /api/schedule/available-lessons` возвращает
`{"lessons":[...]}` с **реальными `Lesson.id`**, доступными текущему
студенту (своя группа, общая пара или авторизованный гость), а не ID
строки расписания.

`POST /api/attendance/:lessonId/mark`:
```json
{"qrToken":"<актуальное значение из QR>"}
```

Успех `201`:
```json
{
  "message":"Attendance marked",
  "attendance":{
    "id":78,
    "studentId":51,
    "lessonId":42,
    "status":"PENDING",
    "faceChecked":false,
    "deviceChecked":false,
    "locationChecked":false,
    "reviewed":false,
    "rejectionReason":null,
    "markedAt":"2026-11-26T14:10:00.000Z",
    "reviewedAt":null
  }
}
```

Используйте **`attendance.id`** (не `lessonId`) для проверок устройства
и геолокации. Преподаватель принимает решение: `PRESENT`, `LATE` или
`REJECTED`; успешная проверка устройства/координат сама не подтверждает отметку.

WebSocket: `ws://localhost:3000/ws?token=<JWT>`.
При подключении: `{"type":"connected","message":"WebSocket connected"}`.
Сервер отправляет студенту **только события его отметки** (и преподавателю занятия):

```json
{
  "type":"attendance.updated",
  "lessonId":42,
  "attendanceId":78,
  "studentId":51,
  "status":"PRESENT",
  "faceChecked":false,
  "deviceChecked":true,
  "locationChecked":true,
  "reviewed":true,
  "rejectionReason":null
}
```

Также приходит `attendance.created` с `type`, `lessonId`,
`attendanceId`, `studentId`, `status`, `markedAt`.
`attendance.updated` создаётся при одобрении/отклонении учителем;
проверка координат/устройства сама по себе WS не отправляет.
Если WebSocket недоступен/переподключился — перечитайте `GET /api/attendance/history`.

## 4. Геолокация

`POST /api/attendance/:attendanceId/location`, JSON:

```json
{
  "latitude":59.929561,
  "longitude":30.296671,
  "accuracyMeters":15,
  "capturedAt":"2026-11-26T14:10:20.000Z"
}
```

Координаты/точность должны быть **числами**, `capturedAt` — ISO 8601
с часовым поясом (можно `new Date(position.timestamp).toISOString()`).
Окно — **180 секунд после создания отметки**; `capturedAt` должен
попадать между `markedAt` и временем запроса. Радиус до **100 м** от
аудитории и погрешность до **50 м** включительно.

Успех `200`:
```json
{"status":"PENDING","locationChecked":true,"reason":null,"captureTimeOutsideWindow":false}
```

При неуспехе геопроверки может быть **тоже HTTP 200**:
```json
{"status":"PENDING","locationChecked":false,"reason":"LOCATION_OUTSIDE_RADIUS","captureTimeOutsideWindow":false}
```

Другие `reason`: `LOCATION_ACCURACY_TOO_LOW`,
`LOCATION_CAPTURE_TIME_OUTSIDE_WINDOW`. Ошибки: 400 неверные поля,
403 чужая отметка, 409 закрытая/изменившаяся запись,
410 `LOCATION_WINDOW_EXPIRED`. Не приравнивайте HTTP 200 к `locationChecked: true`.

## 5. Устройство WebAuthn и проверка лица

Регистрация настоящего ключа студента (с JWT):
- `POST /api/devices/webauthn/register/options` → HTTP 200
  `{"requestId":"<uuid>","options":{...}}`.
- Передайте `options` в SimpleWebAuthn `startRegistration({optionsJSON: options})`.
- `POST /api/devices/webauthn/register/verify` с JSON
  `{"requestId":"<uuid>","credential":<результат startRegistration>}`
  → HTTP 201 `{"verified":true}`.

Проверка **конкретной отметки** (в обоих маршрутах `:id` = Attendance.id):
- `POST /api/attendance/:id/device/options` → HTTP 200
  `{"requestId":"<uuid>","options":{...}}`.
- Передайте `options` в `startAuthentication({optionsJSON: options})`.
- `POST /api/attendance/:id/device/verify` с JSON
  `{"requestId":"<uuid>","credential":<результат startAuthentication>}`
  → HTTP 200 `{"verified":true,"status":"PENDING"}`.

Сервер проверяет подпись WebAuthn, привязку ключа к студенту
и одноразовый challenge. Это **не** равно распознаванию лица.
Ошибки: `409 NO_REGISTERED_CREDENTIAL` (зарегистрировать ключ),
`410 CHALLENGE_EXPIRED_OR_USED` (новые options), `400 VERIFICATION_FAILED`,
`409 ATTENDANCE_NOT_PENDING`. Срок одноразового challenge — до 120 с;
для отметки общий лимит — 180 с от `markedAt`.
Для работы необходимы корректные серверные
`WEBAUTHN_ORIGIN` и `WEBAUTHN_RP_ID`.

**Не готово:** отдельного публичного маршрута для серверной проверки
лица / сравнения лица с эталоном нет. Поле `faceChecked` в модели
присутствует, но Frontend не должен самостоятельно выставлять
`true` или имитировать успешную проверку. Старый обработчик
`updateAttendanceChecks` не подключён к роутеру и использовать его нельзя.
Учитель может вручную подтвердить `PENDING` даже если `faceChecked=false`.

## 6. Статистика

`GET /api/attendance/stats` (JWT STUDENT):

```json
{
  "totalLessons":5,
  "attendedLessons":2,
  "missedLessons":1,
  "rejectedLessons":1,
  "pendingLessons":1,
  "unmarkedLessons":1,
  "attendancePercentage":40
}
```

- `totalLessons`: пары своей группы, **завершённые преподавателем**
  (`finishedAt != null`), без физкультуры, включая досрочно завершённые.
- `attendedLessons`: подтверждённые `PRESENT` + `LATE`.
- `missedLessons`: только после **планового конца `endsAt`**
  пары без какой-либо отметки либо с `REJECTED`.
- `rejectedLessons`: все `REJECTED` завершённых пар, даже до `endsAt`.
- `pendingLessons`: `PENDING` завершённых пар, не считаются пропуском.
- `unmarkedLessons`: досрочно завершённые пары с `endsAt` в будущем
  и без отметки — предварительный статус, пока не пропуск.
- `attendancePercentage`: `round(attendedLessons / totalLessons * 100, 2)`;
  при нулевом знаменателе — 0. Не вычислять `missedLessons`
  как `totalLessons - attendedLessons` — из-за `PENDING` и `unmarkedLessons`
  эти значения отличаются.

В примере 5 завершённых преподавателем пар: 2 подтверждённые,
1 отклонённая после конца, 1 ожидающая и 1 без отметки до конца.

## Что отсутствует / ограничения MVP

- **Отдельный API реальной проверки лица**: отсутствует; не показывать
  успешную лицевую проверку без серверного подтверждения.
- **Автоматическое одобрение отметки после трёх проверок**:
  отсутствует; окончательное решение принимает преподаватель.
- **Отдельный GET одной Attendance по её ID**: не нужен для MVP;
  актуальное значение доступно через WebSocket и `/history`.
- **Самостоятельная смена группы студентом**: отдельного API нет;
  группу выбирают из `/api/registration/groups` при регистрации.

Актуальные маршруты реализованы в `src/routes` и `src/controllers`.
