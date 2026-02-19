import type {
  IExecuteFunctions,
  IHttpRequestOptions,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import { computeWaitMs, applyJitter } from "./throttling";

export interface ThrottleConfig {
  codes: Set<string>;
  defaultWaitMs: number;
  jitterPercent: number;
  maxRetries: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps `this.helpers.httpRequest` and `this.helpers.httpRequestWithAuthentication`
 * with transparent throttling. When a response has a throttle status code,
 * the wrapper waits and retries automatically. The caller (V3 execute) never
 * sees the throttle response.
 */
export function wrapHelpersWithThrottling(
  ctx: IExecuteFunctions,
  config: ThrottleConfig,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const helpers = ctx.helpers as any;

  const originalHttpRequest = helpers.httpRequest.bind(helpers);
  const originalHttpRequestWithAuth =
    helpers.httpRequestWithAuthentication.bind(ctx);

  helpers.httpRequest = async (
    requestOptions: IHttpRequestOptions,
  ): Promise<any> => {
    return throttledCall(
      ctx,
      config,
      requestOptions,
      (opts) => originalHttpRequest(opts),
    );
  };

  helpers.httpRequestWithAuthentication = async (
    credentialsType: string,
    requestOptions: IHttpRequestOptions,
    additionalCredentialOptions?: unknown,
  ): Promise<any> => {
    return throttledCall(
      ctx,
      config,
      requestOptions,
      (opts) =>
        originalHttpRequestWithAuth(
          credentialsType,
          opts,
          additionalCredentialOptions,
        ),
    );
  };
}

async function throttledCall(
  ctx: IExecuteFunctions,
  config: ThrottleConfig,
  requestOptions: IHttpRequestOptions,
  doRequest: (opts: IHttpRequestOptions) => Promise<any>,
): Promise<any> {
  const wantFullResponse = requestOptions.returnFullResponse === true;
  const wantIgnoreErrors = requestOptions.ignoreHttpStatusErrors === true;

  // Force full response so we can inspect the status code
  const patchedOptions: IHttpRequestOptions = {
    ...requestOptions,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  };

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const response = await doRequest(patchedOptions);

    const statusCode =
      typeof response === "object" && response !== null
        ? response.statusCode ?? response.status ?? 200
        : 200;
    const statusStr = String(statusCode);

    if (config.codes.has(statusStr)) {
      if (attempt >= config.maxRetries) {
        throw new NodeOperationError(ctx.getNode(),
          `Throttling: max retries (${config.maxRetries}) exceeded. Last status: ${statusCode}`,
        );
      }

      const headers =
        typeof response === "object" && response !== null
          ? response.headers ?? {}
          : {};
      const baseWait = computeWaitMs(headers, config.defaultWaitMs);
      const wait = applyJitter(baseWait, config.jitterPercent);

      ctx.logger.info(
        `[Throttling] Status ${statusCode}, attempt ${attempt + 1}/${config.maxRetries}, waiting ${Math.round(wait)}ms`,
      );

      await sleep(wait);
      continue;
    }

    // Not a throttle response — restore original behavior
    if (!wantIgnoreErrors && statusCode >= 400) {
      // The original httpRequest would have thrown; re-throw with original options
      // so n8n's error formatting applies
      return doRequest(requestOptions);
    }

    if (!wantFullResponse) {
      // Caller only wanted the body
      return typeof response === "object" && response !== null
        ? response.body
        : response;
    }

    return response;
  }
}
