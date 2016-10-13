'use strict';
const path = require('path'),
  exec = require('child_process').exec,
  decamelize = require('decamelize'),
  camelize = require('camelize'),
  fs = require('fs'),
  componentLoader = require('./loader'),
  crudifyInit = require('./crudifyModel'),
  crudifyActionInit = require('./crudifyAction'),
  Sequelize = require('sequelize');
/**
 * Created by Adrian on 09-May-16.
 */
module.exports = function (thorin, opt) {
  const config = Symbol(),
    async = thorin.util.async,
    models = Symbol(),
    logger = Symbol(),
    loaded = Symbol(),
    seq = Symbol();
  const loader = componentLoader(thorin),
    crudify = crudifyInit(thorin),
    CrudifyAction = crudifyActionInit(thorin);


  class ThorinSqlStore extends thorin.Interface.Store {
    static publicName() {
      return "sql";
    }

    constructor() {
      super();
      this.type = "sql";
      this[loaded] = false;
      this[config] = {};
      this[models] = {};  // hash of modelName:modelObj
      this[seq] = null;
      this[logger] = null;
    }

    get logger() {
      if (!this[logger]) return thorin.logger('store.' + this.type);
      return this[logger];
    }

    /**
     * Dumps the entire database structure using mysqldump
     * TODO: make it work with certificates
     * HOW it works:
     *  dump(fn) -> call the fn with the result
     *  dump(path) -> write in the path.
     * */
    dump(arg) {
      let fullPath,
        onDump;
      if (typeof arg === 'string') {
        try {
          fullPath = path.normalize(arg);
          let basePath = path.dirname(fullPath);
          thorin.util.fs.ensureDirSync(basePath);
        } catch (e) {
          return Promise.reject(e);
        }
      } else if (typeof arg === 'function') {
        onDump = arg;
      } else {
        return Promise.reject(thorin.error('SQL.DUMP', 'Usage: dump(fn) or dump(path)'));
      }
      return new Promise((resolve, reject) => {
        let cmd = `mysqldump -h ${this[config].host} -u ${this[config].user}`;
        if (this[config].options.port) {
          cmd += ` -P ${this[config].options.port}`;
        }
        if (this[config].password) {
          cmd += ` -p${this[config].password}`;
        }
        cmd += ' --skip-comments';
        cmd += ` ${this[config].database}`;
        exec(cmd, (err, stdout, stderr) => {
          if (err) {
            return reject(thorin.error('SQL.DUMP', 'Could not dump database', err));
          }
          if (stdout.indexOf('CREATE TABLE') === -1) {
            return reject(thorin.error('SQL.DUMP', 'Dump result is not valid', new Error(stderr)));
          }
          if (typeof onDump === 'function') {
            onDump(stdout);
          } else {
            try {
              fs.writeFileSync(fullPath, stdout, {encoding: 'utf8'});
            } catch (e) {
              return reject(thorin.error('SQL.DUMP', 'Could not write to export path', e));
            }
          }
          resolve();
        });
      });
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
          delete: true,
          crudify: true
        },
        host: 'localhost',
        port: null,
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
      if (this[config].port != null) {
        this[config].options.port = this[config].port;
        delete this[config].port;
      }
      if (!(this[config].path.models instanceof Array)) {
        this[config].path.models = [this[config].path.models];
      }
      if (this[config].debug && typeof this[config].debug.restify === 'boolean') { //backwards compatibility
        this[config].debug.crudify = this[config].debug.restify;
      }
      thorin.config('store.' + this.name, this[config]);
      this[logger] = thorin.logger(this.name);
      this[config].path.models.forEach((modelPath) => {
        if (!modelPath) return;
        loader.load(this, modelPath, this[models]);
      });
    }

    /*
     * Connect to SQL and initialize the connection.
     * */
    run(done) {
      if (this[seq]) return done();  // already initialized.
      if (this[config].user == null || this[config].password == null || !this[config].database) {
        return done(thorin.error('SQL.CREDENTIALS', 'Missing user, password or database credentials.'));
      }
      let opt = this[config].options;
      if (this[config].debug === false) {
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
          if (err) return done(err);
          done();
        });
      });

      async.series(calls, (err) => {
        if (err) {
          return done(thorin.error('SQL.INITIALIZATION', 'Could not initialize store.', err));
        }
        thorin.logger(this.name).info('Connected to SQL server');
        done();
      });
    }

    /**
     * Manually execute an SQL query.
     * */
    query() {
      let seqObj = this.getInstance();
      if (!seqObj) return Promise.reject('SQL.NOT_CONNECTED', 'Connection is not active');
      return seqObj.query.apply(seqObj, arguments);
    }

    /*
     * Sets up the database and all the relations. This is called
     * when the app is run with --setup=store.sql
     * */
    setup(done) {
      this.settingUp = true;
      const SETUP_DIRECTORIES = this[config].path.models;
      for (let i = 0; i < SETUP_DIRECTORIES.length; i++) {
        if (!SETUP_DIRECTORIES[i]) continue;
        try {
          thorin.util.fs.ensureDirSync(path.normalize(thorin.root + '/' + SETUP_DIRECTORIES[i]));
        } catch (e) {
        }
      }
      var log = thorin.logger(this.name);
      this.run((e) => {
        log.info(`Setting up database structure`);
        if (e) return done(e);
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
            if (items.length === 0) return;
            items[0].forEach((item) => {
              let tableName = item['Tables_in_' + this[config].database];
              if (!tableName) return;
              previousTables.push(tableName);
            });
          });
        });

        // drop each table.
        calls.push(() => {
          if (previousTables.length === 0) return;
          let drops = [];
          previousTables.forEach((tableName) => {
            drops.push(() => {
              return seqObj.query('DROP TABLE IF EXISTS `' + tableName + '`');
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
          if (!this[config].path.patch) return;
          var patchFiles = thorin.util.readDirectory(this[config].path.patch, 'sql');
          if (patchFiles.length === 0) return;
          let queries = [];
          patchFiles.forEach((fpath) => {
            var queryContent;
            try {
              queryContent = fs.readFileSync(fpath, {encoding: 'utf8'});
            } catch (e) {
              this._log("Thorin.store.sql: failed to load sql patch file: " + fpath);
              return;
            }
            if (queryContent.trim() === '') return;
            queryContent = queryContent.replace(/\r?\n/g, "\n");
            let statements = queryContent.split('\n');
            statements.forEach((sql) => {
              if (sql.trim() === '') return;
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
          if (e) {
            log.error("Encountered an error while setting up");
            log.trace(e.stack);
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
      if (!seqObj) {
        return new Promise((resolve, reject) => {
          reject(thorin.error('SQL.NOT_CONNECTED', 'Connection is not active.'));
        });
      }
      // sync the entire DB
      if (typeof opt !== 'string') {
        return seqObj.sync(opt);
      }
      //IF we have a specific model to sync, we can do so.
      if (typeof opt === 'string' && opt) {    // Try to sink a specific model
        let modelName = opt;
        return this.model(modelName).sync(b);
      }
      return this;
    }

    /*
     * Returns a custom SQL model by its code.
     * */
    model(name, forceReturnModel) {
      if (!this[models][name]) return null;
      if (forceReturnModel === true) return this[models][name];
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
      if (this[loaded]) {
        console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store is already initialized and cannot add models. Use thorin.on(thorin.EVENT.INIT) in stead.'));
        return this;
      }
      if (typeof item === 'string') {
        loader.load(this, item, this[models]);
        return this;
      }
      if (typeof item === 'function') {
        if (typeof opt !== 'object' || !opt || !opt.code) {
          console.error(thorin.error('SQL.ADD_MODEL', 'SQL Store: when adding a model with a function, options must be passed with a code.'));
          return this;
        }
        let modelObj = loader.buildModel(this.getInstance(), item, opt);
        if (modelObj) {
          if (typeof this[models][modelObj.code] !== 'undefined') {
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
     * Manually set the SQL patch path.
     * */
    setPatchPath(patchPath) {
      if (typeof patchPath !== 'string') return false;
      this[config].path.patch = path.normalize(patchPath);
      return this;
    }

    /*
     * The crudify function will attach CREATE, READ, FIND, UPDATE, DELETE
     * on the given model name.
     * Arguments:
     *   modelName - the model name we want to crudify.
     *   actions - the actions we want to attach. Defaults to all.
     *   options - additional options to pass.
     *     - name: the model code we want to use. Default to modelObj.code
     *     - namespace=store: if we want to use a different action namespace, other than the default "store" one.
     *     - debug=false: should we log the Crudify model action
     * */
    crudify(modelName, actions, opt) {
      const modelObj = this.model(modelName),
        crudifyDebug = this[config].debug.crudify;
      if (!modelObj) {
        console.error(thorin.error('SQL.CRUDIFY', 'SQL model ' + modelName + ' not found for crudify()'));
        return this;
      }
      if (typeof actions === 'string') {
        actions = actions.split(' ');
      }
      if (!(actions instanceof Array)) {
        opt = actions;
        actions = ['create', 'read', 'find', 'update', 'delete'];
      }
      if (typeof opt !== 'object' || !opt) opt = {};
      if (!opt.name) {
        opt.name = modelObj.code;
      }
      const actionObj = new CrudifyAction(modelObj);
      // once the db is ready, we create the action.
      thorin.on(thorin.EVENT.RUN, 'store.' + this.name, () => {
        process.nextTick(() => {
          actions.forEach((name) => {
            if (typeof crudify[name] !== 'function') {
              console.error(thorin.error('SQL.CRUDIFY', 'Crudify action ' + name + ' is not valid for model ' + modelName));
              return;
            }
            let dbAction = crudify[name].call(this, actionObj, opt);
            if (!dbAction) {
              console.warn(thorin.error('SQL.CRUDIFY', 'Crudify action ' + name + ' could not complete.'));
              return;
            }
            let self = this;

            function onActionRegistered(newActionObj) {
              if (newActionObj.name !== dbAction.name) return;
              thorin.dispatcher.removeListener('action', onActionRegistered);
              let logMsg = 'Crudifying "' + name + '" for model ' + modelName + ' on (' + dbAction.name + ')',
                aliases = [];
              if (dbAction.aliases) {
                dbAction.aliases.forEach((item) => {
                  aliases.push(item.verb + ' ' + item.name);
                });
                logMsg += " [" + aliases.join(',') + ']';
              }
              if (crudifyDebug) {
                self._log(logMsg);
              } else if (thorin.env === 'production' && opt.debug === true) {
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

    restify(modelName) {
      this.logger.warn('restify() on ' + modelName + ' has been deprecated in favor of crudify()');
      return this.crudify.apply(this, arguments);
    }

    /*
     * This will offer transaction support (see http://docs.sequelizejs.com/en/latest/docs/transactions )
     * The transaction wrapper looks as follows:
     * storeObj.transaction((t) => {
     *   return new Promise((resolve, reject) => {
     *   // do stuff
     *     const Account = storeObj.model('account');
     *     return Account.find({...}, { transaction: t })
     *     resolve();  // this will commit.
     *   })
     * }).then((result) => {}) // committed
     *   .catch((err) => {});  // rolled back
     * */
    transaction(fn, opt) {
      return this[seq].transaction(opt || {}, (t) => {
        try {
          return fn(t);
        } catch (e) {
          this._log('Transaction encountered an error in handler', e);
          return Promise.reject(thorin.error(e));
        }
      });
    }

    /*
     * Handles sequelize logs.
     * */
    _log(msg) {
      if (this.settingUp) {
        msg = 'setup: ' + msg;
      }
      if (this[config].debug === false) return;  // no debug.
      if (this[config].debug === true) { // debug all
        this.logger.debug(msg);
      }
      if (this[config].debug.create === false && msg.indexOf('INSERT ') !== -1) return;
      if (this[config].debug.read === false && msg.indexOf('SELECT ') !== -1) return;
      if (this[config].debug.update === false && msg.indexOf('UPDATE ') !== -1) return;
      if (this[config].debug.delete === false && msg.indexOf('DELETE ') !== -1) return;
      this.logger.debug(msg);
    }

    /*
     * ------------ HELPER FUNCTIONS
     * */
    decamelize(r) {
      return decamelize(r, '_');
    }

    camelize(r) {
      return camelize(r, '_');
    }
  }

  return ThorinSqlStore;
}