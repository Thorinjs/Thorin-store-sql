'use strict';
const sequelize = require('sequelize');
/**
 * Created by Adrian on 29-Mar-16.
 */
/*
 * Add the PRIMARY type over sequelize.
 * */
sequelize.PRIMARY = {
  __proxy: sequelize.INTEGER,
  __options: {
    primaryKey: true,
    autoIncrement: true
  }
};
/*
* Adds the JSON type. A JSON type handles serialization and de-serialization.
* */
sequelize.JSON = {
  __proxy: sequelize.TEXT,
  __options: {
    defaultValue: ""
  },
  __getter: function(fieldName, defaultValue) {
    return function getField() {
      let value = this.dataValues[fieldName];
      if(!value) return JSON.parse(defaultValue);
      try {
        value = JSON.parse(value);
      } catch(e) {
        return JSON.parse(defaultValue);
      }
      return value;
    }
  },
  __setter: function(fieldName) {
    return function setField(v) {
      if(typeof v === 'undefined') return this;
      if(typeof v === 'object' && v) {
        v = JSON.stringify(v);
      }
      if(this.dataValues[fieldName] !== v) {
        this._changed[fieldName] = v;
      }
      this.dataValues[fieldName] = v;
      return this;
    }
  }
}