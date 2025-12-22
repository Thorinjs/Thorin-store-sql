'use strict';
/**
 * These are the re-encrypt/encrypt/decrypt methods that
 * are attached to each individual model definition.
 * it will essentially allow us to handle re-encryption/decryption of databases.
 */
module.exports = (thorin, opt, storeObj) => {

  const methods = {},
    logger = thorin.logger(opt.logger);

  /**
   * This will essentially handle re-encryption of data
   * NOTE: each defined model will have this function attached as a
   * static method.
   * NOTE2: Since this function will use the findAll() functionality,
   * it will allow us to paginate through items.
   * OPTIONS:
   *  opt - the default findAll() options, but with encrypt=true;
   *  config.old_key - the old key to use, defaults to CURRENT_KEY. NOTE: if this is set to false, we will not use any key.
   *  config.new_key - the new key to use (required)
   *  config.batch -> the batch size, defaults to 100
   *  config.max -> max items to convert, defaults to all
   *  config.values -> if set to true, we will return the plain-text dataValue for each item.
   * */
  methods.reEncrypt = (modelObj) => {
    return function reEncrypt(opt, config) {
      if (typeof opt !== 'object' || !opt) opt = {};
      if (typeof config !== 'object' || !config) {
        if (typeof config === 'string') {
          config = {
            new_key: config
          };
        }
      }
      if (!config || !config.new_key) {
        return Promise.reject(thorin.error('STORE.CRYPTO', 'A new re-encryption key was not supplied'));
      }
      const OLD_KEY = (config.old_key || undefined),
        NEW_KEY = config.new_key,
        BATCH_SIZE = (typeof config.batch === 'number' ? config.batch : 100),
        MAX_SIZE = (typeof config.max === 'number' ? config.max : false);

      storeObj.crypto.addKey([NEW_KEY, OLD_KEY]);
      let result = {
          encrypted: 0
        },
        iObj = this;
      opt.crypto = true;
      if (OLD_KEY) {
        opt.key = OLD_KEY;
      }
      if (config.values) result.values = [];
      return storeObj.transaction((t) => {
        opt.transaction = t;
        let calls = [],
          itemCount = 0;
        /* step one: check how many items are.. */
        calls.push(() => {
          return this.count(opt).then((cnt) => itemCount = cnt);
        });

        /* based on the count, we create batches. */
        calls.push(() => {
          if (MAX_SIZE && itemCount > MAX_SIZE) itemCount = MAX_SIZE;
          let batches = [];
          for (let i = 0; i <= itemCount; i = i + BATCH_SIZE) {
            let min = i,
              max = i + BATCH_SIZE;
            max = Math.min(max, itemCount);
            addToBatch(batches, min, max);
          }
          return thorin.series(batches);
        });

        function addToBatch(batches, min, max) {
          batches.push(() => {
            let batchOpt = thorin.util.extend(opt, {
                offset: min,
                limit: max
              }),
              batchItems = [],
              updates = [];

            /* find all items  */
            updates.push(() => {
              return iObj.findAll(batchOpt).then((items) => batchItems = items);
            });

            updates.push(() => {
              let qry = [];
              batchItems.forEach((itemObj) => {
                if (typeof config.onItem === 'function') {
                  try {
                    config.onItem(itemObj);
                  } catch (e) {
                    logger.trace(`Error thrown in onItem() for batch ${min}-${max}. Skipping item.`);
                    return;
                  }
                }
                if (config.values === true) {
                  result.values.push(JSON.parse(JSON.stringify(itemObj.dataValues)));
                }
                qry.push(() => {
                  return itemObj.save({
                    transaction: t,
                    key: NEW_KEY
                  }).then(() => {
                    result.encrypted++;
                  })
                });
              });
              return thorin.series(qry);
            });
            return thorin.series(updates);
          });
        }

        return thorin.series(calls);
      }).then(() => {
        logger.info(`Re-encryption on model ${modelObj.code} successfully finalized`);
        return result;
      }).catch((e) => {
        logger.error(`Could not finalize re-encryption on model ${modelObj.code}`);
        logger.debug(e);
        throw e;
      });
    }
  };

  /**
   * This will essentially try to encrypt the entire table. It performs the same
   * as a findAll() query, but for non-encrypted entities (it does not encrypt the where)
   * and then, encrypt each individual row with the provided key, or the current key
   * OPTIONS:
   *   opt - the default findAll() options, but with encrypt=false
   *   config.new_key - the new key to use (required)
   *   config.batch -> the batch size, defaults to 100
   *   config.max -> max items to convert, default to all
   *   config.values -> if set to true, will return the plain-text dataValue for each item
   *   config.fields -> the fields we want to encrypt.
   * */
  methods.encrypt = (modelObj) => {
    return function encrypt(opt, config) {
      if (typeof opt !== 'object' || !opt) opt = {};
      if (typeof config !== 'object' || !config) {
        if (typeof config === 'string') {
          config = {
            new_key: config
          };
        }
      }
      if (!config || !config.new_key) {
        return Promise.reject(thorin.error('STORE.CRYPTO', 'A new encryption key was not supplied'));
      }
      const NEW_KEY = config.new_key || undefined,
        BATCH_SIZE = (typeof config.batch === 'number' ? config.batch : 100),
        MAX_SIZE = (typeof config.max === 'number' ? config.max : false);
      storeObj.crypto.addKey(NEW_KEY);
      let result = {
          encrypted: 0
        },
        iObj = this;
      if (config.values) result.values = [];
      let oldGetEncrypted;
      if (config.fields instanceof Array && config.fields.length > 0) {
        oldGetEncrypted = modelObj.getEncrypted;
        modelObj.getEncrypted = () => config.fields;
      }
      return storeObj.transaction((t) => {
        opt.transaction = t;
        let calls = [],
          itemCount = 0;

        /* step one: check how many items are.. */
        calls.push(() => {
          return this.count(opt).then((cnt) => itemCount = cnt);
        });

        /* based on the count, we create batches. */
        calls.push(() => {
          if (MAX_SIZE && itemCount > MAX_SIZE) itemCount = MAX_SIZE;
          let batches = [];
          for (let i = 0; i <= itemCount; i = i + BATCH_SIZE) {
            let min = i,
              max = i + BATCH_SIZE;
            max = Math.min(max, itemCount);
            addToBatch(batches, min, max);
          }
          return thorin.series(batches);
        });

        function addToBatch(batches, min, max) {
          batches.push(() => {
            let batchOpt = thorin.util.extend(opt, {
                offset: min,
                limit: max
              }),
              batchItems = [],
              updates = [];

            /* find all items  */
            updates.push(() => {
              return iObj.findAll(batchOpt).then((items) => batchItems = items);
            });
            updates.push(() => {
              let qry = [];
              batchItems.forEach((itemObj) => {
                if (typeof config.onItem === 'function') {
                  try {
                    config.onItem(itemObj);
                  } catch (e) {
                    logger.trace(`Error thrown in onItem() for batch ${min}-${max}. Skipping item.`);
                    return;
                  }
                }
                if (config.values === true) {
                  result.values.push(JSON.parse(JSON.stringify(itemObj.dataValues)));
                }
                qry.push(() => {
                  return itemObj.save({
                    key: NEW_KEY,
                    transaction: t,
                    crypto: true,
                    crypto_change: true
                  }).then(() => {
                    result.encrypted++;
                  })
                });
              });
              return thorin.series(qry);
            });
            return thorin.series(updates);
          });
        }

        return thorin.series(calls);
      }).then(() => {
        logger.info(`Encryption on model ${modelObj.code} successfully finalized`);
        if (oldGetEncrypted) modelObj.getEncrypted = oldGetEncrypted;
        return result;
      }).catch((e) => {
        if (oldGetEncrypted) modelObj.getEncrypted = oldGetEncrypted;
        logger.error(`Could not finalize encryption on model ${modelObj.code}`);
        logger.debug(e);
        throw e;
      });
    }

  };

  /**
   * This will essentially try to decrypt the entire table It will perform the same
   * as findAll() query with encrypted where's, and save each entity decrypted.
   * OPTIONS:
   *  opt - the default findAll() options, but with encrypt=true
   *  config.old_key - the key to use to decrypt. If specified, we will try to use it to decrypt
   *  config.batch -> the batch size, defaults to 100
   *  config.max -> max items to convert, defaults to all
   *  config.values -> if set to true, we will return the plain-text dataValue for each item.
   *  config.fields - if set, the config fiels we want to decrypt.
   * */
  methods.decrypt = (modelObj) => {
    return function decrypt(opt, config) {
      if (typeof opt !== 'object' || !opt) opt = {};
      if (typeof config !== 'object' || !config) {
        if (typeof config === 'string') {
          config = {
            old_key: config
          };
        }
      }
      if (!config) config = {};
      let customFields = config.fields instanceof Array && config.fields.length > 0 ? config.fields : false;
      let oldGetEncrypted;
      if (customFields) {
        oldGetEncrypted = modelObj.getEncrypted;
        modelObj.getEncrypted = () => customFields;
      }
      const BATCH_SIZE = (typeof config.batch === 'number' ? config.batch : 100),
        MAX_SIZE = (typeof config.max === 'number' ? config.max : false);
      if (typeof config.old_key === 'string') {
        storeObj.crypto.addKey(config.old_key);
      }
      let result = {
          decrypted: 0
        },
        iObj = this;
      if (config.values) result.values = [];
      return storeObj.transaction((t) => {
        opt.transaction = t;
        opt.crypto = true;
        let calls = [],
          itemCount = 0;

        /* step one: check how many items are.. */
        calls.push(() => {
          return this.count(opt).then((cnt) => itemCount = cnt);
        });

        /* based on the count, we create batches. */
        calls.push(() => {
          if (MAX_SIZE && itemCount > MAX_SIZE) itemCount = MAX_SIZE;
          let batches = [];
          for (let i = 0; i <= itemCount; i = i + BATCH_SIZE) {
            let min = i,
              max = i + BATCH_SIZE;
            max = Math.min(max, itemCount);
            addToBatch(batches, min, max);
          }
          return thorin.series(batches);
        });

        function addToBatch(batches, min, max) {
          batches.push(() => {
            let batchOpt = thorin.util.extend(opt, {
                offset: min,
                limit: max
              }),
              batchItems = [],
              updates = [],
              encryptedFields = modelObj.getEncrypted();
            batchOpt.crypto = true;
            batchOpt.crypto_fields = (customFields || encryptedFields);

            /* find all items  */
            updates.push(() => {
              return iObj.findAll(batchOpt).then((items) => batchItems = items);
            });
            updates.push(() => {
              let qry = [];
              batchItems.forEach((itemObj) => {
                if (typeof config.onItem === 'function') {
                  try {
                    config.onItem(itemObj);
                  } catch (e) {
                    logger.trace(`Error thrown in onItem() for batch ${min}-${max}. Skipping item.`);
                    return;
                  }
                }
                if (config.values === true) {
                  result.values.push(JSON.parse(JSON.stringify(itemObj.dataValues)));
                }
                qry.push(() => {
                  // update only encrypted fields.
                  let toChange = (customFields || encryptedFields);
                  toChange.forEach((item) => {
                    itemObj._changed[item] = true;
                  });
                  return itemObj.save({
                    crypto: false,
                    crypto_fields: toChange,
                    transaction: t
                  }).then(() => {
                    result.decrypted++;
                  })
                });
              });
              return thorin.series(qry);
            });
            return thorin.series(updates);
          });
        }

        return thorin.series(calls);
      }).then(() => {
        logger.info(`Decryption on model ${modelObj.code} successfully finalized`);
        if (oldGetEncrypted) modelObj.getEncrypted = oldGetEncrypted;
        return result;
      }).catch((e) => {
        if (oldGetEncrypted) modelObj.getEncrypted = oldGetEncrypted;
        logger.error(`Could not finalize decryption on model ${modelObj.code}`);
        logger.debug(e);
        throw e;
      });
    };
  }


  return methods;
};
