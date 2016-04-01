'use strict';
const async = require('async'),
  componentLoader = require('./lib/loader'),
  Sequelize = require('sequelize');
require('./lib/customTypes');
/**
 * Created by Adrian on 29-Mar-16.
 * Events:
 *  - reconnect({name, duration})
 *  - disconnect({name})
 */
module.exports = function init(thorin) {
  const config = Symbol(),
    models = Symbol(),
    loaded = Symbol(),
    seq = Symbol();
  const loader = componentLoader(thorin);

  class ThorinSqlStore extends thorin.Interface.Store {
    static publicName() { return "sql"; }
    constructor() {
      super();
      this[loaded] = false;
      this[config] = {};
      this[models] = {};  // hash of modelName:modelObj
      this[seq] = null;
    }

    /* Returns the sequelize instance */
    getInstance() {
      return this[seq];
    }

    /*
    * Initializes the store.
    * */
    init(storeConfig) {
      this[config] = thorin.util.extend({
        debug: {      // Setting this to =false, will disable debugging all together.
          create: true,
          read: true,
          update: true,
          delete: true
        },
        host: 'localhost',
        user: null,
        password: null,
        database: null,
        path: {
          models: 'app/models',   // the store model definition folder
          patch: 'app/models/patch' // the store sql patcher.
        },
        options: {  // sequelize options
          dialect: 'mysql',
          timezone: '+00:00',
          pool: {
            maxIdleTime: 12000
          }
        }
      }, storeConfig);
      loader.load(this, thorin.root + '/' + this[config].path.models, this[models]);
    }

    /*
    * Returns a custom SQL model by its code.
    * */
    model(name) {
      if(!this[models][name]) return null;
      return this[models][name].getInstance();
    }

    /*
    * This will try and register a new model.
    * - IF we receive a "string", we will consider that it is the fullPath of the model file.
    * - IF we receive a "function", we will consider that it is the exported file.
    * NOTE:
    *   models can only be added BEFORE the store is initialized.
    * NOTE2:
    *   when item is function, options MUST contain:
    *     - code
    * */
    addModel(item, opt) {
      if(this[loaded]) {
        console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store is already initialized and cannot add models.'));
        return this;
      }
      if(typeof item === 'string') {
        loader.load(this, item, this[models]);
        return this;
      }
      if(typeof item === 'function') {
        if(typeof opt !== 'object' || !opt || !opt.code) {
          console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store: when adding a model with a function, options must be passed.'));
          return this;
        }
        let modelObj = loader.buildModel(this.getInstance(), item, opt);
        if(modelObj) {
          if(typeof this[models][modelObj.code] !== 'undefined') {
            console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store: model ' + item.code + ' was already declared.'));
            return this;
          }
          this[models][modelObj.code] = modelObj;
          return this;
        }
      }
      return this;
    }

    /*
    * Connect to SQL and initialize the connection.
    * */
    run(done) {
      if(!this[config].user || !this[config].password || !this[config].database) {
        return done(thorin.error('SQL.CREDENTIALS', 'Missing user, password or database credentials.'));
      }
      let opt = this[config].options;
      if(this[config].debug === false) {
        opt.logging = false;
      } else {
        opt.logging = this._log.bind(this);
      }
      opt.host = this[config].host;
      this[seq] = new Sequelize(this[config].database, this[config].user || null, this[config].password || null, opt);
      const calls = [];
      /* load models */
      calls.push((done) => {
        this[loaded] = true;
        loader.finalizeLoading(this, this[config], this[models], (err) => {
          if(err) return done(err);
          done();
        });
      });

      async.series(calls, (err) => {
        if(err) {
          return done(thorin.error('SQL.INITIALIZATION', 'Could not initialize store.', err));
        }
        done();
      });
    }

    /*
    * Handles sequelize logs.
    * */
    _log() {
      console.log("LOGS");
    }

  }

  return ThorinSqlStore;
};