import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import test from "node:test";
import { isAuthorizedCronRequest } from "../api/cron-auth";

function request(authorization?: string): IncomingMessage {
  const incoming = new IncomingMessage(new Socket());
  if (authorization) {
    incoming.headers.authorization = authorization;
  }
  return incoming;
}

test("authorizes a bearer token with the configured cron secret", () => {
  assert.equal(isAuthorizedCronRequest(request("Bearer test-secret"), "test-secret"), true);
  assert.equal(isAuthorizedCronRequest(request("test-secret"), "test-secret"), true);
});

test("rejects missing, mismatched, and unconfigured cron secrets", () => {
  assert.equal(isAuthorizedCronRequest(request(), "test-secret"), false);
  assert.equal(isAuthorizedCronRequest(request("Bearer wrong"), "test-secret"), false);
  assert.equal(isAuthorizedCronRequest(request("Bearer test-secret"), ""), false);
});
