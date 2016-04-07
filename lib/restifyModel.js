'use strict';
/**
 * Created by Adrian on 07-Apr-16.
 * This will register the CREATE, READ, UPDATE, DELETE, FIND
 * actions for the given modelObj.
 */
module.exports = function(thorin) {

  const actions = {},
    dispatcher = thorin.dispatcher,
    ACTION_NAMESPACE = "db";

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

  /* Attach the stuff to the new action */
  function attach(restifyAction, dbAction, aliases) {
    // attach all middlewares.
    restifyAction.handlers.forEach((item) => {
      dbAction[item.fn].apply(dbAction, item.args);
    });
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
  }

  /* Attaches a foreign validator to the input */
  function addForeignValidator(fieldValidator, relation, _ignoreCallback) {
    let relObj = this.model(relation.name, true),
      relPrimary = relObj.getPrimary(),
      relName = relation.options.foreignKey.name;
    if (relPrimary) {
      addValidator(fieldValidator, relName, relPrimary);
    }
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
   * Handles the CREATEion of a sql model.
   * Action id will be:
   *   db.create.{modelName}
   * HTTP alias will be: POST {root}/{modelName}
   * */
  actions.create = function(actionObj, opt) {
    var modelObj = actionObj.model;
    var aliases = getAliases(actionObj, 'POST', '/' + modelObj.code),
      namespace = opt.namespace || ACTION_NAMESPACE,
      actionId = opt.action || (namespace + '.create.' + modelObj.code);
    var dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {};

    // place static ones
    Object.keys(modelObj.fields).forEach((fieldName) => {
      let field = modelObj.fields[fieldName];
      if (field.primaryKey && field.autoIncrement) return; // we skip primary key.
      addValidator(fieldValidator, fieldName, field);
    });
    // check if we have any relationships.
    modelObj.relations.forEach((relation) => {
      // belongsTo relations have a foreign key in the current model that we have to check.
      if (relation.type === 'belongsTo') {
        addForeignValidator.call(this, fieldValidator, relation);
      }
    });
    dbAction.input(fieldValidator);
    dbAction.use((intentObj) => {
      let DbModel = this.model(modelObj.code),
        newInstance = DbModel.build(intentObj.input());
      newInstance.save().then(() => {
        // at this point, we created the instance.
        newInstance.fromRestify = true;
        intentObj.result(newInstance).send();
      }, (e) => {
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
        intentObj.error(wrapError).send();
      }).catch((e) => {
        intentObj.error(thorin.error(e));
      });
    });
    /* Register the action to the dispatcher. */
    dispatcher.addAction(dbAction);
    return dbAction;
  };

  /*
   * Handles the "FindByID" of a SQL model.
   * */
  actions.read = function(actionObj, opt) {
    var modelObj = actionObj.model,
      primaryKey = modelObj.getPrimary();
    if (!primaryKey) {
      console.error('Thorin.sql.restify: Model ' + modelObj.code + " does not contain a primary key for the READ restify action.");
      return false;
    }
    var aliases = getAliases(actionObj, 'GET', '/' + modelObj.code + '/:' + primaryKey.fieldName),
      namespace = opt.namespace || ACTION_NAMESPACE,
      actionId = opt.action || (namespace + '.read.' + modelObj.code);
    var dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {};
    fieldValidator[primaryKey.field] = dispatcher.validate(primaryKey.type.key);
    fieldValidator[primaryKey.field].error(thorin.error('INPUT.NOT_VALID', 'Invalid or missing ' + primaryKey.fieldName));
    dbAction.input(fieldValidator);
    dbAction.use((intentObj) => {
      let DbModel = this.model(modelObj.code),
        findQuery = {
          where: {}
        };
      findQuery.where[primaryKey.fieldName] = intentObj.input(primaryKey.fieldName);
      // update the findQuery
      actionObj._runFilters('read', intentObj, findQuery);
      DbModel.find(findQuery).then((resObj) => {
        if (!resObj) { // not found.
          intentObj
            .error(thorin.error('ENTRY.NOT_FOUND', 'The requested entry was not found', 404))
            .send();
          return;
        }
        intentObj.result(resObj).send();
      }).catch((e) => {
        intentObj.error(thorin.error(e)).send();
      });
    });
    dispatcher.addAction(dbAction);
    return dbAction;
  };

  /*
   * Handles the "FindAll" of a SQL Model.
   * OPTIONS:
   *  - maxLimit -> the maximum limit
   * The default functionality will include:
   * - sorting with: sort=asc|desc&sortBy=fieldName
   * */
  actions.find = function(actionObj, opt) {
    var modelObj = actionObj.model;
    var aliases = getAliases(actionObj, 'GET', '/' + modelObj.code),
      namespace = opt.namespace || ACTION_NAMESPACE,
      actionId = opt.action || (namespace + '.find.' + modelObj.code);
    var dbAction = new thorin.Action(actionId);
    attach(actionObj, dbAction, aliases);
    let fieldValidator = {},
      attributeFilters = [];
    // add the created_at or updated_at field.
    if(modelObj.options.createdAt) {
      attributeFilters.push(modelObj.options.createdAt);
    }
    if(modelObj.options.updatedAt) {
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
      if (typeof fieldValidator[fieldName].defaultValue === 'undefined') {
        fieldValidator[fieldName].default(null);
      }
    });
    // then, do the createdAt or updatedAt.
    if(modelObj.options.createdAt) {
      fieldValidator[modelObj.options.createdAt] = dispatcher.validate('DATE').default(null);
    }
    if(modelObj.options.updatedAt) {
      fieldValidator[modelObj.options.updatedAt] = dispatcher.validate('DATE').default(null);
    }
    // then, we do the foreign validators.
    modelObj.relations.forEach((relation) => {
      if (relation.type === 'belongsTo') {
        let valObj = addForeignValidator.call(this, fieldValidator, relation, true);
        valObj.default(null);
        attributeFilters.push(relation.options.foreignKey.name);
      }
    });
    // Add the "START_DATE" and "END_DATE" validators, if the model has a createdAt.
    if(modelObj.options.createdAt) {
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
    if(modelObj.options.createdAt) {
      orderByDefault = modelObj.options.createdAt;
    } else {  // default the primary key.
      if(primaryKey) {
        orderByDefault = primaryKey.fieldName;
      }
    }
    fieldValidator['order_by'] = dispatcher.validate('string').default(orderByDefault);

    // attach the validator.s
    dbAction.input(fieldValidator);
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
          if(safe.length === 0) return;
          findQuery.where[name] = safe;
        } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          findQuery.where[name] = value;
        }
      });
      // set the limit
      findQuery.limit = input.limit;
      if(input.page > 1) {  // we have pagination
        findQuery.offset = (input.page -1 ) * input.limit;
      }
      // set the order and orderBy
      let orders = input.order_by.split(','),
        hasOrder = false;
      for(let i=0; i < orders.length; i++) {
        let orderBy = orders[i];
        if(attributeFilters.indexOf(orderBy) !== -1
          || orderBy === modelObj.options.createdAt
          || orderBy === modelObj.options.updatedAt
          || (primaryKey && primaryKey.fieldName === orderBy)) {
          findQuery.order.push([orderBy, input.order]);
          hasOrder = true;
        }
      }
      if(!hasOrder) {
        findQuery.order.push([orderByDefault, input.order]);
      }
      // set the start_date and end_date if we have em under start_date and end_date
      if((input.start_date || input.end_date) && !findQuery.where[modelObj.options.createdAt]) {
        if(input.start_date && input.end_date) {
          if(input.start_date > input.end_date) {
            let err = thorin.error('INPUT.NOT_VALID', 'Start date must be before end date.', 400);
            err.data = {
              field: 'start_date'
            };
            return intentObj.error(err).send();
          }
          if(input.end_date < input.start_date) {
            let err = thorin.error('INPUT.NOT_VALID', 'End date must be after start date.', 400);
            err.data = {
              field: 'end_date'
            };
            return intentObj.error(err).send();
          }
          if(input.start_date.toString() === input.end_date.toString()) {
            findQuery.where[modelObj.options.createdAt] = input.start_date;
          }
        }
        if(!findQuery.where[modelObj.options.createdAt]) {
          findQuery.where[modelObj.options.createdAt] = {};
          if(input.start_date) {
            findQuery.where[modelObj.options.createdAt]['$gte'] = input.start_date;
          }
          if(input.end_date) {
            findQuery.where[modelObj.options.createdAt]['$lte'] = input.end_date;
          }
        }
      }
      // run the filters.
      actionObj._runFilters('find', intentObj, findQuery);
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
        if(totalCount === 0) return;
        return DbModel.findAll(findQuery).then((_res) => {
          results = _res;
        });
      });
      thorin.series(calls, (err) => {
        if(err) {
          return intentObj.error(thorin.error(err)).send();
        }
        intentObj.result(results);
        // TODO: transform the pagination data into a thorin.Pagination
        let totalPages = Math.ceil(totalCount / input.limit);
        let paginationData = {
          total_count: totalCount,
          current_count: results.length,
          page_count: totalPages,
          page: input.page
        };
        intentObj.pagination(paginationData);
        intentObj.send();
      });
    });
    dispatcher.addAction(dbAction);
    return dbAction;
  };

  /*
   * Handles the "Update" of a SQL Model.
   * */
  actions.update = function(actionObj, opt) {

  };

  /*
   * Handles the "Delete" of a SQL Model.
   * */
  actions.delete = function(actionObj, opt) {

  };


  return actions;
}
;