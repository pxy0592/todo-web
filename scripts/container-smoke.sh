#!/bin/sh

set -eu

image_name="${TODO_WEB_IMAGE:-todo-web:local}"
container_name="${TODO_WEB_SMOKE_CONTAINER:-todo-web-smoke}"
host_port="${TODO_WEB_SMOKE_PORT:-4173}"
base_url="http://127.0.0.1:${host_port}"
body_file="$(mktemp)"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$body_file"
}

fail() {
  printf '%s\n' "Container smoke check failed: $*" >&2
  exit 1
}

assert_status() {
  expected_status="$1"
  request_path="$2"
  actual_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url$request_path")" || fail "request to $request_path failed"
  [ "$actual_status" = "$expected_status" ] || fail "$request_path returned $actual_status, expected $expected_status"
}

assert_header() {
  request_path="$1"
  header_name="$2"
  header_pattern="$3"
  headers="$(curl --fail --silent --show-error --head "$base_url$request_path")" || fail "header request to $request_path failed"
  printf '%s\n' "$headers" | grep -Eiq "^${header_name}: ${header_pattern}" || fail "$request_path did not include ${header_name}: ${header_pattern}"
}

trap cleanup EXIT HUP INT TERM

cleanup
docker image inspect "$image_name" >/dev/null || fail "image $image_name is unavailable"
docker run --rm -d --name "$container_name" -p "$host_port:4173" "$image_name" >/dev/null

attempt=1
while [ "$attempt" -le 20 ]; do
  if curl --fail --silent "$base_url/" >"$body_file"; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$attempt" -le 20 ] || fail "server at $base_url did not become ready"

grep -Fq 'src/main.js' "$body_file" || fail "root HTML does not reference src/main.js"
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
