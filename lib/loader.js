'use strict';
const fs = require('fs'),
  decamelize = require('decamelize'),
  camelcase = require('camelcase'),
  sequelize = require('sequelize'),
  path = require('path'),
  storeModelFn = require('./storeModel');



/**
 * Created by Adrian on 29-Mar-16.
 * This component is used to load up all the sql / postgre models.
 */
module.exports = function init(thorin) {
  const async = thorin.util.async;
  const NAME_SEPARATOR = '_';
  const StoreModel = storeModelFn(thorin);
  const loader = {};
  const extendModels = {};  // hash of {modelName: [fns]}}

  /*
  * Load up all the models.
  * */
  function loadModels(fpath, modelFiles) {
    try {
      fpath = path.normalize(fpath);
      if(!fs.existsSync(fpath)) throw 1;
    } catch(e) {
      return false;
    }
    if(path.extname(fpath) === '.js') {
      // we have a file.
      let itemName = path.basename(fpath);
      itemName = itemName.substr(0, itemName.lastIndexOf('.'));
      let itemCode = decamelize(itemName);
      let item = {
        fullPath: fpath,
        code: itemCode,
        name: itemName,
        path: path.basename(fpath)
      };
      modelFiles.push(item);
      return true;
    }
    const items = thorin.util.readDirectory(fpath, {
      ext: 'js',
      relative: true
    });
    if(items.length === 0) {
      return true;
    }
    for(let i=0; i < items.length; i++) {
      let itemPath = items[i];
      let item = {
        fullPath: path.normalize(fpath + '/' + itemPath)
      };
      itemPath = itemPath.substr(0, itemPath.lastIndexOf('.'));
      let itemName = decamelize(itemPath, NAME_SEPARATOR);
      itemName = itemName.split(path.sep).join(NAME_SEPARATOR);
      item.name = itemName;
      item.code = camelcase(itemName);
      item.path = itemPath.split(path.sep).join('/');
      modelFiles.push(item);
    }
    return true;
  }

  /*
  * initialize the models and create their appropiate model instance.
  * */
  function initModels(seqObj, modelFiles, models) {
    modelFiles.forEach((item) => {
      var modelFn;
      try {
        modelFn = require(item.fullPath);
      } catch(e) {
        console.error('Thorin.sql: could not require model: ' + item.fullPath + '\n', e.stack);
        return;
      }
      if(modelFn == null) return;  // we skip it
      if(typeof modelFn !== 'function') {
        console.error(thorin.error('SQL.INVALID_MODEL', 'SQL Model: ' + item.fullPath + ' must export a function(modelObj){}'));
        return;
      }
      if(modelFn.name === 'extend') {
        if(typeof extendModels[item.code] === 'undefined') extendModels[item.code] = [];
        extendModels[item.code].push(modelFn);
        return;
      }
      let modelObj = loader.buildModel(seqObj, modelFn, item);
      if(modelObj) {
        if(typeof models[modelObj.code] !== 'undefined') {
          console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store: model ' + item.code + ' was already declared.'));
          return;
        }
        models[modelObj.code] = modelObj;
      }
    });
  }

  /*
  * This will build the thorin store model object.
  * */
  loader.buildModel = function BuildStoreModel(seqObj, modelFn, item) {
    if(!item.name) {
      item.name = decamelize(item.code, '_');
      item.code = camelcase(item.code);
    }
    let modelObj = new StoreModel(item.code, item.name, item.fullPath);
    modelFn(modelObj, sequelize, seqObj);
    if(typeof extendModels[item.code] !== 'undefined') {
      for(let i=0; i < extendModels[item.code].length; i++) {
        let extendFn = extendModels[item.code][i];
        extendFn(modelObj, sequelize, seqObj);
      }
      delete extendModels[item.code];
    }
    if(!modelObj.isValid()) {
      console.error(thorin.error('SQL.INVALID_MODEL', 'SQL Model: ' + (item.fullPath || item.code) + ' does not contain valid information.'));
      return;
    }
    return modelObj;
  };

  /*
  * For each model, we will create its definition and attach it to sequelize.
  * */
  function createInstances(seqObj, models, done) {
    Object.keys(models).forEach((key) => {
      let modelObj = models[key],
        attributes = {},
        options = thorin.util.extend({}, modelObj.options);
      modelObj.privateAttributes = [];
      // map the attributes
      Object.keys(modelObj.fields).forEach((fieldName) => {
        let fieldOpt = modelObj.fields[fieldName];
        if(modelObj.getters[fieldName]) {
          fieldOpt.get = modelObj.getters[fieldName];
        }
        if(modelObj.setters[fieldName]) {
          fieldOpt.set = modelObj.setters[fieldName];
        }
        if(fieldOpt.private) {
          modelObj.privateAttributes.push(fieldName);
        }
        attributes[fieldName] = fieldOpt;
      });
      if(options.createdAt === true) options.createdAt = 'created_at';
      if(options.updatedAt === true) {
        options.updatedAt = 'updated_at';
        if(!attributes[options.updatedAt]) {
          attributes[options.updatedAt] = {
            defaultValue: null,
            allowNull: true,
            type: sequelize.DATE
          }
        }
      }
      if(options.deletedAt === true) {
        options.deletedAt = 'deleted_at';
        if(!attributes[options.deletedAt]) {
          attributes[options.deletedAt] = {
            defaultValue: null,
            allowNull: true,
            type: sequelize.DATE
          }
        }
      }
      // create the inner options.
      options.underscored = true;
      options.tableName = modelObj.tableName;
      options.indexes = modelObj.indexes;
      options.instanceMethods = modelObj.methods;
      options.classMethods = modelObj.statics;
      options.hooks = modelObj.hooks;
      options.validate = {};
      let validatorId = 0;
      // set validations
      modelObj.validations.forEach((item) => {
        if(item.name) { // we have a field validator.
          if(!attributes[item.name]) {
            console.warn('Thorin.sql: model ' + key + " does not have field " + item.name + ' for validator.');
            return;
          }
          if(!attributes[item.name].validate) attributes[item.name].validate = {};
          attributes[item.name].validate['validate' + item.name + validatorId] = item.fn;
          validatorId++;
          return;
        }
        // we have a model validator.
        options.validate['thorinValidate' + validatorId] = item.fn;
        validatorId++;
      });

      // wrap the toJSON function to exclude private fields.
      function ToJSON(jsonName) {
        if (jsonName === 'result') jsonName = 'default';
        let args = Array.prototype.slice.call(arguments);
        if(typeof jsonName === 'undefined') {
          jsonName = 'default';
        } else if(typeof jsonName === 'string') {
          args.splice(0, 1);  //remove the name.
        }
        let jsonFn = modelObj.jsons[jsonName],
          result = this.dataValues;
        if(typeof jsonFn === 'undefined' && jsonName !== 'default') { // silent fallback
          if(typeof modelObj.jsons['default'] === 'function') {
            result = modelObj.jsons['default'].apply(this, args);
          }
        } else {
          if(typeof modelObj.jsons[jsonName] === 'function') {
            result = modelObj.jsons[jsonName].apply(this, args);
          } else {
            result = this.dataValues;
          }
        }
        if(result === this) {
          result = this.dataValues;
        }
        if(typeof result === 'object' && result != null) {
          for(let i=0; i < modelObj.privateAttributes.length; i++) {
            if(typeof result[modelObj.privateAttributes[i]] !== 'undefined') {
              delete result[modelObj.privateAttributes[i]];
            }
          }
        }
        return result;
      }
      options.instanceMethods['toJSON'] = ToJSON;
      // we do a synonym to .json()
      options.instanceMethods['json'] = ToJSON;
      var modelInstance;
      try {
        modelInstance = seqObj.define(modelObj.code, attributes, options);
      } catch(e) {
        console.error('Thorin.sql: could not create sequelize schema for: ' + modelObj.code + '\n', e.stack);
        return;
      }
      modelObj.setInstance(modelInstance);
    });
    done();
  }

  /*
  * Creates the associations between models.
  * */
  function createAssociations(models, done) {
    Object.keys(models).forEach((key) => {
      let modelObj = models[key],
        instanceObj = modelObj.getInstance();
      modelObj.relations.forEach((relation) => {
        let targetModel = models[relation.name];
        if(!targetModel) {
          throw thorin.error('SQL.INVALID_ASSOCIATION', 'Target association: '+ relation.type + " " + relation.name + ' does not exist for ' + modelObj.code);
        }
        let targetInstanceObj = targetModel.getInstance();
        let opt = thorin.util.extend(getAssociationOptions(targetModel.tableName, relation.options, modelObj),{
          as: targetModel.code
        }, relation.options);
        relation.options = opt;
        if(opt.private) {
          modelObj.privateAttributes.push(opt.foreignKey.name);
        }
        try {
          instanceObj[relation.type](targetInstanceObj, opt);
        } catch(e) {
          console.error('Thorin.sql: could not create sequelize association: %s %s %s', modelObj.code, relation.type, targetModel.code, e.stack);
        }
      });
    });
    done();
  }

  /*
  * Initialize the loader and load some models for preparation.
  * */
  loader.load = function LoadModels(storeObj, modelPath, models) {
    /* step one: load and parse their info. */
    let files = [];
    loadModels(modelPath, files);
    initModels(storeObj.getInstance(), files, models);
  };

  /*
  * Initializes the loader.
  * */
  loader.finalizeLoading = function initialize(storeObj, config, models, onDone) {
    var calls = [],
      seqObj = storeObj.getInstance();
    /* step three: create the models. */
    calls.push((done) => {
      createInstances(seqObj, models, done);
    });

    /* step 4: create associations */
    calls.push((done) => {
      createAssociations(models, done);
    });

    /* next,  */
    async.series(calls, (err) => {
      if(err) return onDone(err);
      onDone();
    });
  };


  /* PRIVATE */
  function getAssociationOptions(name, opt, modelObj) {
    let options = {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    };
    if(typeof opt.constraints !== 'boolean') {
      options.constraints = true;
    }
    let primaryObj = modelObj.getPrimary(),
      fk = (primaryObj ? primaryObj.name : 'id');
    fk = fk.charAt(0).toUpperCase() + fk.substr(1);
    let canBeNull = (typeof opt['allowNull'] === 'boolean' ? opt['allowNull'] : true);
    if(!opt.foreignKey) {
      options.foreignKey = {
        name: decamelize((opt.as || name) + fk, '_'),
        allowNull: canBeNull
      };
    } else if(typeof opt.foreignKey === 'string') {
      options.foreignKey = {
        name: options.foreignKey,
        allowNull: canBeNull
      };
    }
    return options;
  }
  return loader;
};
