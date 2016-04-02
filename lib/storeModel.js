'use strict';
/**
 * Created by Adrian on 29-Mar-16.
 */

module.exports = function(thorin) {
  const instance = Symbol();

  class StoreModel {

    constructor(code, name, file) {
      this[instance] = null;  // this is the sequelize instance object.
      this.code = code;
      this.file = file;
      this.tableName = name;

      this.fields = {};
      this.hooks = {};
      this.statics = {};
      this.methods = {};
      this.setters = {};
      this.getters = {};
      this.indexes = [];
      this.validations = {};
      this.relations = [];
      this.options = {
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        deletedAt: false
      };
    }

    setInstance(iObj) {
      if(!this[instance]) {
        this[instance] = iObj;
      }
      return this;
    }
    getInstance() {
      if(!this[instance]) return this;
      return this[instance];
    }

    /*
     * Checks if we have enough information about a table.
     * A valid model must have AT LEAST one field and a table name.
    */
    isValid() {
      if(Object.keys(this.fields).length === 0) return false;
      if(!this.tableName) return false;
      return true;
    }

    /*
    * Adds a field to the model.
    * */
    field(name, type, opt) {
      if(this.fields[name]) {
        throw thorin.error('SQL.MODEL.INVALID_FIELD', 'Invalid field: ' + name + ' for model: ' + this.code);
      }
      if(typeof opt !== 'object' || !opt) opt = {};
      if(typeof type.__proxy !== 'undefined') {  // custom one.
        if(typeof type.__options === 'object') {
          opt = thorin.util.extend(opt, type.__options);
        }
        type = type.__proxy;
      }
      if(typeof type === 'undefined' || type === null) {
        throw thorin.error('SQL.MODEL.INVALID_TYPE', 'Invalid field type: '+name+' for model: ' + this.code);
      }
      this.fields[name] = thorin.util.extend(opt, {
        type: type
      });
      return this;
    }

    /*
    * Adds a hook to the model.
    * */
    hook(hookName, hookFn) {
      if(this[instance]) {
        this[instance].addHook(hookName, hookFn);
        return this;
      }
      if(typeof this.hooks[hookName] === 'undefined') this.hooks[hookName] = [];
      this.hooks[hookName].push(hookFn);
      return this;
    }

    /*
    * Adds a static item to the model.
    * */
    static(name, varValue) {
      if(this.statics[name]) {
        throw thorin.error('SQL.MODEL.INVALID_STATIC', 'Invalid static: ' + name + ' for model: ' + this.code);
      }
      this.statics[name] = varValue;
      return this;
    }

    /*
    * Attaches a method to the model.
    * */
    method(name, fn) {
      if(this.methods[name]) {
        throw thorin.error('SQL.MODEL.INVALID_METHOD', 'Invalid method: ' + name + ' for model: ' + this.code);
      }
      if(typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_METHOD', 'Invalid method fn: ' + name + ' for model: ' + this.code);
      }
      this.methods[name] = fn;
      return this;
    }

    /*
    * Attaches a setter to the model.
    * */
    setter(name, fn) {
      if(this.setters[name]) {
        throw thorin.error('SQL.MODEL.INVALID_SETTER', 'Invalid setter: ' + name + ' for model: ' + this.code);
      }
      if(typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_SETTER', 'Invalid setter fn: ' + name + ' for model: ' + this.code);
      }
      this.setters[name] = fn;
      return this;
    }
    /*
     * Attaches a getter to the model.
     * */
    getter(name, fn) {
      if(this.getters[name]) {
        throw thorin.error('SQL.MODEL.INVALID_GETTER', 'Invalid getter: ' + name + ' for model: ' + this.code);
      }
      if(typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_GETTER', 'Invalid getter fn: ' + name + ' for model: ' + this.code);
      }
      this.getters[name] = fn;
      return this;
    }

    /*
    * Creates a new index
    * */
    index(fields, opt) {
      if(typeof fields === 'string') fields = fields.split(' ');
      if(typeof opt !== 'object' || !opt) opt = {};
      opt = thorin.util.extend(opt, {
        fields: fields
      });
      this.indexes.push(opt);
      return this;
    }

    /*
    * Attach a validator.
    * */
    validate(name, fn) {
      if(this.validations[name]) {
        throw thorin.error('SQL.MODEL.INVALID_VALIDATION', 'Invalid validation: ' + name + ' for model: ' + this.code);
      }
      if(typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_VALIDATION', 'Invalid validation fn: ' + name + ' for model: ' + this.code);
      }
      this.validations[name] = fn;
      return this;
    }

    /*
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
      this.relations.push({
        type: 'hasMany',
        name: name,
        options: opt || {}
      });
      return this;
    }

  }

  return StoreModel;
};