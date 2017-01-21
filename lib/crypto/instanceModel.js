/**
 * Created by Snoopy on 20-Jan-17.
 */
const initMethods = require('./dbMethods');
module.exports = (thorin, opt, Store, storeObj, config) => {

  const instance = {},
    logger = thorin.logger(opt.logger),
    crypto = storeObj.crypto;

  let dbMethods = initMethods(thorin, opt, storeObj);

  let pendingModels = [];

  /*
   * Binds the model and alters queries
   * */
  function prepareModel(modelObj) {
    /* BEFORE save */
    function onSave(iObj, opt, fn) {
      /* Check if crypto is disabled */
      if (typeof opt === 'object' && opt && opt.crypto === false) return fn();
      /* for each field, check if we have to encrypt*/
      let encrypted = modelObj.getEncrypted();
      for (let i = 0, len = encrypted.length; i < len; i++) {
        let fieldName = encrypted[i],
          fieldValue = iObj.getDataValue(fieldName);
        if (typeof fieldValue === 'undefined') {  // check default value;
          let _default = modelObj.fields[fieldName]._default;
          if (typeof _default !== 'undefined' && _default != null) {
            fieldValue = (typeof _default === 'function' ? _default() : _default);
          }
        }
        if (typeof fieldValue === 'undefined' || fieldValue == null) continue;
        // we now place it encrypted.
        if (crypto.isEncrypted(fieldValue)) continue;
        let enc = crypto.encrypt(fieldValue, opt.key);
        if (enc == null) continue;
        iObj.setDataValue(fieldName, enc);
        if (typeof iObj.__original_encrypted === 'undefined') {
          iObj.__original_encrypted = {};
        }
        iObj.__original_encrypted[fieldName] = fieldValue;
      }
      if (typeof fn === 'function') {
        fn();
      }
    }

    function onSaved(iObj) {
      if (typeof iObj.__original_encrypted === 'undefined') return;
      let fields = Object.keys(iObj.__original_encrypted);
      for (let i = 0, len = fields.length; i < len; i++) {
        let fieldName = fields[i],
          fieldValue = iObj.__original_encrypted[fieldName];
        iObj.setDataValue(fieldName, fieldValue);
      }
      delete iObj.__original_encrypted;
    }

    /*
     * Changes the WHERE statement.
     * */
    function prepareWhere(opt) {
      /* Check if crypto is disabled */
      if (opt.crypto === false) return;
      if (typeof opt.where !== 'object' || !opt.where) return;
      let fields = Object.keys(opt.where);
      for (let i = 0, len = fields.length; i < len; i++) {
        let fieldName = fields[i];
        if (!modelObj.isEncrypted(fieldName)) continue;
        let fieldValue = opt.where[fieldName];
        if (typeof fieldValue === 'undefined' || fieldValue == null) continue;
        if (crypto.isEncrypted(fieldValue)) continue;
        let enc = crypto.encrypt(fieldValue, opt.key);
        if (enc == null) continue;
        opt.where[fieldName] = enc;
      }
    }

    /*
     * Looks for JOINS in the include field
     * */
    function prepareInclude(opt) {
      if (opt.crypto === false) return;
      if (typeof opt.include === 'undefined') return;
      if (opt.include instanceof Array) {
        for (let i = 0, len = opt.include.length; i < len; i++) {
          singleInclude(opt.include[i]);
        }
      } else if (typeof opt.include === 'object' && opt.include) {
        singleInclude(opt.include);
      }
    }

    function singleInclude(obj) {
      if (typeof obj !== 'object' || !obj) return;
      if (typeof obj.where === 'object' && obj.where) {
        prepareWhere(obj);
      }
      if (typeof obj.include !== 'undefined') {
        prepareInclude(obj);
      }
    }

    function bulkChanges(opt, fn) {
      if (opt.crypto === false) return fn();
      // first check for encrypted where's
      if (typeof opt.where === 'object' && opt.where) {
        prepareWhere(opt);
      }
      if (typeof opt.attributes === 'object' && opt.attributes) {
        let fields = Object.keys(opt.attributes);
        for (let i = 0, len = fields.length; i < len; i++) {
          let fieldName = fields[i];
          if (!modelObj.isEncrypted(fieldName)) continue;
          let fieldValue = opt.attributes[fieldName];
          if (typeof fieldValue === 'undefined' || fieldValue == null) continue;
          if (crypto.isEncrypted(fieldValue)) continue;
          let enc = crypto.encrypt(fieldValue, opt.key);
          if (enc == null) continue;
          opt.attributes[fieldName] = enc;
        }
      }
      fn();
    }

    /*
     * Hook inside the findAll()
     * */
    function alterMultiFind(opt, fn) {
      if (typeof opt !== 'object' || !opt) return fn(opt);
      if (opt.crypto === false) return fn(opt);
      prepareWhere(opt);
      prepareInclude(opt);
      if (opt.raw !== true) {
        return fn(opt);
      }
      return fn(opt).then((items) => {
        if (items.length === 0) return items;
        for (let i = 0, len = items.length; i < len; i++) {
          let item = items[i],
            fields = Object.keys(item);
          for (let j = 0, llen = fields.length; j < llen; j++) {
            let fieldValue = item[fields[j]];
            if (crypto.isEncrypted(fieldValue)) {
              let encr = crypto.decrypt(fieldValue, opt.key);
              if (encr) {
                item[fields[j]] = encr;
              }
            }
          }
        }
        return items;
      });
    }

    function alterSingleFind(opt, fn) {
      if (typeof opt !== 'object' || !opt) return fn(opt);
      if (opt.crypto === false) return fn(opt);
      prepareWhere(opt);
      prepareInclude(opt);
      if (opt.raw !== true) return fn(opt);
      return fn(opt).then((item) => {
        if (typeof item !== 'object' || !item) return item;
        let fields = Object.keys(item);
        for (let j = 0, llen = fields.length; j < llen; j++) {
          let fieldValue = item[fields[j]];
          if (crypto.isEncrypted(fieldValue)) {
            let encr = crypto.decrypt(fieldValue, opt.key);
            if (encr) {
              item[fields[j]] = encr;
            }
          }
        }
        return item;
      });
    }

    function alterOrFind(opt, instance, fn) {
      if (typeof opt !== 'object' || !opt) return fn(opt);
      if (opt.crypto === false) return fn(opt);
      prepareWhere(opt);
      prepareInclude(opt);
      return fn(opt, instance);
    }

    function alterCount(opt, fn, _hasRows) {
      if (typeof opt !== 'object' || !opt) return fn(opt);
      if (opt.crypto === false) return fn(opt);
      prepareWhere(opt);
      prepareInclude(opt);
      if (opt.raw !== true || _hasRows !== true) return fn(opt);
      return fn(opt).then((res) => {
        if (typeof res !== 'object' || !res) return res;
        if (!(res.rows instanceof Array)) return res;
        for (let i = 0, len = res.rows.length; i < len; i++) {
          let item = res.rows[i],
            fields = Object.keys(item);
          for (let j = 0, llen = fields.length; j < llen; j++) {
            let fieldValue = item[fields[j]];
            if (crypto.isEncrypted(fieldValue)) {
              let encr = crypto.decrypt(fieldValue, opt.key);
              if (encr) {
                item[fields[j]] = encr;
              }
            }
          }
        }
        return res;
      });
    }

    /*
     * Recursively decrypt entity data
     * */
    function decryptEntity(data, modelObj) {
      if (typeof data !== 'object' || !data) return;
      let encrypted = modelObj.getEncrypted();
      for (let i = 0, len = encrypted.length; i < len; i++) {
        let fieldName = encrypted[i],
          fieldValue = data[fieldName];
        if (typeof fieldValue !== 'string') continue;
        if (!crypto.isEncrypted(fieldValue)) continue;
        let decrypted = crypto.decrypt(fieldValue, opt.key);
        if (decrypted == null) {
          logger.warn(`Could not decrypt field ${fieldName} of entity`);
          logger.debug(data);
          continue;
        }
        data[fieldName] = decrypted;
      }
      /* now check foreign relations */
      if (!modelObj.hasRelationFields()) return;
      let relations = modelObj.getRelationFields();
      for (let i = 0, len = relations.length; i < len; i++) {
        let relation = relations[i];
        if (typeof data[relation.field] === 'undefined') continue;
        let relationModel = storeObj.model(relation.model, true);
        if (!relationModel.hasEncryptedFields()) continue;
        if (data[relation.field] instanceof Array) {
          for (let j = 0; j < data[relation.field].length; j++) {
            decryptEntity(data[relation.field][j], relationModel);
          }
        } else if (typeof data[relation.field] === 'object' && data[relation.field]) {
          decryptEntity(data[relation.field], relationModel);
        }
      }
    }

    function bindToStore(storeObj) {
      let Instance = modelObj.getInstance();
      const names = [
        'findAll', 'findById', 'findOne', 'find', 'findAndCount',
        'count', 'sum', 'max', 'min'
      ];
      names.forEach((name) => {
        let baseFn = Instance[name].bind(Instance);
        switch (name) {
          case 'findAll':
            Instance[name] = function EncryptedFindWrapper(opt) {
              return alterMultiFind(opt, baseFn);
            };
            break;
          case 'find':
          case 'findById':
          case 'findOne':
            Instance[name] = function EncryptedReadWrapper(opt) {
              return alterSingleFind(opt, baseFn);
            };
            break;
          case 'findAndCount':
            Instance[name] = function EncryptedCountWrapper(opt) {
              return alterCount(opt, baseFn, true);
            };
            break;
          case 'findOrCreate':
          case 'findOrInitialize':
            Instance[name] = function EncryptedFindWrapper(opt, instance) {
              return alterOrFind(opt, instance, baseFn);
            };
            break;
          case 'count':
            Instance[name] = function EncryptedCountWrapper(opt) {
              if (typeof opt !== 'object' || !opt) return baseFn(opt);
              if (opt.crypto === false) return baseFn(opt);
              prepareWhere(opt);
              prepareInclude(opt);
              return baseFn(opt);
            };
            break;
          case 'sum':
          case 'min':
          case 'max':
            Instance[name] = function EncryptedFuncWrapper(field, opt) {
              if (typeof opt !== 'object' || !opt) return baseFn(field, opt);
              if (opt.crypto === false) return baseFn(field, opt);
              prepareWhere(opt);
              prepareInclude(opt);
              return baseFn(field, opt);
            };
            break;
        }
      });

      /* Override the default Build() function */
      let _build = Instance.build.bind(Instance);
      Instance.build = function (values, opt) {
        decryptEntity(values, modelObj);
        return _build(values, opt);
      };
    }

    bindToStore(storeObj);

    modelObj
      .hook('beforeBulkCreate', (instances, opt, fn) => {
        for (let i = 0, len = instances.length; i < len; i++) {
          onSave(instances[i], opt);
        }
        fn();
      })
      .hook('afterBulkCreate', (instances) => {
        for (let i = 0, len = instances.length; i < len; i++) {
          onSaved(instances[i]);
        }
      })
      .hook('beforeBulkUpdate', bulkChanges)
      .hook('beforeBulkDestroy', bulkChanges);

    modelObj
      .hook('beforeCreate', onSave)
      .hook('afterCreate', onSaved)
      .hook('beforeUpdate', onSave)
      .hook('afterUpdate', onSaved);
  }

  /*
   * Attaches and overrides default model functions to the given model
   * */
  instance.attach = (modelObj) => {
    pendingModels.push(modelObj);
    Object.keys(dbMethods).forEach((keyName) => {
      modelObj.static(keyName, dbMethods[keyName](modelObj));
    });
    return instance;
  };

  thorin.on(thorin.EVENT.RUN, `store.${storeObj.name}`, () => {
    pendingModels.forEach(modelObj => prepareModel(modelObj));
  });

  return instance;
};