#!/bin/bash
set -e

# Substitute only $DOMAIN in nginx config template, leaving nginx $variables untouched
envsubst '$DOMAIN' < /etc/nginx/conf.d/nginx.conf.template > /etc/nginx/conf.d/default.conf

exec "$@"
