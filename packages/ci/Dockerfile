FROM --platform=linux/amd64 bitnami/kubectl:1.27.8 as kubectl

FROM --platform=linux/amd64 us-docker.pkg.dev/diachronic/temporal-worker:v1
COPY --from=kubectl /opt/bitnami/kubectl/bin/kubectl /usr/local/bin/
ARG VERSION_ID

WORKDIR /code

COPY dist/${VERSION_ID}/* /code/dist/
