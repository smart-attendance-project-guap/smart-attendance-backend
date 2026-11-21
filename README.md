
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

### Настройка WebAuthn

Для локального запуска студенческого frontend на `http://localhost:3001`
добавьте в `.env`:

```dotenv
WEBAUTHN_ORIGIN=http://localhost:3001
WEBAUTHN_RP_ID=localhost
```

`WEBAUTHN_ORIGIN` — адрес страницы frontend со схемой и портом.
`WEBAUTHN_RP_ID` — домен для ключей WebAuthn, без схемы и порта.
На рабочем стенде используйте HTTPS и параметры домена frontend.


## 8. Документация API

Описание маршрутов находится в файле:

`docs/API.md`

Для защищённых запросов сначала необходимо авторизоваться и получить JWT.

## 9. Общий локальный запуск через Docker Compose

Нужен Docker Desktop с Linux containers и Docker Compose 2.17 или новее.
Команды выполняются из корня Backend. Освободите порты 3000 и 3001,
остановив предыдущие процессы Backend и frontend.

Скопируйте `.env.docker.example` в `.env.docker` и замените три
значения `replace_with_...` случайными секретами. Для пароля PostgreSQL
используйте шестнадцатеричную строку, чтобы она подходила для DATABASE_URL.
Файл `.env.docker` исключён из Git и Docker-контекста.

```powershell
docker compose --env-file .env.docker up -d --build --wait
docker compose --env-file .env.docker exec backend npx tsx scripts/seedUniversityReferences.ts
```

Frontend откроется на `http://localhost:3001`, Backend — на
`http://localhost:3000`. Миграции применяются при старте Backend.
Frontend собирается из `feature-student-frontend`, бот — из
`feature-telegram` на GitHub. Для сборки локальных изменений задайте
`FRONTEND_SOURCE` и `BOT_SOURCE` путями к соответствующим репозиториям
в `.env.docker`. Пути считаются относительно папки Backend.

База и Redis используют отдельные Docker-тома этого Compose-проекта.
Для первого входа преподавателя запустите существующий интерактивный скрипт:

```powershell
docker compose --env-file .env.docker exec backend npx tsx scripts/createTeacher.ts
```

Для Telegram заполните `BOT_TOKEN` и `BOT_USERNAME` в `.env.docker`,
остановите ранее запущенный экземпляр этого бота и выполните:

```powershell
docker compose --env-file .env.docker --profile telegram up -d --build bot
```

Обработчик бота получает задания из Backend. Автоматический планировщик
изначально выключен. Чтобы включить напоминания и пропуски, установите
`TELEGRAM_NOTIFICATION_SCHEDULER_ENABLED=true` в `.env.docker` и повторите
команду запуска Compose.

Проверка состояния и остановка стенда:

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker --profile telegram down
```

Команда `down` сохраняет данные в томах. Стенд настроен для работы
с браузером на этом компьютере через localhost.

## Важно

- Каждый участник использует собственную локальную тестовую базу данных.
- Для работы Backend должны быть запущены PostgreSQL и Memurai.
- Не добавляйте настоящие пароли и токены в GitHub.
- Рабочая ветка Backend: `feature-backend`.
