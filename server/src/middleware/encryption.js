/**
 * Encryption Middleware
 *
 * Provides AES-256-GCM encryption and decryption for sensitive data.
 * Used primarily for API key storage.
 *
 * TODO: Implement in Step 2 - Multi-Tenant API Key Support
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config/default.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string using AES-256-GCM.
 *
 * @param {string} plaintext - The text to encrypt.
 * @returns {Object} Object containing encrypted data and IV.
 */
export function encrypt(plaintext) {
  const key = config.security.encryptionKey;

  if (!key) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  // Convert hex key to buffer
  const keyBuffer = Buffer.from(key, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  // Generate random IV
  const iv = randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  // Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypt a string using AES-256-GCM.
 *
 * @param {string} encrypted - The encrypted hex string.
 * @param {string} ivHex - The IV as hex string.
 * @param {string} authTagHex - The auth tag as hex string.
 * @returns {string} The decrypted plaintext.
 */
export function decrypt(encrypted, ivHex, authTagHex) {
  const key = config.security.encryptionKey;

  if (!key) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  // Convert hex values to buffers
  const keyBuffer = Buffer.from(key, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  // Create decipher
  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  // Decrypt
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a random encryption key.
 *
 * @returns {string} 32-byte hex string suitable for ENCRYPTION_KEY.
 */
export function generateKey() {
  return randomBytes(32).toString('hex');
}
