#!/bin/bash
set -eu

key="${MONGO_REPLICA_KEY:?MONGO_REPLICA_KEY is required}"
if [ "${#key}" -lt 32 ] || [ "${#key}" -gt 1024 ]; then
    echo "MONGO_REPLICA_KEY must contain 32 to 1024 base64 characters" >&2
    exit 1
fi
case "$key" in
    *[!A-Za-z0-9+/=]*)
        echo "MONGO_REPLICA_KEY must contain only base64 characters" >&2
        exit 1
        ;;
esac
install -d -m 0700 -o mongodb -g mongodb /run/mongo-replica
umask 077
printf '%s' "$key" > /run/mongo-replica/key
chown mongodb:mongodb /run/mongo-replica/key
chmod 0400 /run/mongo-replica/key
unset key MONGO_REPLICA_KEY
exec /usr/local/bin/docker-entrypoint.sh "$@"
