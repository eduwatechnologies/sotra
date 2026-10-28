import type { IncomingMessage, ServerResponse } from "node:http";

export type FunctionRequest = IncomingMessage;

export interface FunctionResponse extends ServerResponse {
  status(code: number): this;
  json(body: unknown): this;
  send(body: string): this;
}
