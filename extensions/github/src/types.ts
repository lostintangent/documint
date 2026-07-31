import type { Anchor, DocumentUser } from "@lostintangent/documint";

export type CopilotJob = {
  id: string;
  state: string;
  cursor?: Anchor | null;
  threadId?: string | null;
  message?: string;
};

export type ServerState = {
  content: string;
  copilotUser: DocumentUser;
  jobs?: CopilotJob[];
};

export type ServerEvent =
  | { type: "state"; state: ServerState }
  | ({ type: "content"; source?: string; clientId?: string } & ServerState)
  | { type: "job"; jobs?: CopilotJob[] }
  | { type: "error"; message: string };

export type FetchJsonError = Error & {
  status: number;
  payload: { error?: string; state?: ServerState };
};
