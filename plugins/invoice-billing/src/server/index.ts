import type {
  EventEnvelope,
  PluginManifest,
  PluginPermission,
  PluginRegistration,
  PluginHandler
} from "@bizforge/plugin-sdk";
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

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
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
    id: makeId("inv"),
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

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    invoices: Array.from(invoices.values())
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const invoice = buildInvoice(payload);
  invoices.set(invoice.id, invoice);
  paymentsByInvoice.set(invoice.id, []);

  const organizationId = getOrganizationId(payload);

  await context.eventBus.publish(
    publishEvent(
      "invoice.created",
      {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        status: invoice.status,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency
      },
      organizationId,
      invoice.createdAt,
      typedManifest.name
    )
  );

  return {
    created: true,
    invoice
  };
};

const getInvoice: PluginHandler = async ({ params }) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const invoiceId = String(routeParams.id ?? "");
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

  await context.eventBus.publish(
    publishEvent(
      "invoice.issued",
      {
        invoiceId: next.id,
        dueDate: next.dueDate,
        totalAmount: next.totalAmount,
        status: next.status
      },
      getOrganizationId(payload),
      now,
      typedManifest.name
    )
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

  const organizationId = getOrganizationId(payload);
  await context.eventBus.publish(
    publishEvent(
      "invoice.payment.recorded",
      {
        invoiceId,
        paymentId: payment.id,
        amount: payment.amount,
        amountPaid: nextInvoice.amountPaid,
        remainingAmount: roundMoney(nextInvoice.totalAmount - nextInvoice.amountPaid)
      },
      organizationId,
      now,
      typedManifest.name
    )
  );

  if (nextStatus === "paid") {
    await context.eventBus.publish(
      publishEvent(
        "invoice.paid",
        {
          invoiceId,
          totalAmount: nextInvoice.totalAmount,
          paidAt: nextInvoice.paidAt
        },
        organizationId,
        now,
        typedManifest.name
      )
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




