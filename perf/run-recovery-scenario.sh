#!/bin/bash
# npm run artillery -- run perf/scenarios/recovery.yaml -e api &

sleep 35
echo "Simulando caída de la API..."
docker-compose stop api

sleep 20
echo "La API vuelve a levantarse..."
docker-compose start api

wait
echo "Escenario de recuperación finalizado"
