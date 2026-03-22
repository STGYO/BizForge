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

## Core API endpoints

### Health and diagnostics

- `GET /health`
   - Returns service health and persistence mode.
   - Response example:
      - `{ "status": "ok", "service": "core-api", "persistence": "in-memory" }`
- `GET /api/runtime/diagnostics`
   - Returns runtime diagnostics including plugin load summary.
   - Response shape:
      - `persistence: "in-memory" | "postgres"`
      - `pluginLoad.scannedDirectories: number`
      - `pluginLoad.loadedPlugins: number`
      - `pluginLoad.skippedPlugins: number`
      - `pluginLoad.failedPlugins: Array<{ pluginDir: string; reason: string }>`

### Plugin management

- `GET /api/plugins`
   - Lists loaded plugin runtime records.
- `POST /api/plugins/:name/enable`
   - Enables a plugin runtime record.
   - Returns `{ "status": "enabled" }` or `404` if plugin is not found.
- `POST /api/plugins/:name/disable`
   - Disables a plugin runtime record.
   - Returns `{ "status": "disabled" }` or `404` if plugin is not found.
- `GET /api/plugins/:name/meta`
   - Returns plugin metadata and registered capabilities.
- `GET /api/plugins/:name/<route>`
   - Plugin-defined routes are mounted under `/api/plugins/:name`.

### Automation

- `GET /api/automation/catalog`
   - Returns available triggers and actions from enabled plugins.
- `GET /api/automation/rules`
   - Requires header: `x-bizforge-org-id`.
   - Returns rules for the specified organization.
- `POST /api/automation/rules`
   - Requires header: `x-bizforge-org-id`.
   - Body shape:
      - `triggerEvent: string`
      - `conditions: Array<{ field: string; equals: unknown }>`
      - `actions: Array<{ plugin: string; actionKey: string; input: Record<string, unknown> }>`
      - `enabled?: boolean`

## Validation and error semantics

- `400 Bad Request`
   - Missing `x-bizforge-org-id` header on automation routes.
   - Invalid automation rule payload shape.
   - Invalid plugin name parameter.
   - Rule validation failures (for example, unknown plugin or unknown action key).
- `404 Not Found`
   - Plugin enable/disable requested for a plugin that is not loaded.
- `409 Conflict`
   - Request hits a plugin-defined route for a plugin that is currently disabled.

## API examples

Assume core-api is running on `http://localhost:4000`.

### Runtime diagnostics

```bash
curl -s http://localhost:4000/api/runtime/diagnostics
```

Example response:

```json
{
   "persistence": "in-memory",
   "pluginLoad": {
      "scannedDirectories": 1,
      "loadedPlugins": 1,
      "skippedPlugins": 0,
      "failedPlugins": []
   },
   "eventDelivery": {
      "publishedCount": 0,
      "deliveredCount": 0,
      "failedDeliveryCount": 0,
      "subscriberCount": 0,
      "subscribersByEventType": {},
      "deadLetters": []
   }
}
```

### Event delivery diagnostics

```bash
curl -s http://localhost:4000/api/runtime/event-delivery/dead-letters
```

```bash
curl -s -X POST http://localhost:4000/api/runtime/event-delivery/dead-letters/<id>/acknowledge
```

### List plugins

```bash
curl -s http://localhost:4000/api/plugins
```

### Enable or disable a plugin

```bash
curl -s -X POST http://localhost:4000/api/plugins/appointment-manager/disable
curl -s -X POST http://localhost:4000/api/plugins/appointment-manager/enable
```

### Read plugin metadata and call a plugin route

```bash
curl -s http://localhost:4000/api/plugins/appointment-manager/meta
curl -s http://localhost:4000/api/plugins/appointment-manager/appointments
```

### Get automation catalog

```bash
curl -s http://localhost:4000/api/automation/catalog
```

### List automation rules for an organization

```bash
curl -s \
   -H "x-bizforge-org-id: org-1" \
   http://localhost:4000/api/automation/rules
```

### Create an automation rule

```bash
curl -s -X POST http://localhost:4000/api/automation/rules \
   -H "Content-Type: application/json" \
   -H "x-bizforge-org-id: org-1" \
   -d '{
      "triggerEvent": "lead.generated",
      "conditions": [
         { "field": "source", "equals": "web" }
      ],
      "actions": [
         {
            "plugin": "appointment-manager",
            "actionKey": "schedule_follow_up",
            "input": {
               "customerId": "cust-123",
               "offsetHours": 24
            }
         }
      ],
      "enabled": true
   }'
```

### Common 400 error examples

```json
{ "error": "Missing x-bizforge-org-id header" }
```

```json
{ "error": "Invalid automation rule payload" }
```

```json
{ "error": "Unknown plugin: unknown-plugin" }
```
