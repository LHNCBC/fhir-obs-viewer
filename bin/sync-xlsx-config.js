const path = require('path');
const fs = require('fs');
const readXlsxFile = require('read-excel-file/node');
const JSON5 = require('json5');
const json5Writer = require('json5-writer');
const { stringify } = require('csv-stringify/sync');
const { syncGeneratedAssets } = require('./sync-generated-assets.js');

const repoRoot = path.resolve(__dirname, '..');
const xlsxFolder = path.join(repoRoot, 'src/conf/xlsx');
const csvFolder = path.join(repoRoot, 'src/conf/csv');
const settingsPath = path.join(repoRoot, 'src/conf/settings.json5');
const definitionsFilePropName = 'definitionsFile';

/**
 * Searches for an item in the array from a specified index that matches
 * the predicate, stopping if the stopCondition returns true for an item.
 * @param {Array} arr - array to search.
 * @param {number} fromIndex - index to start searching from.
 * @param {Function} predicate - function to match the desired item.
 * @param {Function} stopCondition - function to determine when to stop searching.
 * @returns {*} The found item or undefined.
 */
function findUntil(arr, fromIndex, predicate, stopCondition) {
  for (let i = fromIndex; i < arr.length; i++) {
    if (stopCondition(arr[i])) break;
    if (predicate(arr[i])) return arr[i];
  }
  return undefined;
}

/**
 * Returns an object which maps service base URLs to CSV data extracted from XLSX files.
 * @returns {Promise<Object>}
 */
async function prepareCsvData() {
  // Cell value to mark the beginning of data
  const marker = '---SERVICE BASE URL:';
  // Index offset of the row from which the data starts relative to the row with URL
  const dataOffset = 3;
  const fileNames = fs.readdirSync(xlsxFolder);
  const url2desc = {};

  for (let i = 0; i < fileNames.length; i++) {
    if (!/(.*)\.xlsx$/.test(fileNames[i])) {
      continue;
    }

    const filename = RegExp.$1;
    const fromFilename = filename + '.xlsx';
    const fromPath = path.join(xlsxFolder, fromFilename);
    const sheets = await readXlsxFile(fromPath, {
      getSheets: true
    });

    for (let j = 1; j <= sheets.length; j++) {
      const rows = await readXlsxFile(fromPath, {
        sheet: j
      });

      const urlIndex = rows.findIndex((row) => row[0] === marker);
      const urls = rows[urlIndex][1].split(',');
      const dataRows = rows.slice(urlIndex + dataOffset);
      let currentResourceIndex;
      const desc = dataRows.filter(([rt, element, type, , hideShow], i) => {
        if (rt) {
          // Store the index of the current resource type row.
          currentResourceIndex = i;
          return true;
        }

        return type === 'search parameter'
          // Skip hidden search parameters that do not have corresponding
          // combined search parameters.
          ? hideShow !== 'hide' ||
            findUntil(
              dataRows,
              currentResourceIndex + 1,
              ([, e, t, , h]) => {
                const elements = e?.split(',');
                return elements?.length > 1 && t === 'search parameter' &&
                  h !== 'hide' && elements?.includes(element);
              },
              ([resourceType]) => resourceType
            )
          // Skip disable columns.
          : hideShow !== 'disable';
      });

      urls.forEach((url) => {
        url2desc[url] = (url2desc[url] || []).concat(desc);
      });
    }
  }

  return url2desc;
}

/**
 * Updates settings.json5 and creates CSV-files.
 * @param {Object} url2desc - object which maps service base URLs to CSV
 *   data extracted from XLSX files.
 */
function updateAppSettings(url2desc) {
  const allUrls = Object.keys(url2desc);
  const updateSettingsObj = {
    // Defines the order of the sections in settings.json5.
    default: {},
    default_R4: {},
    default_R5: {},
    customization: {}
  };
  const settingsJsonString = fs.readFileSync(settingsPath).toString();
  const settings = JSON5.parse(settingsJsonString);

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    let toFilename;
    if (url.startsWith('default')) {
      if (!updateSettingsObj[url]) {
        updateSettingsObj[url] = {};
      }
      toFilename = 'desc-' + url.replace(/_/g, '-') + '.csv';
      updateSettingsObj[url][definitionsFilePropName] = toFilename;
    } else {
      toFilename = 'desc-' + url.replace(/:\/\/|\.|\//g, '-') + '.csv';
      updateSettingsObj.customization[url] = {
        [definitionsFilePropName]: toFilename
      };
    }

    fs.writeFileSync(
      path.join(csvFolder, toFilename),
      stringify(url2desc[url], { record_delimiter: '\n' })
    );
  }

  // json5-writer removes any property that does not exist in updateSettingsObj.
  // To keep existing properties, we need to pass undefined.
  Object.keys(settings.default).forEach((key) => {
    if (key !== definitionsFilePropName) {
      updateSettingsObj.default[key] = undefined;
    }
  });
  Object.keys(settings.customization).forEach((url) => {
    if (!updateSettingsObj.customization[url]) {
      // Keep customizations for URLs that are not in XLSX files.
      updateSettingsObj.customization[url] = undefined;
    } else {
      // Keep customizations for URLs that are in XLSX files; only update the CSV link.
      Object.keys(settings.customization[url]).forEach((key) => {
        if (key !== definitionsFilePropName) {
          updateSettingsObj.customization[url][key] = undefined;
        }
      });
    }
  });

  const settingsWriter = json5Writer.load(settingsJsonString);
  settingsWriter.write(updateSettingsObj);
  fs.writeFileSync(settingsPath, settingsWriter.toSource());
}


/**
 * Syncs application configuration from XLSX files (unless SKIP_XLSX=1) and
 * regenerates the definitions index and app version file.
 * @returns {Promise<{skipped: boolean, updatedUrlCount: number,
 *   generatedAssets: Object}>} Result describing whether the XLSX sync was
 *   skipped, how many service URLs were updated, and the generated assets.
 */
async function syncXlsxConfig() {
  const skipXlsx = process.env.SKIP_XLSX === '1';
  let updatedUrlCount = 0;

  if (!skipXlsx) {
    const csvDataByUrl = await prepareCsvData();
    updateAppSettings(csvDataByUrl);
    updatedUrlCount = Object.keys(csvDataByUrl).length;
  }

  const generatedAssets = syncGeneratedAssets();

  return {
    skipped: skipXlsx,
    updatedUrlCount,
    generatedAssets
  };
}

if (require.main === module) {
  syncXlsxConfig()
    .then(({ skipped, updatedUrlCount, generatedAssets }) => {
      if (skipped) {
        console.log('Skipped XLSX sync because SKIP_XLSX=1.');
      } else {
        console.log(`Synced XLSX config for ${updatedUrlCount} service URLs.`);
      }
      console.log(
        `Synced generated assets (definitions + app version ${generatedAssets.appVersion}).`
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  syncXlsxConfig,
  prepareCsvData,
  updateAppSettings
};

