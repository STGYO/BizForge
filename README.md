# BizForge

BizForge is a modular automation platform where business tools ship as plugins.

## Workspace packages

- apps/core-api: Core backend platform and plugin runtime
- apps/web: Unified dashboard shell
- packages/plugin-sdk: Shared plugin interfaces and helpers
- plugins/appointment-manager: Example plugin

## Quick start

1. Install dependencies:

   npm install

2. Run all apps:

   npm run dev

3. Build all packages:

   npm run build

## Runtime notes

- The core API runs with in-memory automation rule storage by default.
- To enable PostgreSQL persistence for automation rules, copy `.env.example` to `.env` and set `DATABASE_URL`.
- Check active persistence mode at `GET /health` via the `persistence` field.
