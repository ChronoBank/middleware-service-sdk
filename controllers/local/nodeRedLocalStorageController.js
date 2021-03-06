/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

const when = require('when'),
  _ = require('lodash'),
  fs = require('fs-extra'),
  Promise = require('bluebird'),
  flowTemplate = require('../../migrations/templates/flowTemplate'),
  path = require('path');

let settings = {},
  flows = {};

let simpleLoad = (type, path, stringify = false) => {
  return when.resolve((async () => {

    let storageDocument = _.chain(flows).get('noderedstorages').find({type: type, path: path}).value();

    if (!storageDocument || !storageDocument.body)
      return [];

    return stringify ?
      JSON.stringify(storageDocument.body) :
      storageDocument.body;

  })());

};

let simpleSave = (type, path, blob) => {

  return when.resolve((async () => {

    let storageDocument = _.chain(flows).get('noderedstorages').find({type: type, path: path}).value();

    if (!storageDocument || !storageDocument.body) 
      storageDocument = {type: type, path: path};
    flows.noderedstorages.push(storageDocument);

    storageDocument.body = JSON.stringify(blob);

  })());

};

const getDeleteTabIds = (oldItems, newItems) => {
  const oldTabs = _.chain(oldItems)
    .get('body').map('id').value();
  const newTabs = _.chain(newItems)
    .get('body').map('id').value();
  return _.difference(oldTabs, newTabs);
};

const getFileName = (migrationName) => {
  return path.join(settings.migrationsDir, `${migrationName.replace('.', '-')}.js`);
};

const deleteTabs = async (deleteTabIds) => {
  flows.noderedstorages = [];
  if (settings.migrationsInOneFile) 
    await Promise.map(deleteTabIds, async (deleteTabId) => {
      await fs.remove(getFileName(deleteTabId));
    });
};

let saveFlows = (blob) => {

  return when.resolve((async () => {

    let items = _.chain(blob)
      .groupBy('z')
      .toPairs()
      .map(pair => ({
        path: pair[0] === 'undefined' ? 'tabs' : pair[0],
        body: pair[1]
      }))
      .value();

    const isMigrationWithNumber = m => _.chain(m.split('.')[0]).toNumber() > 0;
    
    const deleteTabIds = getDeleteTabIds(
      _.find(flows.noderedstorages, {'path': 'tabs'}),
      _.find(items, {'path': 'tabs'})
    );
    await deleteTabs(deleteTabIds);

    for (let item of items) {

      let storageDocument = _.chain(flows).get('noderedstorages').find({type: 'flows', path: item.path}).value();

      if (!storageDocument || !storageDocument.body) {
        storageDocument = {type: 'flows', path: item.path};
        flows.noderedstorages.push(storageDocument);
      }

      if (!_.isEqual(storageDocument.body, item.body)) {
        let newMigrationName = settings.migrationsInOneFile ? item.path : _.chain(flows.migrations)
          .filter(isMigrationWithNumber)
          .sortBy(item => parseInt(item.split('.')[0]))
          .last()
          .split('.').head().toNumber()
          .thru(val => val || 0)
          .round().add(1)
          .add(`.${item.path}`).value();
        await fs.writeFile(
          getFileName(newMigrationName), 
          flowTemplate(item, newMigrationName)
        );
      }

      storageDocument.body = item.body;
    }
  })());

};

let loadFlows = () => {
  return when.resolve((async () => {

    let storageDocuments = _.chain(flows).get('noderedstorages').filter({type: 'flows'}).value();

    if (!storageDocuments)
      return [];

    return _.chain(storageDocuments)
      .map(storageDocument => _.get(storageDocument, 'body', []))
      .flattenDeep()
      .uniqBy('id')
      .value();

  })());

};

let sortDocumentsIntoPaths = (documents) => {

  let sorted = {};
  for (let document of documents) {
    let p = path.dirname(document.path);
    if (p === '.')
      p = '';

    if (!sorted[p])
      sorted[p] = [];

    if (p !== '') {
      let bits = p.split('/');
      sorted[''].push(bits[0]);
      for (let j = 1; j < bits.length; j++) {
        // Add path to parent path.
        let mat = bits.slice(0, j).join('/');
        if (!sorted[mat])
          sorted[mat] = [];

        sorted[mat].push(bits[j]);
      }
    }
    let meta = JSON.parse(document.meta);
    meta.fn = path.basename(document.path);
    sorted[p].push(meta);
  }

  return sorted;
};

const local = {
  init: (globalSettings) => {
    settings = globalSettings;
    flows = fs.readJsonSync('flows.json');
    return when.resolve();

  }, //thumb function

  getFlows: loadFlows,

  saveFlows: saveFlows,

  getCredentials: () => simpleLoad('credentials', '/', true),

  saveCredentials: credentials => simpleSave('credentials', '/', credentials),

  getSettings: () => simpleLoad('settings', '/'),

  saveSettings: settings => simpleSave('settings', '/', settings),

  getSessions: () => simpleLoad('sessions', '/'),

  saveSessions: sessions => simpleSave('sessions', '/', sessions),

  getLibraryEntry: (type, path) => {

    return when.resolve((async () => {
      let resolvedType = 'library-' + type;
      let storageDocument = _.chain(flows).get('noderedstorages').find({type: resolvedType, path: path}).value();

      if (storageDocument)
        return JSON.parse(storageDocument.body);

      // Probably a directory listing...
      // Crudely return everything.
      let storageDocuments = _.chain(flows).get('noderedstorages').filter({type: resolvedType}).value();
      let result = sortDocumentsIntoPaths(storageDocuments);
      return result[path] || [];

    })());
  },

  saveLibraryEntry: (type, path, meta, body) => {

    return when.promise((async () => {
      let resolvedType = 'library-' + type;
      let storageDocument = _.chain(flows).get('noderedstorages').find({type: resolvedType, path: path}).value();

      if (!storageDocument) {
        storageDocument = {type: resolvedType, path: path};
        flows.noderedstorages.push(storageDocument);
      }

      storageDocument.meta = JSON.stringify(meta);
      storageDocument.body = JSON.stringify(body);

    })());
  }
};

module.exports = local;
