import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IHttpRequestOptions,
  IDataObject,
  NodeOperationError,
  NodeApiError,
} from "n8n-workflow";

import { computeWaitMs, applyJitter } from "./throttling";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class HttpRequestThrottled implements INodeType {
  description: INodeTypeDescription = {
    name: "httpRequestThrottled",
    displayName: "HTTP Request (Throttled)",
    icon: "fa:at",
    group: ["output"],
    version: [1, 2, 3],
    defaultVersion: 3,
    subtitle: '={{$parameter["method"] + ": " + $parameter["url"]}}',
    description:
      "Makes an HTTP request and returns the response data (with throttling support)",
    defaults: { name: "HTTP Request (Throttled)", color: "#FF8500" },
    inputs: ["main"],
    outputs: ["main"],
    credentials: [
      {
        name: "httpBasicAuth",
        required: false,
        displayOptions: { show: { authentication: ["basicAuth"] } },
      },
      {
        name: "httpHeaderAuth",
        required: false,
        displayOptions: { show: { authentication: ["headerAuth"] } },
      },
      {
        name: "oAuth1Api",
        required: false,
        displayOptions: { show: { authentication: ["oAuth1"] } },
      },
      {
        name: "oAuth2Api",
        required: false,
        displayOptions: { show: { authentication: ["oAuth2"] } },
      },
    ],
    properties: [
      // ── Core properties ──────────────────────────────────────────────────────
      {
        displayName: "Method",
        name: "method",
        type: "options",
        options: [
          { name: "DELETE", value: "DELETE" },
          { name: "GET", value: "GET" },
          { name: "HEAD", value: "HEAD" },
          { name: "OPTIONS", value: "OPTIONS" },
          { name: "PATCH", value: "PATCH" },
          { name: "POST", value: "POST" },
          { name: "PUT", value: "PUT" },
        ],
        default: "GET",
      },
      {
        displayName: "URL",
        name: "url",
        type: "string",
        default: "",
        placeholder: "https://example.com",
        required: true,
      },
      {
        displayName: "Authentication",
        name: "authentication",
        type: "options",
        options: [
          { name: "None", value: "none" },
          { name: "Basic Auth", value: "basicAuth" },
          { name: "Header Auth", value: "headerAuth" },
          { name: "OAuth1", value: "oAuth1" },
          { name: "OAuth2", value: "oAuth2" },
        ],
        default: "none",
      },
      {
        displayName: "Send Headers",
        name: "sendHeaders",
        type: "boolean",
        default: false,
      },
      {
        displayName: "Header Parameters",
        name: "headerParameters",
        type: "fixedCollection",
        typeOptions: { multipleValues: true },
        default: { parameters: [] },
        displayOptions: { show: { sendHeaders: [true] } },
        options: [
          {
            name: "parameters",
            displayName: "Header",
            values: [
              { displayName: "Name", name: "name", type: "string", default: "" },
              { displayName: "Value", name: "value", type: "string", default: "" },
            ],
          },
        ],
      },
      {
        displayName: "Send Body",
        name: "sendBody",
        type: "boolean",
        default: false,
      },
      {
        displayName: "Body Content Type",
        name: "contentType",
        type: "options",
        displayOptions: { show: { sendBody: [true] } },
        options: [
          { name: "JSON", value: "json" },
          { name: "Form Urlencoded", value: "form-urlencoded" },
          { name: "Raw", value: "raw" },
        ],
        default: "json",
      },
      {
        displayName: "Body",
        name: "body",
        type: "string",
        displayOptions: { show: { sendBody: [true] } },
        default: "",
        typeOptions: { rows: 4 },
      },

      // ── Throttling ─────────────────────────────────────────────────────────────
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
            description: "Maximum number of throttling retries before throwing an error",
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const throttlingEnabled = this.getNodeParameter(
        "throttlingEnabled",
        itemIndex,
        true
      ) as boolean;

      const throttlingParams = throttlingEnabled
        ? (this.getNodeParameter("throttling", itemIndex, {}) as {
            throttleCodes?: string[];
            defaultWaitMs?: number;
            jitterPercent?: number;
            maxThrottleTries?: number;
          })
        : {};

      const throttleCodes = new Set(
        (throttlingParams.throttleCodes ?? ["429"]).map(String)
      );
      const defaultWaitMs = throttlingParams.defaultWaitMs ?? 10_000;
      const jitterPercent = throttlingParams.jitterPercent ?? 25;
      const maxThrottleTries = Math.max(
        1,
        throttlingParams.maxThrottleTries ?? 10
      );

      // ── Build request options ────────────────────────────────────────────────

      const method = this.getNodeParameter("method", itemIndex, "GET") as string;
      const url = this.getNodeParameter("url", itemIndex) as string;
      const sendHeaders = this.getNodeParameter(
        "sendHeaders",
        itemIndex,
        false
      ) as boolean;
      const sendBody = this.getNodeParameter(
        "sendBody",
        itemIndex,
        false
      ) as boolean;

      const requestOptions: IHttpRequestOptions = {
        method: method as IHttpRequestOptions["method"],
        url,
        returnFullResponse: true,
        ignoreHttpStatusErrors: true, // prevent auto-throw on 4xx/5xx so we can handle throttling
        headers: {},
      };

      if (sendHeaders) {
        const headerParams = (
          this.getNodeParameter(
            "headerParameters.parameters",
            itemIndex,
            []
          ) as Array<{ name: string; value: string }>
        );
        for (const h of headerParams) {
          (requestOptions.headers as Record<string, string>)[h.name] = h.value;
        }
      }

      if (sendBody) {
        const contentType = this.getNodeParameter(
          "contentType",
          itemIndex,
          "json"
        ) as string;
        const bodyRaw = this.getNodeParameter("body", itemIndex, "") as string;

        if (contentType === "json") {
          try {
            requestOptions.body = JSON.parse(bodyRaw);
          } catch {
            requestOptions.body = bodyRaw;
          }
          (requestOptions.headers as Record<string, string>)["content-type"] =
            "application/json";
        } else {
          requestOptions.body = bodyRaw;
        }
      }

      // ── Throttling loop ──────────────────────────────────────────────────────

      let throttleAttempt = 0;

      while (true) {
        const authentication = this.getNodeParameter(
          "authentication",
          itemIndex,
          "none"
        ) as string;

        let response: { statusCode: number; headers: Record<string, unknown>; body: unknown };

        try {
          if (authentication !== "none") {
            // Map authentication option to credential name
            const credMap: Record<string, string> = {
              basicAuth: "httpBasicAuth",
              headerAuth: "httpHeaderAuth",
              oAuth1: "oAuth1Api",
              oAuth2: "oAuth2Api",
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            response = await (this.helpers as any).httpRequestWithAuthentication(
              credMap[authentication] ?? authentication,
              requestOptions
            ) as typeof response;
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            response = await (this.helpers as any).httpRequest(
              requestOptions
            ) as typeof response;
          }
        } catch (err) {
          if (err instanceof NodeApiError) throw err;
          throw new NodeOperationError(
            this.getNode(),
            `Network error: ${(err as Error).message}`,
            { itemIndex }
          );
        }

        const statusStr = String(response.statusCode);

        // ── Throttling branch ──────────────────────────────────────────────
        // Uses manual sleep + continue instead of throw to avoid triggering
        // n8n's built-in retry-on-fail mechanism.
        if (throttlingEnabled && throttleCodes.has(statusStr)) {
          throttleAttempt++;

          if (throttleAttempt >= maxThrottleTries) {
            throw new NodeOperationError(
              this.getNode(),
              `Throttling: max retries (${maxThrottleTries}) exceeded. Last status: ${response.statusCode}`,
              { itemIndex }
            );
          }

          const baseWait = computeWaitMs(
            response.headers as Record<string, unknown>,
            defaultWaitMs
          );
          const wait = applyJitter(baseWait, jitterPercent);

          this.logger.info(
            `[Throttling] Status ${response.statusCode} – item ${itemIndex}, attempt ${throttleAttempt}/${maxThrottleTries}, waiting ${Math.round(wait)}ms`
          );

          await sleep(wait);
          continue;
        }

        // ── Non-throttle error ────────────────────────────────────────────
        if (response.statusCode >= 400) {
          const continueOnFail = this.continueOnFail();
          if (continueOnFail) {
            returnData.push({
              json: {
                error: `HTTP ${response.statusCode}`,
                body: response.body as IDataObject,
              } as IDataObject,
              pairedItem: { item: itemIndex },
            });
            break;
          }
          throw new NodeOperationError(
            this.getNode(),
            `HTTP ${response.statusCode}: ${JSON.stringify(response.body)}`,
            { itemIndex }
          );
        }

        // ── Success ──────────────────────────────────────────────────────────
        const body = response.body;
        const json: IDataObject =
          typeof body === "object" && body !== null
            ? (body as IDataObject)
            : ({ data: body } as IDataObject);

        returnData.push({
          json,
          pairedItem: { item: itemIndex },
        });
        break;
      }
    }

    return [returnData];
  }
}
