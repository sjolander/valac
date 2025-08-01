#!/bin/bash
set -e

echo "Starting Valac environment setup..."

# Build and start all containers in detached mode
docker-compose up --build -d

echo "Valac containers started successfully."
echo "Use 'docker-compose logs -f' to watch logs."