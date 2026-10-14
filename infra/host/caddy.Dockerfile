# Caddy with the Route 53 DNS plugin, for Let's Encrypt DNS-01 challenges.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/route53

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
