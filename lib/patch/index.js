'use strict';
const PatchVersionFn = require('./version'),
  camelcase = require('camelcase'),
  path = require('path'),
  fs = require('fs');
/**
 * This is our built-in patching system.
 * It works by creating a table called _system_version that holds:
 *  - the current app name
 *  - the current app version
 *  - the current app's patch information
 *
 *  The SQL patches will be read from thorin.root/sql/patch/v{x.y.z}.sql
 *  and will be applied by their sorted version number.
 *  The first patch will always be applied as thorin.root/sql/patch/setup.sql
 *  All patches will be applied using a single transaction.
 * */
module.exports = (thorin, config, store) => {
  const patch = {},
    logger = store.logger,
    isActive = (config.patch && config.path.patch);
  if (isActive) {
    store.addModel(PatchVersionFn, {
      code: config.patch.tableName
    });
  }
  /**
   * Initiates the patch sync functionality.
   * */
  patch.sync = async () => {
    if (!isActive) return;
    let modelName = camelcase(store.camelize(config.patch.tableName));
    const SystemPatch = store.model(modelName);
    if (!SystemPatch) {
      logger.warn(`Patch model [${modelName}] was not loaded`);
      return;
    }
    let logging = store._log.bind(store);
    let majorVersion = thorin.version.split('-')[0].split('.');
    if (majorVersion.length > 2) majorVersion = majorVersion.slice(0, 2);
    majorVersion = majorVersion.join('.');
    let patches = thorin.util.readDirectory(config.path.patch, {
      ext: '.sql'
    });
    logger.info(`System version: ${majorVersion} [${thorin.app}]`);
    await store.transaction(async (t) => {
      await runSql('SET FOREIGN_KEY_CHECKS=0;', true);
      let isNewSystem = false;
      let versionObj = await SystemPatch.findOne({
        where: {
          system_app: thorin.app
        },
        transaction: t,
        logging: false
      });
      if (!versionObj) {
        isNewSystem = true;
        versionObj = SystemPatch.build({
          system_app: thorin.app
        });
      }
      versionObj.set('system_version', majorVersion);
      let systemPatches = versionObj.get('patches');
      let systemPatchMap = {},
        clean = [],
        setupPatch;
      systemPatches.forEach((patch) => {
        systemPatchMap[patch.text_version] = true;
      });
      // Try to read setup.sql
      try {
        let setupPath = path.normalize(config.path.patch + '/setup.sql');
        let s = fs.readFileSync(setupPath, {encoding: 'utf8'});
        if (s.trim() !== '') {
          setupPatch = {
            text_version: 'setup',
            version: 0,
            patch: setupPath,
            content: s
          };
        }
      } catch (e) {
      }
      for (let i = 0, len = patches.length; i < len; i++) {
        let patch = patches[i],
          base = path.basename(patch).split('.');
        base.pop();
        base = base.join('.');
        if (base.indexOf('setup') !== -1) continue;
        let textVersion = base.split('v').join('');
        let version = parseInt(base.split('v').join('').split('.').join(''));
        let content = fs.readFileSync(patch, {encoding: 'utf8'});
        if (content.trim() === '') {
          logger.debug(`Skipping patch [${version}], empty file`);
          continue;
        }
        clean.push({
          text_version: textVersion,
          version,
          patch,
          content
        });
      }
      patches = clean.sort((a, b) => {
        if (a.version < b.version) return -1;
        return 1;
      });
      // If we have a new system, we consider that patches will not be setup.
      if (isNewSystem) {
        logger.info(`Patching system initialized`);
        if (setupPatch) {
          logger.info(`Applying patch: setup`);
          await runSql(setupPatch.content);
          setAppliedPatches(patches);
        }
      } else {
        // If the system was previously setup, we start applying the patches.
        let pendingPatches = [];
        for (let i = 0, len = patches.length; i < len; i++) {
          let item = patches[i],
            patch = item.patch;

          if (path.basename(patch) === 'setup.sql') continue;
          let content = fs.readFileSync(patch, {encoding: 'utf8'}),
            version = item.version;
          if (systemPatchMap[item.text_version]) continue;  // already patched
          if (content.trim() === '') {
            logger.debug(`Patch file [${version}] empty. Skipping`);
            continue;
          }
          pendingPatches.push({
            version: version,
            text_version: item.text_version,
            content
          });
        }
        pendingPatches.sort((a, b) => a.version - b.version);
        // START APPLYING PATCHES
        for (let i = 0, len = pendingPatches.length; i < len; i++) {
          let patch = pendingPatches[i];
          logger.info(`Applying patch: ${patch.version}`);
          try {
            await runSql(patch.content);
            systemPatches.push(patch);
          } catch (e) {
            logger.fatal(`Failed to apply patch: [${patch.text_version}]`);
            logger.debug(e.message);
            throw thorin.error('SQL.PATCH', `Failed to apply patch ${patch.text_version}: [${e.message}]`);
          }
        }
        setAppliedPatches(systemPatches);
      }

      await versionObj.save({
        transaction: t,
        logging
      });
      await runSql('SET FOREIGN_KEY_CHECKS=1;', true);
      if (versionObj.patch_version) {
        logger.info(`System patch version: [${versionObj.patch_version}]`);
      }

      /* Utility functions */
      async function runSql(content, disableLog) {
        await store.query(content, {
          transaction: t,
          logging: disableLog ? false : logging
        });
      }

      function setAppliedPatches(patches) {
        if (patches.length === 0) return;
        let cleanPatches = patches.map((p) => {
          return {
            version: p.version,
            text_version: p.text_version,
            created_at: p.created_at || new Date().toISOString()
          }
        });
        cleanPatches = cleanPatches.sort((a, b) => a.version - b.version);
        versionObj.set('patches', cleanPatches);
        versionObj.set('patch_version', cleanPatches[cleanPatches.length - 1].text_version);
      }

    });
  };


  return patch;
};