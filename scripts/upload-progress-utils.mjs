/**
 * Upload progress helpers.
 *
 * Kept free of Foundry/browser globals so the estimation logic can be tested
 * under Node. The UI still treats server progress as authoritative; these
 * helpers only fill the silent client-side gaps while a large PDF is being
 * read and queued into the WebSocket.
 */

/**
 * Clamp a percentage into the inclusive 0-100 range.
 *
 * @param {number} value - Candidate percentage.
 * @returns {number} Clamped percentage.
 */
export function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Keep progress from visually moving backwards.
 *
 * @param {number} previous - Previous displayed percentage.
 * @param {number} next - Next candidate percentage.
 * @returns {number} Monotonic percentage.
 */
export function monotonicPercent(previous, next) {
  return Math.max(clampPercent(previous), clampPercent(next));
}

/**
 * Estimate client-side transfer progress from WebSocket bufferedAmount.
 *
 * bufferedAmount starts around the serialized message size after send() and
 * drains as the browser writes bytes to the network. Reserve only a slice of
 * the total operation for this estimate so server-side parsing/compression can
 * still report meaningful later progress.
 *
 * @param {number} totalBytes - Initial bytes queued by the WebSocket send.
 * @param {number} bufferedBytes - Current WebSocket bufferedAmount.
 * @param {number} startPercent - Percent shown when transfer starts.
 * @param {number} endPercent - Percent shown when the browser queue drains.
 * @returns {number} Estimated operation percentage.
 */
export function estimateBufferedTransferProgress(totalBytes, bufferedBytes, startPercent = 15, endPercent = 45) {
  const start = clampPercent(startPercent);
  const end = Math.max(start, clampPercent(endPercent));

  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return start;

  const remaining = Math.min(totalBytes, Math.max(0, Number.isFinite(bufferedBytes) ? bufferedBytes : totalBytes));
  const sentRatio = 1 - (remaining / totalBytes);
  return clampPercent(start + ((end - start) * sentRatio));
}

/**
 * Format upload throughput for user-facing heartbeat messages.
 *
 * @param {number} bytesPerSecond - Bytes per second.
 * @returns {string} Human-readable speed, or empty string when unavailable.
 */
export function formatUploadSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}
