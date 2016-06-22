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

sequelize.JSON = {
  __proxy: sequelize.TEXT,
  __options: {
    defaultValue: ""
  }
}