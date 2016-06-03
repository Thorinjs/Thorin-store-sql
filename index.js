'use strict';
const storeInit = require('./lib/sqlStore');
require('./lib/customTypes');
/**
 * Created by Adrian on 29-Mar-16.
 * Events:
 *  - reconnect({name, duration})
 *  - disconnect({name})
 *  NOTE:
 *  - in order to extend a model added by a plugin, you can simply create the models/tableName.js file in your app, and
 *  module.exports = function extend(modelObj, Seq) {}  // you MUST name your exported function "extend", in order to extend an object.
 */
module.exports = function init(thorin, opt) {
  const async = thorin.util.async;
  // Attach the SQL error parser to thorin.
  thorin.addErrorParser(require('./lib/errorParser'));
  const ThorinSqlStore = storeInit(thorin, opt);

  return ThorinSqlStore;
};
module.exports.publicName = 'sql';