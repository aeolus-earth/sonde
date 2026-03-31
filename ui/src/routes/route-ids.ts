/**
 * Full route IDs for `getRouteApi` in code-split page modules.
 *
 * These match the IDs TanStack Router auto-computes from the path hierarchy:
 *   parent `id: "_authenticated"` → `/_authenticated`
 *   child `path: "/experiments"` → `/_authenticated/experiments`
 */
export const ROUTE_API = {
  authHome: "/_authenticated/",
  authExperiments: "/_authenticated/experiments",
  authExperimentDetail: "/_authenticated/experiments/$id",
  authTree: "/_authenticated/tree",
  authFindings: "/_authenticated/findings",
  authFindingDetail: "/_authenticated/findings/$id",
  authDirections: "/_authenticated/directions",
  authDirectionDetail: "/_authenticated/directions/$id",
  authQuestions: "/_authenticated/questions",
  authActivity: "/_authenticated/activity",
  authNotFound: "/_authenticated/$",
} as const;
