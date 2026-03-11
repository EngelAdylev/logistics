#!/bin/bash
# First-time SSL certificate setup using Let's Encrypt.
# Run this ONCE before starting the production stack.
#
# Usage:
#   chmod +x init-letsencrypt.sh
#   ./init-letsencrypt.sh

set -e

# Load variables from .env
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in the values."
  exit 1
fi
export $(grep -v '^#' .env | grep -v '^$' | xargs)

if [ -z "$DOMAIN" ]; then
  echo "ERROR: DOMAIN is not set in .env"
  exit 1
fi

if [ -z "$CERTBOT_EMAIL" ]; then
  echo "ERROR: CERTBOT_EMAIL is not set in .env"
  exit 1
fi

echo "==> Setting up SSL for domain: $DOMAIN"

# Create required directories
mkdir -p certbot/conf/live/"$DOMAIN"
mkdir -p certbot/www

# Step 1: Create a temporary self-signed certificate so nginx can start
echo "==> Creating temporary self-signed certificate..."
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout certbot/conf/live/"$DOMAIN"/privkey.pem \
  -out certbot/conf/live/"$DOMAIN"/fullchain.pem \
  -subj "/CN=$DOMAIN" 2>/dev/null

# Step 2: Start nginx (frontend) with the dummy cert so port 80 is available for the HTTP challenge
echo "==> Starting nginx temporarily..."
docker compose -f docker-compose.prod.yml up -d frontend

# Give nginx a moment to start
sleep 3

# Step 3: Remove the dummy cert
echo "==> Removing temporary certificate..."
rm -f certbot/conf/live/"$DOMAIN"/privkey.pem certbot/conf/live/"$DOMAIN"/fullchain.pem
rmdir certbot/conf/live/"$DOMAIN" 2>/dev/null || true

# Step 4: Request a real certificate from Let's Encrypt
echo "==> Requesting Let's Encrypt certificate for $DOMAIN..."
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Step 5: Reload nginx with the real certificate
echo "==> Reloading nginx with real certificate..."
docker compose -f docker-compose.prod.yml exec frontend nginx -s reload

echo ""
echo "==> Done! SSL certificate obtained for $DOMAIN"
echo ""
echo "    Now start all services:"
echo "    docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "    After first start, populate the new hierarchical model:"
echo "    curl -X POST https://$DOMAIN/api/v2/sync -H 'Authorization: Bearer <token>'"
