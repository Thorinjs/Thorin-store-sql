'use strict';
/**
 * Created by Adrian on 07-Apr-16.
 * This will register the CREATE, READ, UPDATE, DELETE, FIND
 * actions for the given modelObj.
 * All models that will pass through the restify process, will have a .fromRestify=true field added to their instances.
 *
 * FILTERS THAT CAN BE INTERCEPTED:
 *  create.before(intentObj, newInstanceObj)
 *  create.after(intentObj, savedInstanceObj)
 *  create.send(intentObj)
 *  read.before(intentObj, findQuery)
 *  read.after(intentObj, entityObj)
 *  read.send(intentObj)
 *  find.before(intentObj, findQuery)
 *  find.after(intentObj, results[])
 *  find.send(intentObj)
 *  update.before(intentObj, findQuery)
 *  update.save(intentObj, entityObj)
 *  update.after(intentObj, entityObj)
 *  update.send(intentObj)
 *  delete.before(intentObj, findQuery)
 *  delete.destroy(intentObj, entityObj)
 *  delete.after(intentObj, entityObj)
 *  delete.send(intentObj)
 */
module.exports = function(thorin) {

  const actions = {},
    dispatcher = thorin.dispatcher,
    ACTION_NAMESPACE = "";

  /* Returns an array of aliases for the given action */
  function getAliases(actionObj, defaultVerb, defaultPath) {
    if (actionObj.aliases.length !== 0) {
      return actionObj.aliases; // some custom aliases.
    }
    var rootPath = actionObj.rootPath;
    if (rootPath.charAt(0) !== '/') rootPath = '/' + rootPath;
    if (rootPath.charAt(rootPath.length - 1) === '/') rootPath = rootPath.substr(0, rootPath.length - 1);
    rootPath += defaultPath;
    return [[defaultVerb, rootPath]];
  }

  /* Attach the use() and middleware() for the action */
  function attachUses(restifyAction, dbAction) {
    restifyAction.uses.forEach((item) => {
      if(typeof dbAction[item.fn] !== 'function') return;
      dbAction[item.fn].apply(dbAction, item.args);
    });
  }

  /* Attach the stuff to the new action */
  function attach(restifyAction, dbAction, aliases) {
    if(!restifyAction.templates) return;
    restifyAction.templates.forEach((t) => {
      dbAction.template(t);
    });
    delete restifyAction.templates;
    // attach all middlewares.
    restifyAction.handlers.forEach((item) => {
      if(typeof dbAction[item.fn] !== 'function') return;
      dbAction[item.fn].apply(dbAction, item.args);
    });
    delete restifyAction.handlers;
    // attach aliases.
    aliases.forEach((args) => {
      dbAction.alias.apply(dbAction, args);
    });
  }

  /* Attaches a validator to the input */
  function addValidator(fieldValidator, fieldName, field) {
    fieldValidator[fieldName] = dispatcher.validate(field.type.key);
    if (typeof field.defaultValue !== 'undefined') {
      fieldValidator[fieldName].default(field.defaultValue);
    }
    if (field.type.values) {
      fieldValidator[fieldName].options(field.type.values);
    }
    fieldValidator[fieldName].fieldName = fieldName;
    return fieldValidator[fieldName];
  }

  /* Attaches a foreign validator to the input */
  function addForeignValidator(fieldValidator, relation, _ignoreCallback) {
    let relObj = this.model(relation.name, true),
      relPrimary = relObj.getPrimary(),
      relName = relation.options.foreignKey.name;
    if (relPrimary) {
      addValidator(fieldValidator, relName, relPrimary);
    }
    fieldValidator[relName].fieldName = relName;
    if (relation.options.foreignKey.allowNull) {
      fieldValidator[relName].default(null);
    }
    if (_ignoreCallback === true) return fieldValidator[relName];
    // query the model when an incoming request containing the id comes.
    fieldValidator[relName].callback((val, done) => {
      if (val == null) return done();
      if (typeof val === 'object' && typeof val.get === 'function') return done(null, val); // it was previously queried and fetched.
      let RelModel = this.model(relation.name);
      let where = {};
      where[relPrimary.fieldName] = val;
      RelModel.find({
        where: where,
        attributes: [relPrimary.fieldName]  // we just check for existance.
      }).then((rObj) => {
        if (!rObj) {
          return done(thorin.error('INPUT.NOT_VALID', 'Invalid reference for ' + relName, 404));
        }
        done(null, rObj.get(relPrimary.fieldName));  //return with the id
      }).catch((e) => {
        done(thorin.error(e));
      });
    });
    return fieldValidator[relName];
  }

  /*
   * Error parser for create and update.
   * */
  function parseChangeError(e, modelObj) {
    let wrapError = thorin.error('INPUT.NOT_VALID', 'Invalid value for entity.', 400),
      fields = [];
    if (e instanceof Error) {
      switch (e.name) {
        case 'SequelizeValidationError':
          wrapError.message = e.errors[0].message;
          e.errors.forEach((err) => {
            if (err.path.indexOf('thorinValidate') === -1) { // field validator.
              fields.push(err.path);
            }
          });
          break;
        case 'SequelizeUniqueConstraintError':
          wrapError.code = 'INPUT.EXISTS';
          wrapError.message = "An entry with the same " + e.errors[0].path.substr(modelObj.tableName.length + 1) + ' already exists.';
          e.errors.forEach((err) => {
            fields.push(err.path.substr(modelObj.tableName.length + 1));
          });
          break;
        default:
          e = thorin.error(e);  // default error.
      }
    }
    if (fields.length === 1) {
      wrapError.data = {
        field: fields[0]
      }
    } else if (fields.length > 1) {
      wrapError.data = {
        fields: fields
      };
    }
    return wrapError;
  }


  /*
   * Handles the CREATEion of a sql model.
   * Action id will be:
   *   db.create.{modelName}
   * HTTP alias will be: POST {root}/{modelName}
   * FILTERS:
   *  create.before(intentObj) -> right before we call the save()
   *  create.after(intentObj, instanceObj)  -> right after we call save() and before we send the intent.
   * */
  actions.create = function(actionObj, opt) {
    let modelObj = actionObj.model,
      aliases = getAliases(actionObj, 'POST', '/' + opt.name),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if(namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.create' : opt.action);
    var dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {},
      primaryKey = modelObj.getPrimary();

    // place static ones
    Object.keys(modelObj.fields).forEach((fieldName) => {
      if(fieldName === 'created_at') return;
      let field = modelObj.fields[fieldName];
      if (field.primaryKey || field.private || field.update === false) return;
      addValidator(fieldValidator, fieldName, field);
    });
    // check if we have any relationships.
    modelObj.relations.forEach((relation) => {
      if(relation.options) {
        if(relation.options.private) return;
        if(relation.options.update === false) return;
      }
      // belongsTo relations have a foreign key in the current model that we have to check.
      if (relation.type === 'belongsTo') {
        addForeignValidator.call(this, fieldValidator, relation);
      }
    });
    dbAction.input(fieldValidator);
    // attach the usees() AFTER we've attached the input validators.
    attachUses(actionObj, dbAction);
    dbAction.use((intentObj) => {
      let DbModel = this.model(modelObj.code),
        inputData = intentObj.input(),
        newInstance = DbModel.build({});
      newInstance.fromRestify = true;
      // at this point, we map the information, so that it has access to the .fromRestify
      Object.keys(inputData).forEach((keyName) => {
        if(primaryKey && primaryKey.fieldName === keyName) return;
        newInstance.set(keyName, inputData[keyName]);
      });
      try {
        actionObj._runFilters('create.before', intentObj, newInstance);
      } catch (e) {
        return intentObj.error(thorin.error(e)).send();
      }
      newInstance.save().then(() => {
        try {
          actionObj._runFilters('create.after', intentObj, newInstance);
        } catch (e) {
          return intentObj.error(thorin.error(e)).send();
        }
        intentObj.result(newInstance);
        actionObj._runSend('create.send', intentObj);
      }, (e) => {
        let wrapError = parseChangeError(e, modelObj);
        intentObj.error(wrapError).send();
      }).catch((e) => {
        intentObj.error(thorin.error(e));
      });
    });
    return dbAction;
  };

  /*
   * Handles the "FindByID" of a SQL model.
   *
   * FILTERS:
   *  read.before(intentObj, findQuery) -> right before we call the .find()
   *  read.after(intentObj, entityObj)  -> right after we've found the iten and before we send it to the client.
   * */
  actions.read = function(actionObj, opt) {
    let modelObj = actionObj.model,
      primaryKey = modelObj.getPrimary();
    if (!primaryKey) {
      console.error('Thorin.sql.restify: Model ' + modelObj.code + " does not contain a primary key for the READ restify action.");
      return false;
    }
    let aliases = getAliases(actionObj, 'GET', '/' + opt.name + '/:' + primaryKey.fieldName),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if(namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.read' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {};
    fieldValidator[primaryKey.fieldName] = dispatcher.validate(primaryKey.type.key);
    fieldValidator[primaryKey.fieldName].default(null);
    dbAction.input(fieldValidator);
    attachUses(actionObj, dbAction);
    dbAction.use((intentObj) => {
      let DbModel = this.model(modelObj.code),
        findQuery = {
          where: {}
        };
      findQuery.where[primaryKey.fieldName] = intentObj.input(primaryKey.fieldName);
      // update the findQuery
      try {
        actionObj._runFilters('read.before', intentObj, findQuery);
      } catch (e) {
        return intentObj.error(thorin.error(e)).send();
      }
      function doResObj(resObj) {
        if (!resObj) { // not found.
          return intentObj
            .error(thorin.error('ENTRY.NOT_FOUND', 'The requested entity was not found', 404))
            .send();
        }
        resObj.fromRestify = true;
        try {
          actionObj._runFilters('read.after', intentObj, resObj);
        } catch (e) {
          return intentObj.error(thorin.error(e)).send();
        }
        intentObj.result(resObj);
        actionObj._runSend('read.send', intentObj);
      }
      let tmpObj = intentObj.data(modelObj.code);
      // IF we already have the modelObj in the intent data, we use it.
      if(tmpObj) {
        return doResObj(tmpObj);
      }
      if(primaryId == null) {
        return intentObj.error(thorin.error('INPUT.NOT_VALID', 'Invalid or missing ' + primaryKey.fieldName)).send();
      }
      DbModel.find(findQuery).then(doResObj).catch((e) => {
        intentObj.error(thorin.error(e)).send();
      });
    });
    return dbAction;
  };

  /*
   * Handles the "FindAll" of a SQL Model.
   * OPTIONS:
   *  - maxLimit -> the maximum limit
   * The default functionality will include:
   * - sorting with: sort=asc|desc&sortBy=fieldName
   * - paging with ?page=2&limit=10
   * - date filtering with ?start_date&end_date
   *
   * FILTERS:
   *  find.before(intentObj, findQuery) -> right before we call the findAll() with the query.
   *  find.after(intentObj, results[])  -> right after we've queried and before we send them.
   * */
  actions.find = function(actionObj, opt) {
    let modelObj = actionObj.model;
    let aliases = getAliases(actionObj, 'GET', '/' + opt.name),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if(namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.find' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {},
      attributeFilters = [];
    // add the created_at or updated_at field.
    if (modelObj.options.createdAt) {
      attributeFilters.push(modelObj.options.createdAt);
    }
    if (modelObj.options.updatedAt) {
      attributeFilters.push(modelObj.options.updatedAt);
    }
    let primaryKey = modelObj.getPrimary();
    // for each field in the model, we check if it is searchable or not.
    Object.keys(modelObj.fields).forEach((fieldName) => {
      let field = modelObj.fields[fieldName];
      // IF the field is private, has filtering disabled or is primary, we skip.
      if (field.primaryKey && field.autoIncrement) return;
      if (field.private && field.filter !== true) return;
      if (field.filter === false) return;
      attributeFilters.push(fieldName);
      addValidator(fieldValidator, fieldName, field);
      fieldValidator[fieldName].default(null);
    });
    // then, do the createdAt or updatedAt.
    if (modelObj.options.createdAt) {
      fieldValidator[modelObj.options.createdAt] = dispatcher.validate('DATE').default(null);
    }
    if (modelObj.options.updatedAt) {
      fieldValidator[modelObj.options.updatedAt] = dispatcher.validate('DATE').default(null);
    }
    // then, we do the foreign validators.
    modelObj.relations.forEach((relation) => {
      if (relation.options.private && relation.options.filter !== true) return;
      if (relation.type === 'belongsTo') {
        let valObj = addForeignValidator.call(this, fieldValidator, relation, true);
        valObj.default(null);
        attributeFilters.push(relation.options.foreignKey.name);
      }
    });
    // Add the "START_DATE" and "END_DATE" validators, if the model has a createdAt.
    if (modelObj.options.createdAt) {
      fieldValidator['start_date'] = dispatcher.validate('DATE').default(null);
      fieldValidator['end_date'] = dispatcher.validate('DATE').default(null);
    }
    // Add the "LIMIT" validator
    fieldValidator['limit'] = dispatcher.validate('NUMBER', {
      min: 1,
      max: opt.maxLimit || 100
    }).default(10);
    // add the "PAGE" validator
    fieldValidator['page'] = dispatcher.validate('NUMBER', {
      min: 1
    }).default(1);
    // add the "ORDER" validator
    fieldValidator['order'] = dispatcher.validate('ENUM', ['asc', 'desc']).default('asc');
    // add the "ORDER_BY" validator
    let orderByDefault = null;
    if (modelObj.options.createdAt) {
      orderByDefault = modelObj.options.createdAt;
    } else {  // default the primary key.
      if (primaryKey) {
        orderByDefault = primaryKey.fieldName;
      }
    }
    fieldValidator['order_by'] = dispatcher.validate('string').default(orderByDefault);

    // attach the validator.s
    dbAction.input(fieldValidator);
    attachUses(actionObj, dbAction);
    dbAction.use((intentObj) => {
      // first, we parse the input, to see what isn't null.
      let DbModel = this.model(modelObj.code),
        findQuery = {
          where: {},
          order: []
        },
        input = intentObj.input();
      // validate the incoming keys
      attributeFilters.forEach((name) => {
        let value = input[name];
        if (value == null || typeof value === 'undefined') return;
        // type safe.
        if (value instanceof Array) {
          let safe = [];
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] === 'string' || typeof value[i] === 'number' || typeof value[i] === 'boolean') {
              safe.push(value[i]);
            }
          }
          if (safe.length === 0) return;
          findQuery.where[name] = safe;
        } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          findQuery.where[name] = value;
        }
      });
      // set the limit
      findQuery.limit = input.limit;
      if (input.page > 1) {  // we have pagination
        findQuery.offset = (input.page - 1 ) * input.limit;
      }
      // set the order and orderBy
      let orders = input.order_by.split(','),
        hasOrder = false;
      for (let i = 0; i < orders.length; i++) {
        let orderBy = orders[i];
        if (attributeFilters.indexOf(orderBy) !== -1
          || orderBy === modelObj.options.createdAt
          || orderBy === modelObj.options.updatedAt
          || (primaryKey && primaryKey.fieldName === orderBy)) {
          findQuery.order.push([orderBy, input.order]);
          hasOrder = true;
        }
      }
      if (!hasOrder) {
        findQuery.order.push([orderByDefault, input.order]);
      }
      // set the start_date and end_date if we have em under start_date and end_date
      if ((input.start_date || input.end_date) && !findQuery.where[modelObj.options.createdAt]) {
        if (input.start_date && input.end_date) {
          if (input.start_date > input.end_date) {
            let err = thorin.error('INPUT.NOT_VALID', 'Start date must be before end date.', 400);
            err.data = {
              field: 'start_date'
            };
            return intentObj.error(err).send();
          }
          if (input.end_date < input.start_date) {
            let err = thorin.error('INPUT.NOT_VALID', 'End date must be after start date.', 400);
            err.data = {
              field: 'end_date'
            };
            return intentObj.error(err).send();
          }
          if (input.start_date.toString() === input.end_date.toString()) {
            findQuery.where[modelObj.options.createdAt] = input.start_date;
          }
        }
        if (!findQuery.where[modelObj.options.createdAt]) {
          findQuery.where[modelObj.options.createdAt] = {};
          if (input.start_date) {
            findQuery.where[modelObj.options.createdAt]['$gte'] = input.start_date;
          }
          if (input.end_date) {
            findQuery.where[modelObj.options.createdAt]['$lte'] = input.end_date;
          }
        }
      }
      // run the filters.
      try {
        actionObj._runFilters('find.before', intentObj, findQuery);
      } catch (e) {
        return intentObj.error(thorin.error(e)).send();
      }
      let calls = [],
        totalCount,
        results = [];
      // step one, count() all of them.
      calls.push(() => {
        let countQuery = thorin.util.extend(findQuery);
        delete countQuery.limit;
        delete countQuery.offset;
        delete countQuery.order;
        return DbModel.count(countQuery).then((cnt) => {
          totalCount = cnt;
        });
      });
      // step two, if there are any counts, query em.
      calls.push(() => {
        if (totalCount === 0) return;
        return DbModel.findAll(findQuery).then((_res) => {
          results = _res;
          for (let i = 0; i < results.length; i++) {
            results[i].fromRestify = true;
          }
        });
      });
      thorin.series(calls, (err) => {
        if (err) {
          return intentObj.error(thorin.error(err)).send();
        }
        try {
          actionObj._runFilters('find.after', intentObj, results);
        } catch (e) {
          return intentObj.error(thorin.error(e)).send();
        }
        intentObj.result(results);
        // TODO: transform the pagination data into a thorin.Pagination
        let totalPages = Math.ceil(totalCount / input.limit);
        let paginationData = {
          total_count: totalCount,
          page_count: totalPages,
          current_count: results.length,
          current_page: input.page
        };
        intentObj.rootData(paginationData);
        actionObj._runSend('find.send', intentObj);
      });
    });
    return dbAction;
  };

  /*
   * Handles the "Update" of a SQL Model. We can only handle UPDATE
   * for models that have one primary key defined. If a model has no such ting,
   * we cannot perform the update.
   * OPTIONS:
   *
   * FILTERS:
   *  update.before(intentObj, findQuery) -> right before we call the find() for the entity.
   *  update.save(intentObj, entityObj) -> right before we call the save() for the entity
   *  update.after(intentObj, entityObj) -> right after we called the save() for the entity.
   * */
  actions.update = function(actionObj, opt) {
    let modelObj = actionObj.model;
    let primaryKey = modelObj.getPrimary();
    if (!primaryKey) {
      console.warn('Thorin.sql.restify: model ' + modelObj.code + ' does not have a primary key for "update" restify');
      return;
    }
    let aliases = getAliases(actionObj, 'POST', '/' + opt.name + '/:' + primaryKey.fieldName),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if(namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.update' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {},
      foreignKeys = [];
    // place the model's fields as input fields
    Object.keys(modelObj.fields).forEach((fieldName) => {
      if(fieldName === 'created_at') return;
      let field = modelObj.fields[fieldName];
      if (field.private || field.update === false) return;
      let proxyField = {
        type: {
          key: field.type.key,
          values: field.type.values
        },
        defaultValue: null
      };
      addValidator(fieldValidator, fieldName, proxyField);
    });
    // place any relation foreign keys
    modelObj.relations.forEach((relation) => {
      if(relation.options) {
        if (relation.options.private === true) return; //skip private fields.
        if (relation.options.update === false) return; // skip non updatable fields.
      }

      if (relation.type === 'belongsTo') {
        let valObj = addForeignValidator.call(this, fieldValidator, relation);
        valObj.default(null);
        foreignKeys.push(valObj.fieldName);
      }
    });
    dbAction.input(fieldValidator);
    attachUses(actionObj, dbAction);
    dbAction.use((intentObj) => {
      let DbModel = this.model(modelObj.code),
        rawInput = intentObj.rawInput,
        input = intentObj.input();
      let calls = [],
        resObj,
        primaryId = intentObj.input(primaryKey.fieldName),
        hasUpdates = false,
        findQry = {
          where: {}
        };
      findQry.where[primaryKey.fieldName] = primaryId;
      // run the action filters
      // IF we already have the entity in the intent, we skip the query
      let tmpObj = intentObj.data(modelObj.code);
      if(tmpObj) {
        resObj = tmpObj;
      } else {
        if(!primaryId) {
          return intentObj.error(thorin.error('INPUT.NOT_VALID', 'Invalid or missing ' + primaryKey.fieldName)).send();
        }
        try {
          actionObj._runFilters('update.before', intentObj, findQry);
        } catch (e) {
          return intentObj.error(thorin.error(e)).send();
        }
        // step one, read the model.
        calls.push((stop) => {
          return DbModel.find(findQry).then((res) => {
            if (!res) {
              return stop(thorin.error('ENTRY.NOT_FOUND', 'The requested entity was not found', 404));
            }
            resObj = res;
            resObj.fromRestify = true;
          });
        });
      }
      // step two, update the result's fields. and save it.
      calls.push((stop) => {
        // step one, for each rawInput, we fetch its input, so that we only update what we receive.
        let updateKeys = Object.keys(input),
          toUpdate = {};
        for (let i = 0; i < updateKeys.length; i++) {
          let keyName = updateKeys[i],
            keyValue = input[keyName];
          if (keyName === primaryKey.fieldName) continue;
          if (typeof rawInput[keyName] === 'undefined') continue;
          let shouldUpdateKey = false;
          // check if we have a foreign key
          if (foreignKeys.indexOf(keyName) !== -1) {
            if (rawInput[keyName] == null) {
              keyValue = null;  //remove the reference.
              shouldUpdateKey = true;
            } else if (input[keyName] != null) {
              shouldUpdateKey = true; // update teh reference
            }
          } else {
            if (input[keyName] != null) {
              shouldUpdateKey = true;
            }
          }
          if (!shouldUpdateKey) continue;
          toUpdate[keyName] = keyValue;
          if (!hasUpdates) hasUpdates = true;
        }
        if (!hasUpdates) return;
        let hasAfterFilters = false;
        Object.keys(toUpdate).forEach((keyName) => {
          if (!hasAfterFilters) hasAfterFilters = true;
          let val = toUpdate[keyName];
          resObj.set(keyName, val);
        });
        if (!hasAfterFilters) return;  // filter removed updates.
        // call the filters to possibly alter the updates.
        try {
          actionObj._runFilters('update.save', intentObj, resObj);
        } catch (e) {
          return stop(e);
        }
        return resObj.save();
      });
      thorin.series(calls, (e) => {
        if (e) {
          let wrapError = parseChangeError(e, modelObj);
          return intentObj.error(wrapError).send();
        }
        try {
          actionObj._runFilters('update.after', intentObj, resObj);
        } catch (e) {
          return intentObj.error(thorin.error(e)).send();
        }
        let hasChanged = (Object.keys(resObj._changed).length > 0);
        intentObj.rootData({
          changed: hasChanged
        });
        intentObj.result(resObj);
        actionObj._runSend('update.send', intentObj);
      });
    });
    return dbAction;
  };

  /*
   * Handles the "Delete" of a SQL Model.
   * FILTERS:
   *  delete.before(intentObj, findQuery) -> right before we call the find() for the entity
   *  delete.destroy(intentObj, entityObj) -> right before we call the destroy() for the entity
   *  delete.after(intentObj, entityObj)  -> right after we called the destroy() and the entity was deleted.
   *
   *  OPTIONS:
   *    - useField (string) if specified, we will not destroy() the entity ,but rather set the given field to false and save.
   * */
  actions.delete = function(actionObj, opt) {
    let modelObj = actionObj.model,
      primaryKey = modelObj.getPrimary();
    if (!primaryKey) {
      console.warn('Thorin.sql.resitfy: model ' + modelObj.code + ' does not have a primary key. Skipping');
      return;
    }
    let aliases = getAliases(actionObj, 'DELETE', '/' + opt.name + '/:' + primaryKey.fieldName),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if(namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.delete' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    // the only input we have is the primary key.
    let fieldValidator = {};
    fieldValidator[primaryKey.fieldName] = dispatcher.validate(primaryKey.type.key);
    fieldValidator[primaryKey.fieldName].default(null);
    dbAction.input(fieldValidator);
    attachUses(actionObj, dbAction);
    dbAction.use((intentObj) => {
      let DbModel = this.model(modelObj.code),
        resObj,
        primaryId = intentObj.input(primaryKey.fieldName),
        findQuery = {
          where: {}
        };
      findQuery.where[primaryKey.fieldName] = primaryId;
      // IF we had a useField option specify, that MUST be true
      if(opt.useField) {
        findQuery.where[opt.useField] = true;
      }
      // update the find query
      // IF we already have the entity in the intent, we skip the query.
      let tmpObj = intentObj.data(modelObj.code);
      let calls = [];
      if(tmpObj) {
        resObj = tmpObj;
      } else {
        if(primaryId == null) {
          return intentObj.error(thorin.error('INPUT.NOT_VALID', 'Invalid or missing ' + primaryKey.fieldName)).send();
        }
        // IF we don't have the entity, we query for it.
        try {
          actionObj._runFilters('delete.before', intentObj, findQuery);
        } catch (e) {
          // if we have any filter error, we stop.
          return intentObj.error(thorin.error(e)).send();
        }
        // step one, read the model.
        calls.push((stop) => {
          return DbModel.find(findQuery).then((res) => {
            if (!res) {
              return stop(thorin.error('ENTRY.NOT_FOUND', 'The requested entity was not found', 404));
            }
            resObj = res;
            resObj.fromRestify = true;
          });
        });
      }
      // step two, delete it.
      calls.push((stop) => {
        if (typeof resObj.canDelete === 'function') {
          let canDelete = true;
          try {
            canDelete = resObj.canDelete();
            if (!canDelete) {
              return stop()
            }
          } catch (e) {
            return stop(thorin.error(e));
          }
          if (canDelete === false) {
            return stop(thorin.error('ENTRY.DELETE', 'The requested entity cannot be deleted.', 400));
          }
        }
        try {
          actionObj._runFilters('delete.destroy', intentObj, resObj);
        } catch (e) {
          // if we have any filter error, we stop.
          return stop(e);
        }
        /* We check if we want to simply set a given field to false or destroy.*/
        if(!opt.useField) {
          return resObj.destroy();
        }
        resObj.set(opt.useField, false);
        resObj.set('deleted_at', Date.now());
        return resObj.save();
      });

      thorin.series(calls, (e) => {
        if (e) {
          return intentObj.error(e).send();
        }
        try {
          actionObj._runFilters('delete.after', intentObj, resObj);
        } catch (e) {
          // if we have any filter error, we stop.
          return intentObj.error(thorin.error(e)).send();
        }
        intentObj.rootData({
          deleted: true
        });
        actionObj._runSend('delete.send', intentObj);
      });
    });
    return dbAction;
  };


  return actions;
}
;