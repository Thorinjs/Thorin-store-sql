'use strict';
module.exports = (modelObj, Seq) => {

  modelObj.options.createdAt = false;
  modelObj
    .field('id', Seq.PRIMARY)
    .field('system_app', Seq.STRING(64), {
      defaultValue: null
    })
    .field('system_version', Seq.STRING(64), {
      defaultValue: null
    })
    .field('patches', Seq.TEXT, { // an array with {version,textVersion}
      defaultValue: null
    })
    .field('patch_version', Seq.STRING(64), { // the latest patch version
      defaultValue: null
    });

  modelObj
    .setter('patches', function (v) {
      try {
        this.setDataValue('patches', JSON.stringify(v || []));
      } catch (e) {
      }
    })
    .getter('patches', function () {
      let res = [];
      try {
        res = JSON.parse(this.getDataValue('patches'));
        if (!(res instanceof Array)) res = [];
      } catch (e) {
      }
      return res;
    });

};