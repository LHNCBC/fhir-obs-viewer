/**
 * This file exports utility functions meant for common use
 * Please add future utility methods here (as top-level exports)
 */

import fhirpath from 'fhirpath';
import { sortBy } from 'lodash-es';
import { AutocompleteOption } from '../types/autocompleteOption';
import escapeStringForRegExp from './utils/escapeStringForRegExp.js';
export { escapeStringForRegExp };

// Import highlight.js and register only those languages that we need
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
hljs.registerLanguage('json', json);

/**
 * Returns syntax-highlighted HTML to display JSON string.
 * @param json - JSON string
 * @returns highlighted HTML string
 */
export function highlightJsonHtml(json: string): string {
  return hljs.highlight(json, {language: 'json'}).value;
}

/**
 * Capitalize the first char and return the string
 */
export function capitalize(str: string): string {
  return str && str.charAt(0).toUpperCase() + str.substring(1);
}


/**
 * Escapes special HTML characters in a string to prevent XSS attacks.
 * Replaces &, <, >, ", and ' with their corresponding HTML entities.
 *
 * @param str - The input string to escape.
 * @returns The escaped string safe for HTML insertion.
 */
export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Escapes a FHIR search parameter string
 * (see https://www.hl7.org/fhir/search.html#escaping)
 */
export function escapeFhirSearchParameter(str: string): string {
  return str.replace(/[$,|\\]/g, '\\$&');
}

/**
 * Escapes a FHIR search parameter string then encode it with encodeURIComponent
 * (see https://www.hl7.org/fhir/search.html#escaping)
 */
export function encodeFhirSearchParameter(str): string {
  return encodeURIComponent(escapeFhirSearchParameter(str));
}


/**
 * Converts a CSV string to an array of arrays of cell values, if possible,
 * Otherwise returns null.
 * The idea of code borrowed from https://gist.github.com/Jezternz/c8e9fafc2c114e079829974e3764db75
 */
export function csvStringToArray(csvString: string): string[][] | null {
  const re = /(,|\r?\n|\r|^)(?:"([^"]*(?:""[^"]*)*)"|([^,\r\n]*))/gi;
  const result = [[]];
  let lastIndex = 0;
  let matches: RegExpExecArray | null;
  while ((matches = re.exec(csvString))) {
    if (matches[1].length && matches[1] !== ',') {
      result.push([]);
    }
    result[result.length - 1].push(
      matches[2] !== undefined ? matches[2].replace(/""/g, '"') : matches[3]
    );
    lastIndex = re.lastIndex;
  }
  // Remove the last row if it's empty (happens when the CSV string ends with a newline character)
  if (result[result.length - 1].length === 0 ||
    result[result.length - 1].length === 1 && result[result.length - 1][0] === '') {
    result.pop();
  }
  return lastIndex === csvString.length ? result : null;
}

/**
 * Prepares a string for searching together with word synonyms.
 * example: 'AB' => 'AB,ANTIBODY,ANTIBODIES'.
 * example: 'AB TITR' => 'AB TITR,ANTIBODY TITR,ANTIBODIES TITR'.
 */
export function modifyStringForSynonyms(
  wordSynonyms: object,
  str: string
): string {
  if (!str) {
    return str;
  }
  return str
    .toUpperCase()
    .split(' ')
    .map((x) => wordSynonyms[x] || [x])
    .reduce(
      (prev: string[], curr: string[]) => {
        return [].concat(
          ...prev.map((x) => curr.map((y) => (x ? `${x} ${y}` : y)))
        );
      },
      ['']
    )
    .join(',');
}

/**
 * Generates a lookup object from synonyms json array, for faster retrieval.
 */
export function generateSynonymLookup(synonyms: string[][]): object {
  const lookup = {};
  synonyms.forEach((x) => {
    x.forEach((y) => {
      lookup[y] = x;
    });
  });
  return lookup;
}

const focusableSelector = [
  '*[tabIndex]:not([tabIndex="-1"])',
  'a[href]:not([disabled])',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input[type="date"]:not([disabled])',
  'input[type="text"]:not([disabled])',
  'input:not([type]):not([disabled])',
  'input[type="radio"]:not([disabled])',
  'input[type="checkbox"]:not([disabled])',
  'select:not([disabled])'
].join(',');

/**
 * Returns true if HTML element is visible.
 */
function isVisible(element: HTMLElement): boolean {
  return window.getComputedStyle(element).display !== 'none';
}

/**
 * Returns focusable children of HTML element.
 */
export function getFocusableChildren(element: HTMLElement): HTMLElement[] {
  return [].slice
    .call(element.querySelectorAll(focusableSelector))
    .filter((child) => isVisible(child));
}

/**
 * Returns the value of the specified parameter from the current URL
 * @param name - parameter name
 */
export function getUrlParam(name): string {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

/**
 * Returns a new URL from originalUrl, adding a new parameter or
 * updating an existing one.
 * Will use window.location.href if originalUrl is omitted.
 * @param name - parameter name
 * @param value - parameter value
 * @param originalUrl old URL string
 */
export function setUrlParam(name, value, originalUrl = ''): string {
  const url = new URL(originalUrl || window.location.href);
  url.searchParams.set(name, value);
  return url.toString();
}

/**
 * Returns a new URL from originalUrl, removing a parameter.
 * Will use window.location.href if originalUrl is omitted.
 * @param name - parameter name
 * @param originalUrl old URL string
 */
export function removeUrlParam(name, originalUrl = ''): string {
  const url = new URL(originalUrl || window.location.href);
  url.searchParams.delete(name);
  return url.toString();
}

/**
 * Returns plural form of resource type name.
 */
export function getPluralFormOfResourceType(resourceType: string): string {
  return resourceType.replace(/(.*)(.)/, (_, $1, $2) => {
    if ($2 === 'y') {
      return $1 + 'ies';
    }
    return _ + 's';
  });
}

// Map a resource type to a user-friendly record name
const resourceType2RecordName = {
  ResearchStudy: 'Study',
  Observation: 'Variable'
};
/**
 * Returns record name (user friendly name for resource type).
 * @param resourceType - resource type
 */
export function getRecordName(resourceType: string): string {
  return resourceType2RecordName[resourceType] || resourceType;
}

/**
 * Returns plural form of record name (user-friendly name for resource type).
 */
export function getPluralFormOfRecordName(resourceType: string): string {
  return getPluralFormOfResourceType(getRecordName(resourceType));
}

export const UCUM_CODE_SYSTEM = 'http://unitsofmeasure.org';

/**
 * Returns list of commensurable units for autocomplete-lhc.
 * @param unitCode - unit code
 * @param unitSystem - unit system
 */
export function getCommensurableUnitOptions(unitCode: string, unitSystem: string)
  : AutocompleteOption[] {
  let isFromList = false;
  const unitList = getCommensurableUnitList(unitCode, unitSystem)
    .map((i) => {
      if (i.csCode_ === unitCode) {
        isFromList = true;
      }
      return {
        name: i.name_ || i.csCode_,
        value: (isFromList && !unitSystem ? '' : UCUM_CODE_SYSTEM + '|') + escapeFhirSearchParameter(i.csCode_)
      };
    });

  return isFromList ? sortBy(unitList, 'name') : []
}

/**
 * Returns list of commensurable units from UCUM library.
 * @param unitCode - unit code
 * @param unitSystem - unit system
 * @return {any[]}
 */
export function getCommensurableUnitList(unitCode: string, unitSystem: string)
  : any[] {
  return !unitSystem || unitSystem === UCUM_CODE_SYSTEM
    ? (fhirpath as any).ucumUtils
      .commensurablesList(unitCode)[0]
      // TODO: Filter units by category in the UCUM library
      ?.filter(i=>i.category_ === 'Clinical') || []
    : [];
}

/**
 * Dispatches a window resize event.
 * Dispatching a resize event fixes the issue with <cdk-virtual-scroll-viewport>
 * displaying an empty table when the active tab is changed.
 * This event runs _changeListener in ViewportRuler which run checkViewportSize
 * in CdkVirtualScrollViewport.
 * See code for details:
 * https://github.com/angular/components/blob/12.2.3/src/cdk/scrolling/viewport-ruler.ts#L55
 * https://github.com/angular/components/blob/12.2.3/src/cdk/scrolling/virtual-scroll-viewport.ts#L184
 */
export function dispatchWindowResize(): void {
  if (typeof Event === 'function') {
    // fire resize event for modern browsers
    window.dispatchEvent(new Event('resize'));
  } else {
    // for IE and other old browsers
    // causes deprecation warning on modern browsers
    const evt = window.document.createEvent('UIEvents');
    // @ts-ignore
    evt.initUIEvent('resize', true, false, window, 0);
    window.dispatchEvent(evt);
  }
}

/**
 * Computes the cartesian product of an array of string arrays.
 * Each result is an array containing one element from each input array.
 *
 * @param {string[][]} arrays - An array of string arrays to combine.
 * @returns {string[][]} The cartesian product as an array of arrays.
 *
 * @example
 * cartesian([['&a=1', '&a=2'], ['&b=1', '&b=2']]);
 * // Returns: [['&a=1', '&b=1'], ['&a=1', '&b=2'], ['&a=2', '&b=1'], ['&a=2', '&b=2']]
 */
export function cartesian(arrays: string[][]): string[][] {
  return arrays.reduce(
    (acc, curr) =>
      acc.flatMap(a => curr.map(b => [...a, b])),
    [[]] as string[][]
  );
}
