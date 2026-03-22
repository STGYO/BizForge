import type {
  EventEnvelope,
  PluginManifest,
  PluginPermission,
  PluginRegistration,
  PluginHandler
} from "@bizforge/plugin-sdk";
import { createHash, randomUUID } from "node:crypto";
import manifest from "../../plugin.json" assert { type: "json" };

const typedManifest = {
  ...manifest,
  permissions: manifest.permissions as PluginPermission[]
} as PluginManifest;

type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "void";

interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceRecord {
  id: string;
  customerId: string;
  currency: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  lineItems: InvoiceLineItem[];
  createdAt: string;
  issuedAt?: string | undefined;
  paidAt?: string | undefined;
  updatedAt: string;
}

interface PaymentRecord {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  reference: string;
  createdAt: string;
}

const invoices = new Map<string, InvoiceRecord>();
const paymentsByInvoice = new Map<string, PaymentRecord[]>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function toDeterministicUuid(value: string): string {
  const digest = createHash("sha1").update(value).digest("hex").slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function normalizeUuid(value: unknown, fallback: string): string {
  const candidate = String(value ?? "").trim();
  if (!candidate) {
    return fallback;
  }

  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : toDeterministicUuid(candidate);
}

function resolveOrganizationId(payload: Record<string, unknown>, headers: unknown): string {
  const source =
    payload.organizationId ??
    (headers as Record<string, unknown> | undefined)?.["x-bizforge-org-id"] ??
    DEFAULT_ORGANIZATION_ID;
  return normalizeUuid(source, DEFAULT_ORGANIZATION_ID);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string,
  sourcePlugin: string
): EventEnvelope<Record<string, unknown>> {
  return {
    eventId: makeId("evt"),
    eventType: type,
    occurredAt,
    organizationId,
    sourcePlugin,
    schemaVersion: 1,
    payload
  };
}

async function emitBillingEvent(
  context: Parameters<PluginHandler>[1],
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string
): Promise<void> {
  if (context.persistence) {
    await context.persistence.writeEvent({
      eventType: type,
      organizationId,
      sourcePlugin: typedManifest.name,
      payload
    });
    return;
  }

  await context.eventBus.publish(
    publishEvent(type, payload, organizationId, occurredAt, typedManifest.name)
  );
}

function mapInvoiceRow(row: Record<string, unknown>): InvoiceRecord {
  return {
    id: String(row.id),
    customerId: String(row.customerId ?? ""),
    currency: String(row.currency ?? "USD"),
    dueDate: String(row.dueDate ?? new Date().toISOString()),
    status: String(row.status ?? "draft") as InvoiceStatus,
    subtotal: Number(row.subtotal ?? 0),
    taxAmount: Number(row.taxAmount ?? 0),
    totalAmount: Number(row.totalAmount ?? 0),
    amountPaid: Number(row.amountPaid ?? 0),
    lineItems: [],
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    ...(row.issuedAt ? { issuedAt: String(row.issuedAt) } : {}),
    ...(row.paidAt ? { paidAt: String(row.paidAt) } : {}),
    updatedAt: String(row.updatedAt ?? row.createdAt ?? new Date().toISOString())
  };
}

function mapLineItemRow(row: Record<string, unknown>): InvoiceLineItem {
  return {
    id: String(row.id),
    description: String(row.description ?? "Line item"),
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unitPrice ?? 0),
    amount: Number(row.amount ?? 0)
  };
}

function mapPaymentRow(row: Record<string, unknown>): PaymentRecord {
  return {
    id: String(row.id),
    invoiceId: String(row.invoiceId),
    amount: Number(row.amount ?? 0),
    method: String(row.method ?? "manual"),
    reference: String(row.reference ?? ""),
    createdAt: String(row.createdAt ?? new Date().toISOString())
  };
}

function normalizeLineItems(payload: Record<string, unknown>): InvoiceLineItem[] {
  const source = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  const items = source
    .map((entry) => {
      const candidate = entry as Record<string, unknown>;
      const quantity = Number(candidate.quantity ?? 1);
      const unitPrice = Number(candidate.unitPrice ?? 0);
      const amount = roundMoney(quantity * unitPrice);

      return {
        id: String(candidate.id ?? makeId("item")),
        description: String(candidate.description ?? "Line item"),
        quantity,
        unitPrice,
        amount
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && Number.isFinite(item.unitPrice));

  if (items.length > 0) {
    return items;
  }

  return [
    {
      id: makeId("item"),
      description: "Default service fee",
      quantity: 1,
      unitPrice: 100,
      amount: 100
    }
  ];
}

function buildInvoice(payload: Record<string, unknown>): InvoiceRecord {
  const now = new Date().toISOString();
  const lineItems = normalizeLineItems(payload);
  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.amount, 0));
  const taxRate = Number(payload.taxRate ?? 0.1);
  const taxAmount = roundMoney(subtotal * taxRate);
  const totalAmount = roundMoney(subtotal + taxAmount);

  return {
    id: randomUUID(),
    customerId: String(payload.customerId ?? payload.entityId ?? "unknown-customer"),
    currency: String(payload.currency ?? "USD"),
    dueDate: String(
      payload.dueDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    ),
    status: "draft",
    subtotal,
    taxAmount,
    totalAmount,
    amountPaid: 0,
    lineItems,
    createdAt: now,
    updatedAt: now
  };
}

const listRecords: PluginHandler = async ({ query, headers }, context) => {
  const payload = (query ?? {}) as Record<string, unknown>;
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const invoiceRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id AS "customerId",
         currency,
         due_date AS "dueDate",
         status,
         subtotal,
         tax_amount AS "taxAmount",
         total_amount AS "totalAmount",
         amount_paid AS "amountPaid",
         created_at AS "createdAt",
         issued_at AS "issuedAt",
         paid_at AS "paidAt",
         updated_at AS "updatedAt"
       FROM invoices
       WHERE organization_id = $1::uuid
       ORDER BY created_at DESC`,
      organizationId
    );

    const mappedInvoices: InvoiceRecord[] = [];
    for (const row of invoiceRows.rows) {
      const invoice = mapInvoiceRow(row);
      const lineItems = await context.persistence.queryByOrganization<Record<string, unknown>>(
        `SELECT
           li.id::text AS id,
           description,
           quantity,
           unit_price AS "unitPrice",
           amount
         FROM invoice_line_items li
         INNER JOIN invoices i ON i.id = li.invoice_id
         WHERE i.organization_id = $1::uuid
           AND li.invoice_id = $2::uuid
         ORDER BY li.created_at ASC`,
        organizationId,
        [invoice.id]
      );

      mappedInvoices.push({
        ...invoice,
        lineItems: lineItems.rows.map((entry) => mapLineItemRow(entry))
      });
    }

    return {
      plugin: typedManifest.name,
      invoices: mappedInvoices
    };
  }

  return {
    plugin: typedManifest.name,
    invoices: Array.from(invoices.values())
  };
};

const createRecord: PluginHandler = async ({ body, headers }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const invoice = buildInvoice(payload);
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    await context.persistence.queryByOrganization(
      `INSERT INTO invoices (
         id,
         organization_id,
         customer_id,
         currency,
         due_date,
         status,
         subtotal,
         tax_amount,
         total_amount,
         amount_paid,
         issued_at,
         paid_at,
         created_at,
         updated_at
       ) VALUES (
         $2::uuid,
         $1::uuid,
         $3,
         $4,
         $5::timestamptz,
         $6,
         $7,
         $8,
         $9,
         $10,
         NULL,
         NULL,
         $11::timestamptz,
         $12::timestamptz
       )`,
      organizationId,
      [
        invoice.id,
        invoice.customerId,
        invoice.currency,
        invoice.dueDate,
        invoice.status,
        invoice.subtotal,
        invoice.taxAmount,
        invoice.totalAmount,
        invoice.amountPaid,
        invoice.createdAt,
        invoice.updatedAt
      ]
    );

    for (const lineItem of invoice.lineItems) {
      await context.persistence.queryByOrganization(
        `INSERT INTO invoice_line_items (
           id,
           invoice_id,
           description,
           quantity,
           unit_price,
           amount,
           created_at
         ) VALUES (
           $2::uuid,
           $3::uuid,
           $4,
           $5,
           $6,
           $7,
           $8::timestamptz
         )`,
        organizationId,
        [
          normalizeUuid(lineItem.id, randomUUID()),
          invoice.id,
          lineItem.description,
          lineItem.quantity,
          lineItem.unitPrice,
          lineItem.amount,
          invoice.createdAt
        ]
      );
    }
  } else {
    invoices.set(invoice.id, invoice);
    paymentsByInvoice.set(invoice.id, []);
  }

  await emitBillingEvent(
    context,
    "invoice.created",
    {
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency
    },
    organizationId,
    invoice.createdAt
  );

  return {
    created: true,
    invoice
  };
};

const getInvoice: PluginHandler = async ({ params, query, headers }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (query ?? {}) as Record<string, unknown>;
  const invoiceId = String(routeParams.id ?? "");
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const invoiceRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id AS "customerId",
         currency,
         due_date AS "dueDate",
         status,
         subtotal,
         tax_amount AS "taxAmount",
         total_amount AS "totalAmount",
         amount_paid AS "amountPaid",
         created_at AS "createdAt",
         issued_at AS "issuedAt",
         paid_at AS "paidAt",
         updated_at AS "updatedAt"
       FROM invoices
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [invoiceId]
    );

    const row = invoiceRows.rows[0];
    if (!row) {
      return {
        found: false,
        error: "Invoice not found"
      };
    }

    const lineItemRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         li.id::text AS id,
         description,
         quantity,
         unit_price AS "unitPrice",
         amount
       FROM invoice_line_items li
       INNER JOIN invoices i ON i.id = li.invoice_id
       WHERE i.organization_id = $1::uuid
         AND li.invoice_id = $2::uuid
       ORDER BY li.created_at ASC`,
      organizationId,
      [invoiceId]
    );

    const paymentRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         ip.id::text AS id,
         ip.invoice_id::text AS "invoiceId",
         amount,
         method,
         COALESCE(reference, '') AS reference,
         created_at AS "createdAt"
       FROM invoice_payments ip
       INNER JOIN invoices i ON i.id = ip.invoice_id
       WHERE i.organization_id = $1::uuid
         AND ip.invoice_id = $2::uuid
       ORDER BY ip.created_at DESC`,
      organizationId,
      [invoiceId]
    );

    return {
      found: true,
      invoice: {
        ...mapInvoiceRow(row),
        lineItems: lineItemRows.rows.map((entry) => mapLineItemRow(entry))
      },
      payments: paymentRows.rows.map((entry) => mapPaymentRow(entry))
    };
  }

  const invoice = invoices.get(invoiceId);

  if (!invoice) {
    return {
      found: false,
      error: "Invoice not found"
    };
  }

  return {
    found: true,
    invoice,
    payments: paymentsByInvoice.get(invoiceId) ?? []
  };
};

const issueInvoice: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const invoiceId = String(routeParams.id ?? payload.invoiceId ?? "");
  const organizationId = resolveOrganizationId(payload, undefined);

  if (context.persistence?.isDatabaseAvailable) {
    const invoiceRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id AS "customerId",
         currency,
         due_date AS "dueDate",
         status,
         subtotal,
         tax_amount AS "taxAmount",
         total_amount AS "totalAmount",
         amount_paid AS "amountPaid",
         created_at AS "createdAt",
         issued_at AS "issuedAt",
         paid_at AS "paidAt",
         updated_at AS "updatedAt"
       FROM invoices
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [invoiceId]
    );

    const row = invoiceRows.rows[0];
    if (!row) {
      return {
        issued: false,
        error: "Invoice not found"
      };
    }

    const existing = mapInvoiceRow(row);
    if (existing.status === "void") {
      return {
        issued: false,
        error: "Cannot issue a void invoice"
      };
    }

    const now = new Date().toISOString();
    const next: InvoiceRecord = {
      ...existing,
      status: existing.amountPaid > 0 ? "partially_paid" : "issued",
      issuedAt: existing.issuedAt ?? now,
      updatedAt: now,
      lineItems: []
    };

    await context.persistence.queryByOrganization(
      `UPDATE invoices
       SET status = $3,
           issued_at = $4::timestamptz,
           updated_at = $5::timestamptz
       WHERE organization_id = $1::uuid
         AND id = $2::uuid`,
      organizationId,
      [next.id, next.status, next.issuedAt ?? now, next.updatedAt]
    );

    await emitBillingEvent(
      context,
      "invoice.issued",
      {
        invoiceId: next.id,
        dueDate: next.dueDate,
        totalAmount: next.totalAmount,
        status: next.status
      },
      organizationId,
      now
    );

    return {
      issued: true,
      invoice: next
    };
  }

  const existing = invoices.get(invoiceId);

  if (!existing) {
    return {
      issued: false,
      error: "Invoice not found"
    };
  }

  if (existing.status === "void") {
    return {
      issued: false,
      error: "Cannot issue a void invoice"
    };
  }

  const now = new Date().toISOString();
  const next: InvoiceRecord = {
    ...existing,
    status: existing.amountPaid > 0 ? "partially_paid" : "issued",
    issuedAt: existing.issuedAt ?? now,
    updatedAt: now
  };
  invoices.set(next.id, next);

  await emitBillingEvent(
    context,
    "invoice.issued",
    {
      invoiceId: next.id,
      dueDate: next.dueDate,
      totalAmount: next.totalAmount,
      status: next.status
    },
    organizationId,
    now
  );

  return {
    issued: true,
    invoice: next
  };
};

const recordPayment: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const invoiceId = String(routeParams.id ?? payload.invoiceId ?? payload.entityId ?? "");
  const organizationId = resolveOrganizationId(payload, undefined);

  if (context.persistence?.isDatabaseAvailable) {
    const invoiceRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id AS "customerId",
         currency,
         due_date AS "dueDate",
         status,
         subtotal,
         tax_amount AS "taxAmount",
         total_amount AS "totalAmount",
         amount_paid AS "amountPaid",
         created_at AS "createdAt",
         issued_at AS "issuedAt",
         paid_at AS "paidAt",
         updated_at AS "updatedAt"
       FROM invoices
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [invoiceId]
    );

    const row = invoiceRows.rows[0];
    if (!row) {
      return {
        ok: false,
        error: "Invoice not found"
      };
    }

    const invoice = mapInvoiceRow(row);
    const amount = Number(payload.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        error: "payment amount must be greater than zero"
      };
    }

    const payment: PaymentRecord = {
      id: randomUUID(),
      invoiceId,
      amount: roundMoney(amount),
      method: String(payload.method ?? "manual"),
      reference: String(payload.reference ?? ""),
      createdAt: new Date().toISOString()
    };

    await context.persistence.queryByOrganization(
      `INSERT INTO invoice_payments (
         id,
         invoice_id,
         amount,
         method,
         reference,
         created_at
       ) VALUES (
         $2::uuid,
         $3::uuid,
         $4,
         $5,
         NULLIF($6, ''),
         $7::timestamptz
       )`,
      organizationId,
      [
        payment.id,
        payment.invoiceId,
        payment.amount,
        payment.method,
        payment.reference,
        payment.createdAt
      ]
    );

    const nextAmountPaid = roundMoney(invoice.amountPaid + payment.amount);
    const remaining = roundMoney(invoice.totalAmount - nextAmountPaid);
    const nextStatus: InvoiceStatus =
      remaining <= 0
        ? "paid"
        : invoice.status === "draft"
          ? "partially_paid"
          : "partially_paid";
    const now = payment.createdAt;
    const nextInvoice: InvoiceRecord = {
      ...invoice,
      amountPaid: nextAmountPaid,
      status: nextStatus,
      ...(nextStatus === "paid" ? { paidAt: now } : {}),
      updatedAt: now,
      lineItems: []
    };

    await context.persistence.queryByOrganization(
      `UPDATE invoices
       SET amount_paid = $3,
           status = $4,
           paid_at = $5::timestamptz,
           updated_at = $6::timestamptz
       WHERE organization_id = $1::uuid
         AND id = $2::uuid`,
      organizationId,
      [
        invoiceId,
        nextInvoice.amountPaid,
        nextInvoice.status,
        nextInvoice.paidAt ?? null,
        nextInvoice.updatedAt
      ]
    );

    await emitBillingEvent(
      context,
      "invoice.payment.recorded",
      {
        invoiceId,
        paymentId: payment.id,
        amount: payment.amount,
        amountPaid: nextInvoice.amountPaid,
        remainingAmount: roundMoney(nextInvoice.totalAmount - nextInvoice.amountPaid)
      },
      organizationId,
      now
    );

    if (nextStatus === "paid") {
      await emitBillingEvent(
        context,
        "invoice.paid",
        {
          invoiceId,
          totalAmount: nextInvoice.totalAmount,
          paidAt: nextInvoice.paidAt
        },
        organizationId,
        now
      );
    }

    return {
      ok: true,
      payment,
      invoice: nextInvoice
    };
  }

  const invoice = invoices.get(invoiceId);

  if (!invoice) {
    return {
      ok: false,
      error: "Invoice not found"
    };
  }

  const amount = Number(payload.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      error: "payment amount must be greater than zero"
    };
  }

  const payment: PaymentRecord = {
    id: makeId("pay"),
    invoiceId,
    amount: roundMoney(amount),
    method: String(payload.method ?? "manual"),
    reference: String(payload.reference ?? ""),
    createdAt: new Date().toISOString()
  };

  const existingPayments = paymentsByInvoice.get(invoiceId) ?? [];
  paymentsByInvoice.set(invoiceId, [payment, ...existingPayments]);

  const nextAmountPaid = roundMoney(invoice.amountPaid + payment.amount);
  const remaining = roundMoney(invoice.totalAmount - nextAmountPaid);
  const nextStatus: InvoiceStatus =
    remaining <= 0 ? "paid" : invoice.status === "draft" ? "partially_paid" : "partially_paid";
  const now = payment.createdAt;
  const nextInvoice: InvoiceRecord = {
    ...invoice,
    amountPaid: nextAmountPaid,
    status: nextStatus,
    paidAt: nextStatus === "paid" ? now : undefined,
    updatedAt: now
  };
  invoices.set(invoiceId, nextInvoice);

  await emitBillingEvent(
    context,
    "invoice.payment.recorded",
    {
      invoiceId,
      paymentId: payment.id,
      amount: payment.amount,
      amountPaid: nextInvoice.amountPaid,
      remainingAmount: roundMoney(nextInvoice.totalAmount - nextInvoice.amountPaid)
    },
    organizationId,
    now
  );

  if (nextStatus === "paid") {
    await emitBillingEvent(
      context,
      "invoice.paid",
      {
        invoiceId,
        totalAmount: nextInvoice.totalAmount,
        paidAt: nextInvoice.paidAt
      },
      organizationId,
      now
    );
  }

  return {
    ok: true,
    payment,
    invoice: nextInvoice
  };
};

const pluginAction: PluginHandler = async ({ actionInput }, context) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const createResult = (await createRecord(
    {
      body: payload,
      query: {},
      params: {},
      headers: {}
    },
    context
  )) as Record<string, unknown>;

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "create_invoice",
    invoice: createResult.invoice
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    getInvoice,
    issueInvoice,
    recordPayment,
    pluginAction
  },
  routes: [
    {
      method: "GET",
      path: "/records",
      handlerName: "listRecords"
    },
    {
      method: "POST",
      path: "/records",
      handlerName: "createRecord"
    },
    {
      method: "GET",
      path: "/invoices/:id",
      handlerName: "getInvoice"
    },
    {
      method: "POST",
      path: "/invoices/:id/issue",
      handlerName: "issueInvoice"
    },
    {
      method: "POST",
      path: "/invoices/:id/payments",
      handlerName: "recordPayment"
    }
  ],
  triggers: [
    {
      key: "invoice_created",
      displayName: "Invoice Created",
      eventType: "invoice.created"
    },
    {
      key: "invoice_issued",
      displayName: "Invoice Issued",
      eventType: "invoice.issued"
    },
    {
      key: "invoice_payment_recorded",
      displayName: "Invoice Billing Updated",
      eventType: "invoice.payment.recorded"
    },
    {
      key: "invoice_paid",
      displayName: "Invoice Paid",
      eventType: "invoice.paid"
    }
  ],
  actions: [
    {
      key: "create_invoice",
      displayName: "Invoice Billing Action",
      handlerName: "pluginAction",
      inputSchema: {
        type: "object",
        properties: {
          customerId: { type: "string" },
          currency: { type: "string" },
          dueDate: { type: "string" },
          taxRate: { type: "number" },
          lineItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                quantity: { type: "number" },
                unitPrice: { type: "number" }
              },
              required: ["description", "quantity", "unitPrice"]
            }
          }
        },
        required: ["customerId"]
      }
    }
  ]
};




