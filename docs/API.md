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

Устаревший маршрут. С действующим JWT возвращает HTTP 410 и не изменяет отметку.
Запрос без действующего JWT получает HTTP 401.


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

`PATCH /api/attendance/:id/checks` отключён для записи результатов.
С действующим JWT маршрут возвращает HTTP 410, без действующего JWT — HTTP 401.
Переданные в запросе результаты не меняют статус отметки.


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