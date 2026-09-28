#!/bin/sh
# Runs once, when the Postgres data volume is first initialised.
# POSTGRES_DB (the model service's database) is created by the image itself;
# this adds the MLflow backend-store database alongside it.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE mlflow;
EOSQL
