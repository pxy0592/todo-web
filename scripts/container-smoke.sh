#!/bin/sh

set -eu

image_name="${TODO_WEB_IMAGE:-todo-web:local}"
container_name="${TODO_WEB_SMOKE_CONTAINER:-todo-web-smoke}"
host_port="${TODO_WEB_SMOKE_PORT:-4173}"
base_url="http://127.0.0.1:${host_port}"
body_file="$(mktemp)"
curl_connect_timeout="${TODO_WEB_CURL_CONNECT_TIMEOUT:-2}"
curl_max_time="${TODO_WEB_CURL_MAX_TIME:-5}"

fail() {
  printf '%s\n' "Container smoke check failed: $*" >&2
  exit 1
}

assert_status() {
  expected_status="$1"
  request_path="$2"
  actual_status="$(curl --connect-timeout "$curl_connect_timeout" --max-time "$curl_max_time" --silent --output /dev/null --write-out '%{http_code}' "$base_url$request_path")" || fail "request to $request_path failed"
  [ "$actual_status" = "$expected_status" ] || fail "$request_path returned $actual_status, expected $expected_status"
}

assert_header() {
  request_path="$1"
  header_name="$2"
  header_pattern="$3"
  headers="$(curl --connect-timeout "$curl_connect_timeout" --max-time "$curl_max_time" --fail --silent --show-error --head "$base_url$request_path")" || fail "header request to $request_path failed"
  printf '%s\n' "$headers" | grep -Eiq "^${header_name}: ${header_pattern}" || fail "$request_path did not include ${header_name}: ${header_pattern}"
}

wait_for_page() {
  attempts="${1:-30}"
  attempt=1
  while [ "$attempt" -le "$attempts" ]; do
    if curl --connect-timeout "$curl_connect_timeout" --max-time "$curl_max_time" --fail --silent "$base_url/" >"$body_file"; then
      grep -Fq 'src/main.js' "$body_file" || fail "root HTML does not reference src/main.js"
      return
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  fail "server at $base_url did not become ready after ${attempts} attempts"
}

cleanup_container() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$body_file"
}

run_container_smoke() {
  trap cleanup_container EXIT HUP INT TERM

  cleanup_container
  docker image inspect "$image_name" >/dev/null || fail "image $image_name is unavailable"
  docker run --rm -d --name "$container_name" -p "$host_port:4173" "$image_name" >/dev/null
  if [ "$host_port" = "0" ]; then
    host_port="$(docker port "$container_name" 4173/tcp | head -n 1 | sed 's/.*://')" || fail "Docker did not assign a host port"
    [ -n "$host_port" ] || fail "Docker assigned an empty host port"
    base_url="http://127.0.0.1:${host_port}"
  fi

  wait_for_page 20
  assert_header "/styles/app.css" "content-type" "text/css"
  assert_header "/src/main.js" "content-type" "(text|application)/javascript"
  assert_status 404 "/missing"
  assert_status 404 "/%2e%2e/package.json"

  image_user="$(docker image inspect "$image_name" --format '{{.Config.User}}')"
  [ "$image_user" = "node" ] || fail "image runtime user is $image_user, expected node"
  image_volumes="$(docker image inspect "$image_name" --format '{{json .Config.Volumes}}')"
  [ "$image_volumes" = "null" ] || fail "image declares runtime volumes: $image_volumes"
  container_mounts="$(docker inspect "$container_name" --format '{{json .Mounts}}')"
  [ "$container_mounts" = "[]" ] || fail "container has runtime mounts: $container_mounts"
  container_user="$(docker inspect "$container_name" --format '{{.Config.User}}')"
  [ "$container_user" = "node" ] || fail "container runtime user is $container_user, expected node"
  runtime_user="$(docker run --rm --entrypoint /bin/sh "$image_name" -c 'test -r /app/dist/index.html && test -r /app/serve.mjs && test ! -e /app/package.json && test ! -e /app/src && id -un')"
  [ "$runtime_user" = "node" ] || fail "runtime file boundary or user check failed"

  docker rm -f "$container_name" >/dev/null
  remaining_containers="$(docker ps -aq --filter "name=^/${container_name}$")"
  [ -z "$remaining_containers" ] || fail "container $container_name remains after cleanup"

  printf '%s\n' 'Container smoke checks passed'
}

compose_project="${TODO_WEB_COMPOSE_PROJECT:-todo-web-compose-smoke-$$}"
compose_default_port_override="${TODO_WEB_COMPOSE_DEFAULT_PORT_OVERRIDE:-0}"
compose_override_port="${TODO_WEB_COMPOSE_OVERRIDE_PORT:-4317}"
compose_override_file="$(mktemp)"
compose_started=0

compose() {
  docker compose --project-name "$compose_project" "$@"
}

compose_with_default_port_override() {
  docker compose --project-name "$compose_project" -f compose.yaml -f "$compose_override_file" "$@"
}

cleanup_compose() {
  if [ "$compose_started" -eq 1 ]; then
    compose down >/dev/null 2>&1 || true
    compose_started=0
  fi
  rm -f "$body_file" "$compose_override_file"
}

assert_compose_scope() {
  config="$(unset TODO_WEB_PORT; compose config --format json)" || fail "Compose configuration could not be rendered"
  printf '%s' "$config" | grep -Fq '"volumes"' && fail "Compose configuration declares volumes"
  printf '%s' "$config" | grep -Fq '"external": true' && fail "Compose configuration declares external resources"

  services="$(printf '%s' "$config" | grep -o '"todo-web"' | wc -l | tr -d ' ')"
  [ "$services" -ge 1 ] || fail "Compose configuration does not declare todo-web"

  remaining_containers="$(compose ps -q)"
  [ -z "$remaining_containers" ] || fail "Compose project $compose_project still has application containers"
}

assert_compose_running() {
  published_port="$1"
  compose_ps="$(compose ps)"
  printf '%s\n' "$compose_ps"
  printf '%s\n' "$compose_ps" | grep -Eq 'todo-web.*running|todo-web.*Up' || fail "todo-web is not running in Compose project $compose_project"
  compose_containers="$(compose ps -q)"
  [ "$(printf '%s\n' "$compose_containers" | sed '/^$/d' | wc -l | tr -d ' ')" = "1" ] || fail "Compose project must have exactly one application container"
  actual_port="$(compose port todo-web 4173)" || fail "Compose does not publish todo-web:4173"
  [ "${actual_port##*:}" = "$published_port" ] || fail "Compose publishes $actual_port, expected host port ${published_port}"
}

run_compose_smoke() {
  trap cleanup_compose EXIT HUP INT TERM

  # Prove the user-facing default interpolation before applying a test-only port override.
  default_config="$(unset TODO_WEB_PORT; compose config --format json)" || fail "default Compose configuration could not be rendered"
  printf '%s' "$default_config" | grep -Fq '"published": "4173"' || fail "default Compose config does not publish 4173"

  cat >"$compose_override_file" <<EOF
services:
  todo-web:
    ports: !override
      - "${compose_default_port_override}:4173"
EOF

  # Keep TODO_WEB_PORT unset in the default branch; the temporary override only avoids test-host conflicts.
  compose_started=1
  (
    unset TODO_WEB_PORT
    compose_with_default_port_override up --build -d
  )
  host_port="$(compose port todo-web 4173 | sed 's/.*://')" || fail "Compose does not publish todo-web:4173"
  base_url="http://127.0.0.1:${host_port}"
  wait_for_page 30
  assert_compose_running "$host_port"

  compose down >/dev/null
  compose_started=0
  assert_compose_scope

  override_config="$(TODO_WEB_PORT="$compose_override_port" compose config --format json)"
  printf '%s' "$override_config" | grep -Fq "\"published\": \"$compose_override_port\"" || fail "Compose config does not publish $compose_override_port"
  compose_started=1
  TODO_WEB_PORT="$compose_override_port" compose up --build -d
  host_port="$compose_override_port"
  base_url="http://127.0.0.1:${host_port}"
  wait_for_page 30
  assert_compose_running "$compose_override_port"

  compose down >/dev/null
  compose_started=0
  assert_compose_scope
  printf '%s\n' "Compose lifecycle smoke checks passed (default 4173 via temporary ${compose_default_port_override}, TODO_WEB_PORT=${compose_override_port})"
}

case "${TODO_WEB_SMOKE_MODE:-container}" in
  container)
    run_container_smoke
    ;;
  compose)
    run_compose_smoke
    ;;
  *)
    fail "unknown TODO_WEB_SMOKE_MODE: ${TODO_WEB_SMOKE_MODE}"
    ;;
esac
