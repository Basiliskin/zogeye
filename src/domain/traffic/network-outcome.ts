import type { RequestFact } from "../models.js";

/** True when a captured call completed with a response or an explicit error. */
export function hasNetworkOutcome(request: RequestFact): boolean {
  return (
    request.responseStatus != null ||
    request.source?.endsWith("-error") === true
  );
}
