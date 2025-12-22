/**
 * Created by Snoopy on 20-Jan-17.
 */

module.exports = (thorin, opt, Store, storeObj, config) => {
  const Seq = require('sequelize'),
    initInstance = require('./instanceModel');
  let InstanceModel;

  if (config.enabled) {
    InstanceModel = initInstance(thorin, opt, Store, storeObj, config);
  }


  class StoreModel extends Store.Model {

    #binds = false;
    #encrypted = [];
    #encryptedMap = {};
    #relationFields = false;


    constructor(code, name, file) {
      super(code, name, file);
      this.#binds = false;
      this.#encrypted = [];
      this.#encryptedMap = {};
      this.#relationFields = false;
      if (InstanceModel && !this.#binds) {
        this.#binds = true;
        InstanceModel.attach(this);
      }
    }

    /**
     * Verifies if the given field is encrypted
     * */
    isEncrypted(field) {
      return (typeof this.#encryptedMap[field] !== 'undefined');
    }

    hasEncryptedFields() {
      return this.#encrypted.length !== 0;
    }

    /**
     * Manually push the given field as encrypted
     *  */
    _addEncryptedField(field) {
      if (this.#encrypted.indexOf(field) === -1) {
        this.#encrypted.push(field);
        this.#encryptedMap[field] = true;
      }
      return this;
    }

    /**
     * Returns all encrypted fields
     *  */
    getEncrypted() {
      return this.#encrypted;
    }

    hasRelationFields() {
      return this.relations.length !== 0;
    }

    /**
     * Returns relation names
     *  */
    getRelationFields() {
      if (this.#relationFields !== false) return this.#relationFields;
      let names = [];
      for (let i = 0; i < this.relations.length; i++) {
        let item = this.relations[i];
        if (!item.options.as) continue;
        names.push({
          model: item.name,
          field: item.options.as
        });
      }
      this.#relationFields = names;
      return names;
    }

    /**
     * Simple wrapper over the field() function with encrypt = true;
     * */
    encryptedField(name, a, b) {
      if (!config.enabled) {
        let fieldType, fieldOpt;
        if ((typeof a === 'object' && a && a.options) || typeof a === 'function') {
          fieldType = a;
          if (typeof b === 'object' && b) {
            fieldOpt = b;
          }
        } else if (typeof a === 'object' && typeof b === 'undefined') {
          fieldType = Seq.TEXT;
          fieldOpt = a;
        } else if (typeof a === 'object' && a && typeof b !== 'undefined') {
          fieldType = a;
          fieldOpt = b;
        }
        if (!fieldType) fieldType = Seq.TEXT;
        return this.field(name, fieldType, fieldOpt);
      }
      let opt;
      if (typeof a === 'object' && a) {
        opt = a;
      } else if (typeof b === 'object' && b) {
        opt = b;
      }
      if (!opt) opt = {};
      opt.encrypt = true;
      return this.field(name, null, opt);
    }

    /**
     * Attach the option "encrypt": true to the field() method
     * */
    field(name, type, opt) {
      if (typeof opt !== 'object' || !opt || !opt.encrypt) {
        return super.field.apply(this, arguments);
      }
      if (typeof opt.length === 'number' && opt.length) {
        type = Seq.STRING(opt.length);
        delete opt.length;
      } else {
        type = Seq.TEXT;  // any encrypted field is of type text.
      }
      this.#encrypted.push(name);
      this.#encryptedMap[name] = true;
      if (typeof opt.defaultValue !== 'undefined' && opt.defaultValue != null) {
        opt._default = opt.defaultValue;
      }
      delete opt.defaultValue;
      super.field(name, type, opt);
      return this;
    }
  }

  Store.Model = StoreModel;

};
