/**
 * Messaging zone public interface.
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
