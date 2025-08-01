#!/bin/bash
set -e

echo "Stopping and removing Valac containers..."

# Stop and remove containers with 'valac-' prefix
docker ps -a --filter "name=valac-" --format "{{.ID}}" | while read cid; do
  docker rm -f "$cid"
done

# Remove volumes named with 'valac-' prefix
docker volume ls --format "{{.Name}}" | grep '^valac-' | while read vol; do
  docker volume rm "$vol"
done

echo "Done."