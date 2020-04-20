'use strict';
const initStore = require('./lib/sqlStore'),
  initTypes = require('./lib/customTypes');
/**
 * Created by Adrian on 29-Mar-16.
 * Events:
 *  - reconnect({name, duration})
 *  - disconnect({name})
 *  NOTE:
 *  - in order to extend a model added by a plugin, you can simply create the models/tableName.js file in your app, and
 *  module.exports = function extend(modelObj, Seq) {}   // you MUST name your exported function "extend", in order to extend an object.
 */
module.exports = function init(thorin, opt) {
  initTypes(thorin);
  // Attach the SQL error parser to thorin.
  thorin.addErrorParser(require('./lib/errorParser'));
  const ThorinSqlStore = initStore(thorin, opt);

  return ThorinSqlStore;
};
module.exports.publicName = 'sql';
