#!/bin/sh
MASTER_HOST=${REDIS_MASTER_HOST:-redis}
MASTER_PORT=${REDIS_MASTER_PORT:-6379}
QUORUM=${SENTINEL_QUORUM:-2}

cat > /tmp/sentinel.conf << EOF
port 26379
sentinel monitor mymaster ${MASTER_HOST} ${MASTER_PORT} ${QUORUM}
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
sentinel parallel-syncs mymaster 1
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
EOF

if [ -n "${REDIS_PASSWORD}" ]; then
  echo "sentinel auth-pass mymaster ${REDIS_PASSWORD}" >> /tmp/sentinel.conf
fi

echo "Starting sentinel → master at ${MASTER_HOST}:${MASTER_PORT} (quorum ${QUORUM})"
exec redis-sentinel /tmp/sentinel.conf
