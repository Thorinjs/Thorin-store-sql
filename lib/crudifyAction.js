'use strict';
/**
 * Created by Adrian on 07-Apr-16.
 * This is a crudify action wrapper, which wraps the
 * information we want to apply to the thorin action.
 */
module.exports = function (thorin) {

  class ThorinSqlCrudifyAction {

    #hasDebug = true;

    constructor(modelObj) {
      this.model = modelObj;
      this.rootPath = "";
      this.templates = [];
      this.aliases = [];
      this.handlers = [];
      this.uses = [];
      this.filters = [];  // array of filters that should mutate the FIND and READ query
    }

    get hasDebug() {
      return this.#hasDebug;
    }

    set hasDebug(v) {
      this.#hasDebug = v;
    }

    /**
     * Disables any kind of debugging for this action
     * */
    debug(v) {
      this.#hasDebug = (typeof v === 'boolean' ? v : false);
      return this;
    }

    /**
     * When we want to crudify a model with READ and FIND, the default
     * WHERE select query will be select *
     * Whenever we want to limit or attach additional filters to a restified filter,
     * we just insert a filter callback, that will be called with filter(intentObj, whereQuery)
     * Note:
     *  if crudifyType is not specified, we will apply the filter for both  READ and FIND.
     *  If it is, it should be either FIND or READ
     * */
    filter(crudifyType, fn) {
      if (typeof crudifyType === 'object' && crudifyType) {
        this.handlers.push({
          fn: 'filter',
          args: [...arguments]
        });
        return this;
      }
      if (typeof crudifyType === 'function') {
        fn = crudifyType;
        crudifyType = undefined;
      } else if (typeof crudifyType === 'string') {
        crudifyType = crudifyType.toLowerCase();
      }
      if (typeof fn === 'function') {
        this.filters.push({
          type: crudifyType,
          fn: fn
        });
      }
      return this;
    }

    /** Private function that calls all the registered filter callbacks with the
     * intent and the pending query. */
    _runFilters(crudifyType, intentObj, qry) {
      for (let i = 0; i < this.filters.length; i++) {
        let item = this.filters[i];
        if (typeof item.type === 'string' && item.type !== crudifyType) continue;
        item.fn(intentObj, qry);
      }
    }

    /**
     * This will run the "action.send" filter. Note that when overriding
     * the {name}.send filter, we will not call the intent.send() function.
     * */
    _runSend(crudifyType, intentObj) {
      for (let i = 0; i < this.filters.length; i++) {
        let item = this.filters[i];
        if (item.type === crudifyType) {
          try {
            return item.fn(intentObj);
          } catch (e) {
            return intentObj.error(e).send();
          }
        }
      }
      intentObj.send();
    }

    input() {
      this.handlers.push({
        fn: 'input',
        args: [...arguments]
      });
      return this;
    }

    render() {
      this.handlers.push({
        fn: 'render',

      });
      return this;
    }

    alias() {
      this.aliases.push([...arguments]);
      return this;
    }

    root(p) {
      if (typeof p === 'string') {
        this.rootPath = p;
      }
      return this;
    }

    middleware() {
      this.uses.push({
        fn: 'use',
        args: [...arguments]
      });
      return this;
    }

    use() {
      this.uses.push({
        fn: 'use',
        args: [...arguments]
      });
      return this;
    }

    authorize() {
      this.handlers.push({
        fn: 'authorize',
        args: [...arguments]
      });
      return this;
    }

    authorization() {
      console.log(`Thorin.Action.authorization() depreacted. use .authorize()`)
      return this.authorize.apply(this, arguments);
    }

    template(name) {
      this.templates.push(name);
      return this;
    }


    end() {
      this.handlers.push({
        fn: 'end',
        args: [...arguments]
      });
      return this;
    }

    before() {
      this.handlers.push({
        fn: 'before',
        args: [...arguments]
      });
      return this;
    }

    after() {
      this.handlers.push({
        fn: 'after',
        args: [...arguments]
      });
      return this;
    }
  }

  return ThorinSqlCrudifyAction;

};
