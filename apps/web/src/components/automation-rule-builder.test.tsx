import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  SchemaFieldRenderer,
  createDraftFromPayload,
  serializeDraft,
  type RuleDraft
} from "./automation-rule-builder";
import type { AutomationCatalog } from "../lib/automation-api";

const catalog: AutomationCatalog = {
  triggers: [
    {
      plugin: "core",
      key: "lead-generated",
      displayName: "Lead Generated",
      eventType: "lead.generated"
    }
  ],
  actions: [
    {
      plugin: "appointment-manager",
      key: "schedule_follow_up",
      displayName: "Schedule Follow Up",
      inputSchema: {
        type: "object",
        required: ["customerId", "preferences"],
        properties: {
          customerId: { type: "string" },
          preferences: {
            type: "object",
            required: ["channel"],
            properties: {
              channel: {
                enum: ["email", "sms"]
              }
            }
          },
          labels: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    }
  ]
};

describe("SchemaFieldRenderer", () => {
  it("renders enum options", () => {
    render(
      <SchemaFieldRenderer
        schema={{ enum: ["email", "sms"] }}
        label="channel"
        value="email"
        required={true}
        path="actions.0.input.preferences.channel"
        validationErrors={{}}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: "email" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "sms" })).toBeTruthy();
  });

  it("renders nested object fields", () => {
    render(
      <SchemaFieldRenderer
        schema={{
          type: "object",
          required: ["customerId"],
          properties: {
            customerId: { type: "string" },
            offsetHours: { type: "number" }
          }
        }}
        label="input"
        value={{ customerId: "cust-1", offsetHours: 24 }}
        required={true}
        path="actions.0.input"
        validationErrors={{}}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("cust-1")).toBeTruthy();
    expect(screen.getByDisplayValue("24")).toBeTruthy();
  });

  it("handles array add item", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SchemaFieldRenderer
        schema={{
          type: "array",
          items: { type: "string" }
        }}
        label="labels"
        value={["first"]}
        required={false}
        path="actions.0.input.labels"
        validationErrors={{}}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add Item" }));

    expect(onChange).toHaveBeenCalledWith(["first", ""]);
  });
});

describe("draft serialization", () => {
  it("round-trips payload without draft IDs", () => {
    const payload = {
      triggerEvent: "lead.generated",
      conditions: [{ field: "source", equals: "web" }],
      actions: [
        {
          plugin: "appointment-manager",
          actionKey: "schedule_follow_up",
          input: {
            customerId: "cust-1",
            preferences: { channel: "email" },
            labels: ["hot"]
          }
        }
      ],
      enabled: true
    };

    const draft = createDraftFromPayload(payload, catalog);
    const serialized = serializeDraft(draft as RuleDraft);

    expect(serialized).toEqual(payload);
  });
});
