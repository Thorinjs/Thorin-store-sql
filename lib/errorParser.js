'use strict';

/**
 * Checks if the given error contains any kind of sequelize information.
 * If it does, we will mutate it so that the error ns is SQL
 * */
function parseError(e) {
  let sqlError = (e.source || e);
  if (e.code && e.code.indexOf('SQL') === 0) {
    e.ns = 'STORE';
  }
  if (typeof sqlError.name !== 'string' || sqlError.name.indexOf('Sequelize') !== 0) return;
  e.ns = 'STORE.SQL';
  switch (sqlError.name) {
    case 'SequelizeUniqueConstraintError':
      e.code = 'VALIDATION_ERROR';
      break;
    case 'SequelizeDatabaseError':
      e.code = 'QUERY_ERROR';
      break;
    case 'SequelizeValidationError':
      e.code = 'VALIDATION_ERROR';
      e.statusCode = 400;
      try {
        e.message = sqlError.errors[0].message;
      } catch (er) {}
      break;
    default:
      e.code = 'DATABASE_ERROR';
  }
  return true;
}

module.exports = parseError;
