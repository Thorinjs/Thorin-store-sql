'use strict';
const sequelize = require('sequelize');
module.exports = (thorin) => {

  const TYPES = {

    /**
     * Add the PRIMARY type over sequelize.
     * */
    PRIMARY: {
      __proxy: sequelize.INTEGER,
      __options: {
        primaryKey: true,
        autoIncrement: true
      }
    },

    /**
     * Adds the UUID type over sequelize that uses uuid.v4 and some additional crypto random
     * */
    UUID: {
      __proxy: sequelize.STRING(50),
      __index: {
        unique: true
      },
      __options: {
        allowNull: false,
        defaultValue: function () {
          let uuid = thorin.util.uuid.v4(),
            randEnd = thorin.util.randomString(8).toLowerCase(),
            final = uuid + '-' + randEnd;
          return final;
        }
      }
    },

    /**
     * Add the MySQL TIMESTAMP type
     * */
    TIMESTAMP: {
      __proxy: 'TIMESTAMP',
      __options: {
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
        allowNull: false
      }
    },

    /**
     * Add the Short UUID type of sequelize and mark it as unique.
     * Length: 36 characters
     * Uses: uuid.v4() for 24 chars ( no comma)
     *    thorin.util.randomString(8)
     * */
    UUID_SHORT: {
      __proxy: sequelize.STRING(33),
      __index: {
        unique: true
      },
      __options: {
        allowNull: false,
        defaultValue: function () {
          let uuid = thorin.util.uuid.v4().replace(/-/g, ''),
            randEnd = thorin.util.randomString(8).toLowerCase();
          uuid = uuid.substr(0, 24);
          let final = uuid + randEnd;
          return final;
        }
      }
    },
    /**
     * Adds the JSON type. A JSON type handles serialization and de-serialization.
     * @DEPRECATED
     * */
    _JSON: {
      __proxy: sequelize.TEXT,
      __options: {
        defaultValue: ""
      },
      __getter: function (fieldName, defaultValue) {
        return function getField() {
          let value = this.dataValues[fieldName];
          if (!value) return JSON.parse(defaultValue);
          try {
            value = JSON.parse(value);
          } catch (e) {
            return JSON.parse(defaultValue);
          }
          return value;
        }
      },
      __setter: function (fieldName) {
        return function setField(v) {
          if (typeof v === 'undefined') return this;
          if (typeof v === 'object' && v) {
            v = JSON.stringify(v);
          }
          if (this.dataValues[fieldName] !== v) {
            this._changed[fieldName] = v;
          }
          this.dataValues[fieldName] = v;
          return this;
        }
      }
    }
  };

  Object.keys(TYPES).forEach((name) => {
    Object.defineProperty(sequelize, name, {
      value: TYPES[name],
      enumerable: false,
      writable: true
    })
  });

}
