/**
 * SHA-1 hexadécimal via Web Crypto (disponible dans Node et dans les webviews).
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha1Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
