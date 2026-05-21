#!/usr/bin/env node
/**
 * This file contains a script used to automatically configure the RDF for
 * a FHIR server. It is intended to be used by developers who want to quickly
 * set up the web application for a new FHIR server.
 *
 * This script will examine the FHIR server at the specified URL and create
 * a settings.json5 file with the specified default server URL, as well as
 * a CSV-file with definitions describing the available resource types,
 * the available table columns for those resource types, and the available
 * search parameters.
 */

const { Command } = require('commander');
// Shared CLI entrypoint used by local source runs and bundled build output.
const program = new Command();
// Emulate the browser's XMLHttpRequest object.
global.XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
// Reuse the same backend query implementation as the web app for consistency.
const { FhirBatchQuery } =
  require('../src/app/shared/fhir-backend/fhir-batch-query.js');
const JSON5 = require('json5');
const json5Writer = require('json5-writer');
const fs = require('fs');
const path = require('path');
// CSV + capability utilities used to derive server-specific definitions output.
const {
  parseCsvString, stringifyCsvRows, buildCapabilityIndex, collectResourceTypes,
  collectSearchParamInfoByResource, isSpecialSearchParamName,
  filterDefinitionRows
} = require('./definitions-generator');

// FHIRPath context models used for optional expression-based column checks.
const r4Model = require('fhirpath/fhir-context/r4');
const r5Model = require('fhirpath/fhir-context/r5');

// Keep requests simple and resilient for capability probing during autoconfig.
const REQUEST_OPTIONS = { combine: false, retryCount: 3 };
// TODO:
//  We currently exclude search parameters of the "reference", "Patient", and
//  "Identifier" types from the output CSV file, but we may add them to the
//  output if needed. "Patient" is a synthetic type that effectively represents
//  a "reference" to a resource of type "Patient".
const EXCLUDED_OUTPUT_SEARCH_PARAM_TYPES = new Set(['reference', 'Patient',
  'Identifier']);
// Composite params are excluded from probing because they are ambiguous.
const EXCLUDED_INPUT_SEARCH_PARAM_TYPES = new Set(['composite']);


/**
 * Converts a URL-like string into a filename-safe slug.
 * Replaces runs of non-alphanumeric characters with dashes and trims edge
 * dashes.
 * @param {string} url - URL or arbitrary string to sanitize.
 * @returns {string} Sanitized value suitable for use in file names.
 */
function sanitizeUrlForFilename(url) {
  return url.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}


/**
 * Resolves the bundled base definitions CSV path for a given FHIR version.
 * Falls back to the source tree path when running from development sources.
 * @param {string} versionName - FHIR version identifier
 *   (for example `R4` or `R5`).
 * @returns {string} Absolute/relative path to the base definitions CSV.
 */
function getBaseDefinitionsCsvPath(versionName) {
  const suffix = versionName === 'R5' ? 'R5' : 'R4';
  const bundledPath = path.join(
    __dirname,
    'conf',
    'csv',
    `desc-default-${suffix}.csv`
  );
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }
  return path.join(
    __dirname,
    '..',
    'src',
    'conf',
    'csv',
    `desc-default-${suffix}.csv`
  );
}


/**
 * Ensures the output directory contains default R4/R5 definitions CSV files.
 * Missing files are copied from bundled/source template locations.
 * @param {string} outputDir - Target output directory.
 * @returns {string[]} Absolute paths of copied files.
 */
function ensureDefaultDefinitionsCsvFiles(outputDir) {
  const copiedFiles = [];
  const filesToEnsure = ['R4', 'R5'];

  filesToEnsure.forEach((versionName) => {
    const sourcePath = getBaseDefinitionsCsvPath(versionName);
    const fileName = path.basename(sourcePath);
    const targetPath = path.join(outputDir, fileName);
    if (fs.existsSync(targetPath)) {
      return;
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Base definitions CSV not found: ${sourcePath}`);
    }
    fs.copyFileSync(sourcePath, targetPath);
    copiedFiles.push(targetPath);
  });

  return copiedFiles;
}


/**
 * Resolves the initial settings template path across bundled and source
 * layouts.
 * @returns {string} Path to `settings-initial.json5`.
 */
function getSettingsInitialPath() {
  const candidatePaths = [
    path.join(__dirname, 'conf', 'settings-initial.json5')
  ];

  const foundPath = candidatePaths.find((candidatePath) =>
    fs.existsSync(candidatePath));
  return foundPath || candidatePaths[candidatePaths.length - 1];
}


/**
 * Resolves the RDF/autoconfig version from available metadata files.
 * Prefers bundled `build-info.json`, then falls back to `package.json`.
 * @returns {string} Resolved version, or `unknown` if metadata is unavailable.
 */
function getRdfVersion() {
  const candidatePaths = [
    // Preferred for bundled autoconfig-build so the folder stays
    // self-contained.
    path.join(__dirname, 'conf', 'build-info.json'),
    // Source fallback for local development runs.
    path.join(__dirname, '..', 'package.json')
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
      if (data?.rdfVersion) {
        return data.rdfVersion;
      }
      if (data?.version) {
        return data.version;
      }
    } catch (err) {
      // Ignore malformed metadata and continue to the next fallback.
    }
  }

  return 'unknown';
}


/**
 * Loads a CapabilityStatement either from a local file or from the FHIR server.
 * @param {FhirBatchQuery|null|undefined} fhirClient - FHIR client used for
 *   remote metadata fetch.
 * @param {string|undefined} capabilityFile - Optional local
 *   CapabilityStatement JSON path.
 * @returns {Promise<object|null>} Parsed CapabilityStatement object,
 *   or `null` when unavailable.
 */
async function loadCapabilityStatement(fhirClient, capabilityFile) {
  if (capabilityFile) {
    const capabilityString = fs.readFileSync(capabilityFile, 'utf-8');
    return JSON.parse(capabilityString);
  }
  if (!fhirClient) {
    return null;
  }
  const features = fhirClient.getFeatures();
  const formatParam = features?.isFormatSupported ? '?_format=json' : '';
  const response = await fhirClient.get(
    `metadata${formatParam}`,
    REQUEST_OPTIONS
  );
  return response.data;
}


/**
 * Checks whether a resource type has at least one row on the server.
 * @param {FhirBatchQuery} fhirClient - FHIR client used for querying
 *   data presence.
 * @param {string} resourceType - FHIR resource type
 *   (for example `Observation`).
 * @returns {Promise<boolean>} `true` when at least one resource exists.
 */
async function checkResourceHasData(fhirClient, resourceType) {
  try {
    const response = await fhirClient.get(
      `${resourceType}?_elements=id&_count=1`,
      REQUEST_OPTIONS
    );
    return response.data?.entry?.length > 0;
  } catch (err) {
    console.warn(err);
    return false;
  }
}


/**
 * Checks whether a search parameter returns data and collects matching samples.
 * @param {FhirBatchQuery} fhirClient - FHIR client used for querying.
 * @param {string} resourceType - FHIR resource type to query.
 * @param {string} paramName - Search parameter name.
 * @returns {Promise<{hasData: boolean, resources: object[]}>}
 *   Data flag and sample resources.
 */
async function checkSearchParamHasData(fhirClient, resourceType, paramName) {
  try {
    const response = await fhirClient.get(
      `${resourceType}?${paramName}:missing=false&_count=5`,
      REQUEST_OPTIONS
    );
    const resources = (response.data?.entry || [])
      .map((entry) => entry.resource)
      .filter(Boolean);
    return { hasData: resources.length > 0, resources };
  } catch (err) {
    console.warn(err);
    return { hasData: false, resources: [] };
  }
}


/**
 * Loads a sample resource from fixtures or from the server.
 * @param {string} resourceType - FHIR resource type.
 * @param {{sampleResourceDir?: string}} options - CLI options object.
 * @param {FhirBatchQuery|null|undefined} fhirClient - FHIR client for
 *   server fallback.
 * @returns {Promise<object|null>} Sample resource JSON object or `null`.
 */
async function loadSampleResource(resourceType, options, fhirClient) {
  if (options.sampleResourceDir) {
    const samplePath = path.join(options.sampleResourceDir,
      `${resourceType}.json`);
    if (fs.existsSync(samplePath)) {
      const sampleString = fs.readFileSync(samplePath, 'utf-8');
      return JSON.parse(sampleString);
    }
  }
  if (!fhirClient) {
    return null;
  }
  try {
    const response = await fhirClient.get(`${resourceType}?_count=1`,
      REQUEST_OPTIONS);
    return response.data?.entry?.[0]?.resource || null;
  } catch (err) {
    console.warn(err);
    return null;
  }
}


/**
 * Returns the fhirpath context model for the requested FHIR version.
 * @param {string} versionName - FHIR version (`R4` or `R5`).
 * @returns {object|undefined} Matching fhirpath model, if supported.
 */
function getFhirModel(versionName) {
  if (versionName === 'R5') {
    return r5Model;
  }
  if (versionName === 'R4') {
    return r4Model;
  }
  return undefined;
}


/**
 * Applies scrubber-related settings and client header behavior.
 * @param {string|undefined} scrubberId - Optional scrubber header value.
 * @param {object} updateSettingsObj - Mutable settings update payload.
 * @param {FhirBatchQuery|null|undefined} fhirClient - FHIR client instance.
 * @returns {void}
 */
function applyScrubberSetting(scrubberId, updateSettingsObj, fhirClient) {
  if (scrubberId) {
    console.log('Scrubber ID:', scrubberId);
    fhirClient?.setScrubberIDHeader(scrubberId);
    updateSettingsObj.default['scrubber'] = true;
    return;
  }
  updateSettingsObj.default['scrubber'] = false;
}


/**
 * Builds a minimal update object for json5-writer while preserving untouched
 * settings via `undefined` placeholders.
 * @param {object} settings - Parsed settings template.
 * @param {string} url - Target default server URL.
 * @returns {object} Mutable update object for json5-writer.
 */
function buildSettingsUpdateObj(settings, url) {
  return Object.keys(settings).reduce((res, key) => {
    if (key === 'default') {
      res[key] = {};
      const defaultSection = res[key];
      Object.keys(settings.default).forEach((k) => {
        defaultSection[k] = undefined;
      });
      defaultSection['defaultServer'] = url;
    } else if (key === 'customization') {
      res[key] = {};
      const customizationSection = res[key];
      Object.keys(settings.customization).forEach((k) => {
        customizationSection[k] = undefined;
      });
    } else {
      res[key] = undefined;
    }
    return res;
  }, {});
}


/**
 * Builds the server description stored in generated settings output.
 * @param {FhirBatchQuery} fhirClient - Initialized FHIR client.
 * @returns {{version: string, features: object}} Server description settings.
 */
function buildServerDescription(fhirClient) {
  const features = fhirClient.getFeatures();
  // TODO: Temporary workaround for the issue where combining two "_has"
  //  parameters together with a `_summary` parameter leads to an
  //  uncontrolled increase in load on the HAPI server:
  //  simply disallow the use of more than one `_has` parameter.
  if (features.maxHasAllowed > 1) {
    console.warn(
      `Capping maxHasAllowed from ${features.maxHasAllowed} to 1 to avoid ` +
      'high server load.'
    );
    features.maxHasAllowed = 1;
  }
  return {
    version: fhirClient.getVersionName(),
    features
  };
}


/**
 * Sets server-specific definitions file in the customization section.
 * @param {object} updateSettingsObj - Mutable settings update payload.
 * @param {string} url - FHIR server URL key inside `customization`.
 * @param {string} definitionsFileName - Generated definitions CSV filename.
 * @returns {void}
 */
function setCustomizationDefinitionsFile(
  updateSettingsObj,
  url,
  definitionsFileName
) {
  updateSettingsObj.customization[url] = {
    definitionsFile: definitionsFileName
  };
}


/**
 * Generates a filtered definitions CSV tailored to server capability and data.
 * @param {object} params - Generation parameters.
 * @param {string} params.url - FHIR server base URL.
 * @param {string} params.versionName - FHIR version name.
 * @param {FhirBatchQuery|null|undefined} params.fhirClient - Initialized
 *   FHIR client.
 * @param {string} params.outputDir - Output directory path.
 * @param {object} params.options - CLI options for generation.
 * @returns {Promise<{definitionsFileName: string, outputPath: string,
 *   rowCount: number}>}
 *   Output metadata for the generated CSV.
 */
async function generateDefinitionsCsv({
  url,
  versionName,
  fhirClient,
  outputDir,
  options
}) {
  const baseCsvPath = options.definitionsBase ||
    getBaseDefinitionsCsvPath(versionName);
  const csvString = fs.readFileSync(baseCsvPath, 'utf-8');
  const rows = parseCsvString(csvString);
  if (!rows) {
    throw new Error(`Failed to parse CSV definitions from ${baseCsvPath}`);
  }

  const capabilityStatement = await loadCapabilityStatement(fhirClient,
    options.capabilityFile);
  const capabilityIndex = buildCapabilityIndex(capabilityStatement);
  const resourceTypes = collectResourceTypes(rows);
  const searchParamInfoByResource = collectSearchParamInfoByResource(rows);

  const resourceInfoByType = new Map();
  const forceShowByResource = new Map();
  const model = getFhirModel(versionName);
  for (const resourceType of resourceTypes) {
    const capabilityResourceTypes = capabilityIndex.resourceTypes;
    const capabilitySearchParams = capabilityIndex.searchParamsByType.get(
      resourceType);
    const hasCapabilityResources = capabilityResourceTypes.size > 0;
    const capabilityAllowsResource = hasCapabilityResources
      ? capabilityResourceTypes.has(resourceType)
      : true;
    const hasResourceData = capabilityAllowsResource
      ? await checkResourceHasData(fhirClient, resourceType)
      : false;
    const supported = capabilityAllowsResource && hasResourceData;

    if (!supported) {
      resourceInfoByType.set(resourceType, {
        supported: false,
        sampleResources: [],
        searchParamSupport: new Map()
      });
      continue;
    }

    const sampleResources = [];
    const sampleResource = await loadSampleResource(resourceType, options,
      fhirClient);
    if (sampleResource) {
      sampleResources.push(sampleResource);
    }
    const searchParamSupport = new Map();
    const paramInfo = searchParamInfoByResource.get(resourceType) || new Map();
    for (const [paramName, info] of paramInfo) {
      if (EXCLUDED_INPUT_SEARCH_PARAM_TYPES.has(info?.type)) {
        continue;
      }
      const outputExcludedByType = EXCLUDED_OUTPUT_SEARCH_PARAM_TYPES.has(
        info?.type
      );
      let supportedParam = true;
      if (!isSpecialSearchParamName(paramName)) {
        if (paramName.includes(',')) {
          const parts = paramName
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
          supportedParam = parts.length > 0;
          if (supportedParam && capabilitySearchParams &&
            capabilitySearchParams.size > 0) {
            supportedParam = parts.every((part) =>
              capabilitySearchParams.has(part));
          }
          if (supportedParam) {
            for (const part of parts) {
              const { hasData, resources } = await checkSearchParamHasData(
                fhirClient,
                resourceType,
                part
              );
              resources.forEach((resource) => sampleResources.push(resource));
              if (!hasData) {
                supportedParam = false;
                break;
              }
            }
          }
          if (!supportedParam) {
            const showSet = forceShowByResource.get(resourceType) || new Set();
            parts.forEach((part) => showSet.add(part));
            forceShowByResource.set(resourceType, showSet);
          }
        } else if (capabilitySearchParams && capabilitySearchParams.size > 0) {
          supportedParam = capabilitySearchParams.has(paramName);
          if (supportedParam) {
            const { hasData, resources } = await checkSearchParamHasData(
              fhirClient, resourceType, paramName);
            resources.forEach((resource) => sampleResources.push(resource));
            supportedParam = hasData;
          }
        } else {
          const { hasData, resources } = await checkSearchParamHasData(
            fhirClient, resourceType, paramName);
          resources.forEach((resource) => sampleResources.push(resource));
          supportedParam = hasData;
        }
      }
      // Keep loading/querying data for excluded types so column checks can use
      // those samples.
      searchParamSupport.set(paramName, outputExcludedByType ? false
        : supportedParam);
    }

    resourceInfoByType.set(resourceType, {
      supported: true,
      sampleResources,
      searchParamSupport
    });
  }

  const filteredRows = filterDefinitionRows(rows, resourceInfoByType, {
    // Keep all columns by default; exclude columns without data only upon
    // request:
    skipColumnChecks: !options.excludeEmptyColumns,
    forceShowByResource,
    model
  });
  const definitionsFileName = options.definitionsFileName ||
    `desc-${sanitizeUrlForFilename(url)}.csv`;
  const outputPath = path.join(outputDir, definitionsFileName);
  fs.writeFileSync(outputPath, stringifyCsvRows(filteredRows));

  return { definitionsFileName, outputPath, rowCount: filteredRows.length };
}

// Configure top-level CLI metadata and version output.
program
  .name('autoconfig-src')
  .description(
    'CLI to generate configuration files for RDF based on the capabilities of' +
    ' a FHIR server'
  )
  .version(getRdfVersion(), '-v, --version', 'output the RDF version');

// Define the `init` command that bootstraps settings and definitions output.
program.command('init')
  .description('Create initial configuration files')
  .argument('<url>', 'FHIR server URL')
  .option('-o, --output <foldername>',
    'directory to output the generated configuration files', './output')
  .option('-s, --scrubber-id <id>', 'The scrubber ID header value', '')
  .option('-b, --definitions-base <path>', 'path to base definitions CSV file')
  .option('-c, --capability-file <path>',
    'path to a local CapabilityStatement JSON file')
  .option('-r, --sample-resource-dir <path>',
    'path to sample resources directory')
  .option('--definitions-file-name <name>',
    'definitions CSV filename to write')
  .option(
    '--exclude-empty-columns',
    'exclude column descriptions that have no data in collected sample' +
    ' resources'
  )
  .action(async (url, options) => {
    console.log('Initializing configuration for FHIR server at URL:', url);
    console.log('Output directory:', options.output);

    const settingsPath = getSettingsInitialPath();
    const settingsJsonString = fs.readFileSync(settingsPath).toString();
    const settings = JSON5.parse(settingsJsonString);

    // json5-writer will remove any property that does not exist in
    // updateSettingsObj. To keep the previous property values, we need to pass
    // undefined as the value for those properties.
    const updateSettingsObj = buildSettingsUpdateObj(settings, url);

    // Use the same class as in the web application to get the actual
    // initialization parameters.
    const fhirClient = new FhirBatchQuery({
      serviceBaseUrl: url, maxRequestsPerBatch: 1, maxActiveRequests: 1 });

    applyScrubberSetting(options.scrubberId, updateSettingsObj, fhirClient);

    // Run initialization queries in the same way as we do in the web
    // application, and use the results to update settings.
    try {
      await fhirClient.initialize();
      updateSettingsObj.default['serverDescription'] =
        buildServerDescription(fhirClient);

      const csvOutputPath = path.join(options.output, 'csv');
      if (!fs.existsSync(csvOutputPath)) {
        fs.mkdirSync(csvOutputPath, { recursive: true });
      }

      const definitionsResult = await generateDefinitionsCsv({
        url,
        versionName: fhirClient.getVersionName(),
        fhirClient,
        outputDir: csvOutputPath,
        options
      });
      const copiedDefaultCsvFiles = ensureDefaultDefinitionsCsvFiles(
        csvOutputPath
      );
      copiedDefaultCsvFiles.forEach((copiedPath) => {
        console.log(`Copied missing default definitions file: ${copiedPath}`);
      });
      setCustomizationDefinitionsFile(
        updateSettingsObj,
        url,
        definitionsResult.definitionsFileName
      );
      console.log(`Definitions CSV written to: ${definitionsResult.outputPath}`);
      console.log(`Definitions rows: ${definitionsResult.rowCount}`);

      const settingsWriter = json5Writer.load(settingsJsonString);
      settingsWriter.write(updateSettingsObj);
      const settingsOutputPath = path.join(options.output, 'settings.json5');
      const settingsSource = settingsWriter.toSource();
      fs.writeFileSync(settingsOutputPath, settingsSource);
      console.log(`Settings file written to: ${settingsOutputPath}`);
      console.log(`Settings file size (bytes): ${
        Buffer.byteLength(settingsSource, 'utf-8')
      }`);
    } catch (err) {
      console.error(err);
      process.exitCode = 1;
    }
  });


// Parse CLI args only when executed directly, not when imported by tests.
if (require.main === module) {
  program.parse();
}

// Export helpers so tests can validate path/version and CSV generation
// behavior.
module.exports = {
  sanitizeUrlForFilename,
  getBaseDefinitionsCsvPath,
  ensureDefaultDefinitionsCsvFiles,
  getSettingsInitialPath,
  getRdfVersion,
  generateDefinitionsCsv,
  applyScrubberSetting,
  buildSettingsUpdateObj,
  buildServerDescription,
  setCustomizationDefinitionsFile
};
