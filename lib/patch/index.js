'use strict';
const PatchVersionFn = require('./version'),
  PatchItemInit = require('./patch'),
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
 *  Applying patches will NOT use a transaction, since some ALTER statements are not capable of rollback within a transaction.
 *  Resetting patches will be done in a transaction
 * */
module.exports = (thorin, config, store) => {
  const patch = {},
    logger = store.logger,
    isActive = (config.patch && config.path.patch);
  if (isActive) {
    store.addModel(PatchVersionFn, {
      code: config.patch.tableName
    });
    const PatchItemFn = PatchItemInit(config);
    store.addModel(PatchItemFn, {
      code: config.patch.tableName + '_patch'
    });
  }
  /**
   * Initiates the patch sync functionality.
   * */
  patch.sync = async () => {
    if (!isActive) return;
    let modelName = camelcase(store.camelize(config.patch.tableName)),
      setupScripts = thorin.util.readDirectory(config.path.scripts, {
        ext: '.js'
      });
    const SystemVersion = store.model(modelName),
      SystemPatch = store.model(`${modelName}Patch`);
    if (!SystemVersion) {
      logger.warn(`Patch model [${modelName}] was not loaded`);
      return;
    }
    if (!SystemPatch) {
      logger.warn(`Patch model [${modelName}Patch] was not loaded`);
      return;
    }
    let logging = store._log.bind(store);
    if (!thorin.version) {
      logger.warn(`Could not apply patch - thorin.version not set.`);
      return;
    }
    let majorVersion = thorin.version.split('-')[0].split('.');
    if (majorVersion.length > 2) majorVersion = majorVersion.slice(0, 2);
    majorVersion = majorVersion.join('.');
    let patches = thorin.util.readDirectory(config.path.patch, {
      ext: '.sql'
    });
    logger.info(`System version: ${majorVersion} [${thorin.app}]`);
    const dialect = store.getDialect();
    if (store._hasFkCheck()) {
      await runSql('SET FOREIGN_KEY_CHECKS=0;', true);
    }
    await SystemVersion.sync({
      logging: false
    });
    await SystemPatch.sync({
      logging: false
    });
    let isNewSystem = false;
    let versionObj = await SystemVersion.findOne({
      where: {
        system_app: thorin.app
      },
      logging: false
    });
    if (!versionObj) {
      isNewSystem = true;
      versionObj = SystemVersion.build({
        system_app: thorin.app
      });
    }
    versionObj.set('system_version', majorVersion);
    let systemPatches = versionObj.get('patches'),
      allSystemPatches = await getSystemPatches(versionObj, {
        logging: false
      });
    let systemPatchMap = {},
      clean = [],
      setupPatch;
    systemPatches.forEach((patch) => {
      systemPatchMap[patch.text_version] = true;
    });
    // Try to read setup.sql
    try {
      let setupPath = path.normalize(config.path.patch + '/setup.sql');
      let s = fs.readFileSync(setupPath, { encoding: 'utf8' });
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
      let version = base.split('v').join('');
      let t = version.split('.');
      if (t.length === 3) {
        if (t[2].length === 1) {
          t[2] += '00';
        } else if (t[2].length === 2) {
          t[2] += '0';
        }
        if (t[1].length === 1) {
          t[1] += '00';
        } else if (t[1].length === 2) {
          t[1] += '0';
        }
      }
      version = t.join('.');
      version = parseInt(version.split('.').join(''));
      let content = fs.readFileSync(patch, { encoding: 'utf8' });
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
      }
      setAppliedPatches(patches);
    } else {
      // If the system was previously setup, we start applying the patches.
      let pendingPatches = [];
      for (let i = 0, len = patches.length; i < len; i++) {
        let item = patches[i],
          patch = item.patch;
        if (path.basename(patch) === 'setup.sql') continue;
        let content = fs.readFileSync(patch, { encoding: 'utf8' }),
          version = item.version;
        if (systemPatchMap[item.text_version]) {
          await saveSystemPatch(versionObj, allSystemPatches, item);
          continue;
        }  // already patched
        if (content.trim() === '') {
          logger.debug(`Patch file [${item.text_version}] empty. Skipping`);
          continue;
        }
        pendingPatches.push({
          version: version,
          patch: item.patch,
          text_version: item.text_version,
          content
        });
      }
      pendingPatches.sort((a, b) => a.version - b.version);
      // START APPLYING PATCHES
      for (let i = 0, len = pendingPatches.length; i < len; i++) {
        let patch = pendingPatches[i],
          executedPatches = allSystemPatches[patch.text_version] || [];
        const statements = getPatchFileContents(patch.content);
        for (let j = 0, jlen = statements.length; j < jlen; j++) {
          const s = statements[j],
            isApplied = executedPatches.find(f => f.statement_hash === s.hash);
          if (isApplied) {
            logger.info(`Skipping patch: ${patch.text_version} statement ${j + 1}/${statements.length}`);
          } else {
            logger.info(`Applying patch: ${patch.text_version} statement ${j + 1}/${statements.length}`);
            let runError;
            try {
              await runSql(s.content);
            } catch (e) {
              runError = e;
            }
            if (runError) {
              let isDuplicate = runError?.message?.indexOf('Duplicate ') !== -1;
              if (!isDuplicate && runError?.message?.indexOf('already exists') !== -1) isDuplicate = true;
              if (isDuplicate) {
                logger.warn(`Failed to apply patch [${patch.text_version}] statement ${j + 1}/${statements.length} - ${runError.message}. Skipping`);
              } else {
                logger.fatal(`Failed to apply patch: [${patch.text_version}] statement ${j + 1}/${statements.length} - ${runError.message}`);
                if (store._hasFkCheck()) {
                  await runSql('SET FOREIGN_KEY_CHECKS=1;', true);
                }
                throw thorin.error('SQL.PATCH', `Failed to apply patch ${patch.text_version} statement ${j + 1}/${statements.length}: [${runError.message}]`);
              }
            }
            await saveSystemPatch(versionObj, allSystemPatches, {
              ...patch,
              content: s.content
            });
            systemPatches.push(patch);
          }
        }
      }
      setAppliedPatches(systemPatches);
    }

    if (setupScripts.length > 0) {
      let systemScripts = (versionObj.get('patches') || []).concat([]);
      for (let i = 0, len = setupScripts.length; i < len; i++) {
        let scriptFile = setupScripts[i],
          scriptName = path.basename(scriptFile).replace('.js', '');
        if (systemPatchMap[scriptName]) continue;
        let scriptFn;
        try {
          scriptFn = require(scriptFile);
        } catch (e) {
          logger.fatal(`Failed to require setup script [${scriptFile}]`);
          throw e;
        }
        logger.info(`Applying script: ${scriptName}`);
        await store.transaction(async (t) => {
          await scriptFn(thorin, t);
          if (scriptFn.reset !== false) {
            systemScripts.push({
              version: majorVersion,
              text_version: scriptName
            });
          }
        });
      }
      setAppliedPatches(systemScripts, false);
    }

    await versionObj.save({
      logging: false
    });
    if (store._hasFkCheck()) {
      await runSql('SET FOREIGN_KEY_CHECKS=1;', true);
    }
    if (versionObj.patch_version) {
      logger.info(`System patch version: [${versionObj.patch_version}]`);
    }

    /* Utility functions */
    async function runSql(content, disableLog) {
      await store.query(content, {
        logging: disableLog ? false : logging
      });
    }

    function setAppliedPatches(patches, setMajor) {
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
      if (setMajor !== false) {
        let pVersion = parseInt(cleanPatches[cleanPatches.length - 1].text_version.split('.').join(''));
        if (pVersion > 0) {
          versionObj.set('patch_version', cleanPatches[cleanPatches.length - 1].text_version);
        }
      }
    }

    /*
     * Returns a map of {text_version:[patches]} for all system patches.
     * */
    async function getSystemPatches(versionObj, opt) {
      const items = await SystemPatch.findAll({
        where: {
          system_version_id: versionObj.id
        },
        order: [['version_number', 'ASC']],
        transaction: opt.transaction,
        logging: opt.logging
      });
      const resMap = {};
      for (let i = 0, len = items.length; i < len; i++) {
        let item = items[i];
        if (!resMap[item.version_text]) resMap[item.version_text] = [];
        resMap[item.version_text].push(item);
      }
      return resMap;
    }

    /**
     * Syncs the given statement patch with the systemPatch entities that we have.
     * @Arguments
     *  - versionObj - the systemVersion object to use.
     *  - systemPatchMap - the map of systemPatches previously loaded, with version_text as key
     *  - patchInfo - object with {text_version,version,patch,content}
     * */
    async function saveSystemPatch(versionObj, systemPatchMap = {}, patchInfo) {
      const patchFile = path.basename(patchInfo.patch),
        toHash = [],
        createdPatches = systemPatchMap[patchInfo.text_version] || [],
        contents = getPatchFileContents(patchInfo.content);
      for (let i = 0, len = contents.length; i < len; i++) {
        const {
          hash,
          content
        } = contents[i];
        let exists = createdPatches.find(f => f.statement_hash === hash);
        if (exists) continue;
        toHash.push(hash);
      }
      if (toHash.length > 0) {
        for (let i = 0; i < toHash.length; i++) {
          const hash = toHash[i];
          const sp = SystemPatch.build({
            current_patch_version: versionObj.patch_version,
            patch_file: patchFile,
            version_number: patchInfo.version,
            version_text: patchInfo.text_version,
            statement_hash: hash,
            system_version_id: versionObj.id
          });
          await sp.save({
            logging: false
          });
          if (!systemPatchMap[patchInfo.text_version]) systemPatchMap[patchInfo.text_version] = [];
          systemPatchMap[patchInfo.text_version].push(sp);
        }
      }
    }

  };


  /**
   * Given a text-version of a previously-executed script or patch, it will reset it
   * */
  patch.reset = async (name) => {
    let modelName = camelcase(store.camelize(config.patch.tableName));
    const SystemVersion = store.model(modelName);
    if (!SystemVersion) {
      logger.warn(`Patch model [${modelName}] was not loaded`);
      return false;
    }
    try {
      let isOk = false;
      await store.transaction(async (t) => {
        let versionObj = await SystemVersion.findOne({
          where: {
            system_app: thorin.app
          },
          logging: false,
          transaction: t
        });
        if (!versionObj) return false;
        let patches = versionObj.get('patches');
        let found = false;
        for (let i = 0, len = patches.length; i < len; i++) {
          let p = patches[i];
          if (p.text_version === name || p.version === name) {
            patches.splice(i, 1);
            found = true;
            break;
          }
        }
        if (!found) return;
        logger.info(`Resetting patch [${name}]`);
        versionObj.set('patches', patches);
        isOk = true;
        await versionObj.save({
          transaction: t,
          logging: false
        });
      });
      return isOk;
    } catch (e) {
      logger.error(`Could not reset patch [${name}]`);
      throw e;
    }
  };


  /**
   * Given the contents of a patch file, returns an array with [{content, hash}]
   * */
  function getPatchFileContents(content) {
    const res = [],
      statements = content.split(config.patch.delimiter);
    for (let i = 0, len = statements.length; i < len; i++) {
      let s = statements[i].trim();
      if (!s) continue;
      if (config.patch.delimiter === ';') s += ';';
      let hash = thorin.util.sha1(s);
      res.push({
        content: s,
        hash
      });
    }
    return res;
  }

  return patch;
};

