#!/bin/bash
# Sync static data seed files into the persistent volume.
# Files already present in /app/data are NOT overwritten (preserves runtime caches).
# New seed files (added in code updates) ARE copied automatically.

if [ -d /app/data_seed ]; then
    for f in /app/data_seed/*.json; do
        fname=$(basename "$f")
        if [ ! -f "/app/data/$fname" ]; then
            echo "[entrypoint] Seeding missing data file: $fname"
            cp "$f" "/app/data/$fname"
        else
            # Always update static seed files that ship with the image
            # (they may have been modified in a new release)
            seed_size=$(stat -c%s "$f" 2>/dev/null || echo 0)
            existing_size=$(stat -c%s "/app/data/$fname" 2>/dev/null || echo 0)
            if [ "$seed_size" != "$existing_size" ]; then
                echo "[entrypoint] Updating changed data file: $fname"
                cp "$f" "/app/data/$fname"
            fi
        fi
    done
fi

exec "$@"
