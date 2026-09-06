# shared proxy settings — included by babahakim.conf locations
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
# CSRF Origin validation (PHASE 05) needs the real scheme/host forwarded:
proxy_set_header X-Forwarded-Host  $host;
# upstream keepalive (connection reuse — measured p95 win under load)
proxy_set_header Connection        "";
# timeouts: the app's own report timeout is 15s; reports that legitimately
# take longer are async (202 + queue) — sync ceiling stays tight
proxy_connect_timeout 5s;
proxy_send_timeout    60s;
proxy_read_timeout    60s;
# upload path passes through untouched (body buffered to temp file)
proxy_request_buffering on;
