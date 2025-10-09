#!/bin/bash
npm install -g artillery-plugin-statsd
npm run artillery -- run scenarios/recovery.yaml -e api &

sleep 35
echo "Simulando caída de la API..."
docker compose stop api

sleep 20
echo "La API vuelve a levantarse..."
docker compose start api

wait
echo "Escenario de recuperación finalizado"
