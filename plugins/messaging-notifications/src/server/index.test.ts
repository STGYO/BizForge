import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
	throw new Error("Messaging notifications plugin handlers are not defined");
}

if (!handlers.createRecord || !handlers.pluginAction || !handlers.sendMessage) {
	throw new Error("Messaging notifications plugin expected handlers are missing");
}

const createRecord = handlers.createRecord as PluginHandler;
const pluginAction = handlers.pluginAction as PluginHandler;
const sendMessage = handlers.sendMessage as PluginHandler;

function makeContext(events: EventEnvelope[] = []): PluginRuntimeContext {
	return {
		eventBus: {
			publish: async (event) => {
				events.push(event);
			},
			subscribe: () => {
				return () => {
					return undefined;
				};
			}
		}
	};
}

const emptyInput = {
	body: {},
	query: {},
	params: {},
	headers: {}
};

test("createRecord stores template and emits template created event", async () => {
	const published: EventEnvelope[] = [];
	const context = makeContext(published);

	const result = (await createRecord(
		{
			...emptyInput,
			body: {
				key: `welcome-${Date.now()}`,
				name: "Welcome Message",
				channel: "email",
				subject: "Hi {{name}}",
				body: "Welcome to BizForge, {{name}}",
				organizationId: "org-test"
			}
		},
		context
	)) as Record<string, unknown>;

	assert.equal(result.created, true);
	const template = result.template as Record<string, unknown>;
	assert.equal(template.channel, "email");
	assert.equal(template.name, "Welcome Message");

	assert.equal(published.length, 1);
	assert.equal(published[0]?.eventType, "message.template.created");
});

test("pluginAction sends templated message and emits sent lifecycle events", async () => {
	const published: EventEnvelope[] = [];
	const context = makeContext(published);
	const templateKey = `reminder-${Date.now()}`;

	await createRecord(
		{
			...emptyInput,
			body: {
				key: templateKey,
				name: "Reminder",
				channel: "sms",
				body: "Hello {{name}}, your appointment is tomorrow.",
				organizationId: "org-test"
			}
		},
		context
	);

	published.length = 0;
	const result = (await pluginAction(
		{
			...emptyInput,
			actionInput: {
				templateKey,
				recipient: "+15555550123",
				variables: {
					name: "Sam"
				},
				organizationId: "org-test"
			}
		},
		context
	)) as Record<string, unknown>;

	assert.equal(result.ok, true);
	const delivery = result.delivery as Record<string, unknown>;
	assert.equal(delivery.channel, "sms");
	assert.match(String(delivery.body), /Sam/);

	assert.equal(published.length, 2);
	assert.equal(published[0]?.eventType, "message.delivery.updated");
	assert.equal(published[1]?.eventType, "message.sent");
});

test("sendMessage can mark delivery as failed when simulateFailure is true", async () => {
	const published: EventEnvelope[] = [];
	const context = makeContext(published);

	const result = (await sendMessage(
		{
			...emptyInput,
			body: {
				recipient: "ops@example.com",
				channel: "email",
				subject: "Alert",
				body: "Daily report failed.",
				simulateFailure: true,
				organizationId: "org-test"
			}
		},
		context
	)) as Record<string, unknown>;

	assert.equal(result.ok, false);
	assert.equal(result.error, "message delivery failed");
	const delivery = result.delivery as Record<string, unknown>;
	assert.equal(delivery.status, "failed");

	assert.equal(published.length, 1);
	assert.equal(published[0]?.eventType, "message.delivery.updated");
});

test("pluginAction requires recipient", async () => {
	const published: EventEnvelope[] = [];
	const context = makeContext(published);

	const result = (await pluginAction(
		{
			...emptyInput,
			actionInput: {
				body: "Missing recipient"
			}
		},
		context
	)) as Record<string, unknown>;

	assert.equal(result.ok, false);
	assert.equal(result.error, "recipient is required");
	assert.equal(published.length, 0);
});
