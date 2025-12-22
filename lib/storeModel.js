'use strict';
/**
 * This is a simple StoreModel thorin definition for app/models/
 */

module.exports = function (thorin) {

  class StoreModel {

    #instance = null; // this is the sequelize instance object.

    constructor(code, name, file) {
      this.code = code;
      this.file = file;
      this.tableName = name;

      this.fields = {};
      this.hooks = {};
      this.scopes = {};
      this.statics = {};
      this.methods = {};
      this.setters = {};
      this.getters = {};
      this.indexes = [];
      this.jsons = {};    // An array of toJSON functions.
      this.validations = [];
      this.relations = [];
      this.options = {
        timestamps: true,
        //sync: true, // set to false to skip sync-ing of the model.
        createdAt: 'created_at',
        updatedAt: false,
        deletedAt: false
      };
      this.#setDefaultMethods();
    }

    /**
     * Returns the primary key of the model.
     * Note: we currently do not support multiple primaries.
     * */
    getPrimary() {
      let primary = null,
        fieldName,
        _fields = Object.keys(this.fields);
      for (let i = 0, len = _fields.length; i < len; i++) {
        let name = _fields[i],
          field = this.fields[name];
        if (!field.primaryKey) continue;
        fieldName = name;
        primary = field;
        break;
      }
      if (!primary) return null;
      return thorin.util.extend(primary, {name: fieldName});
    }

    setInstance(iObj) {
      if (!this.#instance) {
        this.#instance = iObj;
      }
      return this;
    }

    getInstance() {
      if (!this.#instance) return this;
      return this.#instance;
    }

    /**
     * Checks if we have enough information about a table.
     * A valid model must have AT LEAST one field and a table name.
     */
    isValid() {
      if (Object.keys(this.fields).length === 0) return false;
      if (!this.tableName) return false;
      return true;
    }

    /**
     * Registers a toJSON function that will be called when we send the
     * instance to the client or when performinng JSON.stringify()
     * NOTE:
     *   we can have multiple json functions, that we can add by name.
     *   Ex:
     *     model.json('myJson', function() {return {jsonVersion: 1}})
     *     model.json(function(){ return {jsonVersion: "global"} })
     *
     *  instanceObj.json() => {jsonVersion: "global"}
     *  instanceObj.json('myJson') => {jsonVersion: 1}
     *  instanceObj.json('somethingElse') <=> instanceObj.json()
     * */
    json(name, fn) {
      if (typeof name === 'function') {
        fn = name;
        name = 'default';
      }
      if (typeof fn !== 'function') {
        console.error('Thorin.sql: model definition ' + this.code + ' json() does not pass a function callback.');
        return this;
      }
      if (typeof this.jsons[name] !== 'undefined') {
        console.error('Thorin.sql: model definition ' + this.code + ' json() with name "' + name + '" already exists.');
        return this;
      }
      this.jsons[name] = fn;
      return this;
    }

    /**
     * Adds a field to the model.
     * Additional thorin options:
     *   - private=true -> this will remove the field from the toJSON() function
     *   - filter=false -> when using crudify we will ignore the field in the filters.
     * */
    field(name, type, opt) {
      if (this.fields[name]) {
        throw thorin.error('SQL.MODEL.INVALID_FIELD', 'Invalid field: ' + name + ' for model: ' + this.code);
      }
      if (typeof opt !== 'object' || !opt) opt = {};
      if (typeof type === 'undefined' || type === null) {
        throw thorin.error('SQL.MODEL.INVALID_TYPE', 'Invalid field type: ' + name + ' for model: ' + this.code);
      }
      if (typeof type.__proxy !== 'undefined') {  // custom one.
        if (typeof type.__options === 'object') {
          opt = thorin.util.extend(type.__options, opt);
        }
        if (typeof type.__index !== 'undefined' && !opt.primaryKey) {
          let idxOpt = (typeof type.__index === 'object' ? type.__index : {});
          this.index(name, idxOpt);
        }
        if (typeof opt.defaultValue !== 'undefined' && typeof opt.defaultValue !== 'function') {
          if (typeof opt.defaultValue === 'object' && opt.defaultValue && opt.defaultValue.val) {
            // we have a Seq.literal()
          } else {
            opt.defaultValue = JSON.stringify(opt.defaultValue);
          }
        }
        if (typeof type.__getter === 'function') {
          this.getter(name, type.__getter(name, opt.defaultValue));
        }
        if (typeof type.__setter === 'function') {
          this.setter(name, type.__setter(name));
        }
        type = type.__proxy;
      }
      if (type && type.key === 'TEXT' && opt.defaultValue) {
        delete opt.defaultValue;
      }
      this.fields[name] = thorin.util.extend(opt, {
        type: type
      });
      return this;
    }

    /**
     * Adds a hook to the model.
     * */
    hook(hookName, hookFn) {
      if (this.#instance) {
        this.#instance.addHook(hookName, hookFn);
        return this;
      }
      if (typeof this.hooks[hookName] === 'undefined') this.hooks[hookName] = [];
      this.hooks[hookName].push(hookFn);
      return this;
    }

    /**
     * Adds a static item to the model.
     * */
    static(name, varValue) {
      if (typeof name === 'function' && typeof name.name === 'string' && name.name) {
        varValue = name;
        name = varValue.name;
      }
      if (this.statics[name]) {
        throw thorin.error('SQL.MODEL.INVALID_STATIC', 'Invalid static: ' + name + ' for model: ' + this.code);
      }
      this.statics[name] = varValue;
      if (typeof varValue === 'string' || typeof varValue === 'number' || (typeof varValue === 'object' && varValue)) {
        this[name] = varValue;
      }
      return this;
    }

    /**
     * Assigns a custom error to the model. This is a wrapper over the static method.
     * */
    error(code, msg, a, b, c) {
      let err = (typeof code === 'object' && code ? code : null),
        staticCode = (typeof code === 'string' ? code : err.code);
      if (!err) {
        if (typeof code === 'string') {
          if (code.indexOf('.') === -1) {
            code = this.code.toUpperCase() + '.' + code;
          }
        } else {
          code = 'GENERIC_ERROR';
        }
        err = thorin.error(code, msg, a, b, c);
      }
      this.static(staticCode, err);
      return this;
    }

    /**
     * Attaches a method to the model.
     * */
    method(name, fn) {
      if (typeof name === 'function' && typeof name.name === 'string' && name.name) {
        fn = name;
        name = fn.name;
      }
      if (name === 'json') throw new Error('Thorin.sql.model: json is a reserved instance method name in model ' + this.code);
      if (name === 'toJSON') throw new Error('Thorin.sql.model: toJSON is a reserved instance method name in model ' + this.code);
      if (this.methods[name]) {
        throw thorin.error('SQL.MODEL.INVALID_METHOD', 'Invalid method: ' + name + ' for model: ' + this.code);
      }
      if (typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_METHOD', 'Invalid method fn: ' + name + ' for model: ' + this.code);
      }
      this.methods[name] = fn;
      return this;
    }

    /**
     * Attaches a setter to the model.
     * Note: if "fn" is set as "JSON", we will do a JSON setter.
     * Note2: if "fn" is set as "array", we will do an array setter
     * */
    setter(name, fn) {
      if (this.setters[name]) {
        throw thorin.error('SQL.MODEL.INVALID_SETTER', 'Invalid setter: ' + name + ' for model: ' + this.code);
      }
      if (typeof fn === 'string') {
        if (fn.toLowerCase() === 'json') {
          return this.setter(name, function (d) {
            try {
              if (typeof d === 'string') d = JSON.parse(d);
              if (typeof d !== 'object' || !d) throw 1;
              d = JSON.stringify(d);
              this.setDataValue(name, d);
            } catch (e) {
            }
          });
        }
        if (fn.toLowerCase() === 'array') {
          return this.setter(name, function (d) {
            try {
              let r = [];
              if (d instanceof Array) {
                r = d;
              } else if (typeof d === 'string' && d) {
                r = (d.charAt(0) === '[') ? JSON.parse(d) : d.split(',');
              }
              r = r.join(',');
              this.setDataValue(name, r);
            } catch (e) {
            }
          });
        }
      }

      if (typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_SETTER', 'Invalid setter fn: ' + name + ' for model: ' + this.code);
      }
      this.setters[name] = fn;
      return this;
    }

    /**
     * Attaches a getter to the model.
     * Note: if "fn" is set as "JSON", we will do a JSON getter that returns either a valid JSON object or null.
     * Note2: if "fn" is set as  "ARRAY" we will do an Array getter that always returns an array
     * */
    getter(name, fn) {
      if (this.getters[name]) {
        throw thorin.error('SQL.MODEL.INVALID_GETTER', 'Invalid getter: ' + name + ' for model: ' + this.code);
      }
      if (typeof fn === 'string') {
        if (fn.toLowerCase() === 'json') {
          return this.getter(name, function () {
            let d = this.dataValues[name];
            if(typeof d === 'string' && d) {
              try {
                d = JSON.parse(d);
              } catch (e) {
              }
            }
            return d;
          });
        }
        if (fn.toLowerCase() === 'array') {
          return this.getter(name, function () {
            let r = [];
            try {
              let q = this.getDataValue(name);
              if (typeof q === 'string' && q) {
                r = q.split(',');
              } else if (q instanceof Array) {
                r = q;
              }
            } catch (e) {
            }
            return r;
          });
        }
      }
      if (typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_GETTER', 'Invalid getter fn: ' + name + ' for model: ' + this.code);
      }
      this.getters[name] = fn;
      return this;
    }

    /**
     * Creates a new index
     * */
    index(fields, opt) {
      if (typeof fields === 'string') fields = fields.split(' ');
      if (typeof opt !== 'object' || !opt) opt = {};
      opt = thorin.util.extend(opt, {
        fields: fields
      });
      for (let i = 0; i < this.indexes.length; i++) {
        if (this.indexes[i].fields.join(' ') === fields.join(' ')) {
          throw thorin.error('SQL.MODEL.INVALID_INDEX', `Index ${fields} already exist for model ${this.code}`);
        }
      }
      this.indexes.push(opt);
      return this;
    }

    /**
     * Creates a new scope for this model
     * NOTE:
     * - name=default - this is the default scope.
     * */
    scope(name, args) {
      if (this.scopes[name]) {
        throw thorin.error('SQL.MODEL.INVALID_SCOPE', 'Invalid scope: ' + name + ' for model: ' + this.code);
      }
      if (typeof args !== 'function' && (typeof args !== 'object' || !args)) {
        throw thorin.error('SQL.MODEL.INVALID_SCOPE', 'Invalid scope: ' + name + ' for model: ' + this.code + ': function or object is expected');
      }
      this.scopes[name] = args;
      return this;
    }

    /**
     * Checks if we've already registered an index.
     * */
    hasIndex(fieldName) {
      for (let i = 0; i < this.indexes.length; i++) {
        for (let j = 0; j < this.indexes[i].fields.length; j++) {
          if (this.indexes[i].fields[j] === fieldName) return true;
        }
      }
      return false;
    }

    /**
     * Attach a validator on a specific field.
     * */
    validate(name, fn) {
      if (typeof name === 'function') {
        fn = name;
        name = null;  // we will validate the model, not a field.
      }
      if (typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_VALIDATION', 'Invalid validation: ' + name + ' for model: ' + this.code);
      }
      this.validations.push({
        name: name,
        fn: fn
      });
      return this;
    }

    /**
     * ================RELATIONSHIPS==================
     * */
    belongsTo(name, opt) {
      this.relations.push({
        type: 'belongsTo',
        name: name,
        options: opt || {}
      });
      return this;
    }

    belongsToMany(name, opt) {
      this.relations.push({
        type: 'belongsToMany',
        name: name,
        options: opt || {}
      });
      return this;
    }

    hasOne(name, opt) {
      this.relations.push({
        type: 'hasOne',
        name: name,
        options: opt || {}
      });
      return this;
    }

    hasMany(name, opt) {
      if (!opt) opt = {};
      if (typeof opt.foreignKey === 'undefined') {
        let primaryObj = this.getPrimary();
        opt.foreignKey = this.tableName + '_' + primaryObj.name;
      }
      this.relations.push({
        type: 'hasMany',
        name: name,
        options: opt || {}
      });
      return this;
    }


    /**
     * This will set a series of default methods.
     * */
    #setDefaultMethods = () => {
      /* This will attach the .data(key, _val) method, that works as a virtual getter/setter.*/
      const dataKey = Symbol('data');
      this.method(function data(key, _val) {
        if (typeof this[dataKey] === 'undefined') this[dataKey] = {};
        if (typeof key !== 'string' || !key) return null;
        if (typeof _val === 'undefined') return (typeof this[dataKey][key] === 'undefined' ? null : this[dataKey][key]);
        this[dataKey][key] = _val;
        return this;
      });
    };

  }


  return StoreModel;
};
