# Smart Attendance API

Base URL:

http://localhost:3000

## Authentication

После регистрации Backend возвращает данные созданного пользователя без JWT. Для получения JWT необходимо выполнить POST /api/auth/login.

Для защищённых запросов:

Authorization: Bearer <token>

---

## Auth

### POST /api/auth/register

Регистрация пользователя.

### POST /api/auth/login

Вход пользователя.

Возвращает JWT-токен.

---

## Lessons

### GET /api/lessons

Получить список занятий преподавателя.

Доступ: TEACHER.

### POST /api/lessons

Создать занятие.

Доступ: TEACHER.

### PATCH /api/lessons/:id/finish

Завершить занятие.

Доступ: TEACHER.

### POST /api/lessons/:id/qr

Сгенерировать новый QR-код занятия.

Доступ: TEACHER.

QR действует 15 секунд.

При генерации нового QR предыдущий QR становится недействительным.

### POST /api/lessons/:id/qr/validate

Проверить QR-код занятия.

Доступ: авторизованный пользователь.

---

## Attendance

### POST /api/attendance/:id/mark

Отметить посещение по QR.

Доступ: STUDENT.

### GET /api/attendance/history

Получить историю посещений текущего студента.

Доступ: STUDENT.

### GET /api/attendance/stats

Получить статистику посещаемости текущего студента.

Доступ: STUDENT.

### PATCH /api/attendance/:id/checks

Сохранить результаты проверок посещения.

Проверки:

- faceChecked
- deviceChecked
- locationChecked

Доступ: STUDENT.

### GET /api/attendance/lesson/:id

Получить посещаемость конкретного занятия.

Доступ: TEACHER.

### GET /api/attendance/suspicious

Получить подозрительные отметки.

Доступ: TEACHER.

### PATCH /api/attendance/:id/approve

Подтвердить подозрительную отметку.

Доступ: TEACHER.

### PATCH /api/attendance/:id/reject

Отклонить отметку.

Доступ: TEACHER.

---

## Teacher statistics

### GET /api/attendance/teacher/stats

Общая статистика преподавателя.

Доступ: TEACHER.

### GET /api/attendance/teacher/lessons/stats

Статистика посещаемости по занятиям.

Доступ: TEACHER.

### GET /api/attendance/teacher/groups/stats

Статистика посещаемости по группам.

Доступ: TEACHER.

---

## Service

### GET /api/health

Проверка работы Backend.

### GET /api/db-test

Проверка подключения к базе данных.

---

## Roles

### STUDENT

Доступ к:

- истории посещений;
- своей статистике;
- отметке посещения;
- проверке QR;
- результатам своих проверок.

### TEACHER

Доступ к:

- своим занятиям;
- созданию и завершению занятий;
- генерации QR;
- спискам посещаемости;
- подозрительным отметкам;
- подтверждению и отклонению отметок;
- аналитике.

Пользователь не должен получать данные, которые относятся к другой роли или другому пользователю.
# Примеры запросов

## Регистрация

POST /api/auth/register

Content-Type: application/json

{
  "email": "student@example.com",
  "password": "Student123!",
  "firstName": "Иван",
  "lastName": "Иванов",
  "role": "STUDENT",
  "groupId": 1
}

---

## Вход

POST /api/auth/login

Content-Type: application/json

{
  "email": "student@example.com",
  "password": "Student123!"
}

Ответ:

{
  "token": "<JWT_TOKEN>"
}

После входа токен используется в защищённых запросах:

Authorization: Bearer <JWT_TOKEN>

---

## Проверка авторизации

GET /api/protected

Authorization: Bearer <JWT_TOKEN>

Ответ:

{
  "message": "Access granted",
  "user": {
    "userId": 1,
    "role": "STUDENT"
  }
}
---

## Создание занятия

POST /api/lessons

Authorization: Bearer <TEACHER_TOKEN>

Content-Type: application/json

Пример:

{
  "discipline": "Математика",
  "groupId": 1,
  "classroomId": 1,
  "startsAt": "2026-11-05T10:00:00",
  "endsAt": "2026-11-05T11:30:00"
}
Поле `discipline` обязательно при создании занятия.
Оно должно содержать непустое название дисциплины.

Название сохраняется в базе данных и возвращается
в объекте занятия.
---

## Генерация QR

POST /api/lessons/:id/qr

Authorization: Bearer <TEACHER_TOKEN>

Пример:

POST /api/lessons/4/qr

Ответ:

{
  "message": "QR generated",
  "qrToken": "<QR_TOKEN>",
  "qrExpiresAt": "<DATE>"
}

QR действует 15 секунд.

При генерации нового QR предыдущий QR становится недействительным.

---

## Проверка QR студентом

POST /api/lessons/:id/qr/validate

Authorization: Bearer <STUDENT_TOKEN>

Content-Type: application/json

Пример:

{
  "qrToken": "<QR_TOKEN>"
}

Успешный ответ:

{
  "valid": true,
  "message": "QR code is valid",
  "lessonId": 4
}

---

## Отметка посещения

POST /api/attendance/:id/mark

Authorization: Bearer <STUDENT_TOKEN>

Content-Type: application/json

Пример:

{
  "qrToken": "<QR_TOKEN>"
}

Успешная отметка создаёт запись посещения.

После успешного сканирования действующего QR-кода
Backend создаёт запись посещения со статусом PENDING.

Для отметки Frontend передаёт только qrToken.

Backend проверяет:
- авторизацию и роль STUDENT;
- существование и незавершённость занятия;
- принадлежность студента к группе занятия;
- действительность QR-токена;
- отсутствие повторной отметки.

Возможные статусы посещения:

- PENDING — отметка создана, ожидает проверки.
- PRESENT — посещение подтверждено.
- LATE — посещение подтверждено с опозданием.
- REJECTED — отметка отклонена.

Сейчас преподаватель может вручную подтвердить
или отклонить отметку через API approve и reject.

Безопасное автоматическое подтверждение на основе
проверок устройства, геолокации и лица
пока не реализовано.
---

## История посещений студента

GET /api/attendance/history

Authorization: Bearer <STUDENT_TOKEN>

Ответ содержит массив attendances с существующими
записями посещаемости текущего студента.

Каждая запись содержит:
- id — идентификатор отметки;
- lessonId — идентификатор занятия;
- status — статус посещения;
- markedAt — время отметки;
- rejectionReason — причина отклонения;
- lesson — информация о занятии, включая
  дисциплину, группу и аудиторию.

ВАЖНО: Если студент не отмечался на занятии,
запись Attendance не создаётся.

Поэтому полностью пропущенные занятия
сейчас не отображаются в истории.

Отдельный API для получения пропущенных
занятий пока не реализован.

---

## Пропущенные занятия студента

GET /api/attendance/missed

Доступ: STUDENT, требуется JWT.

Authorization: Bearer <STUDENT_TOKEN>

Возвращает завершённые занятия группы студента,
для которых у него вообще нет записи Attendance.

Пример ответа:

{
  "missedLessons": [
    {
      "id": 5,
      "discipline": "Базы данных",
      "startsAt": "2026-11-06T10:00:00.000Z",
      "endsAt": "2026-11-06T11:30:00.000Z",
      "finishedAt": "2026-11-06T11:30:00.000Z",
      "group": {
        "id": 1,
        "name": "Тестовая группа"
      },
      "classroom": {
        "id": 1,
        "name": "Аудитория 101"
      }
    }
  ]
}

Пример содержит условные данные.
Поле discipline может быть null у старых занятий.

Если таких занятий нет, возвращается:

{
  "missedLessons": []
}

Важно:

- PENDING и REJECTED сюда не включаются,
  поскольку для них уже существует запись Attendance.
- Эти статусы можно получить через
  GET /api/attendance/history.
- Количество элементов missedLessons не всегда
  совпадает с показателем missedLessons в статистике.

---

## Статистика студента

GET /api/attendance/stats

Authorization: Bearer <STUDENT_TOKEN>

Ответ содержит:

- totalLessons
- attendedLessons
- missedLessons
- rejectedLessons
- attendancePercentage

### Правила расчёта статистики

Статистика рассчитывается только по завершённым
занятиям учебной группы студента.

- totalLessons — общее количество завершённых занятий.
- attendedLessons — занятия со статусом PRESENT или LATE.
- missedLessons — занятия без подтверждённого присутствия.
- rejectedLessons — занятия со статусом REJECTED.
- attendancePercentage — процент подтверждённых посещений.

ВАЖНО:

Статус PENDING пока не считается подтверждённым
посещением и учитывается в missedLessons.

Занятия со статусом REJECTED также входят
в missedLessons и отдельно в rejectedLessons.

Поэтому missedLessons не обязательно означает,
что студент действительно отсутствовал.

Если завершённых занятий пока нет,
все показатели равны нулю.
---

## Teacher API

### Получить свои занятия

GET /api/lessons

Authorization: Bearer <TEACHER_TOKEN>

Ответ:

{
  "lessons": [...]
}

---

### Получить посещаемость занятия

GET /api/attendance/lesson/:id

Authorization: Bearer <TEACHER_TOKEN>

Ответ содержит:

- список посещений;
- студента;
- статус;
- время отметки;

- `absentStudents` — список студентов, у которых нет подтверждённого присутствия (`PRESENT` или `LATE`).

В `absentStudents` могут попадать:
- студенты без отметки;
- студенты со статусом `PENDING`;
- студенты со статусом `REJECTED`.

Важно: `absentStudents` не означает, что все перечисленные студенты действительно отсутствовали.

При отображении посещаемости Frontend должен учитывать статусы записей из `attendances` и не дублировать студентов по ID.

---

### Получить подозрительные отметки

GET /api/attendance/suspicious

Authorization: Bearer <TEACHER_TOKEN>

Подозрительной считается отметка, у которой одна или несколько проверок не пройдены.

---

### Подтвердить посещение

PATCH /api/attendance/:id/approve

Authorization: Bearer <TEACHER_TOKEN>

Пример:

PATCH /api/attendance/3/approve

После подтверждения преподавателем:

- status = PRESENT — если студент отметился вовремя.
- status = LATE — если студент отметился после начала занятия.
- reviewed = true — отметка проверена преподавателем.
- reviewedAt — дата и время проверки.
- rejectionReason = null — причина отклонения очищается.
---

### Отклонить посещение

PATCH /api/attendance/:id/reject

Authorization: Bearer <TEACHER_TOKEN>

Content-Type: application/json

Пример:

{
  "rejectionReason": "Студент не прошёл проверку"
}

После отклонения:

- status = REJECTED
- reviewed = true
- rejectionReason содержит причину

---

## Teacher statistics

### Общая статистика

GET /api/attendance/teacher/stats

Authorization: Bearer <TEACHER_TOKEN>

Ответ:

{
  "totalLessons": 0,
  "totalStudents": 0,
  "attendedStudents": 0,
  "attendancePercentage": 0
}

---

### Статистика по занятиям

GET /api/attendance/teacher/lessons/stats

Authorization: Bearer <TEACHER_TOKEN>

Ответ содержит статистику каждого завершённого занятия:

- lessonId
- startsAt
- endsAt
- group
- classroom
- totalStudents
- attendedStudents
- attendancePercentage

---

### Статистика по группам

GET /api/attendance/teacher/groups/stats

Authorization: Bearer <TEACHER_TOKEN>

Ответ содержит:

- groupId
- groupName
- totalLessons
- totalStudents
- attendedStudents
- attendancePercentage

---

## Attendance checks

### Текущее состояние

PATCH /api/attendance/:id/checks

Доступ: STUDENT, требуется JWT.

Маршрут существует, но является временной реализацией.

Сейчас он принимает от студента значения:
- faceChecked
- deviceChecked
- locationChecked
- rejectionReason (необязательно)

Значения проверок передаются клиентом и не
подтверждаются независимой серверной проверкой.

При трёх true сервер устанавливает PRESENT
или LATE в зависимости от времени отметки.

Если хотя бы одна проверка false,
устанавливается REJECTED.

ВАЖНО: Этот маршрут нельзя использовать
для безопасного подтверждения посещаемости.
Студенческий Frontend не должен отправлять
самостоятельно сформированные результаты проверок.

### Планируемые проверки

1. Привязка и подтверждение устройства.
2. Проверка геолокации относительно аудитории.
3. Проверка лица студента.

Отдельные API для этих проверок пока
не реализованы. Их контракты необходимо
согласовать с командой.

### Доступный сценарий

После POST /api/attendance/:lessonId/mark
создаётся посещение со статусом PENDING.

Преподаватель может вручную подтвердить
или отклонить посещение:

PATCH /api/attendance/:id/approve
PATCH /api/attendance/:id/reject

Автоматическое подтверждение по результатам
трёх достоверных серверных проверок
пока не реализовано.

---

### POST /api/attendance/:id/location

Принимает JWT студента. `:id` — ID отметки, которую вернул `/mark`.

```json
{
  "latitude": 59.123,
  "longitude": 30.123,
  "accuracyMeters": 15,
  "capturedAt": "2026-11-06T15:00:00.000Z"
}
```

Backend берёт координаты аудитории из занятия. Допустимый радиус — 100 м,
погрешность — до 50 м включительно. Окно проверки — 180 секунд с `markedAt`.
Время `capturedAt` используется как дополнительный сигнал.

Ответ `200` при успешной проверке:

```json
{
  "status": "PENDING",
  "locationChecked": true,
  "reason": null,
  "captureTimeOutsideWindow": false
}
```

Если координаты за пределами радиуса или погрешность слишком большая,
Backend тоже возвращает `200`, но с `locationChecked: false` и причиной
`LOCATION_OUTSIDE_RADIUS` или `LOCATION_ACCURACY_TOO_LOW`. Отметка остаётся
`PENDING`. Преподаватель может увидеть сохранённую причину в `rejectionReason`.

`captureTimeOutsideWindow` показывает, что время получения координат,
указанное клиентом, раньше `markedAt` или позже времени обработки запроса.

Ошибки: `400` — неверные данные, `401` — запрос без действительного JWT,
`403` — нет доступа к отметке, `409` — отметка закрыта или изменилась
во время запроса, `410` — истекло окно проверки.

## WebSocket

### Подключение

ws://localhost:3000/ws?token=<JWT_TOKEN>

Для подключения необходим действующий JWT.

После успешной авторизации сервер отправляет:

{
  "type": "connected",
  "message": "WebSocket connected"
}

### События посещаемости

Backend формирует следующие события:

- attendance.created — создана новая отметка.
- attendance.updated — изменён статус отметки.

События содержат информацию о занятии,
посещении и его текущем состоянии.

### Кто получает события

В текущей реализации события посещаемости
отправляются только преподавателю,
которому принадлежит соответствующее занятие.

Студенты пока не получают обновления
посещаемости через WebSocket.

### Обновление статуса у студента

Студенческий Frontend может получать актуальный
статус через:

GET /api/attendance/history

Запрос требует JWT с ролью STUDENT.

Пока отметка имеет статус PENDING,
Frontend может периодически запрашивать
историю посещаемости.

Адресная отправка WebSocket-событий
студентам пока не реализована.


## Привязка Telegram

Backend поддерживает привязку Telegram-аккаунта
к аккаунту студента.

### POST /api/telegram/link/start

Доступ: STUDENT, требуется JWT.

Создаёт одноразовый код на 5 минут.

Ответ 200:

{
  "status": "WAITING_BOT",
  "linkUrl": "https://t.me/BOT_USERNAME?start=CODE",
  "expiresAt": "2026-11-06T19:58:55.292Z"
}

Если Telegram уже привязан — HTTP 409.

### GET /api/telegram/link/status

Доступ: STUDENT, требуется JWT.

Возможные статусы:

- NOT_STARTED — активной заявки нет;
- WAITING_BOT — ожидается обращение бота;
- AWAITING_CONFIRMATION — ожидается подтверждение студента;
- LINKED — Telegram привязан.

При AWAITING_CONFIRMATION возвращаются Telegram ID,
username, firstName и expiresAt.

### POST /api/telegram/link/confirm

Доступ: STUDENT, требуется JWT.

Подтверждает привязку Telegram-аккаунта,
ранее переданного ботом.

Тело запроса не требуется.

Ответ 200:

{
  "status": "LINKED",
  "telegram": {
    "id": "123456789",
    "username": "student_user"
  }
}

Если заявка не готова или истекла — HTTP 409
с кодом LINK_NOT_READY.

Если Telegram уже привязан — HTTP 409.


## Служебный API Telegram-бота

### POST /api/internal/telegram/link/claim

Маршрут используется Telegram-ботом для передачи
данных аккаунта при привязке к Smart Attendance.

Авторизация:

Authorization: Bearer <BOT_SERVICE_TOKEN>

BOT_SERVICE_TOKEN — отдельный секрет для взаимодействия
бота с Backend. Он хранится в переменных окружения
и не должен попадать в GitHub.

Тело запроса:

{
  "code": "ONE_TIME_CODE",
  "telegramUserId": "123456789",
  "username": "student_user",
  "firstName": "Иван"
}

Обязательные поля:
- code — одноразовый код из ссылки;
- telegramUserId — Telegram ID пользователя в виде строки.

Необязательные поля:
- username;
- firstName.

Успешный ответ — HTTP 200:

{
  "status": "AWAITING_CONFIRMATION",
  "message": "Confirm Telegram linking in Smart Attendance"
}

Ошибки:

- 400 INVALID_REQUEST — неверный формат данных;
- 401 UNAUTHORIZED_BOT — неправильный или отсутствующий токен;
- 404 LINK_CODE_INVALID — код неизвестен или истёк;
- 409 LINK_CODE_USED — код уже использован;
- 409 TELEGRAM_ALREADY_LINKED — Telegram ID уже привязан.

Если служебная авторизация не настроена,
Backend возвращает HTTP 503.

После успешного запроса Backend временно сохраняет
Telegram ID в Redis.

Окончательная привязка происходит только после
подтверждения студентом через:

POST /api/telegram/link/confirm

Важно: истёкший код сейчас возвращает 404,
а не отдельный ответ 410.

Поле User.telegramId не изменяется при link/claim.


---

## Telegram Notifications API

Backend поддерживает очередь Telegram-уведомлений в PostgreSQL.

### Типы уведомлений

- `LESSON_REMINDER` — напоминание о занятии.
- `LESSON_MISSED` — отсутствие отметки на завершённом занятии.
- `ATTENDANCE_CONFIRMED` — преподаватель подтвердил посещение.
- `ATTENDANCE_REJECTED` — преподаватель отклонил посещение.

### POST /api/internal/telegram/notifications/claim

Служебный маршрут для получения уведомлений Telegram-ботом.

Авторизация:

`Authorization: Bearer BOT_SERVICE_TOKEN`

Тело запроса:

```json
{
  "limit": 3
}
```

`limit` — целое число от 1 до 10.

При успехе возвращает HTTP 200:

```json
{
  "notifications": [
    {
      "notificationId": 1,
      "leaseToken": "temporary-processing-token",
      "telegramId": "987654321",
      "type": "LESSON_REMINDER",
      "lessonId": 7,
      "discipline": "Математика",
      "startsAt": "2026-11-07T14:00:00.000Z",
      "endsAt": "2026-11-07T15:30:00.000Z",
      "attendanceStatus": null,
      "rejectionReason": null
    }
  ]
}
```

Если уведомлений нет:

```json
{
  "notifications": []
}
```

При выдаче уведомление получает статус `PROCESSING`,
уникальный `leaseToken` и срок обработки 90 секунд.

### POST /api/internal/telegram/notifications/:id/result

Служебный маршрут для сохранения результата отправки.

Авторизация:

`Authorization: Bearer BOT_SERVICE_TOKEN`

Успешная отправка:

```json
{
  "leaseToken": "temporary-processing-token",
  "status": "SENT",
  "telegramMessageId": 12345
}
```

Неудачная отправка:

```json
{
  "leaseToken": "temporary-processing-token",
  "status": "FAILED",
  "errorCode": "TELEGRAM_429",
  "retryable": true
}
```

При успехе возвращает HTTP 200:

```json
{
  "success": true
}
```

Ошибки:

- `400 INVALID_REQUEST` — неверные данные.
- `401 UNAUTHORIZED_BOT` — неверный служебный токен.
- `409 INVALID_LEASE` — недействительный или истёкший lease.
- `500 INTERNAL_ERROR` — внутренняя ошибка.

### Повторные попытки

- Максимум 5 попыток отправки.
- Временная ошибка возвращает уведомление в `PENDING`.
- Задержка между попытками увеличивается.
- Постоянная ошибка переводит уведомление в `FAILED`.
- Успешная отправка переводит уведомление в `SENT`.
- Истёкшая пятая попытка закрывается как `FAILED` при следующем запросе очереди.

### Автоматический планировщик

По умолчанию выключен.

Переменные окружения:

```dotenv
TELEGRAM_NOTIFICATION_SCHEDULER_ENABLED=false
TELEGRAM_NOTIFICATION_SCHEDULER_DRY_RUN=false
```

При включении планировщик проверяет расписание каждую минуту.

Напоминания создаются для занятий, начинающихся
в ближайшие 15 минут.

Уведомления о пропусках создаются для завершённых
занятий за последние 10 минут, если у студента
отсутствует запись посещения.

Режим DRY_RUN используется для проверки запуска
без создания уведомлений.
