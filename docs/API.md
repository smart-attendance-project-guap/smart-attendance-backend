# Smart Attendance API

Base URL:

http://localhost:3000

## Authentication

После регистрации или входа Backend возвращает JWT-токен.

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
  "groupId": 1,
  "classroomId": 1,
  "startsAt": "2026-10-01T10:00:00",
  "endsAt": "2026-10-01T11:30:00"
}

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

Статус может быть:

- PRESENT
- LATE
- REJECTED

---

## История посещений студента

GET /api/attendance/history

Authorization: Bearer <STUDENT_TOKEN>

Ответ содержит список посещений текущего студента.

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
- список отсутствующих студентов.

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

После подтверждения:

- status = PRESENT
- reviewed = true

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

### Сохранение результатов проверок

PATCH /api/attendance/:id/checks

Authorization: Bearer <STUDENT_TOKEN>

Content-Type: application/json

Пример:

{
  "faceChecked": true,
  "deviceChecked": true,
  "locationChecked": true
}

Если все три проверки пройдены:

status = PRESENT

Если хотя бы одна проверка не пройдена:

status = REJECTED

Можно передать причину:

{
  "faceChecked": true,
  "deviceChecked": false,
  "locationChecked": true,
  "rejectionReason": "Устройство не прошло проверку"
}
