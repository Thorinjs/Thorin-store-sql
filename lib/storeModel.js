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
      this.jsons = {};    // An array of toJSON functions.
      this.validations = [];
      this.relations = [];
      this.options = {
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        deletedAt: false
      };
    }

    /*
    * Returns the primary key of the model.
    * Note: we currently do not support multiple primaries.
    * */
    getPrimary() {
      let primary = null,
        fieldName;
      Object.keys(this.fields).forEach((name) => {
        if(primary) return;
        let field = this.fields[name];
        if(!field.primaryKey) return;
        fieldName = name;
        primary = field;
      });
      if(!primary) return null;
      return thorin.util.extend(primary, {name: fieldName});
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
      if(typeof name === 'function') {
        fn = name;
        name = 'default';
      }
      if(typeof fn !== 'function') {
        console.error('Thorin.sql: model definition ' + this.code + ' json() does not pass a function callback.');
        return this;
      }
      if(typeof this.jsons[name] !== 'undefined') {
        console.error('Thorin.sql: model definition ' + this.code + ' json() with name "'+name+'" already exists.');
        return this;
      }
      this.jsons[name] = fn;
      return this;
    }

    /*
    * Adds a field to the model.
    * Additional thorin options:
    *   - private=true -> this will remove the field from the toJSON() function
    *   - filter=false -> when using restify we will ignore the field in the filters.
    * */
    field(name, type, opt) {
      if(this.fields[name]) {
        throw thorin.error('SQL.MODEL.INVALID_FIELD', 'Invalid field: ' + name + ' for model: ' + this.code);
      }
      if(typeof opt !== 'object' || !opt) opt = {};
      if(typeof type === 'undefined' || type === null) {
        throw thorin.error('SQL.MODEL.INVALID_TYPE', 'Invalid field type: '+name+' for model: ' + this.code);
      }
      if(typeof type.__proxy !== 'undefined') {  // custom one.
        if(typeof type.__options === 'object') {
          opt = thorin.util.extend(opt, type.__options);
        }
        type = type.__proxy;
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
      if(typeof name === 'function' && typeof name.name === 'string' && name.name) {
        fn = name;
        name = fn.name;
      }
      if(name === 'json') throw new Error('Thorin.sql.model: json is a reserved instance method name in model ' + this.code);
      if(name === 'toJSON') throw new Error('Thorin.sql.model: toJSON is a reserved instance method name in model ' + this.code);
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
      for(let i=0; i < this.indexes.length; i++) {
        if(this.indexes[i].fields.join(' ') === fields.join(' ')) {
          throw thorin.error('SQL.MODEL.INVALID_INDEX', `Index ${fields} already exist for model ${this.code}`);
        }
      }
      this.indexes.push(opt);
      return this;
    }

    /*
    * Checks if we've already registered an index.
    * */
    hasIndex(fieldName) {
      for(let i=0; i < this.indexes.length; i++) {
        for(let j=0; j < this.indexes[i].fields.length; j++) {
          if(this.indexes[i].fields[j] === fieldName) return true;
        }
      }
      return false;
    }

    /*
    * Attach a validator on a specific field.
    * */
    validate(name, fn) {
      if(typeof name === 'function') {
        fn = name;
        name = null;  // we will validate the model, not a field.
      }
      if(typeof fn !== 'function') {
        throw thorin.error('SQL.MODEL.INVALID_VALIDATION', 'Invalid validation: ' + name + ' for model: ' + this.code);
      }
      this.validations.push({
        name: name,
        fn: fn
      });
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