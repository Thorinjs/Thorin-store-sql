/**
 * The cryptor class will essentially handle the decrypting/encrypting of
 * entities, versioning the encryption key so that we can change it later on.
 * The pattern we use to perform such a thing is:
 * CRYPTOR configuration data:
 *  config.prefix - the prefix we use to see which rows are encrypted (optional)
 *  config.separator - the separator we use in our encryption protocol (optional)
 *  config.key - if present, the current key to use to encrypt items.
 *  config.keys[] - if present, an array history of keys to use to decrypt items.
 *
 *  NOTE:
 *    - at least config.key or config.keys should be present. IF config.key is not present, we use the first item in keys.
 *    IF no keys are present, we disable crypto.
 */
const SIGNATURE_LENGTH = 8;
module.exports = (thorin, opt, storeObj, config) => {
  const logger = thorin.logger(opt.logger);
  try {
    if (config.enabled === false) return false;
  } catch (e) {
  }
  if (typeof config !== 'object' || !config) {
    logger.trace(`Crypto config is missing`);
    return false;
  }
  if (typeof config.key !== 'string' && typeof config.keys === 'undefined') {
    logger.warn(`No crypto keys found. Crypto is disabled`);
    return false;
  }
  let CURRENT_KEY = false,
    AVAILABLE_KEYS = {};
  if (typeof config.key === 'string') {
    CURRENT_KEY = config.key;
  } else {
    if (config.keys instanceof Array && config.keys.length !== 0) {
      CURRENT_KEY = config.keys[0];
    } else if (typeof config.keys === 'object' && config.keys) {
      let tmp = Object.keys(config.keys);
      CURRENT_KEY = config.keys[tmp[0]];
    }
  }
  if (!CURRENT_KEY) {
    logger.warn(`Crypto key provided is not valid. Crypto is disabled`);
    return false;
  }
  if (!config.keys) config.keys = [];
  /*
   * We now Prepare the AVAILABLE_KEYS map.
   * This is done by creating a SHA1 of the key, and use the first 6 bytes to version the key.
   * */
  const VERSION_CACHE = {};

  let currentKeyVersion = getKeyVersion(CURRENT_KEY);
  AVAILABLE_KEYS[currentKeyVersion] = CURRENT_KEY;
  if (config.keys instanceof Array) {
    for (let i = 0, len = config.keys.length; i < len; i++) {
      let key = config.keys[i],
        ver = getKeyVersion(key);
      AVAILABLE_KEYS[ver] = key;
    }
  } else if (typeof config.keys === 'object' && config.keys) {
    let tmp = Object.keys(config.keys);
    for (let i = 0, len = tmp.length; i < len; i++) {
      let key = config.keys[tmp[i]],
        ver = getKeyVersion(key);
      AVAILABLE_KEYS[ver] = key;
    }
  }
  const PREFIX = (typeof config.prefix === 'string' ? config.prefix : '$$#'),
    SEPARATOR = (typeof config.separator === 'string' ? config.separator : ':');

  /*
   * Versions the given key returning a SIGNATURE_LENGTH string.
   * This allows us to version encrypted content
   * */
  function getKeyVersion(key) {
    if (typeof VERSION_CACHE[key] !== 'string') {
      let sign = thorin.util.sha2(key + thorin.util.sha1(key));
      sign = sign.substr(0, SIGNATURE_LENGTH);
      VERSION_CACHE[key] = sign;
      AVAILABLE_KEYS[sign] = key;
    }
    return VERSION_CACHE[key];
  }

  class SqlCryptor {

    constructor() {
      this.version = '1';
    }

    /* Interface to add a new key to the internal cache. Returns signature */
    addKey(key) {
      if (key instanceof Array) {
        for (let i = 0, len = key.length; i < len; i++) {
          if (typeof key[i] !== 'string' || !key[i]) continue;
          if (key[i].length < 32) continue;
          if (key[i].length > 32) key[i] = key[i].substr(0, 32);
          getKeyVersion(key[i]);
        }
        return true;
      }
      if (typeof key !== 'string' || !key) return false;
      if (key.length < 32) return false;
      if (key.length > 32) key = key.substr(0, 32);
      return getKeyVersion(key);
    }

    /* Verifies if the given value is already encrypted */
    isEncrypted(value) {
      if (typeof value !== 'string' || !value) return false;
      if (value.substr(0, PREFIX.length + SEPARATOR.length) === `${PREFIX}${SEPARATOR}`) return true;
      return false;
    }


    /*
     * Encryption pattern is:
     * PREFIX:${VERSION}:${encryptedValue}
     * */
    /*
     * Encrypts the given value with the given key, using a versioning
     * system
     * NOTE: - if _version is set,  we will consider the key as an object
     * with versions for differnet keys
     * Default encryption goes with AES-256-CBC
     * Eg:
     *  - {
     *    "1": "myFirstEncryptionKey",
     *    "2": "mySecondEncryptionKey"
     *  }
     * */
    encrypt(value, key) {
      try {
        value = JSON.stringify(value);
      } catch (e) {
        logger.warn(`Could not stringify to encrypt model field`);
        return null;
      }
      if (typeof key !== 'string') {
        key = CURRENT_KEY;
      } else {
        if (key.length > 32) {
          key = key.substr(0, 32);
        } else if (key.length < 32) {
          logger.warn(`Supplied key is less than 32 characters. Skipping.`);
          return null;
        }
      }
      let keyVersion = getKeyVersion(key);
      try {
        value = thorin.util.encrypt(value, key);
        if (!value) return null;
      } catch (e) {
        return null;
      }
      if (!value) return null;
      let final = `${PREFIX}${SEPARATOR}${keyVersion}${SEPARATOR}${value}`;
      return final;
    }

    /*
     * Tries to decrypt the given value.
     * NOTE:
     * if we want versioning to function, the key should either be a string
     * or an object with multiple keys, per version.
     * EG:
     *  - if key is string, we try to use it to decrypt.
     *  - if key is object, we see the version of the encrypted value and try to use
     *  the appropiate key.
     * */
    decrypt(value, key) {
      if (typeof value !== 'string' || !value) return null;
      if (!this.isEncrypted(value)) return value;
      value = value.substr(PREFIX.length + SEPARATOR.length);
      let verIdx = value.indexOf(SEPARATOR);
      if (verIdx === -1) return null;
      let version = value.substr(0, verIdx);
      if (typeof AVAILABLE_KEYS[version] === 'string') {
        key = AVAILABLE_KEYS[version];
      } else if (typeof key === 'string') {
        if (key.length > 32) key = key.substr(0, 32);
        if (key.length < 32) return null;
      }
      value = value.substr(verIdx + SEPARATOR.length);
      // Try the key if string
      if (typeof key !== 'string' || !key) return null;
      let decrypted;
      try {
        decrypted = thorin.util.decrypt(value, key);
        if (!decrypted) return null;
        decrypted = JSON.parse(decrypted);
      } catch (e) {
        return null;
      }
      return decrypted;
    }

  }
  storeObj.crypto = new SqlCryptor();
  return true;
};
