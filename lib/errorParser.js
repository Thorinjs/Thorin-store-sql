'use strict';
/**
 * Created by Adrian on 02-Apr-16.
 */

/*
* Checks if the given error contains any kind of sequelize information.
* If it does, we will mutate it so that the error ns is SQL
* */
function parseError(e) {
  let sqlError = (e.source || e);
  if(e.code && e.code.indexOf('SQL') === 0) {
    e.ns = 'STORE.SQL';
  }
  if(typeof sqlError.name !== 'string' || sqlError.name.indexOf('Sequelize') !== 0) return;
  e.ns = 'STORE.SQL';
  switch(sqlError.name) {
    case 'SequelizeUniqueConstraintError':
      e.code = 'VALIDATION_ERROR';
      break;
    case 'SequelizeDatabaseError':
      e.code = 'QUERY_ERROR';
      break;
    default:
      e.code = 'DATABASE_ERROR';
  }
  return true;
}

module.exports = parseError;