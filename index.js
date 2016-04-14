'use strict';
const path = require('path'),
  decamelize = require('decamelize'),
  fs = require('fs'),
  componentLoader = require('./lib/loader'),
  restifyInit = require('./lib/restifyModel'),
  restifyActionInit = require('./lib/restifyAction'),
  Sequelize = require('sequelize');
require('./lib/customTypes');
/**
 * Created by Adrian on 29-Mar-16.
 * Events:
 *  - reconnect({name, duration})
 *  - disconnect({name})
 */
module.exports = function init(thorin) {
  const async = thorin.util.async;
  // Attach the SQL error parser to thorin.
  thorin.addErrorParser(require('./lib/errorParser'));

  const config = Symbol(),
    models = Symbol(),
    loaded = Symbol(),
    seq = Symbol();
  const loader = componentLoader(thorin),
    restify = restifyInit(thorin),
    RestifyAction = restifyActionInit(thorin);

  class ThorinSqlStore extends thorin.Interface.Store {
    static publicName() { return "sql"; }
    constructor() {
      super();
      this.type = "sql";
      this[loaded] = false;
      this[config] = {};
      this[models] = {};  // hash of modelName:modelObj
      this[seq] = null;
    }

    /* Returns the sequelize class. */
    getSequelize() {
      return Sequelize;
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
          models: path.normalize(thorin.root + '/app/models'),   // the store model definition folder
          patch: path.normalize(thorin.root + '/app/models/patch') // the store sql files that will be executed.
        },
        options: {  // sequelize options
          dialect: 'mysql',
          timezone: '+00:00',
          pool: {
            maxIdleTime: 12000
          }
        }
      }, storeConfig);
      if(!(this[config].path.models instanceof Array)) {
        this[config].path.models = [this[config].path.models];
      }
      this[config].path.models.forEach((modelPath) => {
        loader.load(this, modelPath, this[models]);
      });
      let fse = thorin.util.fse;
      try {
        fse.ensureDirSync(this[config].path.models);
      } catch(e) {}
    }

    /*
     * Connect to SQL and initialize the connection.
     * */
    run(done) {
      if(this[seq]) return done();  // already initialized.
      if(this[config].user == null || this[config].password == null || !this[config].database) {
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
        thorin.logger(this.name).info('Connected to SQL server');
        done();
      });
    }

    /*
    * Sets up the database and all the relations. This is called
    * when the app is run with --setup=store.sql
    * */
    setup(done) {
      this.settingUp = true;
      var log = thorin.logger(this.name);
      this.run((e) => {
        if(e) return done(e);
        let seqObj = this.getInstance(),
          opt = {
            force: true,
            logging: this._log.bind(this)
          };
        let calls = [];
        // Disable foreign key checks
        calls.push(() => {
            return seqObj.query('SET FOREIGN_KEY_CHECKS = 0;');
        });

        // Drop all previous tables.
        let previousTables = [];
        calls.push(() => {
          return seqObj.query('SHOW TABLES IN ' + this[config].database).then((items) => {
            if(items.length === 0) return;
            items[0].forEach((item) => {
              let tableName = item['Tables_in_' + this[config].database];
              if(!tableName) return;
              previousTables.push(tableName);
            });
          });
        });

        // drop each table.
        calls.push(() => {
          if(previousTables.length === 0) return;
          let drops = [];
          previousTables.forEach((tableName) => {
            drops.push(() => {
              return seqObj.query('DROP TABLE ' + tableName);
            });
          });
          return thorin.series(drops);
        });

        // sync sequelize's tables.
        calls.push(() => {
          return seqObj.sync(opt);
        });

        // apply any patches.
        calls.push(() => {
          if(!this[config].path.patch) return;
          var patchFiles = thorin.util.readDirectory(this[config].path.patch, 'sql');
          if(patchFiles.length === 0) return;
          let queries = [];
          patchFiles.forEach((fpath) => {
            var queryContent;
            try {
              queryContent = fs.readFileSync(fpath, { encoding: 'utf8' });
            } catch(e) {
              this._log("Thorin.store.sql: failed to load sql patch file: " + fpath);
              return;
            }
            if(queryContent.trim() === '') return;
            queryContent = queryContent.replace(/\r?\n/g, "\n");
            let statements = queryContent.split('\n');
            statements.forEach((sql) => {
              if(sql.trim() === '') return;
              queries.push(() => {
                return seqObj.query(sql);
              });
            });
          });
          return thorin.series(queries);
        });

        // Re-enable foreign key checks
        calls.push(() => {
          return seqObj.query('SET FOREIGN_KEY_CHECKS = 1;');
        });
        thorin.series(calls, (e) => {
          if(e) {
            return done(e);
          }
          this._log("Setup complete.");
          this.settingUp = false;
          done();
        });
      });
    }

    /*
    * Manually perform a sync() with sequelize.
    * The argument options are the ones passed to sync()
    * NOTE:
    *   - calling sync()  will sync entire db
    *   - calling sync(modelName, opt) will sync specific model
    * */
    sync(opt, b) {
      let seqObj = this.getInstance();
      if(!seqObj) {
        return new Promise((resolve, reject) => {
          reject(thorin.error('SQL.NOT_CONNECTED', 'Connection is not active.'));
        });
      }
      // sync the entire DB
      if(typeof opt !== 'string') {
        return seqObj.sync(opt);
      }
      //IF we have a specific model to sync, we can do so.
      if(typeof opt === 'string' && opt) {    // Try to sink a specific model
        let modelName = opt;
        return this.model(modelName).sync(b);
      }
      return this;
    }

    /*
    * Returns a custom SQL model by its code.
    * */
    model(name, forceReturnModel) {
      if(!this[models][name]) return null;
      if(forceReturnModel === true) return this[models][name];
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
        console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store is already initialized and cannot add models. Use thorin.on(thorin.EVENT.INIT) in stead.'));
        return this;
      }
      if(typeof item === 'string') {
        loader.load(this, item, this[models]);
        return this;
      }
      if(typeof item === 'function') {
        if(typeof opt !== 'object' || !opt || !opt.code) {
          console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store: when adding a model with a function, options must be passed with a code.'));
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
    * The restify function will attach CREATE, READ, FIND, UPDATE, DELETE
    * on the given model name.
    * Arguments:
    *   modelName - the model name we want to restify.
    *   actions - the actions we want to attach. Defaults to all.
    *   options - additional options to pass.
    *     - name: the model code we want to use. Default to modelObj.code
    *     - namespace=db: if we want to use a different action namespace, other than the default "db" one.
    *     - debug=false: should we log the Restify model action
    * */
    restify(modelName, actions, opt) {
      const modelObj = this.model(modelName);
      if(!modelObj) {
        console.error(thorin.error('SQL.RESTIFY', 'SQL model ' + modelName + ' not found for restify()'));
        return this;
      }
      if(typeof actions === 'string') {
        actions = actions.split(' ');
      }
      if(!(actions instanceof Array)) {
        opt = actions;
        actions = ['create', 'read', 'find', 'update', 'delete'];
      }
      if(typeof opt !== 'object' || !opt) opt = {};
      if(!opt.name) {
        opt.name = modelObj.code;
      }
      const actionObj = new RestifyAction(modelObj);
      // once the db is ready, we create the action.
      thorin.on(thorin.EVENT.RUN, 'store.' + this.name, () => {
        process.nextTick(() => {
          actions.forEach((name) => {
            if(typeof restify[name] !== 'function') {
              console.error(thorin.error('SQL.RESTIFY', 'Restify action ' + name + ' is not valid for model ' + modelName));
              return;
            }
            let dbAction = restify[name].call(this, actionObj, opt);
            if(!dbAction) {
              console.warn(thorin.error('SQL.RESTIFY', 'Restify action ' + name + ' could not complete.'));
              return;
            }
            let self = this;
            function onActionRegistered(newActionObj) {
              if(newActionObj.name !== dbAction.name) return;
              thorin.dispatcher.removeListener('action', onActionRegistered);
              let logMsg = 'Restifying "' + name + '" for model ' + modelName + ' on (' + dbAction.name + ')',
                aliases = [];
              if(dbAction.aliases) {
                dbAction.aliases.forEach((item) => {
                  aliases.push(item.verb + ' ' + item.name);
                });
                logMsg += " [" + aliases.join(',') + ']';
              }
              if(thorin.env === 'production' && opt.debug === true) {
                self._log(logMsg);
              } else if(thorin.env === 'development' && opt.debug !== false) {
                self._log(logMsg);
              }
            }
            thorin.dispatcher.on('action', onActionRegistered);
            thorin.dispatcher.addAction(dbAction);
          });
        });
      });
      return actionObj;
    }

    /*
    * Handles sequelize logs.
    * */
    _log(msg) {
      if(this.settingUp) {
        msg = 'setup: ' + msg;
      }
      if(this[config].debug === false) return;  // no debug.
      if(this[config].debug === true) { // debug all
        thorin.logger(this.name).debug(msg);
      }
      if(this[config].debug.create === false && msg.indexOf('INSERT ') !== -1) return;
      if(this[config].debug.read === false && msg.indexOf('SELECT ') !== -1) return;
      if(this[config].debug.update === false && msg.indexOf('UPDATE ') !== -1) return;
      if(this[config].debug.delete === false && msg.indexOf('DELETE ') !== -1) return;
      thorin.logger(this.name).debug(msg);
    }

    /*
    * ------------ HELPER FUNCTIONS
    * */
    decamelize(r) {
      return decamelize(r, '_');
    }
  }

  return ThorinSqlStore;
};