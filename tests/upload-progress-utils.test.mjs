import assert from 'node:assert/strict';
import {
  clampPercent,
  estimateBufferedTransferProgress,
  formatUploadSpeed,
  monotonicPercent
} from '../scripts/upload-progress-utils.mjs';

assert.equal(clampPercent(-5), 0);
assert.equal(clampPercent(120), 100);
assert.equal(clampPercent(12.345), 12.345);
assert.equal(clampPercent(Number.NaN), 0);

assert.equal(monotonicPercent(20, 10), 20);
assert.equal(monotonicPercent(20, 25), 25);
assert.equal(monotonicPercent(20, 120), 100);

assert.equal(estimateBufferedTransferProgress(1000, 1000, 15, 45), 15);
assert.equal(estimateBufferedTransferProgress(1000, 500, 15, 45), 30);
assert.equal(estimateBufferedTransferProgress(1000, 0, 15, 45), 45);
assert.equal(estimateBufferedTransferProgress(0, 0, 15, 45), 15);
assert.equal(estimateBufferedTransferProgress(1000, -100, 15, 45), 45);

assert.equal(formatUploadSpeed(0), '');
assert.equal(formatUploadSpeed(512), '512 B/s');
assert.equal(formatUploadSpeed(1536), '1.5 KB/s');
assert.equal(formatUploadSpeed(2.5 * 1024 * 1024), '2.5 MB/s');

console.log('upload-progress-utils tests passed');
