// All event-management (QuadCode congress) pages are namespaced under this
// base path so they never collide with the other portals (/estudante,
// /revisor, /admin, /co-chairs).
export const EVENT_BASE = "/congresso";
export const e = (p = "") => `${EVENT_BASE}${p}`;
