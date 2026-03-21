# BizForge Event Catalog

## Envelope

All events follow this envelope:

- eventId
- eventType
- occurredAt
- organizationId
- sourcePlugin
- correlationId
- schemaVersion
- payload

## Core topics

- customer.created
- lead.generated
- appointment.booked
- invoice.generated
- payment.completed
- automation.action.requested

## Delivery semantics

- At-least-once delivery
- Retry with exponential backoff
- Dead letter stream per subject
- Consumers must be idempotent
