FROM squidfunk/mkdocs-material@sha256:51b87149d227691486b5f08993d28c65ca7e4990010664b697265b8e6fcd5287

RUN pip install --no-cache-dir --disable-pip-version-check --root-user-action=ignore \
    mkdocs-macros-plugin==1.5.0
