import crypto from 'crypto';

const SIMPLE_ENCRYPTION_KEY = crypto
  .createHash('sha256')
  // .update(config.SIMPLE_ENCRYPTION_KEY)
  .update('starchan') // todo
  .digest('hex')
  .slice(0, 16);

/*
 * Generates a random 8-character ID.
 */
export function randomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/*
 * Encrypts a string with a simple encryption key.
 */
export const encrypt = function (str: string): string {
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    SIMPLE_ENCRYPTION_KEY,
    SIMPLE_ENCRYPTION_KEY
  );
  const encrypted = cipher.update(str, 'utf8', 'hex');
  return encrypted + cipher.final('hex');
};

/*
 * Decrypts a string with a simple encryption key.
 */
export const decrypt = function (str: string): string {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    SIMPLE_ENCRYPTION_KEY,
    SIMPLE_ENCRYPTION_KEY
  );
  const decrypted = decipher.update(str, 'hex', 'utf8');
  return decrypted + decipher.final('utf8');
};
