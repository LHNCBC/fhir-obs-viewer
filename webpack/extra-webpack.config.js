const { syncXlsxConfig } = require('../bin/sync-xlsx-config.js');

module.exports = async (config) => {
  await syncXlsxConfig();


  return config;
};
