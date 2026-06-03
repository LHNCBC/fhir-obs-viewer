# Change Log

This log documents the significant changes for each release.
This project follows [Semantic Versioning](http://semver.org/).

## [7.9.5] - 2026-06-02
### Changed
- Replaced TSLint with Angular ESLint, added linting to the full `npm test`
  workflow, and updated Cypress test plugin configuration for ES module imports.
- Renamed the Angular spec TypeScript config to `src/tsconfig.json` and updated
  the unit-test target to use it.
- Removed unused imports and test helpers surfaced by the new lint rules.

### Fixed
- Cohort searches now skip resources without Patient IDs before Patient lookups
  and criteria checks, avoiding malformed Patient and subject queries.

## [7.9.4] - 2026-05-18
### Fixed
- Autoconfig-generated server descriptions now cap `maxHasAllowed` at 1 to
  avoid expensive queries that combine multiple `_has` parameters with
  `_summary` against HAPI servers.

## [7.9.3] - 2026-05-01
### Fixed
- Fixed the incorrect input field size for autocomplete when the list of
  available search parameters contains only one value.
- Fixed the incorrect positioning of the "connect with SMART on FHIR" checkbox.
- Excluded resource types without visible search parameters from the cohort
  criteria.

## [7.9.2] - 2026-04-10
### Changed
- Autoconfig `init` now writes the path to the generated definitions CSV file
  to the `customization.<server URL>.definitionsFile` parameter, instead of
  updating the global default definition file – which would otherwise be
  overridden by the `definitionsFile` parameter in `default_R4` and `default_R5`.
- Updated `settings-initial.json5` template comments to show server-specific
  `definitionsFile` configuration under `customization`.
- Node-side query logging now includes HTTP status codes for received
  responses, improving request diagnostics.

## [7.9.1] - 2026-04-03
### Changed
- Moved `src/assets/settings.json5` to `src/conf/settings.json5` and updated all
  code references accordingly.
- Autoconfig `init` now consistently writes generated and copied definitions CSV
  files into `output/csv/`, matching the expected folder layout.

## [7.9.0] - 2026-03-20
### Added
- Autoconfig build and test tooling:
  `npm run build-autoconfig`, `npm run test-autoconfig`, and `npm run autoconfig`.
- A standalone `autoconfig-build/` output that includes bundled CLI code plus
  runtime support files (`desc-default-R4.csv`, `desc-default-R5.csv`,
  `settings-initial.json5`, and `build-info.json`).
- Expanded autoconfig fixtures, offline harness scenarios, and unit tests for
  capability filtering, column filtering, and bundled/source path resolution.

### Changed
- `npm run build` now also builds the autoconfig bundle, and `npm test` now
  runs autoconfig tests before unit/e2e tests.
- Refactored autoconfig CSV/capability filtering helpers and documentation for
  bundled-runtime usage.
- Updated default CSV/XLSX definition artifacts used for generated
  configurations.

### Fixed
- Criteria query serialization for non-standard parameters now correctly handles
  values provided as `codes[]`.
- Pull Data code extraction now safely skips medication code collection when a
  medication resource type has no code search parameter in current definitions.
- dbGaP URL pattern handling now safely tolerates missing customization config.
- CSV parsing now trims trailing empty rows caused by terminal newlines.

## [7.8.1] - 2026-03-16
### Fixed
- An issue with the incorrect size of the added tab in the "Pull data" step.

## [7.8.0] - 2026-02-27
### Added
- A new `useCapabilityStatement` configuration option in `settings.json5` that,
  when enabled, uses the server's CapabilityStatement to filter resource types
  and search parameters. Resource types not listed in the CapabilityStatement are
  removed from definitions, and search parameters not supported by the server are
  filtered out. Filtered items are reported to the browser console as warnings.
  This is enabled by default but disabled for dbGaP servers which have a
  non-standard CapabilityStatement.

## [7.7.0] - 2026-01-15
### Added
- Summary information in the "View Cohort" step.

## [7.6.3] - 2026-01-14
### Changed
- Added the columns "Age" and "State" to the patient table.

## [7.6.2] - 2026-01-13
### Fixed
- Updated dependencies to address vulnerabilities.

## [7.6.1] - 2025-12-08
### Changed
- Updated Angular and Angular Material to version 20.

## [7.6.0] - 2025-11-21
### Added
- The ability to display and download raw FHIR resources in the Pull Data step.

## [7.5.0] - 2025-09-29
### Added
- New configuration options for `settings.json5`:
  - `defaultPullDataCount` for the default number of resources per patient to load
    in the Pull Data step.
  - `contextColumns.<context>.DomainResource` to specify context columns for all
    resource tables.
- "Text" column for all resources containing a text summary of the
  resource, for human interpretation (DomainResource.text.`div`).
- "Composition" resource (for R4 configuration).
### Changed
- Allowed bigger tooltips.
### Fixed
- An issue with the unexpected "Unknown unit" in the criteria.
- An issue with incorrect data loading percentage in the pull data step when
  using combined search parameters.
- An issue with autocompletion of search parameters of the "code" data type,
  which should not have a coding system.

## [7.4.0] - 2025-08-26
### Added
- a new configuration options for `settings.json5` to limit maximum page size
  (the maximum value of the "_count" parameter).
### Changed
- Removed temporary solution for the issue with "Observation?_count=1" on dbGap
  servers.

## [7.3.0] - 2025-08-25
### Added
- Updated fhirpath to version 4.5.1, which includes support for the resolve()
  function.
- Support for Reference data type search parameters and combined search
  parameters such as autocomplete "medication name" which actually uses two
  search parameters "code" and "medication". Currently, supported for R4 servers.
### Changed
- Add use of empty code system for "code:not" search parameter for autocomplete
  component when the code system is not specified in the previously found
  resources. Previously, we did not specify the code system, which could lead to
  the exclusion of records that have the same code but a different system.
- Hid some duplicate search parameters (in the default configuration for R4
  servers) that can be used indirectly. For example, we have search parameters
  "variable name" and "variable value", but we don't need to display to the user
  all the variety of parameters code-value-*, combo-code-value-*, etc.

## [7.2.1] - 2025-08-20
### Changed
- The drop-down list of available servers has been moved to the configuration
  file to avoid rebuilding the project to change it.
### Fixed
- Caching of initialization requests to take into account the ScrubberID
  value.
- Updating settings.json5 when building the app, it no longer removes references
  to CSV files from the settings section for URLs that are not in XLSX files.
  This is useful for adding configurations for proxy servers that have the same
  settings as existing configurations.
- Reinitialization of the connection to the FHIR server when ScrubberID changes
  to ensure that it works.

## [7.2.0] - 2025-05-07
### Added
- Three new configuration options for `settings.json5`:
  * `customization.<server URL>.scrubber` - can be set to `true` to enable
    integration with a scrubber server, which includes the scrubberID selection
    dialog, storing `scrubberID` in a cohort and criteria file to correctly
    loading that file, and using the "Scrubber-Id" header in requests to the
    specified FHIR server.
  * `default.allowChangeServer` - specifies whether the user is allowed
     to change the FHIR server URL.
  * `default.defaultServer` - the default FHIR server URL is initially displayed
    when the application is first used (previously it was hardcoded).

## [7.1.0] - 2025-03-12
### Added
- Support for R5 CodeableReference values in tables.
- Support for filtering MedicationDispense and MedicationRequest resources by
  code in the Pull data step.
### Fixed
- Autocomplete for the "code" search parameter for MedicationDispense and
  MedicationRequest resources for R5 servers.
- Autocomplete for the code search parameters to use the "system"
  along with the "code" in the "code:not" query parameters.
- For autocomplete items of the code search parameters with the same display and
  different code + code system combination, append code + code system to the
  display so distinct items are shown to the user.

## [7.0.5] - 2025-01-23
### Fixed
- An issue with skipping clicks on variables while list is loading.

## [7.0.4] - 2024-12-05
### Fixed
- Improved stability of e2e tests.
- Fixed escaping of FHIR search parameter strings: added backslash escaping.

## [7.0.3] - 2024-11-06
### Fixed
- Checking for an issue with the "not" modifier during initialization might not
  work correctly. The problem appears when a patient for the very first
  Observation in the list only has Observations with the same single code.
- Updating the selected observation codes and data type when changing a variable
  name was performed for all variable values in the advanced criteria, even if
  they were not connected. This resulted in incorrect display of units of
  measurement for variable values.

## [7.0.2] - 2024-10-23
### Changed
- Updated Angular Material to version 17.

## [7.0.1] - 2024-09-09
### Fixed
- An issue where part of a table was not visible when scrolling after it was
  expanded to full screen.
- Removed deprecated RouterTestingModule.
- Replaced legacy Angular Material components.

## [7.0.0] - 2024-07-11
### Added
- Passing a unit system when filtering by observation values. Previously saved
  criteria work as they worked before (but the issue of not being able to pass
  the unit system for an observation value persists because they do not contain
  units of measurement).

## [6.17.9] - 2024-06-27
### Fixed
- Exception when selecting variable values in the cart using autocomplete.

## [6.17.8] - 2024-05-06
### Fixed
- An issue with updating the current value of autocompleter when changing the
  search parameter name (without breaking the loading of saved criteria).
- Added loading possible search parameter values for value sets with the required
  binding strength from the FHIR server. This allows us to display only existing
  values and fixes the fallback used to load values from the server when we can't
  get them from spec definitions.

## [6.17.7] - 2024-04-29
### Changed
- Updated Angular to version 17.
- Updated Angular Material to version 16.
### Fixed
- Styles for autocomplete fields in the cart.

## [6.17.6] - 2024-04-24
### Changed
- Update autocomplete-lhc version and disable its progress bar.

## [6.17.5] - 2024-04-16
### Changed
- Updated Cypress to version 13.

## [6.17.4] - 2024-04-15
### Added
- An input field to set "max recent Observations per Patient to check" for
  EvidenceVariables.
- "Id", "Status", "Publisher", and "Patient Id" columns to the EvidenceVariable
  table.
- The option to show only unique EvidenceVariables.
### Fixed
- Removing a resource type tab in the pull data step did not stop the loading
  process on this tab or clear the already loaded data.
- Removed duplicate requests for EvidenceVariable.

## [6.17.3] - 2024-04-11
### Fixed
- loadSharedNavLinks.js link from lforms-app.

## [6.17.2] - 2024-03-29
### Changed
- Use shared navigation links from lforms-app.

## [6.17.1] - 2024-03-01
### Fixed
- Issues with tooltips, reading column headers and filter dialogs by a screen
  reader. Also, for sighted users, a column description will be displayed when
  they hover over the info button, and for screen reader users it will be read
  when they click on the button.
- Removed a separate column without a heading for the "Add record to cart" button.

## [6.17.0] - 2024-02-20
### Changed
- Changed the initialization spinner to a non-blocking one.

## [6.16.2] - 2024-02-02
### Changed
- Made buttons and menus more obvious.

## [6.16.1] - 2024-02-02
### Changed
- Added showing number of people in studies for R5 servers
  (ResearchStudy.recruitment.actualNumber).

## [6.16.0] - 2024-01-26
### Changed
- Support for rdf-server 1.0.0, which is ready for application-based stickiness
  for AWS load balancer.

## [6.15.9] - 2024-01-25
### Fixed
- Issue of missing logout button and checkbox after SMART on FHIR login.

## [6.15.8] - 2024-01-24
### Fixed
- Observation.interpretation should be searchable if available on server.

## [6.15.7] - 2024-01-24
### Fixed
- Align search parameter name fields in query builder.

## [6.15.6] - 2024-01-08
### Changed
- Added baseR5 server to the list and made it default.

## [6.15.5] - 2024-01-04
### Changed
- When a query fails, limit the retry count to 3 instead of retrying for 90
  seconds.

## [6.15.4] - 2024-01-04
### Fixed
- Combined requests for patients with the "_id" parameter to reduce the number
  of requests.
- Bug in the search for patients when nested ORed criteria produce requests for
  different resource types therefore in the output stream, we may have different
  resource types.

## [6.15.3] - 2023-12-19
### Fixed
- Improved performance of loading variables from Observations.

## [6.15.2] - 2023-12-18
### Fixed
- Disable next step header if RAS not logged in.

## [6.15.1] - 2023-12-15
### Fixed
- Updated limit on the number of _has parameters per request for known servers.

## [6.15.0] - 2023-12-07
### Added
- The alpha version became the current version, current version became the
  previous version.

## [6.14.3] - 2023-12-07
### Fixed
- Infinite loop when loading variables in the "Select records" step if the
  server returns observations without codes.

## [6.14.2] - 2023-12-07
### Changed
- Inform user if the search patient or pull data request failed.

## [6.14.1] - 2023-11-17
### Fixed
- Navigate to alpha version after Immport OAuth2 login.

## [6.14.0] - 2023-11-16
### Added
- Ability to login to Immport server through OAuth2.

## [6.13.6] - 2023-11-16
### Changed
- When user types in the Observation Name autocomplete search input field,
  wait 200ms before sending out the query, so that previous queries are not
  sent if user keeps typing.

## [6.13.5] - 2023-11-13
### Fixed
- After logging in through RAS, a new TST token is received but the
  subsequent queries are not sent with the new token.

## [6.13.4] - 2023-10-24
### Fixed
- Issue of focus left behind the dialog after the dialog of "session expired"
  or "disable batch" opens.

## [6.13.2] - 2023-11-09
### Fixed
- Names of search parameter value fields.
- Target javascript version: es2017 -> es2015.

## [6.13.1] - 2023-11-09
### Fixed
- An issue where the search parameter value was updated with the value of the
  previous control when the search parameter name was changed to a search
  parameter of a different data type.
- Improved search performance when using ResearchStudy criteria.
- Improved search performance when using criteria that can be converted to the
  _has search parameter for the Patient resource.

## [6.13.0] - 2023-11-03
### Added
- Bypass initialization queries when there is a setting for the result.

## [6.12.5] - 2023-11-03
### Changed
- Show "browse public data" option only if it's useful.
- Remove Immport dev server from list.

## [6.12.4] - 2023-10-25
### Fixed
- Sorting CTSS variables did not work.
- The selected studies were not considered in the patient search when variables
  were selected.

## [6.12.3] - 2023-10-24
### Fixed
- Go to "Additional Criteria" tab and show errors, if user search for patients
  from another tab while "Additional Criteria" tab has validation errors.

## [6.12.2] - 2023-10-23
### Fixed
- Tooltip for the "add to cart" button blocks next row button.

## [6.12.1] - 2023-10-13
### Added
- Handle RAS error in RDF callback.

## [6.12.0] - 2023-10-13
### Added
- OAuth2 support.

## [6.11.0] - 2023-09-11
### Added
- Using the "advanced search" UI for additional criteria.
### Fixed
- A bug in the search algorithm when ANDed criteria are ORed in the parent node.
- Issues with saving and loading a cohort and criteria.

## [6.10.0] - 2023-09-11
### Added
- Special case of sorting only the newly loaded items of the list of variables
  obtained from observations.

## [6.9.3] - 2023-09-11
### Fixed
- After selecting variables with the same display name but different codes or
  systems in the pull data step, we only saw one selected observation code item.

## [6.9.2] - 2023-09-05
### Fixed
- "No records were found" message for empty tables not in "browse
  public data" mode.

## [6.9.1] - 2023-09-05
### Fixed
- CSP issue when a https server returns next links with http.

## [6.9.0] - 2023-08-31
### Added
- Next page preloading for resource tables and using it to load variables
  from observations.

## [6.8.0] - 2023-08-31
### Added
- Use CTSS for Observation code lookup in the pull data step.

## [6.7.1] - 2023-08-31
### Fixed
- Issue with incomplete data loading in the pull data step when checking 10000
  observations for each of 1000 patients in a cohort by removing the
  XMLHttpRequest timeout and disabling response caching for requests in the pull
  data step.

## [6.7.0] - 2023-08-30
### Added
- Support for basic authentication.

## [6.6.3] - 2023-08-23
### Fixed
- Server version detection: 4.0.0 is now defined as R4.

## [6.6.2] - 2023-08-21
### Added
- Download button on all tables.

## [6.6.1] - 2023-08-09
### Fixed
- Preserve Advanced Settings after RAS login.

## [6.6.0] - 2023-08-03
### Added
- Option to convert Observation table into Variable-Patient table
  in pull data step.

## [6.5.3] - 2023-08-01
### Added
- Display failed requests message in Pull Data tables.

## [6.5.2] - 2023-07-31
### Added
- Request priority management.
### Fixed
- Loading data in the pull data step blocked other requests and made it
  impossible to create a new cohort.

## [6.5.1] - 2023-07-31
### Fixed
- Display of incorrect amount of studies in the select records step.

## [6.5.0] - 2023-07-28
### Added
- R5 support.
### Fixed
- Issue with empty list of variables in the select records step for an R4 server
  with ResearchStudies.
- Replaced `subject:Patient=<id1>,<id2>` with `subject=Patient/<id1>,Patient/<id2>`
  because baseR5 doesn't support it.

## [6.4.2] - 2023-07-28
### Added
- Resend requests separately and notify the user of problems if a batch request
  fails.

## [6.4.1] - 2023-07-21
### Fixed
- Show the list of Observation variables with the same name
  in define cohort step.

## [6.4.0] - 2023-07-20
### Added
- "Browse public data" option for other FHIR servers

## [6.3.7] - 2023-07-20
### Fixed
- Issue with incorrect caching of loaded studies

## [6.3.6] - 2023-07-19
### Fixed
- Do not show session expired message on "browse public data".

## [6.3.5] - 2023-07-06
### Fixed
- Replaced use of ":not=zzz" in autocomplete with ":missing=false" if supported.

## [6.3.4] - 2023-06-23
### Fixed
- Do not cache failed requests that have status 401 or 403.

## [6.3.3] - 2023-06-14
### Changed
- Renamed "Code" column to "Variable Name" in Observation table.
### Added
- A new "Code" column to display raw code in Observation table.

## [6.3.2] - 2023-06-13
### Fixed
- Do not retry GET requests aborted by the server.

## [6.3.1] - 2023-06-12
### Added
- Showing the total number of variables from CTSS.

## [6.3.0] - 2023-06-12
### Added
- Save/load/restore cohort with cart data.
### Changed
- On dbGaP 4xx errors, direct user to re-login and restore the
  step and data afterwards.

## [6.2.14] - 2023-05-31
### Fixed
- Make initialization requests only when necessary. Remove unnecessary
  requests before login.

## [6.2.13] - 2023-05-23
### Fixed
- Handled cases when a server returns less than the expected number of results.

## [6.2.12] - 2023-05-23
### Changed
- Match Observation table Code column to selected Observation codes,
  if any, in "pull data" step.

## [6.2.11] - 2023-05-18
### Added
- Error handling for dbGaP 4xx and 5xx responses.

## [6.2.10] - 2023-05-05
### Changed
- Split column of values into columns of values and units in export.

## [6.2.9] - 2023-05-05
### Added
- Added study name to the variables table for non-dbGaP servers.

## [6.2.8] - 2023-05-05
### Fixed
- Limited variables list to user's studies for dbGap servers.

## [6.2.7] - 2022-05-05
### Changed
- Made the alpha version the default for the dbGap server.

## [6.2.6] - 2022-05-05
### Fixed
- when a SMART on FHIR connection was used, batch processing and query caching
  didn't work, and initialization requests were issued without authorization.
- when there are ResearchStudies but no ResearchSubjects, we should not display
  the study tab and should not use queries for ResearchSubjects

## [6.2.5] - 2023-05-05
### Fixed
- Filter observation codes by search text, while taking into account synonyms.

## [6.2.4] - 2023-05-03
### Changed
- Show proper error message for unsupported FHIR version.

## [6.2.3] - 2023-05-02
### Added
- Ability to add the other end of the range in a second line for Observation
  variable constraints, if the selected comparator in the first line is '>',
  '>=', '<' or '<='.

## [6.2.2] - 2023-04-26
### Changed
- The list for selecting codes in the "pull data for cohort" step is limited to
  those codes that exist for the patient cohort.

## [6.2.1] - 2023-04-25
### Changed
- Filter certain columns by a prefix in dbGaP Variables table.

## [6.2.0] - 2023-04-24
### Added
- Ability to create a cohort of patients by browsing and selecting records
  for non-dbGap FHIR servers.
- Variables tab for non-dbGap FHIR servers.
### Changed
- Cart UI changes:
  - Replaced the checkboxes with small "move to cart" buttons.
  - Moved the cart part of the page above the list of studies/variables
    and hid it until there is something in the cart.
  - Revised row range selection.
  - Moved the download button to the table header.
### Fixed
- An issue where the switching between FHIR servers was not followed by clearing
  loaded data.
- An issue where the switching to the "View cohort" step was allowed without
  searching for patients.
- An exception when trying to pull data for an empty patient cohort.

## [6.1.4] - 2023-04-05
### Changed
- Show message inside table when no record matches filter.

## [6.1.3] - 2023-03-28
### Fixed
- Close the server select list after selection.

## [6.1.2] - 2023-03-28
### Fixed
- Issue with browser back button after RAS login.

## [6.1.1] - 2023-03-08
### Changed
- Updated to Node.js 18.

## [6.1.0] - 2023-02-23
### Changed
- Hid an unnecessary option to view the full list of research studies from
  the select records step.
- Added aborting of HTTP requests if we no longer need a response to them.

## [6.0.10] - 2023-02-13
### Added
- An input field for the maximum number of recent Observations per Patient
  to check when no code is specified in the criteria.

## [6.0.9] - 2023-02-06
### Changed
- Temporarily disabled the use of the _security URL parameter.

## [6.0.8] - 2023-02-02
### Changed
- Enabled use of RAS for dbGap by default.

## [6.0.7] - 2023-01-26
### Changed
- Temporarily enable RAS with a URL parameter until RAS goes live.

## [6.0.6] - 2023-01-12
### Changed
- Added a column with the LOINC short name to the table of variables.
### Fixed
- Added search for synonyms when searching for variables by display name.
- Removed access to the FHIR server from unit tests.

## [6.0.5] - 2023-01-09
### Fixed
- Editing the "server" URL parameter did not result in a logout from RAS.

## [6.0.4] - 2022-12-21
### Changed
- Replaced calls to LiveAnnouncer with calls to Def.ScreenReaderLog from
  autocomplete-lhc.
### Fixed
- Issues with initialization spinner:
  - there were no announcements for the screen reader,
  - didn't block keyboard input.

## [6.0.3] - 2022-12-20
### Fixed
- Duplication of Observations when pulling data for a cohort.

## [6.0.2] - 2022-12-07
### Changed
- Updated website header and footer and logo.
### Fixed
- Removed downloading the full CapabilityStatement with /metadata.

## [6.0.1] - 2022-11-22
### Changed
- Removed the manual show of study 2410.

## [6.0.0] - 2022-11-17
### Changed
- Upgrade Angular to Version 14. Removed support for IE11.

## [5.2.1] - 2022-11-16
### Added
- Integration with dbGaP power user portal to allow user to login/logout.
### Fixed
- Do not cache responses to aborted requests.
- Caching of requests which check whether SMART on FHIR connection is available.
- A bug due to which the stepper could not progress past the first step after
  logout from SMART on FHIR without changing the server URL.

## [5.2.0] - 2022-11-15
### Changed
- Removed Patient.deceased from dbGaP fields.

## [5.1.5] - 2022-11-14
### Fixed
- Narrator read "The field's value does not match any items in the list." when
  the page loads.

## [5.1.4] - 2022-10-31
### Changed
- Added caching of response to a query for the full list of ResearchStudies.

## [5.1.3] - 2022-10-28
### Changed
- Added caching of responses to initialization requests when selecting the FHIR
  server.

## [5.1.2] - 2022-10-27
### Added
- Option to launch a SMART on FHIR connection.

## [5.1.1] - 2022-10-14
### Added
- Search for patients by records in the cart.
- Using the UCUM data from fhirpath.js to display a list of eligible units for
  variables of type Quantity.
### Fixed
- Incorrect stepper state after selecting an action and switching to another
  dbGap server.
- Bug that could cause the patient search to end unexpectedly without any
  notification.
- Optimized patient search by combining ORed code criteria for Observation and
  eliminating unnecessary queries for ANDed criteria.

## [5.1.0] - 2022-10-13
### Added
- Basic RAS flow without actually talking to dbGaP login portal.

## [5.0.17] - 2022-09-30
### Changed
Columns in the table of variables:
- Added a column with the LOINC long common name to the table of variables.
- Renamed column "Variable Name" to "Variable Display Text" in the table of
  variables.

## [5.0.16] - 2022-09-29
### Fixed
- Loss of focus on resource table header cell when sorting table.

## [5.0.15] - 2022-09-29
### Changed
- Added server-side study filtering for the title column of the ResearchStudy table.

## [5.0.14] - 2022-09-29
### Fixed
- No variables after selecting studies.
- Adding studies to the cart affected the list of studies when browsing public
  data.

## [5.0.13] - 2022-09-28
### Added
- Option to limit the ResearchStudy resources to ones the user can access.
### Fixed
- The validation status of the Query Builder component was not updated when
  its configuration was changed. Therefore, the search for patients could not be
  started without changing the criteria.

## [5.0.12] - 2022-09-27
### Added
- Button to download the Research Study or Variable tables into .csv
  files.

## [5.0.11] - 2022-09-12
### Added
- Grouping/ungrouping variables in the cart.
### Fixed
- Pressing the Tab key on the keyboard while the resource table filter button
  had focus was ignored.

## [5.0.10] - 2022-09-01
### Added
- Constraints for variables in the cart.
- Names of studies and datasets to the table of variables.
- A component for displaying text that can be truncated.
- Loading variables when scrolling the table.

### Fixed
- Unnecessary too fast loading of studies in an inactive tab after a 2-minute pause.
- Writing a value to AutocompleteParameterValueComponent.

## [5.0.9] - 2022-08-31
### Added
- Options to variables tab for CTSS API.
### Fixed
- Updating the position of the sticky table header when changing the content of
  the header.

## [5.0.8] - 2022-08-30
### Changed
- Replace mat-autocomplete with autocomplete-lhc controls.
- Match list value on search parameter value autocomplete controls.

## [5.0.7] - 2022-08-29
### Added
- The ability to select multiple rows in a table with a mouse click
  while holding down the Shift key.

## [5.0.6] - 2022-08-26
### Added
- The ability to deselect all selected records.

## [5.0.5] - 2022-08-25
### Added
- Sorting to the variable table (for the alpha version).

## [5.0.4] - 2022-08-25
### Added
- Simple prototype of the component for records in cart for the alpha version.
- The ability to switch to the alpha version using the menu on the version
  number link.
### Fixed
- Incorrect query parameter _type replaced with _format.

## [5.0.3] - 2022-08-24
### Changed
- Removed prev folder.

## [5.0.2] - 2022-07-26
### Fixed
- Do not sort the column when user clicks on header info icon.

## [5.0.1] - 2022-07-22
### Changed
- Use url pattern https://dbgap-api.ncbi.nlm.nih.gov/fhir* for dbGap.

## [5.0.0] - 2022-06-21
### Added
- Alpha version of creating a cohort of patients by browsing and selecting records.

## [4.5.7] - 2022-06-17
### Fixed
- Update criteria data from an old cohort to match current format.
### Added
- Add version number to downloaded cohort.

## [4.5.6] - 2022-06-09
### Fixed
- Use comparators for "string" type search parameters.

## [4.5.5] - 2022-06-01
### Fixed
- Show "display | code | system" for Observation codes that have duplicate display.
- In Observation codes query, include code system.
- Filter out Observation codings with no code in autocomplete.
- Display code if a coding has code but no display.

## [4.5.4] - 2022-05-25
### Fixed
- If user selects Observation "Variable Value" search parameter without
  "Variable Name", show the complete list of numeric and string comparators.

## [4.5.3] - 2022-05-18
### Fixed
- Reinitialize autocomplete field for "variable value" when "variable name"
  changes.
- Incorrect query in some cases:
  * when multiple values are specified in the "variable name" field, and there
    is a "variable value" field.
  * when multiple values are specified in the autocomplete field for
    "variable value".
- Simplified code of resource table component and components that use it.

## [4.5.2] - 2022-05-10
### Fixed
- valueString Observations are not handled.

## [4.5.1] - 2022-05-09
### Fixed
- Fixed exception "expression has changed after it was checked"
  (https://angular.io/errors/NG0100).
- Simplified component code by moving code from components to services.
- Disabled "Save the cohort and criteria for later" button when loading
  a cohort of Patients.

## [4.5.0] - 2022-04-28
### Added
- % complete based on the number of requests processed.
- the ability to set default values for "Requests per batch" and
  "Maximum active requests" in settings.json5 per server and set the default
  value for dbGap to 50.

## [4.4.1] - 2022-04-22
### Fixed
- When requesting Observations, replaced the use of two separate parameters
  "combo-code" and "combo-value-quantity" with a single parameter
  "combo-code-value-quantity".

## [4.4.0] - 2022-04-14
### Added
- Default filter for the "Pull data for the cohort" step.
### Fixed
- Removed duplicate observation codes from requests. Duplication occurs when
  different autocomplete items in the observation lookup component have the
  same codes.

## [4.3.3] - 2022-04-11
### Fixed
- Fixed a bug in the webpack loader that caused the application to build on
  Windows incorrectly.

## [4.3.2] - 2022-04-01
### Changed
- Hide resource table columns without data after loading data.
### Fixed
- The use of a number range filter for the Count column type of
  the ResearchStudy table has been restored.
- Replaced incorrect "dateTime" data type for search parameters with "date"
  to use the correct controls.
- Replaced hyphens in search parameter names with spaces.

## [4.3.1] - 2022-03-31
### Changed
- Hide shared header/footer until page loads.

## [4.3.0] - 2022-03-25
### Added
- Evidence Variable search parameters in define cohort.
- Ability to pull Evidence Variable data for a cohort.

## [4.2.6] - 2022-03-11
### Changed
- get code list for DocumentReference.contenttype via autocomplete search.

## [4.2.5] - 2022-03-08
### Fixed
- Partial hiding of expanded filter lists for research study table.

## [4.2.4] - 2022-03-08
### Changed
- Load shared header and footer from CTSS.

## [4.2.3] - 2022-02-22
### Changed
- Show tooltip if the resource table cell text has been truncated.
- Removed the option to wrap text in resource table cells.

## [4.2.2] - 2022-02-16
### Fixed
- Sorted the dropdown list items for the filter fields in the resource table
  alphabetically.

## [4.2.1] - 2022-02-10
### Changed
- Reduced time to get the first page of research studies.

## [4.2.0] - 2021-02-09
### Changed
- Provided lists for valueCodeableConcept Observations.
### Fixed
- Enabled source map generation.

## [4.1.5] - 2022-02-03
### Changed
- "Keywords" and "Id" for the ResearchStudy table is hidden by default.
- Additional columns with numbers for ResearchStudy table are shown by default
  and renamed.
- Use acronym from Organization reference as a cell value in resource table.
  when available and when it matches the display text.
- Provided the option not to wrap the text in the field.
- Forced "Title" column wider than others for the ResearchStudy table.
- Columns are hidden when we know there is no data for them.

## [4.1.4] - 2022-02-01
### Changed
- Migrated some of the e2e tests to Cypress.

## [4.1.3] - 2022-01-28
### Changed
- Program to update the .xlsx configuration file and updated the .xlsx
  configuration file.

## [4.1.2] - 2022-01-19
### Fixed
- Missing spaces between words in autocomplete dropdown list.

## [4.1.1] - 2022-1-12
### Added
- Support for interpretation search parameter when applicable.

## [4.1.0] - 2021-12-20
### Changed
- Moved comparator, value, and unit to a separate search parameter.

## [4.0.4] - 2021-12-13
### Changed
- Show "Value" column in Observation table by default.

## [4.0.3] - 2021-12-08
### Changed
- Query Builder widget:
  - Add color to the AND/OR lines.
  - Radio buttons to switch between AND/OR operators.
  - Remove "OR" option for single-resource criteria.
  - Added AND/OR above connecting lines.
  - Hide AND/OR toggle when there is only one condition.

## [4.0.2] - 2021-12-6
### Added
- Program to store lists with non-required binding.
### Changed
- Observation.category search parameter in default server now uses a
  autocomplete-lhc Prefetch control with values updated by above program.

## [4.0.1] - 2021-12-2
### Changed
- Until authentication is in place for dbGaP, we include the consent
  groups as values for _security.

## [4.0.0] - 2021-11-30
### Added
- Query Builder: search criteria in Define Cohort step now can combine using
  Boolean operators.
### Fixed
- Detecting of the possibility of using the "age-at-event" sorting parameter.
### Changed
- Rename "resource type" to "record type".
- Text changes in define cohort page.

## [3.25.3] - 2021-11-19
### Changed
- Removed Observation.identifier from search parameters.

## [3.25.2] - 2021-11-19
### Changed
- Left match word boundaries when filtering resource type or search
  parameter.

## [3.25.1] - 2021-11-9
### Fixed
- Announce to the user that a new field has appeared after selecting a
  search parameter.

## [3.25.0] - 2021-11-3
### Added
- a "code text" search parameter for each of the resource types with a
  main "code" field.

## [3.24.0] - 2021-11-1
### Changed
- Turned search parameter value autocomplete prefetch into search, for
  lists whose binding is not required, e.g. Observation.category.
- Show example items when the empty control is focused.

## [3.23.0] - 2021-10-27
### Added
- Program to update the .xlsx configuration file for the 'show/hide' value
  (and row colors) of columns, based on the 'show/hide' values of matching
  search parameters.

## [3.22.2] - 2021-10-19
### Added
- Script for start-public task.

## [3.22.1] - 2021-10-19
### Fixed
- The wrong tab highlighted when the dbGaP server was selected.

## [3.22.0] - 2021-10-08
### Added
- Ability for user to use TAB key on a dropdown list to select an item and
  move to next form control.
- Cursor will be focused on the input control of the newly added line after
  user hits "add resource type" or "add search criterion" buttons.

## [3.21.0] - 2021-10-05
### Changed
- Simplified pull data step search criteria, keeping only observation code
  selection criterion.

## [3.20.0] - 2021-09-23
### Added
- A program to automatically determine whether search parameters have data
  on corresponding server and update the .xlsx configuration file for the
  'show/hide' column.

## [3.19.1] - 2021-09-20
### Changed
- Current tab of the stepper will stay highlighted.

## [3.19.0] - 2021-09-14
### Added
- Include word synonyms when querying server for autocompletion.

## [3.18.1] - 2021-09-10
### Fixed
- Adding a new resource tab in the Pull data for cohort step after or when
  loading Observations data threw exceptions that blocked further operation
  of the application.
- Issue with displaying an empty table when changing the active tab in
  the Pull data for cohort step.

## [3.18.0] - 2021-09-09
### Added
- Using XLSX file(s) to configure search parameters and resource table columns.
### Fixed
- Switching to the View Cohort step after loading criteria and cohort.

## [3.17.1] - 2021-09-08
### Changed
- Sort number columns by number in resource table.

## [3.17.0] - 2021-09-08
### Changed
- Updated to Angular version 12.

## [3.16.2] - 2021-09-07
### Changed
- UI updates to make resource table more readable.

## [3.16.1] - 2021-08-30
### Changed
- Preserve filter values when changing column selections, unless the column
  with filters is removed.
- Trigger table filtering after column change.

## [3.16.0] - 2021-08-17
### Added
- Ability to filter number columns by range.

## [3.15.0] - 2021-08-18
### Changed
- Only Research Studies user has access to can be selected.
- By default, all selectable Research Study rows are checked and displayed
  at the beginning of the table.
- Removed "Skip this step" radio button.
- Reduced number of columns shown by default in Research Study table.

## [3.14.3] - 2021-08-17
### Fixed
- Not all criteria were saved while saving cohort and criteria.
- Not all characters were escaped correctly when downloading a CSV file.
- Descriptions of not all criteria were correctly extracted from the specification.

## [3.14.2] - 2021-08-11
### Fixed
- Quantity units should not have units in single quotes.

## [3.14.1] - 2021-08-11
### Fixed
- Autocomplete-lhc dropdown styles.

## [3.14.0] - 2021-08-09
### Added
- Ability to filter column using autocomplete control with a list of
  possible column values to choose from.
### Changed
- Moved the filter into popup modals that you can open by clicking the
  filter icon on table headers.

## [3.13.0] - 2021-08-04
### Added
- Validation for criteria.
### Changed
- Disabled download button until the resource table data has been loaded.
### Fixed
- Slow evaluation of the contents of the resource table cells.

## [3.12.0] - 2021-07-29
### Changed
- Observation search parameter of type "Quantity" now uses the composite
  test value controls.

## [3.11.0] - 2021-07-28
### Added
- List of units for LOINC codes from CTSS.

## [3.10.1] - 2021-07-28
### Changed
- Added descriptions for search parameter names.
- Renamed "Test value prefix" and "Test value modifier" to "Comparator".
- The default comparator for the test value is "=".

## [3.10.0] - 2021-07-28
### Added
- Patient Id column to ResearchStudy table in the step of pulling data
  for cohort

## [3.9.0] - 2021-07-23
### Changed
- Search criteria in Define Cohort step now has categorized structure based
  on resource types.
- "Observation by Test" is now combined into "Observation" resource type
  as parameter name "code text".
- Removed the date fields in "code text" search parameter.

## [3.8.0] - 2021-07-23
### Changed
- Hide Research Study step if server has no Research Study data.

## [3.7.0] - 2021-07-23
### Changed
- Automatically fallback to single requests if batching is not supported.

## [3.6.1] - 2021-07-22
### Changed
- Show Patient id (dbGaP)
- Store visible table columns for each service base URL separately

## [3.6.0] - 2021-07-22
### Added
- Limit list of resources to what has data (dbGaP).
### Fixed
- It was possible to switch to the View cohort step without
  searching for Patients.

## [3.5.1] - 2021-07-22
### Fixed
- README.md

## [3.5.0] - 2021-07-12
### Added
- Functionality to save cohort data and criteria into file.
- Functionality to load cohort data and criteria from file.

## [3.4.1] - 2021-07-06
### Fixed
- Slowness to load Patients from a ResearchStudy.

## [3.4.0] - 2021-07-06
### Added
- When searching for observation codes, the system now tries to match code
  as well as text. A code will be returned if user input matches exactly the
  code, or part of the code text.

## [3.3.0] - 2021-07-06
### Added
- User can now pull data for Patient the same way as other resource types.

## [3.2.0] - 2021-07-02
### Changed
- After user enters a date range value, the application will use that as
  default value for later date range controls. Refreshing page will clear
  the default value.

## [3.1.2] - 2021-06-28
### Added
- User input to define number of resources per patient for all resource types
  in Pull Data step.

## [3.1.1] - 2021-06-24
### Changed
- When user searches for active patients, the application now tries to also
  return patients without the 'active' field defined.

## [3.1.0] - 2021-06-24
### Added
- Filtering of values in the ResearchStudy.condition column by preferred code
  system.
- Columns for research study content (dbGap only).
- Option to filter ResearchStudies if the user has access to their data.
### Fixed
- Detection of columns visible by default.
- Requests to the FHIR server without endpoint - they cannot be combined
  into a batch request.
- Title of the configure columns dialog.

## [3.0.0] - 2021-06-14
### Changed
- The application has been rewritten to use Angular.
- The new application uses a wizard-like workflow - content is divided into
  logical steps.

## [2.6.1] - 2021-05-24
### Fixed
- Speed up initialization by replacing "_sort=date" with "date=gt1000-01-01"
  in the init query which is used to check if sorting Observations by date
  is supported.

## [2.6.0] - 2021-03-08
### Added
- $lastn lookup of Observation codes, when supported
### Fixed
- It was possible to select the same criteria after loading the cohort criteria
- Displaying Observation component values

## [2.5.0] - 2021-02-18
### Added
- ResearchStudy for cohort selection
- Spinner when loading data

## [2.4.0] - 2020-12-18
### Added
- Support for age-at-event search parameter extension
- Display Observation value from component property
- The ability to enter a floating point Observation value in search parameters
- Advanced settings section
### Changed
- Sort Observations by date only if possible

## [2.3.0] - 2020-12-18
### Added
- Handle 429 responses with rate limiting
## Changed
- Resource type field value is empty by default

## [2.2.0] - 2020-12-02
### Added
- Column selection for resource tables
- Allowed non-LOINC codes to be entered in Patient selection criteria
- Added description for each step

## [2.1.0] - 2020-11-19
### Added
- Reuse selection criteria values from the Patient selection area
- Notes to screen reader log when adding/removing elements
### Fixed
- Observation list does not match term after selection

## [2.0.0] - 2020-11-06
### Added
- Save/Load Cohort criteria
- Version number to html page

## [1.15.0] - 2020-10-30
### Added
- Build/Load Cohort (instead of Patient selection)
## Changed
- Allow patients to be selected by Observation codes which do not have
  values provided for them
- Changed the Patient.active parameter input control from a checkbox to
  a radio button group
## Fixed
- Exception that can be thrown after removing a resource type tab
- Results of not all queries were considered when filtering patient resources
- Extra commas in http requests for data needed for resource tabs

## [1.14.0] - 2020-10-16
### Added
- Allowance to choose which resource types users want to see
  for selected patients

## [1.13.0] - 2020-09-08
### Added
- Display of minimum and maximum values that exist in the database
  for a date range criterion
- npm task "show-webpack-treemap" to run webpack-bundle-analyzer
### Changed
- Bundle size reduced by removing moment locales

## [1.12.0] - 2020-08-24
### Changed
- Revised Observation criteria for Patient selection

## [1.11.2] - 2020-08-14
### Fixed
- Issue with parse batch response
- Issue with partial support of Promise in some Edge versions

## [1.11.1] - 2020-08-12
### Fixed
- Duplication of the search criteria component when changing the server
- Batch tuning applies only after server change

## [1.11.0] - 2020-08-03
### Added
- Display that criteria are combined with logical AND
### Fixed
- Issue with value sets that are used more than once

## [1.10.0] - 2020-07-29
### Added
- Allow other resources to be used to select patients

## [1.9.0] - 2020-07-20
### Changed
- Resource ValueSets are built from the FHIR spec downloads

## [1.8.0] - 2020-07-02
### Added
- Allowed searching of any searchable Condition, Observation or MedicationDispense field

## [1.7.0] - 2020-06-16
### Added
- Separate Patient selection section
- Statistical data loading information

## [1.6.0] - 2020-05-14
### Changed
- Allowed searching of any searchable Encounter field

## [1.5.0] - 2020-05-06
### Changed
- Allowed searching of any searchable Patient field
- Added display of data loading time

## [1.4.0] - 2020-04-23
### Changed
- Allowed selection of patients by gender and age

## [1.3.0] - 2020-04-14
### Changed
- Issues queries per each selected patient
- Added the ability to automatically combine requests in a batch
- No cache used for http errors

## [1.2.1] - 2020-04-09
### Changed
- separate configurations for production and development

## [1.2.0] - 2020-04-03
### Changed
- Added output fields

## [1.1.0] - 2020-03-20
### Changed
- Added button to download observations in CSV format.
- Some markup issues fixed

## [1.0.2] - 2019-09-17
### Changed
- Set the default test/category radio button selection to 'test'

## [1.0.1] - 2019-09-10
### Added
- Support for searching by categories.  The category list includes a mixture of
  categories from the Observation category list and the DiagnosticReport
  category list, with a few modifications.
- A cache for the AJAX requests.
