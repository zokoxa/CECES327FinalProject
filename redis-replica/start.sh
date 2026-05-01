#!/bin/sh
MASTER_HOST=${REDIS_MASTER_HOST:-redis}
MASTER_PORT=${REDIS_MASTER_PORT:-6379}

echo "Starting replica → master at ${MASTER_HOST}:${MASTER_PORT}"
exec redis-server --bind 0.0.0.0 --replicaof ${MASTER_HOST} ${MASTER_PORT}
