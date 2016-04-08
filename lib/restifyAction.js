'use strict';
/**
 * Created by Adrian on 07-Apr-16.
 * This is a restify action wrapper, which wraps the
 * information we want to apply to the thorin action.
 */
module.exports = function(thorin) {

  class ThorinSqlRestifyAction {

    constructor(modelObj) {
      this.model = modelObj;
      this.rootPath = "";
      this.aliases = [];
      this.handlers = [];
      this.filters = [];  // array of filters that should mutate the FIND and READ query
    }

    /*
    * When we want to restify a model with READ and FIND, the default
    * WHERE select query will be select *
    * Whenever we want to limit or attach additional filters to a restified filter,
    * we just insert a filter callback, that will be called with filter(intentObj, whereQuery)
    * Note:
     *  if restifyType is not specified, we will apply the filter for both  READ and FIND.
     *  If it is, it should be either FIND or READ
    * */
    filter(restifyType, fn) {
      if(typeof restifyType === 'function') {
        fn = restifyType;
        restifyType = undefined;
      } else if(typeof restifyType === 'string') {
        restifyType = restifyType.toLowerCase();
      }
      if(typeof fn === 'function') {
        this.filters.push({
          type: restifyType,
          fn: fn
        });
      }
      return this;
    }

    /* Private function that calls all the registered filter callbacks with the
     * intent and the pending query. */
    _runFilters(restifyType, intentObj, qry) {
      for(let i=0; i < this.filters.length; i++) {
        let item = this.filters[i];
        if(typeof item.type === 'string' && item.type !== restifyType) continue;
        item.fn(intentObj, qry);
      }
    }

    input() {
      this.handlers.push({
        fn: 'input',
        args: Array.prototype.slice.call(arguments)
      });
      return this;
    }

    alias() {
      this.aliases.push(Array.prototype.slice.call(arguments));
      return this;
    }

    root(p) {
      if(typeof p === 'string') {
        this.rootPath = p;
      }
      return this;
    }

    middleware() {
      this.handlers.push({
        fn: 'use',
        args: Array.prototype.slice.call(arguments)
      });
      return this;
    }

    authorization() {
      this.handlers.push({
        fn: 'authorize',
        args: Array.prototype.slice.call(arguments)
      });
      return this;
    }

    end() {
      this.handlers.push({
        fn: 'end',
        args: Array.prototype.slice.call(arguments)
      });
      return this;
    }
    before() {
      this.handlers.push({
        fn: 'before',
        args: Array.prototype.slice.call(arguments)
      });
      return this;
    }
    after() {
      this.handlers.push({
        fn: 'after',
        args: Array.prototype.slice.call(arguments)
      });
      return this;
    }
  }

  return ThorinSqlRestifyAction;

};
