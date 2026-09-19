# A4PRINT KASSA Desktop

Windows-оболочка для рабочей A4PRINT KASSA 2.1.

## Разработка
`npm install`
`npm start`

## Windows installer
Поместить фирменную иконку брендбука A4-Касса в `assets/kassa.ico`, затем:
`npm run dist:win`

Результат: `release/A4PRINT-KASSA-Setup-2.1.0.exe`.

Приложение использует production KASSA по адресу https://a4print-hub.ru/kassa/ и сохраняет существующую архитектуру HUB/МойСклад и локальную очередь браузерного профиля Electron.
