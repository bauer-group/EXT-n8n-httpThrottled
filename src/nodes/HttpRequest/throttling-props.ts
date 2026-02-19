import type { INodeProperties } from "n8n-workflow";

export const throttlingProperties: INodeProperties[] = [
  {
    displayName: "Enable Throttling",
    name: "throttlingEnabled",
    type: "boolean",
    default: true,
    description:
      "Automatically wait and retry on rate-limit responses (429 etc.) using response headers",
    noDataExpression: true,
  },
  {
    displayName: "Throttling Settings",
    name: "throttling",
    type: "collection",
    placeholder: "Add Setting",
    default: {},
    displayOptions: { show: { throttlingEnabled: [true] } },
    options: [
      {
        displayName: "HTTP Codes",
        name: "throttleCodes",
        type: "multiOptions",
        default: ["429"],
        description: "HTTP status codes that trigger throttling",
        options: [
          { name: "429 Too Many Requests", value: "429" },
          { name: "503 Service Unavailable", value: "503" },
          { name: "504 Gateway Timeout", value: "504" },
        ],
      },
      {
        displayName: "Default Wait Time (ms)",
        name: "defaultWaitMs",
        type: "number",
        default: 10_000,
        description:
          "Wait time in milliseconds when no response header provides guidance",
      },
      {
        displayName: "Random Jitter (±%)",
        name: "jitterPercent",
        type: "number",
        default: 25,
        description:
          "Randomize wait time by ±N% to prevent thundering herd effects across parallel executions",
      },
      {
        displayName: "Max Throttle Retries",
        name: "maxThrottleTries",
        type: "number",
        default: 10,
        description:
          "Maximum number of throttling retries before throwing an error",
      },
    ],
  },
];
