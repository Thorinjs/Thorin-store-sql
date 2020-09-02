'use strict';
const sequelize = require('sequelize');
module.exports = (thorin) => {

  const REGISTERED_PREFIXES = {};

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
     * Adds a custom prefix and a size for a UUID-like string (think Stripe ids)
     * @ARGUMENTS
     *  - prefix - the preffix to use
     *  - size - the size of the random to use (excluding preffix)
     *  - opt.lower - if set to true, use only lowercase
     *  - opt.uuid - if set to true, we will use uuid.v4() in tandem with randomString()
     * */
    PREFIXED_UUID: (prefix = '', size = 24, opt = {}) => {
      if (typeof prefix !== 'string') {
        console.error(`Prefix PREFIXED_UUID is not of type string`);
        return null;
      }
      prefix = prefix.trim();
      if (prefix) {
        if (REGISTERED_PREFIXES[prefix]) {
          console.error(`Prefix ${prefix} is already used in a model`);
        } else {
          REGISTERED_PREFIXES[prefix] = true;
        }
      }
      const fullSize = prefix.length + size,
        subSize = Math.floor(size / 2);
      return {
        __proxy: sequelize.STRING(fullSize),
        __index: {
          unique: true
        },
        __options: {
          allowNull: false,
          defaultValue: function () {
            let final = prefix,
              randStr = '';
            if (opt.uuid === true) {
              let subSize = size / 2,
                uuid = thorin.util.uuid.v4().replace(/-/g, ''),
                randEnd = thorin.util.randomString(subSize);
              uuid = uuid.substr(0, size - randEnd.length);
              randStr = uuid + randEnd;
            } else {
              randStr = thorin.util.randomString(size);
            }
            if (opt.lower === true) randStr = randStr.toLowerCase();
            return final + randStr;
          }
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
