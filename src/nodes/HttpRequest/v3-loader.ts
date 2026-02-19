import type {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
} from "n8n-workflow";

export interface V3NodeRef {
  description: INodeTypeDescription;
  execute: (
    this: IExecuteFunctions,
  ) => Promise<INodeExecutionData[][] | null>;
}

// Paths to try, ordered from newest n8n layout to oldest
const V3_REQUIRE_PATHS = [
  "n8n-nodes-base/dist/nodes/HttpRequest/V3/HttpRequestV3.node",
  "n8n-nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node",
];

export function loadV3Node(): V3NodeRef | null {
  for (const modulePath of V3_REQUIRE_PATHS) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(modulePath);
      const Ctor = mod.HttpRequestV3 as new () => INodeType;
      if (!Ctor) continue;

      const instance = new Ctor();
      if (!instance.description || !instance.execute) continue;

      return {
        description: instance.description,
        execute: instance.execute as V3NodeRef["execute"],
      };
    } catch {
      // Path not found in this n8n installation, try next
    }
  }

  return null;
}
