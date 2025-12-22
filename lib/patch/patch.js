'use strict';
const camelcase = require('camelcase');
module.exports = (config) => {

  return (modelObj, Seq) => {
    /**
     * This model holds executed patch versions for the given app.
     * */

    modelObj.options.createdAt = false;
    modelObj
      .field('id', Seq.PRIMARY)
      .field('current_patch_version', Seq.STRING(64), {  // the system version at the moment of the patch
        defaultValue: null
      })
      .field('version_number', Seq.INTEGER, {     // the numeric value of the patch file.
        defaultValue: null
      })
      .field('version_text', Seq.STRING(50), {    // the user-friendly value of the patch file.
        defaultValue: null
      })
      .field('patch_file', Seq.STRING(50), {      // the patch file name
        defaultValue: null
      })
      .field('statement_hash', Seq.STRING(64), {  // the statement inside the patch file that we've executed.
        defaultValue: null
      });

    modelObj
      .belongsTo(camelcase(config.patch.tableName), {
        as: 'version',
        foreignKey: 'system_version_id'
      });

  };
}

