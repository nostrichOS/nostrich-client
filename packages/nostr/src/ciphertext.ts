/** Did an encryption call actually produce ciphertext. */
export function isCiphertext(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** Did an encryption call produce ciphertext that does not contain the message. */
export function isSealed(value: string | undefined | null, plaintext: string): value is string {
  if (!isCiphertext(value)) return false
  if (plaintext === '') return true
  // Both directions: an echo of the input, and an "encryption" that merely wrapped.
  return !value.includes(plaintext) && !plaintext.includes(value)
}
