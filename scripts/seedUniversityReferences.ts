
import "dotenv/config";
import { prisma } from "../src/prisma.js";

// Координаты корпусов приблизительные.
// Они НЕ являются точными координатами аудиторий.
const buildings = [
    {
        name: "Большая Морская",
        address: "Санкт-Петербург, ул. Большая Морская, 67",
        latitude: 59.929561,
        longitude: 30.296671,
        rooms: [
            "52-17",
            "52-18",
            "52-19",
            "53-07",
            "53-09",
            "22-15",
        ],
    },
    {
        name: "Гастелло",
        address: "Санкт-Петербург, ул. Гастелло, 15",
        latitude: 59.85765,
        longitude: 30.327736,
        rooms: [
            "32-02",
            "12-04",
            "24-05",
            "31-02",
        ],
    },
    {
        name: "Ленсовета",
        address: "Санкт-Петербург, ул. Ленсовета, 14",
        latitude: 59.855771,
        longitude: 30.33024,
        rooms: [
            "24-06",
            "12-14",
            "22-09",
        ],
    },
];

const disciplines = [
    "Экономика",
    "Информационное право",
    "Компьютерная графика",
    "Алгоритмы и структуры данных",
    "Основы проектной деятельности",
    "Теория вероятностей",
    "Основы программирования",
];

async function main() {
    console.log("Заполнение справочников ГУАП...\n");


    // Добавляем учебные группы
    const groupNames = ["4514", "4515", "4516", "4517"];

    for (const name of groupNames) {
        await prisma.group.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }

    console.log(`Учебные группы готовы: ${groupNames.join(", ")}`);


    // Добавляем корпуса и аудитории
    for (const buildingData of buildings) {
        const building = await prisma.building.upsert({
            where: { name: buildingData.name },
            update: { address: buildingData.address },
            create: {
                name: buildingData.name,
                address: buildingData.address,
            },
        });

        for (const room of buildingData.rooms) {
            // Ищем аудиторию в нужном корпусе
            let classroom = await prisma.classroom.findFirst({
                where: {
                    name: room,
                    buildingId: building.id,
                },
            });

            // Проверяем старые аудитории без корпуса
            if (!classroom) {
                classroom = await prisma.classroom.findFirst({
                    where: {
                        name: room,
                        buildingId: null,
                    },
                });
            }

            if (classroom) {
                // Сохраняем имеющиеся координаты
                await prisma.classroom.update({
                    where: { id: classroom.id },
                    data: { buildingId: building.id },
                });
            } else {
                await prisma.classroom.create({
                    data: {
                        name: room,
                        buildingId: building.id,
                        latitude: buildingData.latitude,
                        longitude: buildingData.longitude,
                    },
                });
            }
        }

        console.log(
            `${buildingData.name}: ${buildingData.rooms.length} аудиторий`
        );
    }

    // Добавляем предметы
    for (const name of disciplines) {
        await prisma.discipline.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }

    console.log(`\nПредметов: ${disciplines.length}`);

    // Проверяем результат
    console.log("\nПРОВЕРКА БАЗЫ:");


    console.log(
        "Учебных групп:",
        await prisma.group.count({
            where: { name: { in: groupNames } },
        })
    );


    console.log(
        "Корпусов:",
        await prisma.building.count({
            where: {
                name: { in: buildings.map((b) => b.name) },
            },
        })
    );

    const savedRooms = await prisma.classroom.count({
        where: {
            OR: buildings.map((b) => ({
                name: { in: b.rooms },
                building: { name: b.name },
            })),
        },
    });

    console.log("Аудиторий:", savedRooms);

    console.log(
        "Предметов:",
        await prisma.discipline.count({
            where: { name: { in: disciplines } },
        })
    );

    console.log("\nГотово!");
}

main()
    .catch((error) => {
        console.error("Ошибка:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
