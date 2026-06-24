// All event-management (QuadCode congress) pages are namespaced under this
// base path so they never collide with the existing review-system routes
// (which already own "/dashboard" and "/admin").
export const EVENT_BASE = "/congresso";
export const e = (p = "") => `${EVENT_BASE}${p}`;
