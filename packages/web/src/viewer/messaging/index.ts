/**
 * Messaging primitives library — WebSocket flow control utilities.
 *
 * This zone collects four independent, framework-agnostic primitives that
 * regulate the frequency and batching of viewer-to-server message delivery:
 *
 *   - **MessageCoalescer** — batches rapid sequential WebSocket messages
 *     into a single flush to avoid redundant fetch calls.
 *   - **MessageThrottle** — per-type trailing-edge debounce with independent
 *     timers, so different message types throttle at different rates.
 *   - **CallRateLimiter** — caps outbound API call frequency with automatic
 *     queue draining.
 *   - **RequestDedup** — deduplicates in-flight requests by key, returning
 *     the same promise to all concurrent callers.
 *
 * These utilities are intentionally separate (low internal coupling) because
 * each solves a distinct flow-control concern. They compose at the consumer
 * level — e.g. a view pipes WebSocket events through the throttle, into the
 * coalescer, with fetch calls gated by the rate limiter and deduplicator.
 *
 * All consumers should import from this barrel rather than individual
 * implementation files. This provides a stable API surface that decouples
 * consumers from internal module reorganization.
 */

export {
  createCallRateLimiter,
  type CallRateLimiter,
  type CallRateLimiterConfig,
} from "./call-rate-limiter.js";

export {
  createMessageCoalescer,
  type MessageCoalescer,
  type MessageCoalescerConfig,
  type ParsedWSMessage,
  type CoalescedBatch,
} from "./message-coalescer.js";

export {
  createMessageThrottle,
  type MessageThrottle,
  type ThrottledHandlerConfig,
} from "./message-throttle.js";

export {
  createRequestDedup,
  type RequestDedup,
} from "./request-dedup.js";
