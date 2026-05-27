import type { DecodePayload } from "../../features/decode-renderer/payload";

export interface AttachmentScenario {
  id: string;
  label: string;
  bootstrap: {
    item: {
      id: string;
      type: string;
      tags: string[];
      sourceAppID: string;
    };
    attachment: {
      historyID: string;
      owner: string;
      attachmentType: string;
      attachmentKey: string;
      payloadJson: string;
    };
  };
}

function payload(overrides: Partial<DecodePayload>): DecodePayload {
  return {
    kind: "decode_preview",
    version: 1,
    encoding: "base64",
    original: "SGVsbG8sIFdvcmxkIQ==",
    truncated: false,
    decoded: "Hello, World!",
    decodedIsJSON: false,
    jwt: null,
    epochMs: null,
    tsUnit: null,
    originalLength: 20,
    decodedLength: 13,
    expanded: false,
    ...overrides,
  };
}

function scenario(id: string, label: string, decodePayload: DecodePayload): AttachmentScenario {
  return {
    id,
    label,
    bootstrap: {
      item: {
        id: `item-${id}`,
        type: "text",
        tags: ["decode-preview"],
        sourceAppID: "local.preview",
      },
      attachment: {
        historyID: `history-${id}`,
        owner: "plugin.pasty.awesome.decode",
        attachmentType: "plugin.pasty.awesome.decode.preview",
        attachmentKey: "primary",
        payloadJson: JSON.stringify(decodePayload),
      },
    },
  };
}

export const attachmentScenarios: AttachmentScenario[] = [
  scenario("base64", "Base64 text", payload({})),
  scenario("url-json", "URL decoded JSON", payload({
    encoding: "url",
    original: "%7B%22a%22%3A1%2C%22b%22%3A%22two%22%7D",
    decoded: '{"a":1,"b":"two"}',
    decodedIsJSON: true,
    originalLength: 39,
    decodedLength: 17,
  })),
  scenario("jwt", "JWT", payload({
    encoding: "jwt",
    original: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.",
    decoded: JSON.stringify({
      header: { alg: "HS256" },
      payload: { sub: "123" },
      signature: "",
    }, null, 2),
    decodedIsJSON: true,
    jwt: {
      header: { alg: "HS256" },
      payload: { sub: "123" },
      signature: "",
    },
    originalLength: 44,
    decodedLength: 85,
  })),
  scenario("timestamp", "Unix timestamp", payload({
    encoding: "timestamp",
    original: "1716800000",
    decoded: "2024-05-27 18:13:20",
    decodedIsJSON: false,
    epochMs: 1716800000000,
    tsUnit: "s",
    originalLength: 10,
    decodedLength: 19,
  })),
  scenario("date", "Date string", payload({
    encoding: "date",
    original: "2026-05-27",
    decoded: "1779811200000",
    decodedIsJSON: false,
    epochMs: 1779811200000,
    tsUnit: null,
    originalLength: 10,
    decodedLength: 13,
  })),
];
