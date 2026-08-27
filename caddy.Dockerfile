FROM caddy:2-builder AS builder
ENV GOPROXY=https://goproxy.cn,direct GOSUMDB=off
RUN /usr/bin/xcaddy build \
    --with github.com/caddy-dns/duckdns

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy