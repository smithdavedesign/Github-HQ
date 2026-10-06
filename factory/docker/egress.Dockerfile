# RepoHQ factory sandbox egress gateway (docs/autonomous-factory.md §14, roadmap Phase 76).
# The worker container sits on an --internal network with no route out; this container is
# its only exit:
#   :8888  tinyproxy, an HTTP(S) forward proxy that only allows EGRESS_ALLOW_HOSTS (package registries)
#   :4000  model relay to the host's LiteLLM gateway that only forwards EGRESS_ALLOW_MODELS
#          (free tiers by default, so repo code can't spend on the paid alias with the shared key)
FROM node:22-alpine
RUN apk add --no-cache tinyproxy tini su-exec
COPY egress-entrypoint.sh egress-relay.mjs /opt/egress/
RUN chmod 0755 /opt/egress/egress-entrypoint.sh
EXPOSE 4000 8888
ENTRYPOINT ["/sbin/tini", "--", "/opt/egress/egress-entrypoint.sh"]
