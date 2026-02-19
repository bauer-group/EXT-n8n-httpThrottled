// nodes/HttpRequest/HttpRequestThrottled.node.ts

import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IHttpRequestOptions,    // v2: neues Options-Interface
  IDataObject,
  NodeOperationError,
  NodeApiError,
} from "n8n-workflow";

import { computeWaitMs, applyJitter } from "./throttling";

// ── Hilfsfunktion ─────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Node-Klasse ───────────────────────────────────────────────────────────────

export class HttpRequestThrottled implements INodeType {
  description: INodeTypeDescription = {
    name: "httpRequestThrottled",
    displayName: "HTTP Request (Throttled)",
    icon: "fa:at",
    group: ["output"],
    // v2: Versioned nodes – Array erlaubt mehrere Versionen gleichzeitig
    version: [1, 2, 3],
    defaultVersion: 3,
    subtitle: '={{$parameter["method"] + ": " + $parameter["url"]}}',
    description:
      "Makes an HTTP request and returns the response data (with throttling support)",
    defaults: { name: "HTTP Request (Throttled)", color: "#2200DD" },
    // Kompatibel mit n8n v1/v2: String-Literal 'main'
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
      // ── Kern-Properties (minimal, für Shadow-Override vollständig aus Core übernehmen) ──
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

      // ── Throttling-Erweiterung ────────────────────────────────────────────────
      {
        displayName: "Throttling aktivieren",
        name: "throttlingEnabled",
        type: "boolean",
        default: true,
        description:
          "Wartet automatisch bei Rate-Limit-Antworten (429 etc.) und wertet Response-Header aus",
        noDataExpression: true,
      },
      {
        displayName: "Throttling-Einstellungen",
        name: "throttling",
        type: "collection",
        placeholder: "Einstellung hinzufügen",
        default: {},
        displayOptions: { show: { throttlingEnabled: [true] } },
        options: [
          {
            displayName: "HTTP-Codes",
            name: "throttleCodes",
            type: "multiOptions",
            default: ["429"],
            description: "Bei diesen HTTP-Statuscodes wird Throttling ausgelöst",
            options: [
              { name: "429 Too Many Requests", value: "429" },
              { name: "503 Service Unavailable", value: "503" },
              { name: "504 Gateway Timeout", value: "504" },
            ],
          },
          {
            displayName: "Standard-Wartezeit (ms)",
            name: "defaultWaitMs",
            type: "number",
            default: 10_000,
            description:
              "Wartezeit in Millisekunden, wenn kein passender Response-Header vorhanden ist",
          },
          {
            displayName: "Zufällige Abweichung (±%)",
            name: "jitterPercent",
            type: "number",
            default: 25,
            description:
              "Streut die Wartezeit um ±N%, um Thundering-Herd-Effekte bei parallelen Executions zu vermeiden",
          },
          {
            displayName: "Max. Throttle-Versuche",
            name: "maxThrottleTries",
            type: "number",
            default: 10,
            description: "Maximale Anzahl Throttling-Retries bevor ein Fehler geworfen wird",
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

      // ── Request-Optionen zusammenbauen ──────────────────────────────────────

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

      // v2: IHttpRequestOptions – kein freies Objekt mehr
      const requestOptions: IHttpRequestOptions = {
        method: method as IHttpRequestOptions["method"],
        url,
        returnFullResponse: true,   // v2: Gibt { statusCode, headers, body } zurück
        ignoreHttpStatusErrors: true, // verhindert automatisches Throw bei 4xx/5xx
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

      // ── Throttling-Loop ─────────────────────────────────────────────────────

      let throttleAttempt = 0;

      while (true) {
        // v2: this.helpers.httpRequest statt this.helpers.request
        // Authentifizierung über httpRequestWithAuthentication wenn nötig
        const authentication = this.getNodeParameter(
          "authentication",
          itemIndex,
          "none"
        ) as string;

        let response: { statusCode: number; headers: Record<string, unknown>; body: unknown };

        try {
          if (authentication !== "none") {
            // Credential-Name aus authentication-Option ableiten
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
            // v2: this.helpers.httpRequest
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            response = await (this.helpers as any).httpRequest(
              requestOptions
            ) as typeof response;
          }
        } catch (err) {
          // Netzwerkfehler → direkt werfen, nicht throtteln
          if (err instanceof NodeApiError) throw err;
          throw new NodeOperationError(
            this.getNode(),
            `Netzwerkfehler: ${(err as Error).message}`,
            { itemIndex }
          );
        }

        const statusStr = String(response.statusCode);

        // ── Throttling-Branch ───────────────────────────────────────────────
        // KRITISCH: Dieser Branch darf Retry-on-Fail NICHT auslösen.
        // Deshalb kein throw, sondern manueller Sleep + continue.
        if (throttlingEnabled && throttleCodes.has(statusStr)) {
          throttleAttempt++;

          if (throttleAttempt >= maxThrottleTries) {
            throw new NodeOperationError(
              this.getNode(),
              `Throttling: Maximale Anzahl Versuche (${maxThrottleTries}) erreicht. Letzter Status: ${response.statusCode}`,
              { itemIndex }
            );
          }

          const baseWait = computeWaitMs(
            response.headers as Record<string, unknown>,
            defaultWaitMs
          );
          const wait = applyJitter(baseWait, jitterPercent);

          this.logger.info(
            `[Throttling] Status ${response.statusCode} – Item ${itemIndex}, Versuch ${throttleAttempt}/${maxThrottleTries}, warte ${Math.round(wait)}ms`
          );

          await sleep(wait);
          continue; // Retry – KEIN Retry-on-Fail
        }

        // ── Normaler Fehler (nicht Throttle-Code) ───────────────────────────
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

        // ── Erfolg ──────────────────────────────────────────────────────────
        const body = response.body;
        const json: IDataObject =
          typeof body === "object" && body !== null
            ? (body as IDataObject)
            : ({ data: body } as IDataObject);

        returnData.push({
          json,
          pairedItem: { item: itemIndex },
        });
        break; // Erfolg → Loop verlassen
      }
    }

    return [returnData];
  }
}
