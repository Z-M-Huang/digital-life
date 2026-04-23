#!/bin/sh
set -eu

if [ "${DIGITAL_LIFE_RUN_MIGRATIONS:-true}" != "false" ]; then
  bun run db:migrate
fi

exec "$@"
