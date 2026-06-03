/**
 * Webpack loader for "definitions/index.json".
 * This loader fills result object with data from "search-parameters.json" from https://www.hl7.org/fhir/downloads.html
 * Also uses "profiles-types.json", "profiles-resources.json", "valuesets.json" and "v3-codesystems.json" from the same directory.
 */
const fs = require('fs');


/**
 * Extracts search parameter description for specified resource type from a description of the search parameter
 * @param {string} resourceType
 * @param {string} description
 * @return {string}
 */
function getDescription(resourceType, description) {
  const descriptions = description.split('\r\n');
  const reDescription = new RegExp(`\\[${resourceType}][^:]*:\\s*(.*)`);
  let result = descriptions[0];
  if (descriptions.length > 1) {
    for (let i = 0; i < descriptions.length; ++i) {
      if (reDescription.test(descriptions[i])) {
        result = RegExp.$1;
        break;
      }
    }
  }
  return result.trim();
}


/**
 * Extract search parameters configuration from JSON FHIR Definitions (part of FHIR specification)
 * @param {string} directoryPath - directory where JSON files are located
 * @param {Array<string>} resourceTypes - list of resource types for which you want to get search parameters configuration
 * @param {Array<string>} additionalExpressions - list of additional expressions to extract value sets
 * @return {{}}
 */
function getSearchParametersConfig(
  directoryPath,
  resourceTypes,
  additionalExpressions
) {
  if (!fs.existsSync(directoryPath)) {
    return null;
  }
  const profiles = {
    parameters: JSON.parse(
      fs.readFileSync(directoryPath + '/search-parameters.json').toString()
    ),
    resources: JSON.parse(
      fs.readFileSync(directoryPath + '/profiles-resources.json').toString()
    ),
    types: JSON.parse(
      fs.readFileSync(directoryPath + '/profiles-types.json').toString()
    ),
    valueSets: JSON.parse(
      fs.readFileSync(directoryPath + '/valuesets.json').toString()
    ),
    // R5 definitions do not have this file
    v3CodeSystems: fs.existsSync(directoryPath + '/v3-codesystems.json')
      ? JSON.parse(
          fs.readFileSync(directoryPath + '/v3-codesystems.json').toString()
        )
      : null
  };


  /**
   * @typedef TypeDescriptionHash
   * @type {Object}
   * @property {string} type - type name
   * @property {string} [valueSet] - value set url
   */

  /**
   * Finds type description and value set by simple FHIRPath expression
   * @param {Object} resultConfig - webpack loader result object
   * @param {string} path - simple FHIRPath expression starting with a resource
   *                        type with a dot-separated listing of property names
   * @return {TypeDescriptionHash}
   */
  function getTypeDescriptionByPath(resultConfig, path) {
    const typeDesc = {
      ...getTypeDescByArrayOfPropertyNames(
        // Remove surrounding parentheses
        (/\((.*)\)/.test(path) ? RegExp.$1 : path).split('.')
      )
    };
    findValueSet(resultConfig, path, typeDesc.valueSet);
    return typeDesc;
  }


  /**
   * Finds value set and stores it in the webpack loader result object
   * @param {Object} resultConfig - webpack loader result object
   * @param {string} path - simple FHIRPath expression starting with a resource
   *                        type with a dot-separated listing of property names
   *                        for which valueSet is used
   * @param {string} valueSetUrl - valueSet url
   */
  function findValueSet(resultConfig, path, valueSetUrl) {
    if (valueSetUrl) {
      if (!resultConfig.valueSets[valueSetUrl]) {
        const valueSet = getValueSet({ url: valueSetUrl });
        resultConfig.valueSets[valueSetUrl] =
          valueSet instanceof Array
            ? valueSet.sort((a, b) => a.display.localeCompare(b.display))
            : valueSet ||
              // R5 definitions do not have v3-codesystems.json
              valueSetUrl;
      }
      resultConfig.valueSetByPath[path] = valueSetUrl;
    }
  }


  /**
   * Returns type description of resource property by path specified by an array of property names
   * @param {string} resourceType - resource type
   * @param {Array<string>} propertyNames - array of property names
   * @return {TypeDescriptionHash}
   */
  function getTypeDescByArrayOfPropertyNames([resourceType, ...propertyNames]) {
    if (!propertyNames.length) {
      return {
        type: resourceType
      };
    }
    const entry =
      profiles.resources.entry.find((i) => i.resource.id === resourceType) ||
      profiles.types.entry.find((i) => i.resource.id === resourceType);
    const resource = entry.resource;
    const expression = resourceType + '.' + propertyNames[0];
    let desc =
      resource.snapshot.element.filter((i) => i.id === expression)[0] ||
      resource.snapshot.element.filter(
        (i) => i.id.indexOf(expression) === 0
      )[0];
    if (!desc.type && /#(.*)/.test(desc.contentReference)) {
      desc = resource.snapshot.element.find((i) => i.id === RegExp.$1);
    }
    let type = desc.type[0].code;
    if (desc.type.length !== 1) {
      if (
        propertyNames.length === 2 &&
        /ofType\((.*)\)/.test(propertyNames[1])
      ) {
        // FHIRPath expressions in R5 definitions can use ".ofType(...)"
        type = RegExp.$1;
        propertyNames.length = 1;
      } else {
        console.warn('Warning: Data type cannot be accurately determined');
      }
    }
    if (propertyNames.length === 1) {
      return {
        type,
        ...(desc.binding && desc.binding.valueSet
          ? { valueSet: desc.binding.valueSet }
          : {}),
        ...(desc.binding && desc.binding.strength === 'required'
          ? { required: true }
          : {})
      };
    } else if (type === 'BackboneElement') {
      return getTypeDescByArrayOfPropertyNames([
        resourceType,
        propertyNames[0] + '.' + propertyNames[1],
        ...propertyNames.slice(2)
      ]);
    } else {
      return getTypeDescByArrayOfPropertyNames([
        desc.type[0].code,
        ...propertyNames.slice(1)
      ]);
    }
  }


  /**
   * Gets ValueSet or CodeSystem items array from concept array, with filtering by
   * includeCodes, and converting a CodeSystem tree of concepts to the flat list.
   * @param {string} system - value set code system
   * @param {Array<{code: string, display: string}>} concept - concept input
   *        array, each concept can have a nested concept array
   * @param {Array<string> | null} [includeCodes] - if specified, then a list
   *        of concept codes that we should include in the result array
   * @param {boolean} includeChildren - true if we should include nested
   *        concepts of matched concept in the result Array
   * @return {Array<{code: string, display: string}>}
   */
  function getValueSetItems(system, concept, includeCodes, includeChildren) {
    return concept.reduce((acc, i) => {
      if (!includeCodes || includeCodes[i.code]) {
        acc.push({
          code: i.code,
          system,
          display: i.display || i.code
        });
      }

      return i.concept
        ? acc.concat(
            getValueSetItems(
              system,
              i.concept,
              includeChildren && includeCodes && includeCodes[i.code]
                ? null
                : includeCodes,
              includeChildren
            )
          )
        : acc;
    }, []);
  }


  /**
   * Gets an array of all ValueSet or CodeSystem items by URL.
   * If it is not possible to fill an array of items for ValueSet(CodeSystem),
   * then a string with a URL is returned. If ValueSet/CodeSystem is not
   * described in specification then result will be null.
   * @param {Object} options
   *        "options.url" is passed on the initial call, then if the "url" points to a ValueSet
   *        the function calls itself recursively for each "ValueSet.compose.include"
   *        item (see http://hl7.org/fhir/valueset.html#resource) which could point to another
   *        ValueSet or CodeSystem. This item value is passed into the "options" parameter.
   *        If "options.valueSet" is provided, it should be an array of URLs, and the function
   *        will turn that into a series of recursive calls with "options.url" set.
   * @param {string} options.url - canonical identifier for value set, represented as a URI (globally unique)
   * @param {Array<string>} options.valueSet - array of canonical value set identifiers
   *        Example of resource which uses "compose.include[].valueSet": http://hl7.org/fhir/valueset-security-labels.json.html
   * @param {string} options.system - the system the codes come from
   *        Example of resource which uses only "compose.include[].system: http://hl7.org/fhir/valueset-address-use.json.html
   * @param {Array<{code:string, display:string}>} options.concept - a concept defined in a system
   *        Example of resource which uses "compose.include[].concept": http://hl7.org/fhir/valueset-c80-doc-typecodes.json.html
   * @param {Array<Object>} options.filter - select codes/concepts by their properties.
   *        Only one filter options is currently supported:
   *        {property: 'concept', op: 'is-a', value: string}
   *        Example of resource which uses "compose.include[].filter": http://hl7.org/fhir/v3/ActEncounterCode/v3-ActEncounterCode.json.html
   * @return {Array<{code: string, display: string}> | string | null}
   */
  function getValueSet(options) {
    if (options.valueSet) {
      return [].concat.apply(
        [],
        options.valueSet.map((i) => getValueSet({ url: i })).filter((i) => i)
      );
    }
    const url = (options.url || options.system).split('|')[0];
    const entry =
      profiles.valueSets.entry.find(
        (i) => i.fullUrl === url || i.resource.url === url
      ) ||
      profiles.v3CodeSystems?.entry.find(
        (i) => i.fullUrl === url || i.resource.url === url
      );
    if (!entry) {
      if (options.concept) {
        return options.concept.map((i) => ({
          code: i.code,
          system: url,
          display: i.display || i.code
        }));
      }
      return null;
    }

    // resource is a ValueSet or CodeSystem resource
    const resource = entry.resource;
    let result = [];

    if (resource && resource.concept) {
      // if resource is CodeSystem:
      const includeCodes =
        options.concept &&
        options.concept.reduce((acc, c) => {
          acc[c.code] = true;
          return acc;
        }, {});
      const filterCodes =
        options.filter &&
        options.filter.reduce((acc, f) => {
          if (f.property !== 'concept' || f.op !== 'is-a' || !f.value) {
            // TODO: support full include specification? (see http://hl7.org/fhir/valueset.html)
            console.error('Unsupported filter value:', options);
          } else {
            acc[f.value] = true;
          }
          return acc;
        }, {});
      result = result.concat(
        getValueSetItems(
          url,
          resource.concept,
          includeCodes || filterCodes,
          !!filterCodes
        )
      );
    }

    const compose = resource && resource.compose;
    const include = compose && compose.include;
    if (include) {
      // if resource is a ValueSet and has included ValueSets or CodeSystems:
      result = result.concat(
        ...include
          .map((i) => {
            const items = getValueSet(i);
            // if (!items) {
            //   console.log("Can't find:", i);
            // } else if (!(items instanceof Array)) {
            //   console.log('No values for:', items);
            // }

            const excludes =
              (compose.exclude &&
                compose.exclude.filter((e) => e.system === i.system)) ||
              [];
            const excludeCodes = excludes.reduce((acc, exclude) => {
              if (!exclude.concept) {
                // TODO: support full exclude specification? (see http://hl7.org/fhir/valueset.html)
                console.error('Unsupported exclude value:', options);
              } else {
                exclude.concept.forEach((e) => (acc[e.code] = true));
              }
              return acc;
            }, {});

            return items instanceof Array && excludeCodes
              ? items.filter((j) => !excludeCodes[j.code])
              : items;
          })
          .filter((i) => i instanceof Array)
      );
    }

    if (result.length) {
      if (!result.some((item) => item.system !== result[0].system)) {
        // If there is only one coding system, remove it as unnecessary
        result.forEach((item) => delete item.system);
      }
      return result;
    }

    return url;
  }

  let resultConfig = {
    resources: {},
    valueSets: {},
    // to avoid duplication of objects in memory, the properties below are filled at runtime,
    // see method getCurrentDefinitions (common-descriptions.js) for details
    valueSetByPath: {},
    valueSetMaps: {},
    valueSetMapByPath: {}
  };

  /**
   * Returns an array of search parameter descriptions for the specified resource type
   * @param {string} resourceType - resource type
   * @return {Array<Object>}
   */
  function getSearchParameterDescriptions(resourceType) {
    return profiles.parameters.entry
      .filter((item) => item.resource.base.indexOf(resourceType) !== -1)
      .map((item) => {
        let expression = '',
          path = '',
          typeFromExpression;

        item.resource.expression.split('|').some((i) => {
          // Select FHIRPath expression for resourceType
          const found = new RegExp(`\\b${resourceType}\\b`).test(i);
          if (found) {
            expression = i.trim();
            // Extract the type of value and property path from this expression
            if (/(.*)\.as\(([^)]*)\)$/.test(expression)) {
              typeFromExpression = RegExp.$2;
              path = RegExp.$1;
            } else if (
              /(.*)\.where\(resolve\(\) is ([^)]*)\)$/.test(expression)
            ) {
              typeFromExpression = RegExp.$2;
              path = RegExp.$1;
            } else if (/^\((.*) as ([^)]*)\)$/.test(expression)) {
              typeFromExpression = RegExp.$2;
              path = RegExp.$1;
            } else if (/^\((.*) is ([^)]*)\)$/.test(expression)) {
              typeFromExpression = RegExp.$2;
              path = RegExp.$1;
            } else if (/(.*)\.where\(/.test(expression)) {
              path = RegExp.$1;
            } else if (/\.exists\(\)/.test(expression)) {
              typeFromExpression = 'boolean';
            } else {
              path = expression;
            }
          }
          return found;
        });

        const param = {
          name: item.resource.name,
          type:
            (item.resource.type === 'token' ||
            // TODO:
            //  This code changes type of search parameter from "reference" to
            //  "Patient". Not sure why. Maybe this is unnecessary? If it is
            //  necessary, can we store the type of the resource referenced by
            //  the "reference" separately?
            item.resource.type === 'reference' ||
            item.resource.type === 'quantity'
              ? typeFromExpression
              : '') || item.resource.type,
          rootPropertyName: getPropertyPath(resourceType, path).split('.')[0],
          expression,
          // TODO: Remove the unused 'path' after moving this code from the `prev` directory to the `source` directory.
          path,
          description: getDescription(resourceType, item.resource.description)
        };
        if (param.type === 'token') {
          Object.assign(param, getTypeDescriptionByPath(resultConfig, path));
        }
        return param;
      });
  }


  /**
   * Determines resource property path by simple FHIRPath expression
   * @param {string} resourceType - resource type
   * @param {string} path - simple FHIRPath expression starting with a resource
   *                        type with a dot-separated listing of property names
   * @return {string}
   */
  function getPropertyPath(resourceType, path) {
    const searchValue = new RegExp(`^${resourceType}\\.`);
    return path.replace(searchValue, '');
  }


  /**
   * Returns an array of column descriptions for the specified resource type
   * @param {string} resourceType - resource type
   * @return {Array<Object>}
   */
  function getColumnDescriptions(resourceType) {
    const resource = profiles.resources.entry.find(
      (i) => i.resource.id === resourceType
    ).resource;
    const idRegExp = new RegExp(`^${resourceType}\\.([^.]*)$`);
    let columns = [];
    resource.snapshot.element.forEach((element) => {
      if (idRegExp.test(element.id)) {
        const elementName = RegExp.$1;
        const isArray = element.max === '*';

        // Exclude common elements from resource column list
        // inherited from Resource: id, meta, implicitRules, and language
        // inherited from DomainResource: text, contained, extension, and modifierExtension
        if (
          element.base.path.startsWith('Resource.') ||
          element.base.path.startsWith('DomainResource.')
        ) {
          return;
        }

        let types = '';
        if (!element.type) {
          if (/#(.*)/.test(element.contentReference)) {
            types = resource.snapshot.element
              .find((i) => i.id === RegExp.$1)
              .type.map((i) => i.code);
          }
        } else {
          types = element.type.map((i) => i.code);
        }

        columns.push({
          element: elementName,
          types,
          description: element.short,
          isArray
        });

        // Find value sets for displaying column values
        findValueSet(
          resultConfig,
          resourceType + '.' + elementName,
          element.binding && element.binding.valueSet
        );
        // TODO: Find value sets for child properties ?
      }
    });
    return columns;
  }

  resourceTypes.forEach((resourceType) => {
    resultConfig.resources[resourceType] = {
      searchParameters: getSearchParameterDescriptions(resourceType),
      columnDescriptions: getColumnDescriptions(resourceType)
    };
  });

  // Some times we need additional value sets that no search parameters refers to.
  // For example,
  // We need value set for "Patient.telecom.use"
  // for displaying Patient phone/email in HTML table.
  // To get it, we should specify this path in option "additionalExpressions"
  // see "source/js/search-parameters/definitions/webpack-options.json"
  //
  // Find value sets for additional expressions:
  additionalExpressions.forEach((expression) => {
    getTypeDescriptionByPath(resultConfig, expression);
  });

  return resultConfig;
}

function buildDefinitionsIndex(index, options, contextPath) {
  index.configByVersionName = Object.values(
    index.versionNameByVersionNumberRegex
  ).reduce((acc, versionName) => {
    const { resourceTypes, additionalExpressions } = options[versionName];
    if (!acc[versionName]) {
      acc[versionName] = getSearchParametersConfig(
        contextPath + '/' + versionName,
        resourceTypes,
        additionalExpressions
      );
    }
    return acc;
  }, {});

  return index;
}

function loader(source) {
  const index = JSON.parse(source);
  const options =
    (typeof this.getOptions === 'function' ? this.getOptions() : this.query) ||
    {};
  return JSON.stringify(buildDefinitionsIndex(index, options, this.context));
}

module.exports = loader;
module.exports.buildDefinitionsIndex = buildDefinitionsIndex;
module.exports.getSearchParametersConfig = getSearchParametersConfig;
