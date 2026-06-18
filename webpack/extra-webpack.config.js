const { syncXlsxConfig } = require('../bin/sync-xlsx-config.js');


/**
 * Custom webpack configuration hook that regenerates XLSX-derived definitions
 * and settings before the build proceeds.
 * @param {Object} config - the incoming webpack configuration
 * @return {Promise<Object>} The (unchanged) webpack configuration.
 */
module.exports = async (config) => {
  await syncXlsxConfig();


  return config;
};
