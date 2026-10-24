# Caddy with the Route 53 DNS plugin, for Let's Encrypt DNS-01 challenges.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/route53

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Run unprivileged. Caddy listens on 8443 (no privileged port, so no root or extra
# capabilities); docker-compose maps the host's 443 to it. It owns only its cert/config dirs.
RUN addgroup -S caddy && adduser -S -G caddy -H -s /sbin/nologin caddy \
 && mkdir -p /data/caddy /config/caddy \
 && chown -R caddy:caddy /data /config
USER caddy
EXPOSE 8443
