import { join } from 'node:path';
import loader, {
  buildDefinitionsIndex,
  getSearchParametersConfig
} from './webpack-loader.js';
import { getVersionNameByNumber } from '../fhir-backend/fhir-batch-query.js';

// Directory that contains the per-version FHIR definition folders (R4, R5).
// Tests run with the project root as the working directory.
const definitionsDir = join(
  process.cwd(),
  'src/app/shared/definitions'
);
const r4Dir = join(definitionsDir, 'R4');


describe('getVersionNameByNumber', function () {

  it('translates a FHIR Version number to a release name', function () {
    expect(getVersionNameByNumber('4.0.0')).toBe('R4');
    expect(getVersionNameByNumber('4.0.1')).toBe('R4');
    expect(getVersionNameByNumber('4.0.9')).toBe(null);
  });

});


describe('getSearchParametersConfig', function () {
  // Build the configuration once for a small set of resource types to keep
  // the (multi-megabyte) definition files from being parsed repeatedly.
  let config;

  beforeAll(function () {
    config = getSearchParametersConfig(r4Dir, ['Patient', 'Observation'], [
      'Patient.telecom.use'
    ]);
  });

  it('returns null when the definitions directory does not exist', function () {
    expect(
      getSearchParametersConfig(join(definitionsDir, 'does-not-exist'), [], [])
    ).toBeNull();
  });

  it('produces the expected top-level result structure', function () {
    expect(Object.keys(config).sort()).toEqual([
      'resources',
      'valueSetByPath',
      'valueSetMapByPath',
      'valueSetMaps',
      'valueSets'
    ]);
    expect(Object.keys(config.resources).sort()).toEqual([
      'Observation',
      'Patient'
    ]);
  });

  it('describes search parameters for each requested resource type', function () {
    const params = config.resources.Patient.searchParameters;
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
    params.forEach((param) => {
      expect(typeof param.name).toBe('string');
      expect(typeof param.type).toBe('string');
      expect(typeof param.expression).toBe('string');
      expect(typeof param.rootPropertyName).toBe('string');
      expect(typeof param.description).toBe('string');
    });
  });

  it('enriches token search parameters with type, value set and required flag', function () {
    const gender = config.resources.Patient.searchParameters.find(
      (param) => param.name === 'gender'
    );
    expect(gender).toBeDefined();
    expect(gender.type).toBe('code');
    expect(gender.expression).toBe('Patient.gender');
    expect(gender.valueSet).toBe(
      'http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1'
    );
    expect(gender.required).toBe(true);
  });

  it('describes columns and excludes inherited Resource/DomainResource elements', function () {
    const columns = config.resources.Patient.columnDescriptions;
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    columns.forEach((column) => {
      expect(typeof column.element).toBe('string');
      expect(typeof column.description).toBe('string');
      expect(typeof column.isArray).toBe('boolean');
    });
    const elementNames = columns.map((column) => column.element);
    // Inherited elements must be filtered out.
    ['id', 'meta', 'implicitRules', 'language', 'text'].forEach((name) => {
      expect(elementNames).not.toContain(name);
    });
    // A multi-cardinality element is flagged as an array.
    const identifier = columns.find(
      (column) => column.element === 'identifier'
    );
    expect(identifier.isArray).toBe(true);
    expect(identifier.types).toEqual(['Identifier']);
  });

  it('resolves value sets referenced by additional expressions', function () {
    const url = 'http://hl7.org/fhir/ValueSet/contact-point-use|4.0.1';
    expect(config.valueSetByPath['Patient.telecom.use']).toBe(url);
    expect(Array.isArray(config.valueSets[url])).toBe(true);
  });

});


describe('buildDefinitionsIndex', function () {

  it('populates configByVersionName for each indexed version', function () {
    const index = {
      versionNameByVersionNumberRegex: {
        '^(4.0.0|4.0.1)$': 'R4'
      },
      configByVersionName: {}
    };
    const options = {
      R4: { resourceTypes: ['Patient'], additionalExpressions: [] }
    };

    const result = buildDefinitionsIndex(index, options, definitionsDir);

    expect(result).toBe(index);
    expect(Object.keys(result.configByVersionName)).toEqual(['R4']);
    expect(result.configByVersionName.R4.resources.Patient).toBeDefined();
  });

});


describe('loader', function () {

  it('parses the source, builds the index and serializes it back to JSON', function () {
    const source = JSON.stringify({
      versionNameByVersionNumberRegex: {
        '^(4.0.0|4.0.1)$': 'R4'
      },
      configByVersionName: {}
    });
    const context = {
      context: definitionsDir,
      getOptions() {
        return {
          R4: { resourceTypes: ['Patient'], additionalExpressions: [] }
        };
      }
    };

    const output = loader.call(context, source);
    const parsed = JSON.parse(output);

    expect(typeof output).toBe('string');
    expect(parsed.configByVersionName.R4.resources.Patient).toBeDefined();
  });

  it('falls back to "this.query" when "getOptions" is unavailable', function () {
    const source = JSON.stringify({
      versionNameByVersionNumberRegex: {
        '^(4.0.0|4.0.1)$': 'R4'
      },
      configByVersionName: {}
    });
    const context = {
      context: definitionsDir,
      query: { R4: { resourceTypes: ['Patient'], additionalExpressions: [] } }
    };

    const parsed = JSON.parse(loader.call(context, source));

    expect(parsed.configByVersionName.R4.resources.Patient).toBeDefined();
  });

});
