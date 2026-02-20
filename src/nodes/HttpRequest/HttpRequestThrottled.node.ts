import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  INodeProperties,
  IHttpRequestOptions,
  IDataObject,
} from "n8n-workflow";
import { NodeOperationError, NodeApiError } from "n8n-workflow";

import { loadV3Node, type V3NodeRef } from "./v3-loader";
import { wrapHelpersWithThrottling, type ThrottleConfig } from "./throttle-wrapper";
import { throttlingProperties } from "./throttling-props";
import { computeWaitMs, applyJitter } from "./throttling";

// ── Filter properties to latest V3 version ───────────────────────────────────
// V3 contains properties for MULTIPLE sub-versions (3, 3.1, 4, 4.1, …).
// Duplicate properties exist for different versions (e.g. two "method" defs).
// We filter to keep ONLY properties visible at the latest version, then strip
// the @version gate so they work with our version: 1 (DB requires integer).

function filterToVersion(
  properties: INodeProperties[],
  targetVersion: number,
): INodeProperties[] {
  return properties
    .filter((prop) => {
      const showVersions = prop.displayOptions?.show?.["@version"];
      const hideVersions = prop.displayOptions?.hide?.["@version"];

      // No version gate → visible in all versions, keep it
      if (!showVersions && !hideVersions) return true;

      // show @version: keep only if targetVersion is in the list
      if (showVersions && Array.isArray(showVersions)) {
        if (!showVersions.includes(targetVersion)) return false;
      }

      // hide @version: discard if targetVersion is in the list
      if (hideVersions && Array.isArray(hideVersions)) {
        if (hideVersions.includes(targetVersion)) return false;
      }

      return true;
    })
    .map((prop) => {
      // Strip @version from kept properties (our node is version 1)
      const p = { ...prop };
      if (p.displayOptions) {
        p.displayOptions = { ...p.displayOptions };
        if (p.displayOptions.show?.["@version"]) {
          p.displayOptions.show = { ...p.displayOptions.show };
          delete p.displayOptions.show["@version"];
          if (Object.keys(p.displayOptions.show).length === 0) {
            delete p.displayOptions.show;
          }
        }
        if (p.displayOptions.hide?.["@version"]) {
          p.displayOptions.hide = { ...p.displayOptions.hide };
          delete p.displayOptions.hide["@version"];
          if (Object.keys(p.displayOptions.hide).length === 0) {
            delete p.displayOptions.hide;
          }
        }
        if (!p.displayOptions.show && !p.displayOptions.hide) {
          delete p.displayOptions;
        }
      }

      // Recurse into fixedCollection / collection values
      if (p.options) {
        p.options = p.options.map((opt: any) => {
          if (opt.values && Array.isArray(opt.values)) {
            return { ...opt, values: filterToVersion(opt.values, targetVersion) };
          }
          return opt;
        });
      }

      return p;
    });
}

// ── V3 node loading (lazy – deferred until first class instantiation) ────────

let v3Ref: V3NodeRef | null | undefined; // undefined = not yet attempted

function getV3Ref(): V3NodeRef | null {
  if (v3Ref === undefined) {
    v3Ref = loadV3Node();
  }
  return v3Ref;
}

// ── Fallback description (used when n8n-nodes-base is not available) ──────────

const fallbackDescription: INodeTypeDescription = {
  name: "httpRequestThrottled",
  displayName: "HTTP Request (Throttled)",
  icon: "fa:globe",
  group: ["output"],
  version: 1,
  subtitle: '={{$parameter["method"] + ": " + $parameter["url"]}}',
  description:
    "Makes an HTTP request with automatic rate-limit throttling",
  defaults: { name: "HTTP Request (Throttled)", color: "#FF8500" },
  inputs: ["main"],
  outputs: ["main"],
  credentials: [
    { name: "httpBasicAuth", required: false, displayOptions: { show: { authentication: ["basicAuth"] } } },
    { name: "httpHeaderAuth", required: false, displayOptions: { show: { authentication: ["headerAuth"] } } },
    { name: "oAuth1Api", required: false, displayOptions: { show: { authentication: ["oAuth1"] } } },
    { name: "oAuth2Api", required: false, displayOptions: { show: { authentication: ["oAuth2"] } } },
  ],
  properties: [
    {
      displayName: "Method", name: "method", type: "options", default: "GET",
      options: [
        { name: "DELETE", value: "DELETE" }, { name: "GET", value: "GET" },
        { name: "HEAD", value: "HEAD" }, { name: "OPTIONS", value: "OPTIONS" },
        { name: "PATCH", value: "PATCH" }, { name: "POST", value: "POST" },
        { name: "PUT", value: "PUT" },
      ],
    },
    { displayName: "URL", name: "url", type: "string", default: "", placeholder: "https://example.com", required: true },
    {
      displayName: "Authentication", name: "authentication", type: "options", default: "none",
      options: [
        { name: "None", value: "none" }, { name: "Basic Auth", value: "basicAuth" },
        { name: "Header Auth", value: "headerAuth" }, { name: "OAuth1", value: "oAuth1" },
        { name: "OAuth2", value: "oAuth2" },
      ],
    },
    { displayName: "Send Headers", name: "sendHeaders", type: "boolean", default: false },
    {
      displayName: "Header Parameters", name: "headerParameters", type: "fixedCollection",
      typeOptions: { multipleValues: true }, default: { parameters: [] },
      displayOptions: { show: { sendHeaders: [true] } },
      options: [{ name: "parameters", displayName: "Header", values: [
        { displayName: "Name", name: "name", type: "string", default: "" },
        { displayName: "Value", name: "value", type: "string", default: "" },
      ] }],
    },
    { displayName: "Send Body", name: "sendBody", type: "boolean", default: false },
    {
      displayName: "Body Content Type", name: "contentType", type: "options",
      displayOptions: { show: { sendBody: [true] } }, default: "json",
      options: [
        { name: "JSON", value: "json" }, { name: "Form Urlencoded", value: "form-urlencoded" },
        { name: "Raw", value: "raw" },
      ],
    },
    {
      displayName: "Body", name: "body", type: "string",
      displayOptions: { show: { sendBody: [true] } }, default: "", typeOptions: { rows: 4 },
    },
    ...throttlingProperties,
  ],
};

// ── Helper ────────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function readThrottleConfig(ctx: IExecuteFunctions): ThrottleConfig {
  // Read from first item — throttling config applies to the entire execution
  const throttlingParams = ctx.getNodeParameter("throttling", 0, {}) as {
    throttleCodes?: string[];
    defaultWaitMs?: number;
    jitterPercent?: number;
    maxThrottleTries?: number;
  };

  return {
    codes: new Set((throttlingParams.throttleCodes ?? ["429"]).map(String)),
    defaultWaitMs: throttlingParams.defaultWaitMs ?? 5_000,
    jitterPercent: throttlingParams.jitterPercent ?? 25,
    maxRetries: Math.max(1, throttlingParams.maxThrottleTries ?? 5),
  };
}

// ── Node class ────────────────────────────────────────────────────────────────

export class HttpRequestThrottled implements INodeType {
  description: INodeTypeDescription;

  constructor() {
    const v3 = getV3Ref();
    if (v3) {
      // Copy only properties + credentials from V3 (safe for community nodes).
      // Strip @version display gates so all V3 features are visible at version 1.
      this.description = {
        name: "httpRequestThrottled",
        displayName: "HTTP Request (Throttled)",
        icon: "fa:globe" as const,
        version: 1,
        group: ["output"],
        subtitle: '={{$parameter["method"] + ": " + $parameter["url"]}}',
        description:
          "Makes an HTTP request with automatic rate-limit throttling",
        defaults: { name: "HTTP Request (Throttled)", color: "#FF8500" },
        inputs: ["main"],
        outputs: ["main"],
        credentials: v3.description.credentials,
        properties: [
          ...filterToVersion(
            v3.description.properties,
            Math.max(
              ...(Array.isArray(v3.description.version)
                ? v3.description.version
                : [v3.description.version]),
            ),
          ),
          ...throttlingProperties,
        ],
      };
    } else {
      this.description = fallbackDescription;
    }
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    let throttlingEnabled: boolean;
    try {
      throttlingEnabled = this.getNodeParameter("throttlingEnabled", 0, true) as boolean;
    } catch {
      throttlingEnabled = true;
    }

    // ── V3 path: delegate to the original node with throttled helpers ──────
    const v3 = getV3Ref();
    if (v3?.execute) {
      if (throttlingEnabled) {
        const config = readThrottleConfig(this);
        wrapHelpersWithThrottling(this, config);
      }
      return (await v3.execute.call(this)) as INodeExecutionData[][];
    }

    // ── Fallback path: minimal implementation ─────────────────────────────
    return fallbackExecute.call(this, throttlingEnabled);
  }
}

// ── Fallback execute (when n8n-nodes-base is not available) ───────────────────

async function fallbackExecute(
  this: IExecuteFunctions,
  throttlingEnabled: boolean,
): Promise<INodeExecutionData[][]> {
  const items = this.getInputData();
  const returnData: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const throttlingParams = throttlingEnabled
      ? (this.getNodeParameter("throttling", itemIndex, {}) as {
          throttleCodes?: string[];
          defaultWaitMs?: number;
          jitterPercent?: number;
          maxThrottleTries?: number;
        })
      : {};

    const throttleCodes = new Set(
      (throttlingParams.throttleCodes ?? ["429"]).map(String),
    );
    const defaultWaitMs = throttlingParams.defaultWaitMs ?? 5_000;
    const jitterPercent = throttlingParams.jitterPercent ?? 25;
    const maxThrottleTries = Math.max(1, throttlingParams.maxThrottleTries ?? 5);

    const method = this.getNodeParameter("method", itemIndex, "GET") as string;
    const url = this.getNodeParameter("url", itemIndex) as string;
    const sendHeaders = this.getNodeParameter("sendHeaders", itemIndex, false) as boolean;
    const sendBody = this.getNodeParameter("sendBody", itemIndex, false) as boolean;

    const requestOptions: IHttpRequestOptions = {
      method: method as IHttpRequestOptions["method"],
      url,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
      headers: {},
    };

    if (sendHeaders) {
      const headerParams = this.getNodeParameter(
        "headerParameters.parameters", itemIndex, [],
      ) as Array<{ name: string; value: string }>;
      for (const h of headerParams) {
        (requestOptions.headers as Record<string, string>)[h.name] = h.value;
      }
    }

    if (sendBody) {
      const contentType = this.getNodeParameter("contentType", itemIndex, "json") as string;
      const bodyRaw = this.getNodeParameter("body", itemIndex, "") as string;
      if (contentType === "json") {
        try { requestOptions.body = JSON.parse(bodyRaw); } catch { requestOptions.body = bodyRaw; }
        (requestOptions.headers as Record<string, string>)["content-type"] = "application/json";
      } else {
        requestOptions.body = bodyRaw;
      }
    }

    let throttleAttempt = 0;
    while (true) {
      const authentication = this.getNodeParameter("authentication", itemIndex, "none") as string;
      let response: { statusCode: number; headers: Record<string, unknown>; body: unknown };

      try {
        if (authentication !== "none") {
          const credMap: Record<string, string> = {
            basicAuth: "httpBasicAuth", headerAuth: "httpHeaderAuth",
            oAuth1: "oAuth1Api", oAuth2: "oAuth2Api",
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          response = await (this.helpers as any).httpRequestWithAuthentication(
            credMap[authentication] ?? authentication, requestOptions,
          ) as typeof response;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          response = await (this.helpers as any).httpRequest(requestOptions) as typeof response;
        }
      } catch (err) {
        if (err instanceof NodeApiError) throw err;
        throw new NodeOperationError(
          this.getNode(), `Network error: ${(err as Error).message}`, { itemIndex },
        );
      }

      const statusStr = String(response.statusCode);

      if (throttlingEnabled && throttleCodes.has(statusStr)) {
        throttleAttempt++;
        if (throttleAttempt >= maxThrottleTries) {
          throw new NodeOperationError(this.getNode(),
            `Throttling: max retries (${maxThrottleTries}) exceeded. Last status: ${response.statusCode}`,
            { itemIndex },
          );
        }
        const baseWait = computeWaitMs(response.headers as Record<string, unknown>, defaultWaitMs);
        const wait = applyJitter(baseWait, jitterPercent);
        this.logger.info(
          `[Throttling] Status ${response.statusCode} – item ${itemIndex}, attempt ${throttleAttempt}/${maxThrottleTries}, waiting ${Math.round(wait)}ms`,
        );
        await sleep(wait);
        continue;
      }

      if (response.statusCode >= 400) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: `HTTP ${response.statusCode}`, body: response.body as IDataObject } as IDataObject,
            pairedItem: { item: itemIndex },
          });
          break;
        }
        throw new NodeOperationError(this.getNode(),
          `HTTP ${response.statusCode}: ${JSON.stringify(response.body)}`, { itemIndex },
        );
      }

      const body = response.body;
      const json: IDataObject = typeof body === "object" && body !== null
        ? (body as IDataObject)
        : ({ data: body } as IDataObject);
      returnData.push({ json, pairedItem: { item: itemIndex } });
      break;
    }
  }

  return [returnData];
}
