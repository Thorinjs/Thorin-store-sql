'use strict';
/**
 * Created by Adrian on 07-Apr-16.
 * This will register the CREATE, READ, UPDATE, DELETE, FIND
 * actions for the given modelObj.
 * All models that will pass through the crudify process, will have a .fromCrudify=true field added to their instances.
 *
 * FILTERS THAT CAN BE INTERCEPTED:
 *  create.before(intentObj, newInstanceObj)
 *  create.after(intentObj, savedInstanceObj)
 *  create.send(intentObj)
 *  create.error(intentObj)
 *  read.before(intentObj, findQuery)
 *  read.after(intentObj, entityObj)
 *  read.send(intentObj)
 *  read.error(intentObj)
 *  find.before(intentObj, findQuery)
 *  find.count(intentObj, countQry)
 *  find.after(intentObj, results[])
 *  find.send(intentObj)
 *  find.error(intentObj)
 *  update.before(intentObj, findQuery)
 *  update.save(intentObj, entityObj)
 *  update.after(intentObj, entityObj)
 *  update.send(intentObj)
 *  update.error(intentObj)
 *  delete.before(intentObj, findQuery)
 *  delete.destroy(intentObj, entityObj)
 *  delete.after(intentObj, entityObj)
 *  delete.send(intentObj)
 *  delete.error(intentObj)
 */
module.exports = function (thorin) {

  const actions = {},
    dispatcher = thorin.dispatcher,
    ACTION_NAMESPACE = "";

  /* Returns an array of aliases for the given action */
  function getAliases(actionObj, defaultVerb, defaultPath, hasAlias) {
    if (hasAlias === false) return [];
    if (actionObj.aliases.length !== 0) {
      return actionObj.aliases; // some custom aliases.
    }
    let rootPath = actionObj.rootPath;
    if (rootPath.charAt(0) !== '/') rootPath = '/' + rootPath;
    if (rootPath.charAt(rootPath.length - 1) === '/') rootPath = rootPath.substr(0, rootPath.length - 1);
    rootPath += defaultPath;
    return [[defaultVerb, rootPath]];
  }

  /* Attach the use() and middleware() for the action */
  function attachUses(crudifyAction, dbAction) {
    crudifyAction.uses.forEach((item) => {
      if (typeof dbAction[item.fn] !== 'function') return;
      dbAction[item.fn].apply(dbAction, item.args);
    });
  }

  /* Attach the stuff to the new action */
  function attach(crudifyAction, dbAction, aliases) {
    if (!crudifyAction.templates) return;
    crudifyAction.templates.forEach((t) => {
      dbAction.template(t);
    });
    delete crudifyAction.templates;
    // attach all middlewares.
    crudifyAction.handlers.forEach((item) => {
      if (typeof dbAction[item.fn] !== 'function') return;
      dbAction[item.fn].apply(dbAction, item.args);
    });
    delete crudifyAction.handlers;
    dbAction.hasDebug = crudifyAction.hasDebug;
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
      relName = relation.options.foreignKey.name || relation.options.foreign_key || relation.options.foreignKey;
    if (!relName && relation.options.foreign_key) {
      console.warn(`Thorin.store.crudify: could not set foreign key validator for`, relation)
      return null;
    }
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
      if (typeof val === 'function') val = val();
      where[relPrimary.fieldName] = val;
      RelModel.find({
        where: where,
        attributes: [relPrimary.fieldName]  // we just check for existance.
      }).then((rObj) => {
        if (!rObj) {
          return done(thorin.error('DATA.INVALID', 'Invalid reference for ' + relName, 404));
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
    if (!modelObj || e && e.name.indexOf('Thorin') === 0) return e;
    let wrapError = thorin.error('DATA.INVALID', 'Invalid value for entity.', 400),
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


  /**
   * Handles the CREATEion of a sql model.
   * Action id will be:
   *   db.create.{modelName}
   * HTTP alias will be: POST {root}/{modelName}
   * OPTIONS
   *    - delay -> if set to true, we will delay input() only after the action's uses
   * FILTERS:
   *  create.before(intentObj) -> right before we call the save()
   *  create.after(intentObj, instanceObj)  -> right after we call save() and before we send the intent.
   * */
  actions.create = async function (actionObj, opt) {
    let modelObj = actionObj.model,
      aliases = getAliases(actionObj, 'POST', '/' + opt.name, opt.alias),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if (namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.create' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {},
      primaryKey = modelObj.getPrimary();

    // place static ones
    Object.keys(modelObj.fields).forEach((fieldName) => {
      if (fieldName === 'created_at') return;
      let field = modelObj.fields[fieldName];
      if (field.primaryKey || field.private || field.create === false) return;
      addValidator(fieldValidator, fieldName, field);
    });
    // check if we have any relationships.
    modelObj.relations.forEach((relation) => {
      if (relation.options) {
        if (relation.options.private) return;
        if (relation.options.create === false) return;
      }
      // belongsTo relations have a foreign key in the current model that we have to check.
      if (relation.type === 'belongsTo') {
        addForeignValidator.call(this, fieldValidator, relation);
      }
    });
    if (opt.delay === true) {
      attachUses(actionObj, dbAction);
      dbAction.input(fieldValidator);
    } else {
      dbAction.input(fieldValidator);
      attachUses(actionObj, dbAction);
    }
    dbAction.use(async (intentObj) => {
      let DbModel = this.model(modelObj.code),
        inputData = intentObj.input(),
        newInstance = DbModel.build({});
      newInstance.fromCrudify = true;
      newInstance.fromRestify = true; // backwards compatibility
      // at this point, we map the information, so that it has access to the .fromCrudify
      Object.keys(inputData).forEach((keyName) => {
        if (primaryKey && primaryKey.fieldName === keyName) return;
        newInstance.set(keyName, inputData[keyName]);
      });
      try {
        actionObj._runFilters('create.before', intentObj, newInstance);
      } catch (e) {
        intentObj.error(thorin.error(e));
        actionObj._runSend('create.error', intentObj);
        return null;
      }
      try {
        await newInstance.save();
        actionObj._runFilters('create.after', intentObj, newInstance);
        intentObj.result(newInstance);
        actionObj._runSend('create.send', intentObj);
      } catch (e) {
        let wrapError = parseChangeError(e, modelObj);
        intentObj.error(wrapError);
        actionObj._runSend('create.error', intentObj);
      }
    });
    return dbAction;
  };

  /**
   * Handles the "FindByID" of a SQL model.
   *  OPTIONS
   *    - input = input/filter (where to place the validations)
   *    - delay -> if set to true, we will delay filter applying only after the action's ones.
   *  - forceQuery -> if set to true, we will not use data(modelObj.code)  *
   * FILTERS:
   *  read.before(intentObj, findQuery) -> right before we call the .find()
   *  read.after(intentObj, entityObj)  -> right after we've found the iten and before we send it to the client.
   * */
  actions.read = async function (actionObj, opt) {
    let modelObj = actionObj.model,
      primaryKey = modelObj.getPrimary();
    if (!primaryKey) {
      console.error('Thorin.sql.crudify: Model ' + modelObj.code + " does not contain a primary key for the READ crudify action.");
      return false;
    }
    let aliases = getAliases(actionObj, 'GET', '/' + opt.name + '/:' + primaryKey.fieldName, opt.alias),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if (namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.read' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {};
    fieldValidator[primaryKey.fieldName] = dispatcher.validate(primaryKey.type.key);
    fieldValidator[primaryKey.fieldName].default(null);
    let inputType = opt.input === 'filter' ? 'filter' : 'input';
    if (opt.delay === true) {
      attachUses(actionObj, dbAction);
      dbAction[inputType](fieldValidator);
    } else {
      dbAction[inputType](fieldValidator);
      attachUses(actionObj, dbAction);
    }
    dbAction.use(async (intentObj) => {
      let DbModel = this.model(modelObj.code),
        primaryId = intentObj[inputType](primaryKey.fieldName),
        findQuery = {
          where: {}
        };
      findQuery.where[primaryKey.fieldName] = intentObj.input(primaryKey.fieldName);
      // update the findQuery
      try {
        actionObj._runFilters('read.before', intentObj, findQuery);
      } catch (e) {
        intentObj.error(thorin.error(e));
        actionObj._runSend('read.error', intentObj);
        return null;
      }

      function doResObj(resObj) {
        if (!resObj) { // not found.
          intentObj.error(thorin.error('ENTRY.NOT_FOUND', 'The requested entity was not found', 404))
          actionObj._runSend('read.error', intentObj);
          return;
        }
        resObj.fromRestify = true; // backwards compatibility
        resObj.fromCrudify = true;
        try {
          actionObj._runFilters('read.after', intentObj, resObj);
        } catch (e) {
          intentObj.error(parseChangeError(e));
          actionObj._runSend('read.error', intentObj);
          return;
        }
        intentObj.result(resObj);
        actionObj._runSend('read.send', intentObj);
      }

      let tmpObj = intentObj.data(modelObj.code);
      // IF we already have the modelObj in the intent data, we use it.
      if (tmpObj && !opt.forceQuery) {
        return doResObj(tmpObj);
      }
      if (primaryId == null) {
        intentObj.error(thorin.error('DATA.INVALID', 'Invalid or missing ' + primaryKey.fieldName));
        actionObj._runSend('read.error', intentObj);
        return null;
      }
      try {
        let res = await DbModel.find(findQuery);
        doResObj(res);
      } catch (e) {
        intentObj.error(parseChangeError(e));
        actionObj._runSend('read.error', intentObj);
      }
    });
    return dbAction;
  };

  /**
   * Handles the "FindAll" of a SQL Model.
   * OPTIONS:
   *  - maxLimit -> the maximum limit. If this is set to false, we disable pagination
   *  - defaultLimit -> the default limit
   *  - defaultOrder -> the default order (asc/desc)
   *  - defaultOrderBy -> the default orderBy (fieldName)
   *  - allowDate -> should we allow start/end date filtering?
   *  - allowAll -> if we receive a limit_disable=true, do not apply limitation
   *  - filters -> if set to false, will disable any filters
   *  - input -> defaults to "input", can be specified as "filter"
   *  - delay -> if set, we will place the filter with process.nextTick
   * The default functionality will include:
   * - sorting with: sort=asc|desc&sortBy=fieldName
   * - paging with ?page=2&limit=10
   * - date filtering with ?start_date&end_date
   *
   * FILTERS:
   *  find.before(intentObj, findQuery) -> right before we call the findAll() with the query.
   *  find.count(intentObj, countQry) -> right before we call the count() with the query
   *  find.after(intentObj, results[])  -> right after we've queried and before we send them.
   * */
  actions.find = async function (actionObj, opt) {
    let modelObj = actionObj.model;
    let aliases = getAliases(actionObj, 'GET', '/' + opt.name, opt.alias),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if (namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.find' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {},
      attributeFilters = [];
    let primaryKey = modelObj.getPrimary();
    // for each field in the model, we check if it is searchable or not.
    if (opt.filters !== false) {
      Object.keys(modelObj.fields).forEach((fieldName) => {
        let field = modelObj.fields[fieldName];
        // IF the field is private, has filtering disabled or is primary, we skip.
        if (field.primaryKey && field.autoIncrement) return;
        if (field.private && field.filter !== true) return;
        if (field.filter === false || field.find === false) return;
        attributeFilters.push(fieldName);
        addValidator(fieldValidator, fieldName, field);
        fieldValidator[fieldName].default(null);
      });
      // then, we do the foreign validators.
      modelObj.relations.forEach((relation) => {
        if (relation.options.private && relation.options.filter !== true) return;
        if (relation.options.filter === false || relation.options.find === false) return;
        if (relation.type === 'belongsTo') {
          let valObj = addForeignValidator.call(this, fieldValidator, relation, true);
          if (!valObj) return;
          valObj.default(null);
          let name = (typeof relation.options.foreignKey === 'string' ? relation.options.foreignKey : relation.options.foreignKey.name);
          if (name) {
            attributeFilters.push(name);
          }
        }
      });
      // Add the "START_DATE" and "END_DATE" validators, if the model has a createdAt.
      if (modelObj.options.createdAt && opt.allowDate !== false) {
        fieldValidator['start_date'] = dispatcher.validate('DATE').default(null);
        fieldValidator['end_date'] = dispatcher.validate('DATE').default(null);
      }
    }

    // Add the "LIMIT" validator
    if (opt.maxLimit !== false) {
      fieldValidator['limit'] = dispatcher.validate('NUMBER', {
        min: 1,
        max: opt.maxLimit || 100
      }).default(opt.defaultLimit || 10);
      // add the "PAGE" validator
      fieldValidator['page'] = dispatcher.validate('NUMBER', {
        min: 1
      }).default(1);
    }
    // Allow limit: false, to fetch all entries
    if (opt.allowAll) {
      fieldValidator['limit_disable'] = dispatcher.validate('BOOLEAN').default(false);
    }
    // add the "ORDER" validator
    fieldValidator['order'] = dispatcher.validate('ENUM', ['asc', 'desc']).default(opt.defaultOrder || 'desc');
    // add the "ORDER_BY" validator
    let orderByDefault = opt.defaultOrderBy || null;
    if (!orderByDefault) {
      if (modelObj.options.createdAt) {
        orderByDefault = modelObj.options.createdAt;
      } else {  // default the primary key.
        if (primaryKey) {
          orderByDefault = primaryKey.fieldName;
        }
      }
    }
    fieldValidator['order_by'] = dispatcher.validate('string').default(orderByDefault);
    // attach the validator.s
    let inputType = opt.input === 'filter' ? 'filter' : 'input';
    if (opt.delay === true) {
      attachUses(actionObj, dbAction);
      dbAction[inputType](fieldValidator);
    } else {
      dbAction[inputType](fieldValidator);
      attachUses(actionObj, dbAction);
    }
    dbAction.use(async (intentObj) => {
      // first, we parse the input, to see what isn't null.
      let DbModel = this.model(modelObj.code),
        findQuery = {
          where: {},
          order: []
        },
        input = intentObj[inputType]();
      if (input.limit_disable === true) {
        input.limit = null;
      }
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
      if (opt.maxLimit !== false && input.limit !== null) {
        findQuery.limit = input.limit;
        if (input.page > 1) {  // we have pagination
          findQuery.offset = (input.page - 1) * input.limit;
        }
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
            let err = thorin.error('DATA.INVALID', 'Start date must be before end date.', 400);
            err.data = {
              field: 'start_date'
            };
            intentObj.error(err);
            actionObj._runSend('find.error', intentObj);
            return null;
          }
          if (input.end_date < input.start_date) {
            let err = thorin.error('DATA.INVALID', 'End date must be after start date.', 400);
            err.data = {
              field: 'end_date'
            };
            intentObj.error(err);
            actionObj._runSend('find.error', intentObj);
            return null;
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
      let totalCount,
        results = [];
      try {
        actionObj._runFilters('find.before', intentObj, findQuery);
        if (opt.maxLimit !== false) {
          // step one, count() all of them.
          let countQuery = thorin.util.extend(findQuery);
          actionObj._runFilters('find.count', intentObj, countQuery);
          delete countQuery.limit;
          delete countQuery.offset;
          delete countQuery.order;
          delete countQuery.attributes;
          totalCount = await DbModel.count(countQuery);
        }
        // step two, if there are any counts, query em.
        if (totalCount !== 0) {
          results = await DbModel.findAll(findQuery);
          // backward-compatible.
          for (let i = 0; i < results.length; i++) {
            results[i].fromRestify = true;
            results[i].fromCrudify = true;
          }
        }
        actionObj._runFilters('find.after', intentObj, results);
        intentObj.result(results);
        if (opt.maxLimit !== false) {
          let totalPages = 1;
          if (typeof input.limit === 'number' && typeof totalCount === 'number') {
            totalPages = Math.ceil(totalCount / input.limit);
          }
          let paginationData = {
            total_count: totalCount,
            page_count: totalPages,
            current_count: results.length,
            current_page: input.page
          };
          intentObj.setMeta(paginationData);
        }
        actionObj._runSend('find.send', intentObj);
      } catch (e) {
        intentObj.error(parseChangeError(e));
        actionObj._runSend('find.error', intentObj);
      }
    });

    return dbAction;
  };

  /**
   * Handles the "Update" of a SQL Model. We can only handle UPDATE
   * for models that have one primary key defined. If a model has no such ting,
   * we cannot perform the update.
   * OPTIONS:
   *  - delay -> if set, we will delay filtering only after the input()
   *  - fields -> an array of allowed updatable fields.
   *  - forceQuery -> if set to true, we will not use data(modelObj.code)  *
   * FILTERS:
   *  update.before(intentObj, findQuery) -> right before we call the find() for the entity.
   *  update.save(intentObj, entityObj) -> right before we call the save() for the entity
   *  update.after(intentObj, entityObj) -> right after we called the save() for the entity.
   * */
  actions.update = async function (actionObj, opt) {
    let modelObj = actionObj.model;
    let primaryKey = modelObj.getPrimary();
    if (!primaryKey) {
      console.warn('Thorin.sql.crudify: model ' + modelObj.code + ' does not have a primary key for "update" crudify');
      return;
    }
    let aliases = getAliases(actionObj, 'POST', '/' + opt.name + '/:' + primaryKey.fieldName, opt.alias),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if (namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.update' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {},
      foreignKeys = [];
    let allowedFields = opt.fields || false;
    // place the model's fields as input fields
    Object.keys(modelObj.fields).forEach((fieldName) => {
      if (fieldName === 'created_at') return;
      if (allowedFields && allowedFields.indexOf(fieldName) === -1) return;
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
      let fieldName = relation.options.foreignKey.name;
      if (allowedFields && allowedFields.indexOf(fieldName) === -1) return;
      if (relation.options) {
        if (relation.options.private === true) return; //skip private fields.
        if (relation.options.update === false) return; // skip non updatable fields.
      }

      if (relation.type === 'belongsTo') {
        let valObj = addForeignValidator.call(this, fieldValidator, relation);
        valObj.default(undefined);
        foreignKeys.push(valObj.fieldName);
      }
    });
    if (opt.delay === true) {
      attachUses(actionObj, dbAction);
      dbAction.input(fieldValidator);
    } else {
      dbAction.input(fieldValidator);
      attachUses(actionObj, dbAction);
    }
    dbAction.use(async (intentObj) => {
      let DbModel = this.model(modelObj.code),
        rawInput = intentObj.rawInput,
        input = intentObj.input();
      let resObj,
        primaryId = intentObj.input(primaryKey.fieldName),
        hasUpdates = false,
        findQry = {
          where: {}
        };
      findQry.where[primaryKey.fieldName] = primaryId;
      try {
        // run the action filters
        // IF we already have the entity in the intent, we skip the query
        let tmpObj = intentObj.data(modelObj.code);
        if (tmpObj && !opt.forceQuery) {
          resObj = tmpObj;
        } else {
          if (!primaryId) {
            intentObj.error(thorin.error('DATA.INVALID', 'Invalid or missing ' + primaryKey.fieldName));
            actionObj._runSend('update.error', intentObj);
            return null;
          }
          actionObj._runFilters('update.before', intentObj, findQry);
          let res = await DbModel.find(findQry);
          if (!res) {
            throw thorin.error('ENTRY.NOT_FOUND', 'The requested entry does not exist', 404);
          }
          resObj = res;
          resObj.fromRestify = true;
          resObj.fromCrudify = true;
        }
        // step two, update the result's fields. and save it.
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
            } else if (input[keyName] != null && typeof input[keyName] !== 'undefined') {
              shouldUpdateKey = true; // update teh reference
            }
          } else {
            if (input[keyName] != null && typeof input[keyName] !== 'undefined') {
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
        actionObj._runFilters('update.save', intentObj, resObj);
        await resObj.save();
        actionObj._runFilters('update.after', intentObj, resObj);
        let hasChanged = (Object.keys(resObj._changed).length > 0);
        intentObj.setMeta({
          changed: hasChanged
        });
        intentObj.result(resObj);
        actionObj._runSend('update.send', intentObj);
      } catch (e) {
        let wrapError = parseChangeError(e, modelObj);
        intentObj.error(wrapError);
        actionObj._runSend('update.error', intentObj);
      }
    });
    return dbAction;
  };

  /**
   * Handles the "Delete" of a SQL Model.
   * FILTERS:
   *  delete.before(intentObj, findQuery) -> right before we call the find() for the entity
   *  delete.destroy(intentObj, entityObj) -> right before we call the destroy() for the entity
   *  delete.after(intentObj, entityObj)  -> right after we called the destroy() and the entity was deleted.
   *
   *  OPTIONS:
   *    - delay -> if set to true, we will delay input to after uses'
   *    - useField (string) if specified, we will not destroy() the entity ,but rather set the given field to false and save.
   *      - forceQuery -> if set to true, we will not use data(modelObj.code)  *
   * */
  actions.delete = function (actionObj, opt) {
    let modelObj = actionObj.model,
      primaryKey = modelObj.getPrimary();
    if (!primaryKey) {
      console.warn('Thorin.sql.resitfy: model ' + modelObj.code + ' does not have a primary key. Skipping');
      return;
    }
    let aliases = getAliases(actionObj, 'DELETE', '/' + opt.name + '/:' + primaryKey.fieldName, opt.alias),
      namespace = (typeof opt.namespace === 'undefined' ? ACTION_NAMESPACE : opt.namespace);
    if (namespace !== '') namespace = namespace + '.';
    let actionId = (typeof opt.action === 'undefined' ? namespace + opt.name + '.delete' : opt.action);
    let dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    // the only input we have is the primary key.
    let fieldValidator = {};
    fieldValidator[primaryKey.fieldName] = dispatcher.validate(primaryKey.type.key);
    fieldValidator[primaryKey.fieldName].default(null);
    if (opt.delay === true) {
      attachUses(actionObj, dbAction);
      dbAction.input(fieldValidator);
    } else {
      dbAction.input(fieldValidator);
      attachUses(actionObj, dbAction);
    }
    dbAction.use(async (intentObj) => {
      let DbModel = this.model(modelObj.code),
        resObj,
        primaryId = intentObj.input(primaryKey.fieldName),
        findQuery = {
          where: {}
        };
      findQuery.where[primaryKey.fieldName] = primaryId;
      // IF we had a useField option specify, that MUST be true
      if (opt.useField) {
        findQuery.where[opt.useField] = true;
      }
      // update the find query
      // IF we already have the entity in the intent, we skip the query.
      let tmpObj = intentObj.data(modelObj.code);
      try {
        if (tmpObj && !opt.forceQuery) {
          resObj = tmpObj;
        } else {
          if (primaryId == null) {
            return intentObj.error(thorin.error('DATA.INVALID', 'Invalid or missing ' + primaryKey.fieldName)).send();
          }
          // IF we don't have the entity, we query for it.
          actionObj._runFilters('delete.before', intentObj, findQuery);

          // step one, read the model.
          let res = await DbModel.find(findQuery);
          if (!res) {
            throw thorin.error('ENTRY.NOT_FOUND', 'The requested entity was not found', 404);
          }
          resObj = res;
          resObj.fromRestify = true;
          resObj.fromCrudify = true;
        }
        // NEXT, DELETE IT
        if (typeof resObj.canDelete === 'function') {
          let canDelete = true;
          canDelete = resObj.canDelete();
          if (!canDelete) {
            throw thorin.error('ENTRY.DELETE', 'This entity cannot be deleted');
          }
        }
        actionObj._runFilters('delete.destroy', intentObj, resObj);
        // step two, delete it.
        /* We check if we want to simply set a given field to false or destroy.*/
        if (!opt.useField) {
          await resObj.destroy();
        } else {
          resObj.set(opt.useField, false);
          resObj.set('deleted_at', Date.now());
          await resObj.save();
        }
        actionObj._runFilters('delete.after', intentObj, resObj);
        intentObj.setMeta({
          deleted: true
        });
        intentObj.data(modelObj.code, resObj);
        actionObj._runSend('delete.send', intentObj);
      } catch (e) {
        let wrapError = parseChangeError(e, modelObj);
        intentObj.error(wrapError);
        actionObj._runSend('delete.error', intentObj);
      }
    });
    return dbAction;
  };

  return actions;
};
