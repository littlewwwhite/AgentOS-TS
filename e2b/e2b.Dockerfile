FROM node:22-slim

RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY dist/ ./dist/
COPY node_modules/ ./node_modules/
COPY package.json ./
COPY skills/ ./skills/

RUN mkdir -p /app/workspace

# Start command (overridable via e2b template config)
CMD ["bun", "/app/dist/sandbox.js", "/app/workspace", "--skills", "/app/skills"]
