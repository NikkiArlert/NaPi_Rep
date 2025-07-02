@echo off
title Запуск бота + сервера + webapp

start cmd /k "node index.js"
start cmd /k "node server.js"
start cmd /k "cd webapp && npm run dev"