
# Smart Attendance — Backend

Backend системы контроля посещаемости студентов.

## Технологии

- Node.js, Express, TypeScript
- PostgreSQL, Prisma 7
- Redis (Memurai для Windows)
- JWT
- WebSocket

## 1. Необходимые программы

Перед запуском установите:

- Node.js
- Git
- PostgreSQL
- Memurai (совместимый с Redis сервер для Windows)

## 2. Получение проекта

Откройте PowerShell и выполните:

```powershell
git clone -b feature-backend https://github.com/smart-attendance-project-guap/smart-attendance-backend.git
cd smart-attendance-backend
npm.cmd install
```

## 3. Настройка базы данных

Откройте pgAdmin и создайте базу данных с именем:

`smart_attendance`

Создайте в корне проекта файл `.env`, скопировав содержимое `.env.example`.

Укажите свои настройки:

```dotenv
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/smart_attendance?schema=public"
JWT_SECRET="REPLACE_WITH_YOUR_OWN_LONG_RANDOM_SECRET"
```

Замените `YOUR_PASSWORD` на пароль пользователя PostgreSQL. Если пароль содержит специальные символы, их необходимо закодировать для URL.

Для JWT используйте собственный длинный случайный секрет.

Не публикуйте файл `.env` и не отправляйте свои пароли другим участникам.

## 4. Подготовка Prisma

Выполните в терминале проекта:

```powershell
npx.cmd prisma migrate deploy --config prisma7.config.ts
npx.cmd prisma generate --config prisma7.config.ts
```

Команды создадут таблицы по существующим миграциям и сгенерируют Prisma Client.

## 5. Запуск Redis

В Windows используется Memurai.

Откройте PowerShell от имени администратора:

```powershell
Start-Service -Name Memurai
```

Проверьте состояние службы:

```powershell
Get-Service -Name Memurai
```

Статус должен быть `Running`.

## 6. Запуск Backend

Вернитесь в терминал проекта и выполните:

```powershell
npm.cmd run dev
```

Ожидаемый результат:

```text
Redis connected
Backend started on http://localhost:3000
WebSocket available at ws://localhost:3000/ws
```

Для проверки откройте:

http://localhost:3000/api/health

Ожидаемый ответ:

```json
{
  "status": "ok",
  "message": "Backend is running"
}
```

## 7. Подключение Frontend

Backend работает по адресу:

`http://localhost:3000`

Для Frontend настроен CORS с адресом:

`http://localhost:3001`

Используйте эти адреса для локальной интеграции.

## 8. Документация API

Описание маршрутов находится в файле:

`docs/API.md`

Для защищённых запросов сначала необходимо авторизоваться и получить JWT.

## Важно

- Каждый участник использует собственную локальную тестовую базу данных.
- Для работы Backend должны быть запущены PostgreSQL и Memurai.
- Не добавляйте настоящие пароли и токены в GitHub.
- Рабочая ветка Backend: `feature-backend`.
