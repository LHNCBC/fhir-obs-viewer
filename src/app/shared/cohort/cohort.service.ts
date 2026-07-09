/**
 * This file contains a service for working with a cohort of patients.
 */
import { Injectable } from '@angular/core';
import {
  Criteria,
  Criterion,
  ResourceTypeCriteria
} from '../../types/search-parameters';
import {
  BehaviorSubject,
  defer,
  EMPTY,
  forkJoin,
  from,
  Observable,
  of,
  OperatorFunction,
  Subject
} from 'rxjs';
import {
  bufferCount,
  catchError,
  concatMap,
  expand,
  filter,
  finalize,
  last,
  map,
  mergeMap,
  mergeScan,
  share,
  startWith,
  switchMap,
  take
} from 'rxjs/operators';
import {
  CODETEXT,
  OBSERVATION_VALUE,
  QueryParamsService
} from '../query-params/query-params.service';
import { chunk, cloneDeep, uniqBy } from 'lodash-es';
import { HttpClient } from '@angular/common/http';
import { FhirBackendService } from '../fhir-backend/fhir-backend.service';
import {
  CustomRxjsOperatorsService
} from '../custom-rxjs-operators/custom-rxjs-operators.service';
import { Resource, Bundle, Patient } from 'fhir/r4';

// Patient resource type name
const PATIENT_RESOURCE_TYPE = 'Patient';
// ResearchStudy resource type name
const RESEARCH_STUDY_RESOURCE_TYPE = 'ResearchStudy';
// EvidenceVariable resource type name
const EVIDENCE_VARIABLE_RESOURCE_TYPE = 'EvidenceVariable';
// Observation resource type name
const OBSERVATION_RESOURCE_TYPE = 'Observation';

// Maximum value allowed for the _count parameter.
export const MAX_PAGE_SIZE = 2147483647;

export enum CreateCohortMode {
  UNSELECTED = 'UNSELECTED',
  NO_COHORT = 'NO_COHORT',
  BROWSE = 'BROWSE',
  SEARCH = 'SEARCH'
}

interface CohortState {
  // Indicates that data is loading
  loading: boolean;
  // Array of loaded Patients
  patients: Patient[];
  // Processed Patient Ids used to skip already selected Patients
  processedPatientIds: { [patientId: string]: boolean };
  // The number of resources in processing is used to pause the loading of the next page
  numberOfProcessingResources$: BehaviorSubject<number>;
}

interface ResourceToCheck {
  // Resource to check
  resource: Resource;
  // Whether the resource meets the criteria
  checkPassed: boolean;
}

// Empty cohort state
const emptyState: CohortState = {
  loading: false,
  patients: [],
  processedPatientIds: {},
  numberOfProcessingResources$: null
};

@Injectable({
  providedIn: 'root'
})
export class CohortService {
  constructor(
    private fhirBackend: FhirBackendService,
    private queryParams: QueryParamsService,
    private http: HttpClient,
    private customRxjs: CustomRxjsOperatorsService
  ) {}

  createCohortMode = CreateCohortMode.UNSELECTED;

  // Observable that emits Patient resources that match the criteria
  patientStream: Observable<Patient[]>;

  // Cohort criteria
  criteria: Criteria;
  criteria$ = new Subject<Criteria>();

  // Maximum number of patients
  maxPatientCount = 100;

  currentState: CohortState = { ...emptyState };

  // A matrix of loading info that will be displayed with View Cohort resource table.
  loadingStatistics: (string | number)[][] = [];

  // A flag indicating a 4xx error has been received during Patient search.
  patient400ErrorFlag = false;

  /**
   * Sets the cohort criteria
   */
  setCriteria(criteria: Criteria): void {
    this.criteria = {...criteria};
    this.criteria$.next(this.criteria);
  }

  /**
   * Resets the cohort criteria to its default value and returns that value
   */
  resetCriteria(): Criteria {
    const defaultCriteria: Criteria = {
      condition: 'and',
      rules: []
    };
    // Clear patient list when resetting criteria
    this.currentState = { ...emptyState };
    this.patientStream = of([]);

    this.setCriteria(defaultCriteria);
    return defaultCriteria;
  }
  /**
   * Search for a list of Patient resources using the criteria tree.
   * This method searches from the server and checks Patient resources
   * against all criteria, and emits Patient resources that match criteria
   * through {patientStream}
   */
  searchForPatients(
    criteria: Criteria,
    maxPatientCount: number,
    researchStudyIds: string[] = null
  ): void {
    const currentState: CohortState = {
      loading: true,
      patients: [],
      processedPatientIds: {},
      numberOfProcessingResources$: new BehaviorSubject<number>(0)
    };
    this.currentState = currentState;
    this.loadingStatistics = [];
    this.maxPatientCount = maxPatientCount;
    // Maximum number of Patients to load
    const emptyPatientCriteria: ResourceTypeCriteria = {
      condition: 'and',
      resourceType: PATIENT_RESOURCE_TYPE,
      rules: []
    };

    this.setCriteria(criteria);

    // Preprocess a criteria tree built using the Query Builder component.
    // If there are no criteria - use default empty Patient criteria.
    criteria = (this.prepareCriteria(criteria, researchStudyIds) ||
      emptyPatientCriteria) as Criteria;

    // Create a new Observable which emits Patient resources that match the criteria.
    // If we have only one block with Patient criteria - load all Patient in one request.
    this.patientStream = defer(() => {
      currentState.patients = [];
      return this.replaceOtherResourceCriteriaWithPatientCriteria(
        of(this.simplifyCriteriaTree(criteria))
      );
    }).pipe(
      concatMap((simplifiedCriteria) => {
        return simplifiedCriteria
          ? this.search(
            maxPatientCount,
            this.combineANDedCriteriaForPatient(simplifiedCriteria),
            maxPatientCount,
            currentState
          )
          : EMPTY;
      }),
      // Expand each array of resources into separate resources
      concatMap((resources: Resource[]) => {
        // Skip already processed Patients or resources without a Patient ID,
        // decrementing the in-processing counter for each skipped resource.
        resources = resources.filter((resource) => {
          const patientId = this.getPatientIdFromResource(resource);
          if (!patientId || currentState.processedPatientIds[patientId]) {
            currentState.numberOfProcessingResources$.next(
              currentState.numberOfProcessingResources$.value - 1
            );
            return false;
          }
          currentState.processedPatientIds[patientId] = true;
          return true;
        });

        // Cap the batch so we never exceed maxPatientCount.
        const remaining = maxPatientCount - currentState.patients.length;
        if (resources.length > remaining) {
          resources.length = remaining;
        }

        // Separate Patient resources from related resources.
        const patients: Patient[] = [];
        const otherPatientIds: string[] = [];
        for (const resource of resources) {
          if (resource.resourceType === PATIENT_RESOURCE_TYPE) {
            patients.push(resource as Patient);
          } else {
            otherPatientIds.push(this.getPatientIdFromResource(resource));
          }
        }

        // If there are no related resources, return the patients as-is.
        if (!otherPatientIds.length) {
          return of(patients);
        }

        // Fetch Patient resources for related resources so the caller always
        // receives Patient objects.
        return this.http
          .get<Bundle>(`$fhir/${PATIENT_RESOURCE_TYPE}`, {
            params: {
              _id: otherPatientIds.join(','),
              _count: otherPatientIds.length
            }
          })
          .pipe(
            map((response) =>
              response?.entry?.length
                ? patients.concat(response.entry.map((entry) => entry.resource as Patient))
                : []
            )
          );
      }),
      map((patients: Patient[]) => {
        const processedResources = patients.length;
        currentState.patients.push(...patients);
        if (currentState.patients.length < maxPatientCount) {
          // Update the number of resources in processing
          currentState.numberOfProcessingResources$.next(
            currentState.numberOfProcessingResources$.value - processedResources
          );
        } else {
          // Cancel the loading of the next page if the maximum number of
          // Patients has been reached
          currentState.numberOfProcessingResources$.next(0);
          currentState.numberOfProcessingResources$.complete();
        }
        return [...currentState.patients];
      }),
      // Stop emitting resources when the maximum number is reached
      // takeWhile((patients) => patients.length < maxPatientCount),
      // Complete observable on error
      catchError((e) => {
        console.error(e);
        if (e.status >= 400 && e.status < 500) {
          this.patient400ErrorFlag = true;
        }
        return EMPTY;
      }),
      finalize(() => {
        currentState.loading = false;
      }),
      startWith([]),
      // Do not create a new stream for each subscription
      share()
    );
  }

  /**
   * Returns an Observable that emits arrays of resources (page by page) that
   * match the criteria. If among the criteria there are criteria for Patients,
   * then the Observable will emit arrays of Patient resources.
   * @param maxPatientCount - maximum number of Patients
   * @param criteria - criteria tree
   * @param pageSize - the value of the _count parameter
   * @param currentState - an object describing the current loading process
   */
  search(
    maxPatientCount: number,
    criteria: Criteria | ResourceTypeCriteria,
    pageSize: number,
    currentState: CohortState
  ): Observable<Resource[]> {
    // Loading resources by criteria for specified resource type
    if ('resourceType' in criteria) {
      // If the resource criteria are combined by the OR operator, we split them
      // into separate ones. ANDed criteria will be sent in one request.
      return from(
        criteria.condition === 'or'
          ? criteria.rules.map((rule) => [rule])
          : [criteria.rules]
      ).pipe(
        // Sequentially execute queries and put the result into the stream.
        concatMap((rules) =>
          this.requestResources(
            criteria.resourceType,
            rules,
            pageSize,
            maxPatientCount,
            currentState
          )
        )
      );
      // Loading a subgroup of resources by criteria combined by the OR operator
    } else if (criteria.condition === 'or') {
      return from(criteria.rules).pipe(
        concatMap((rule) =>
          this.search(maxPatientCount, rule, pageSize, currentState)
        )
      );
    } else {
      // Loading a subgroup of resources by criteria combined by the AND operator
      if (criteria.rules.length > 1) {
        // Get new criteria sorted by the number of matching resources.
        return this.getAmountOfResources(criteria).pipe(
          mergeMap((newCriteria) => {
            // If there are no matching resources, return an empty result
            if (newCriteria.total === 0) {
              return from([]);
            }
            // All child criteria except the first one
            const restRules = newCriteria.rules.slice(1);
            // Search by the first child criterion
            return this.search(
              maxPatientCount,
              newCriteria.rules[0],
              pageSize,
              currentState
            ).pipe(
              mergeMap((resources: Resource[]) => {
                // Deduplicate by Patient ID and skip already-processed patients.
                const uncheckedResources = uniqBy(
                  resources.filter((r) => {
                    const patientId = this.getPatientIdFromResource(r);
                    return patientId && !currentState.processedPatientIds[patientId];
                  }),
                  (r) => this.getPatientIdFromResource(r)
                ).map((resource) => ({ resource, checkPassed: true }));

                // Run a parallel check of the accumulated resources by the rest
                // of the criteria:
                const checked$: Observable<Resource[]> = uncheckedResources.length
                  ? this.check(uncheckedResources, { ...newCriteria, rules: restRules }).pipe(
                    map((res) =>
                      res
                        .filter(({ checkPassed }) => checkPassed)
                        .map(({ resource }) => resource)
                    )
                  )
                  : of([]);

                return checked$.pipe(
                  map((checkedResources) => {
                    // Update the number of resources in processing
                    currentState.numberOfProcessingResources$.next(
                      currentState.numberOfProcessingResources$.value -
                      (resources.length - checkedResources.length)
                    );
                    return checkedResources;
                  })
                );
              })
            );
          })
        );
      } else {
        return this.search(
          maxPatientCount,
          criteria.rules[0],
          pageSize,
          currentState
        );
      }
    }
  }

  /**
   * Checks if the patients related to the specified resources meet the specified
   * criteria. If the criteria include criteria for patients, or the input
   * resources are patients, then the Observable will return the patient resources.
   * @param resourcesToCheck - array of resources with check status for each resource
   * @param criteria - criteria to check
   * @returns an Observable that returns a list of resources with a flag for
   *  each resource indicating that it meets the criteria
   */
  check(
    resourcesToCheck: ResourceToCheck[],
    criteria: Criteria | ResourceTypeCriteria
  ): Observable<ResourceToCheck[]> {
    let observable;
    const isORedCriteria = criteria.condition === 'or';

    if ('resourceType' in criteria) {
      // Currently, resource criteria are always ANDed, but we leave the option
      // to OR them if needed in the future. If resource criteria are ORed, we
      // split them into separate ones. ANDed criteria will be sent in one request.
      observable = from(
        isORedCriteria
          ? criteria.rules.map((rule) => [rule])
          : [criteria.rules]
      ).pipe(
        // "mergeScan" is the RxJS version of "reduce".
        // See https://rxjs.dev/api/operators/mergeScan.
        // Here we go through all the criteria sets sequentially and accumulate
        // the resulting set of resources associated with patients with a check
        // status. This is needed only if the criteria for the resource type are
        // ORed. When they are ANDed it is only one iteration. Currently, the UI
        // only allows criteria with the AND operator for the resource type, but
        // I don't want to have this limitation in the search algorithm.
        mergeScan(
          (acc, rules) => {
            const {
              toCheck,
              alreadyChecked
            } = this.splitListByCheckStatus(acc, isORedCriteria);
            if (toCheck.length) {
              const useHas = this.canUseHas(criteria.resourceType, rules);
              const resourceType =
                criteria.resourceType === EVIDENCE_VARIABLE_RESOURCE_TYPE
                  ? OBSERVATION_RESOURCE_TYPE
                  : useHas
                    ? PATIENT_RESOURCE_TYPE
                    : criteria.resourceType;
              // If the resource is not a Patient, we extract only the subject
              // element in order to further identify the Patient by it.
              const elements =
                resourceType === RESEARCH_STUDY_RESOURCE_TYPE
                  ? '&_elements=id'
                  : resourceType !== PATIENT_RESOURCE_TYPE
                    ? '&_elements=subject'
                    : '';

              // Partition the resources to check by whether they have a Patient ID.
              const validResourcesToCheck: ResourceToCheck[] = [];
              const invalidResourcesToCheck: ResourceToCheck[] = [];
              for (const r of toCheck) {
                if (this.getPatientIdFromResource(r.resource)) {
                  validResourcesToCheck.push(r);
                } else {
                  invalidResourcesToCheck.push({ ...r, checkPassed: false });
                }
              }

              const baseTail = alreadyChecked.concat(invalidResourcesToCheck);
              if (!validResourcesToCheck.length) {
                return of(baseTail);
              }

              const doRequest = (link: string) =>
                this.requestResourcesForCheck(
                  resourceType, link, elements, criteria.resourceType, rules, useHas
                );

              let batches$: Observable<ResourceToCheck[]>[];

              if (resourceType === PATIENT_RESOURCE_TYPE) {
                // Check up to 10 patients per request using _id=.
                batches$ = chunk(validResourcesToCheck, 10).map((batch) => {
                  const patientIds = batch.map(
                    ({ resource }) => this.getPatientIdFromResource(resource)!
                  );
                  return doRequest('_id=' + patientIds.join(',')).pipe(
                    map((response) => {
                      const found = new Map(
                        response?.entry?.map(({ resource }) => [resource.id, resource])
                      );
                      return batch.map((item) => {
                        const patientId = this.getPatientIdFromResource(item.resource);
                        // If the patient was returned, replace the resource with it so we
                        // don't need a follow-up request to fetch the Patient later.
                        return found.has(patientId)
                          ? { resource: found.get(patientId), checkPassed: true }
                          : { ...item, checkPassed: false };
                      });
                    })
                  );
                });
              } else {
                // Check one resource at a time using subject= (or _has for ResearchStudy).
                batches$ = validResourcesToCheck.map((item) => {
                  const patientId = this.getPatientIdFromResource(item.resource)!;
                  const link =
                    resourceType === RESEARCH_STUDY_RESOURCE_TYPE
                      ? `_count=1&_has:ResearchSubject:study:${this.fhirBackend.subjectParamName}=Patient/${patientId}`
                      : `_count=1&subject=Patient/${patientId}`;
                  return doRequest(link).pipe(
                    map((response) => {
                      item.checkPassed = !!response?.entry?.length;
                      return [item];
                    })
                  );
                });
              }

              return forkJoin(batches$).pipe(
                map((results) => baseTail.concat(...results))
              );
            } else {
              return of(alreadyChecked);
            }
          },
          resourcesToCheck,
          1
        ),
        last()
      );
    } else {
      observable = from(criteria.rules).pipe(
        mergeScan(
          (acc, rule) => {
            const {
              toCheck,
              alreadyChecked
            } = this.splitListByCheckStatus(acc, isORedCriteria);
            return toCheck.length
              ? this
                .check(toCheck.map(({resource}) => ({
                  resource,
                  checkPassed: rule.condition !== 'or'
                })), rule)
                .pipe(map((res) => alreadyChecked.concat(res)))
              : of(alreadyChecked);
          },
          resourcesToCheck,
          1
        ),
        last()
      );
    }

    return observable;
  }

  /**
   * Splits list of resources to list of already checked resources and resources
   * that need additional checks if we have other criteria.
   * @param resourcesToCheck - list of resources with check status
   * @param isORedCriteria - `true` when the criteria are combined using OR,
   *  `false` when AND.
   * @returns two new resource lists
   */
  splitListByCheckStatus(
    resourcesToCheck: ResourceToCheck[],
    isORedCriteria: boolean
  ): { toCheck: ResourceToCheck[]; alreadyChecked: ResourceToCheck[] } {
    const toCheck = [];
    const alreadyChecked = [];

    resourcesToCheck.forEach((r) => {
      // If the resource criteria are combined by the OR operator, we
      // will take the first matched resource. If the resource criteria
      // are combined by the AND operator, and one of the queries returns
      // nothing, we don't need to check the other criteria.
      if (isORedCriteria ? r.checkPassed : !r.checkPassed) {
        alreadyChecked.push(r);
      } else {
        toCheck.push(r);
      }
    });
    return {toCheck, alreadyChecked};
  }

  /**
   * Requests resources related with a patient based on criteria to check if
   * they meet the criteria.
   * @param requestResourceType - type of resource to request
   * @param link = url parameter to link a resource with a patient
   * @param elements - url parameter with requested resource fields
   * @param criteriaResourceType - resource type for which the criteria are
   *   specified may be different from requestResourceType if useHas is true
   * @param rules - array of criteria
   * @param useHas - true if we need a _has query
   * @returns an Observable of result of an HTTP call
   */
  requestResourcesForCheck(
    requestResourceType: string,
    link: string,
    elements: string,
    criteriaResourceType: string,
    rules: Criterion[],
    useHas: boolean
  ): Observable<Bundle> {
    const query =
      `$fhir/${requestResourceType}?${link}${elements}` +
      rules
        .map((criterion: Criterion) => {
          const urlParamString = this.queryParams.getQueryParam(
            criteriaResourceType,
            criterion.field
          );
          return useHas
            ? urlParamString.replace(
              /&/g,
              `&_has:${criteriaResourceType}:subject:`
            )
            : urlParamString;
        })
        .join('');
    return this.http.get<Bundle>(query);
  }

  /**
   * Moves child criteria from subgroups to the parent level if subgroups are ANDed.
   * @param criteria source criteria
   * @returns simplified criteria.
   */
  simplifyCriteriaTree(criteria: Criteria | ResourceTypeCriteria): Criteria | ResourceTypeCriteria | null {
    let rules = [];
    if ('resourceType' in criteria) {
      rules.push(...criteria.rules);
    } else {
      rules = criteria.rules.reduce((newRules, rule) => {
        if (rule.rules.length) {
          if ('resourceType' in rule) {
            newRules.push(rule);
          } else if (criteria.condition === 'and' && rule.condition === 'and') {
            // Moves ANDed child criteria to the parent criteria
            newRules.push(
              ...rule.rules.map(r => this.simplifyCriteriaTree(r)).filter(r => r)
            );
          } else {
            const newRule = this.simplifyCriteriaTree(rule);
            if (newRule) {
              newRules.push(newRule);
            }
          }
        }
        return newRules;
      }, []);
    }
    return {
      ...criteria,
      rules
    };
  }

  /**
   * Replaces:
   * - criteria for ResearchStudy with study id criteria for Patient.
   * - criteria for other resources, which can be replaced by _has criteria for the patient
   * @param criteria source criteria
   * @return updated criteria or null if it is known in advance that the search
   *  will return an empty list
   */
  replaceOtherResourceCriteriaWithPatientCriteria(criteria: Observable<Criteria | ResourceTypeCriteria>): Observable<Criteria | ResourceTypeCriteria | null> {
    return criteria.pipe(
      concatMap((c) => {
        if ('resourceType' in c) {
          if (c.resourceType === 'ResearchStudy') {
            const hasResearchSubjects = this.getHasResearchSubjectsParam();
            const query =
              `$fhir/${c.resourceType}?_elements=id${hasResearchSubjects}` +
              c.rules
                .map((criterion: Criterion) => this.queryParams.getQueryParam(c.resourceType, criterion.field))
                .join('');
            return this.http.get<Bundle>(query).pipe(
              this.customRxjs.takeAll(),
              map((bundle) => {
                const researchStudyIds = bundle.entry?.map(r => r.resource.id).join(',');
                return researchStudyIds ? {
                  condition: 'and',
                  resourceType: 'Patient',
                  rules: [
                    {
                      field: {
                        element: `_has:ResearchSubject:${this.fhirBackend.subjectParamName}:study`,
                        value: researchStudyIds
                      }
                    }
                  ]
                } as ResourceTypeCriteria : null;
              })
            );
          } else if (this.canUseHas(c.resourceType, c.rules)) {
            return of({
              condition: c.condition,
              resourceType: 'Patient',
              // At the moment we have only one element in this array, but we use map() just in case
              rules: c.rules.map((r) => {
                const [element, value] = this.queryParams
                  .getQueryParam(c.resourceType, r.field)
                  .replace(/&/g, `_has:${c.resourceType}:subject:`)
                  .split('=');
                return {
                  field: {element, value}
                };
              })
            });
          } else {
            return of(c);
          }
        } else {
          return forkJoin(c.rules.map((cc) => this.replaceOtherResourceCriteriaWithPatientCriteria(of(cc)))).pipe(
            map((ccc: (Criteria | ResourceTypeCriteria)[]) => {
              const rules = ccc.filter((i) => i);
              return c.condition === 'and' && rules.length < ccc.length
                ? null
                : {
                  ...c,
                  rules
                };
            })
          );
        }
      })
    );
  }

  /**
   * Returns the number of criteria whose parameter name begins with _has
   * @param rules - array of criteria
   */
  getNumberOfHasCriteria(rules: Criterion[]) {
    return rules.filter(c => c.field.element.startsWith('_has')).length;
  }

  /**
   * Combines ANDed criteria for the patient resource type on each level of the criteria tree.
   * @param criteria source criteria
   */
  combineANDedCriteriaForPatient(criteria: Criteria | ResourceTypeCriteria): Criteria | ResourceTypeCriteria | null {
    const maxHasAllowed = this.fhirBackend.features.maxHasAllowed;
    let rules = [];
    let patientCriteria: ResourceTypeCriteria;
    if ('resourceType' in criteria) {
      rules.push(...criteria.rules);
    } else {
      rules = criteria.rules.reduce((newRules, rule) => {
        if ('resourceType' in rule) {
          if (criteria.condition === 'and' && rule.resourceType === PATIENT_RESOURCE_TYPE) {
            if (patientCriteria) {
              if (this.getNumberOfHasCriteria(patientCriteria.rules) + this.getNumberOfHasCriteria(rule.rules) > maxHasAllowed) {
                newRules.push(patientCriteria);
                patientCriteria = rule;
              } else {
                patientCriteria.rules.push(...rule.rules);
              }
            } else {
              patientCriteria = rule;
            }
          } else {
            newRules.push(rule);
          }
        } else {
          newRules.push(this.combineANDedCriteriaForPatient(rule));
        }
        return newRules;
      }, []);
    }
    if (patientCriteria) {
      rules.push(patientCriteria);
    }

    return {
      ...criteria,
      rules
    };
  }

  /**
   * Returns a prepared criteria tree:
   *  - removes empty criteria from the criteria tree
   *  - inserts the criteria for the selected ResearchStudies into the existing
   *    (ANDed with other) Patients criteria, otherwise adds the root criteria
   *    for the selected ResearchStudies
   *  - combine code and value criteria for Observation
   *  - combine ORed code criteria for Observation
   */
  prepareCriteria(
    criteria: Criteria | ResourceTypeCriteria,
    researchStudyIds: string[] = null
  ): Criteria | ResourceTypeCriteria | null {
    if (researchStudyIds?.length) {
      const preparedCriteria = this.prepareCriteria(criteria) || {
        condition: 'and',
        resourceType: PATIENT_RESOURCE_TYPE,
        rules: []
      };
      const ruleForResearchStudyIds = {
        field: {
          // The case when an element is not a search parameter is
          // specially taken into account in the function getQueryParam
          // of the service QueryParamsService.
          element: `_has:ResearchSubject:${this.fhirBackend.subjectParamName}:study`,
          value: researchStudyIds.join(',')
        }
      };
      const patientCriteria = this.findAndedWithOtherCriteriaFor(
        PATIENT_RESOURCE_TYPE,
        preparedCriteria
      );
      // Insert the criteria for the selected ResearchStudies into the existing
      // (ANDed with other) Patients criteria
      if (patientCriteria) {
        if (patientCriteria.condition === 'and') {
          patientCriteria.rules.push(ruleForResearchStudyIds);
        } else {
          // Split patient criteria to separate blocks
          delete patientCriteria.resourceType;
          ((patientCriteria as unknown) as Criteria).rules = patientCriteria.rules.map(
            (rule) => ({
              resourceType: PATIENT_RESOURCE_TYPE,
              condition: 'and',
              rules: [rule, ruleForResearchStudyIds]
            })
          );
        }
        return preparedCriteria;
      }

      // Otherwise add the root criteria for the selected ResearchStudies
      return {
        condition: 'and',
        rules: ([
          {
            condition: 'and',
            resourceType: PATIENT_RESOURCE_TYPE,
            rules: [ruleForResearchStudyIds]
          }
        ] as Array<Criteria | ResourceTypeCriteria>).concat(
          this.prepareCriteria(preparedCriteria) || []
        )
      } as Criteria;
    }

    if ('resourceType' in criteria) {
      // Remove empty resource type criteria so we don't have to consider them
      // in the search algorithm
      if (!criteria.rules.length) {
        return null;
      }

      let condition = criteria.condition;
      let resourceType = criteria.resourceType;
      let rules;

      // Combine code and value criteria for Observation when we have one code
      // and one value:
      const obsCodeCriterion = criteria.resourceType === 'Observation'
        ? criteria.rules.find((c) => c.field.element === CODETEXT)
        : null;

      if (
        obsCodeCriterion?.field.selectedObservationCodes.coding.length === 1
      ) {
        const obsValueCriterion = criteria.rules.find(
          (c) => c.field.element === OBSERVATION_VALUE
        );
        if (
          obsValueCriterion &&
          (!obsValueCriterion.field.value.testValue.codes ||
            obsValueCriterion.field.value.testValue.codes.length === 1)
        ) {
          rules = [
            ...criteria.rules.filter(
              (c) => c !== obsCodeCriterion && c !== obsValueCriterion
            ),
            {
              field: {
                ...obsCodeCriterion.field,
                value: obsValueCriterion.field.value
              }
            }
          ];
        }
      }

      rules = cloneDeep(rules || criteria.rules);

      // Processing combined search parameters.
      const {combinedRules, otherRules} = rules.reduce((obj, rule) => {
        if (Array.isArray(rule.field.element)) {
          // If the element is an array, it means that it is a combined search
          // parameter.
          if (condition === 'or') {
            // If criteria are ORed, we can simply split combined criteria into
            // separate rules without significant changes in the criteria
            // structure.
            rule.field.element.forEach((element) => {
              obj.otherRules({
                ...rule,
                field: {
                  ...rule.field,
                  element
                }
              });
            });
          } else {
            obj.combinedRules.push(rule);
          }
        } else {
          obj.otherRules.push(rule);
        }
        return obj;
      }, {
        combinedRules: [], otherRules: []
      });

      if (combinedRules.length) {
        // If we have combined search parameters, we need to split them into
        // separate rules.
        if (otherRules.length === 0 && combinedRules.length === 1) {
          // If we have only one criterion with the combined search parameter,
          // use the OR operator
          condition = 'or';
          rules = combinedRules[0].field.element.map((element) => ({
            ...combinedRules[0],
            field: {
              ...combinedRules[0].field,
              element
            }
          }));

        } else {
          rules = combinedRules.reduce((obj, rule) => {
            // If the field is an array, it means that it is a combined search parameter
            // and we need to split it into separate rules.
            const res = {
              condition: 'or',
              rules: []
            }
            rule.field.element.forEach((element) => {
              res.rules.push({
                condition: 'and',
                resourceType,
                rules: [{
                  ...rule,
                  field: {
                    ...rule.field,
                    element
                  }
                }, ...otherRules]
              });
            });
            obj.push(res);
            return obj;
          }, []);
          resourceType = null;
        }
      }

      // We need a copy of the object in order not to visualize our changes
      return {
        // if we have only one criterion with the OR operator, replace the
        // operator with AND
        condition: rules.length === 1 ? 'and' : condition,
        ...(resourceType ? { resourceType } : {}),
        rules
      };
    } else {
      // Combined ORed code criteria for Observation
      let obsCodeCriterion;

      const rules = criteria.rules.reduce((result, rule) => {
        const preparedRule = this.prepareCriteria(rule);
        // Skip empty subgroups, so we don't have to consider them in the search algorithm
        if (preparedRule) {
          // Combine ORed code criteria for Observation
          if (
            criteria.condition === 'or' &&
            'resourceType' in preparedRule &&
            preparedRule.rules.length === 1 &&
            preparedRule.rules[0].field.selectedObservationCodes?.coding.length > 0 &&
            !preparedRule.rules[0].field.value &&
            preparedRule.rules[0].field.value !== false
          ) {
            if (obsCodeCriterion) {
              obsCodeCriterion.rules[0].field.selectedObservationCodes.coding.push(
                ...preparedRule.rules[0].field.selectedObservationCodes.coding
              );
              obsCodeCriterion.rules[0].field.selectedObservationCodes.items.push(
                ...preparedRule.rules[0].field.selectedObservationCodes.items
              );
            } else {
              obsCodeCriterion = preparedRule;
              result.push(obsCodeCriterion);
            }
          } else {
            result.push(preparedRule);
          }
        }
        return result;
      }, []);
      if (rules.length === 0) {
        return null;
      } else {
        // We need a copy of the object in order not to visualize our changes
        return {
          ...criteria,
          rules
        };
      }
    }
  }

  /**
   * Extracts the Patient ID from a patient-related resource or from a Patient
   * resource.
   */
  getPatientIdFromResource(resource: Resource): string | undefined {
    return resource.resourceType === PATIENT_RESOURCE_TYPE
      ? resource.id
      // TODO: In the future we might want to use the resolve() function from
      //  fhirpath.js instead of RegExp.
      : (resource as any).subject?.reference?.match(/(^|\/)Patient\/(.*)/)?.[2];
  }

  /**
   * Returns the criteria tree sorted at each level by the total amount of
   * patient-related resources that match these criteria and populates the total
   * property for each resource criteria and resource subgroup.
   * This helps to find the best way to select Patients and get rid of
   * unnecessary searches.
   */
  getAmountOfResources(criteria: Criteria): Observable<Criteria> {
    if ('total' in criteria) {
      return of(criteria);
    }

    return (criteria.rules.length
      ? forkJoin(
          criteria.rules.map((ruleset) => {
            if ('resourceType' in ruleset) {
              // If the resource criteria are combined by the OR operator, we split them
              // into separate ones. ANDed criteria will be sent in one request.
              const rulesets =
                ruleset.condition === 'or'
                  ? ruleset.rules.map((rule) => [rule])
                  : [ruleset.rules];
              return forkJoin(
                rulesets.map((rules) =>
                  this.requestAmountOfResources(ruleset.resourceType, rules)
                )
              ).pipe(
                map((totals) => ({
                  ...ruleset,
                  total: totals.reduce((total, totalN) => total + totalN, 0)
                }))
              );
            } else {
              return this.getAmountOfResources(ruleset);
            }
          })
        )
      : of([])
    ).pipe(
      map((rules) => {
        const sortedRules =
          criteria.condition === 'and'
            ? rules.sort((x, y) => {
                if (x.total === Infinity && y.total === Infinity) {
                  return 0;
                }
                return x.total - y.total;
              })
            : rules;

        return {
          condition: criteria.condition,
          rules: sortedRules,
          total:
            criteria.condition === 'and'
              ? sortedRules[0].total
              : sortedRules.reduce((total, rule) => total + rule.total, 0)
        };
      })
    );
  }

  /**
   * Returns true if the _has query can be used to retrieve Patient resources
   * based on the specified criteria for specified resource type.
   */
  canUseHas(
    resourceType: string,
    criteriaForResourceType: Array<Criterion>
  ): boolean {
    // We can use _has to select Patients if we only have one
    // criterion for the resource type:
    if (
      resourceType !== PATIENT_RESOURCE_TYPE &&
      resourceType !== RESEARCH_STUDY_RESOURCE_TYPE &&
      resourceType !== EVIDENCE_VARIABLE_RESOURCE_TYPE &&
      criteriaForResourceType.length === 1 &&
      // Currently don't use _has for EV since it doesn't work with search parameter 'obs-evidence-variable'
      criteriaForResourceType[0].field.element !== 'evidencevariable'
    ) {
      const queryParam = this.queryParams.getQueryParam(
        resourceType,
        criteriaForResourceType[0].field
      );
      return (
        queryParam.lastIndexOf('&') === 0 &&
        // Do not use _has when using modifier on the Observation value
        !/:(contains|exact)/.test(queryParam)
      );
    }
    return false;
  }

  /**
   * Requests an count of patient-related resources that match the specified
   * array of criteria. For ResearchStudy, requests an count of ResearchStudies
   * that have ResearchSubjects and treats a nonzero result as Infinity (each
   * ResearchStudy can have many ResearchSubjects).
   * @param resourceType - resource type
   * @param rules - array of ANDed criteria
   */
  requestAmountOfResources(
    resourceType: string,
    rules: Criterion[]
  ): Observable<number> {
    const hasResearchSubjects = this.getHasResearchSubjectsParam();
    const useHas = this.canUseHas(resourceType, rules);
    const queryResourceType =
      resourceType === EVIDENCE_VARIABLE_RESOURCE_TYPE
        ? OBSERVATION_RESOURCE_TYPE
        : useHas
        ? PATIENT_RESOURCE_TYPE
        : resourceType;

    const query =
      '$fhir/' +
      queryResourceType +
      '?_total=accurate&_summary=count' +
      (resourceType === RESEARCH_STUDY_RESOURCE_TYPE
        ? hasResearchSubjects
        : '') +
      rules
        .map((criterion: Criterion) => {
          const urlParamString = this.queryParams.getQueryParam(
            resourceType,
            criterion.field
          );
          return useHas
            ? urlParamString.replace(/&/g, `&_has:${resourceType}:subject:`)
            : urlParamString;
        })
        .join('');

    return this.http.get<Bundle>(query).pipe(
      map((response) => {
        if (!response.hasOwnProperty('total')) {
          return Infinity;
        }

        if (resourceType === RESEARCH_STUDY_RESOURCE_TYPE) {
          return response.total ? Infinity : 0;
        }
        return response.total;
      })
    );
  }

  /**
   * Requests resources related to Patient (or Patient resources) by criteria.
   * @param resourceType - resource type
   * @param rules - array of ANDed criteria
   * @param pageSize - page size
   * @param maxPatientCount - maximum number of Patients to load
   * @param currentState - an object describing the current loading process
   */
  requestResources(
    resourceType: string,
    rules: Criterion[],
    pageSize: number,
    maxPatientCount: number,
    currentState: CohortState
  ): Observable<Resource[]> {
    // Returns an empty Observable if the maximum number of patients has been reached
    if (currentState.patients.length >= maxPatientCount) {
      return EMPTY;
    }

    // For ResearchStudy criteria, we requests ResearchStudies and then
    // recursively requests Patients for those ResearchStudies:
    if (resourceType === RESEARCH_STUDY_RESOURCE_TYPE) {
      const nextResearchStudyPage$ = new Subject<void>();
      const hasResearchSubjects = this.getHasResearchSubjectsParam();

      return this.http
        .get<Bundle>(
          `$fhir/${resourceType}?_count=${pageSize}&_elements=id${hasResearchSubjects}` +
            rules.map((criterion: Criterion) =>
              this.queryParams.getQueryParam(resourceType, criterion.field)
            )
        )
        .pipe(
          // Modifying the Observable to load the following pages sequentially
          this.loadPagesSequentially(
            maxPatientCount,
            nextResearchStudyPage$,
            currentState
          ),
          // Expand the BundleEntries array into separate resources
          concatMap((response) => {
            return from((response?.entry || []).map((i) => i.resource.id)).pipe(
              bufferCount(10),
              concatMap((ids) => {
                return this.requestResources(
                  PATIENT_RESOURCE_TYPE,
                  [
                    {
                      field: {
                        element: `_has:ResearchSubject:${this.fhirBackend.subjectParamName}:study`,
                        value: ids.join(',')
                      }
                    }
                  ],
                  pageSize,
                  maxPatientCount,
                  currentState
                );
              }),
              finalize(() => {
                nextResearchStudyPage$.next();
              })
            );
          })
        );
    }

    const useHas = this.canUseHas(resourceType, rules);
    const queryResourceType =
      resourceType === EVIDENCE_VARIABLE_RESOURCE_TYPE
        ? OBSERVATION_RESOURCE_TYPE
        : useHas
        ? PATIENT_RESOURCE_TYPE
        : resourceType;
    // If the resource is not a Patient, we extract only the subject
    // element in order to further identify the Patient by it.
    const elements =
      queryResourceType !== PATIENT_RESOURCE_TYPE ? '&_elements=subject' : '';
    const query =
      `$fhir/${queryResourceType}?_count=${pageSize}${elements}` +
      rules
        .map((criterion: Criterion) => {
          const urlParamString = this.queryParams.getQueryParam(
            resourceType,
            criterion.field
          );
          return useHas
            ? urlParamString.replace(/&/g, `&_has:${resourceType}:subject:`)
            : urlParamString;
        })
        .join('');

    return this.http.get<Bundle>(query).pipe(
      // Modifying the Observable to load the following pages sequentially
      this.loadPagesSequentially(
        maxPatientCount,
        currentState.numberOfProcessingResources$.pipe(
          // Waiting for processing of already loaded resources
          filter(
            (numberOfProcessingResources) => numberOfProcessingResources === 0
          )
        ),
        currentState
      ),
      // Expand the BundleEntries array into separate resources
      map((response: Bundle) => {
        const resources = (response?.entry || [])
          .map((i) => i.resource)
          // Filter out OperationOutcome resources for https://server.fire.ly/r4
          .filter(i => i.resourceType === queryResourceType);
        // Update the number of resources in processing
        currentState.numberOfProcessingResources$.next(
          currentState.numberOfProcessingResources$.value + resources.length
        );
        return resources;
      })
    );
  }

  /**
   * Modifies the Observable to load the following pages sequentially
   * @param maxPatientCount - maximum number of Patients to load
   * @param readyForNextPage - the next page request will be executed after this
   *   Observable emits a value.
   * @param currentState - an object describing the current loading process
   */
  loadPagesSequentially(
    maxPatientCount: number,
    readyForNextPage: Observable<any>,
    currentState: CohortState
  ): OperatorFunction<Bundle, Bundle> {
    return expand((response: Bundle) => {
      const nextPageUrl = this.fhirBackend.getNextPageUrl(response);
      if (!nextPageUrl) {
        // Emit a complete notification if there is no next page
        return EMPTY;
      }
      // Do not load next page before processing current page
      return readyForNextPage.pipe(
        // Load each page once
        take(1),
        switchMap(() => {
          if (currentState.patients.length < maxPatientCount) {
            // Load the next page of resources
            return this.http.get<Bundle>(nextPageUrl);
          } else {
            // Emit a complete notification
            return EMPTY;
          }
        })
      );
    });
  }

  /**
   * Returns URL parameter for ResearchStudy query with all possible ResearchSubject
   * statuses used to filter ResearchStudies that does not have ResearchSubjects.
   */
  getHasResearchSubjectsParam(): string {
    const statuses = Object.keys(
      this.fhirBackend.getCurrentDefinitions().valueSetMapByPath[
        'ResearchSubject.status'
      ]
    ).join(',');
    return `&_has:ResearchSubject:study:status=${statuses}`;
  }

  /**
   * Find criteria for a specified resource type that are ANDed with other criteria
   * @param resourceType - resource type
   * @param criteria - all criteria
   */
  findAndedWithOtherCriteriaFor(
    resourceType: string,
    criteria: Criteria | ResourceTypeCriteria
  ): ResourceTypeCriteria {
    let result = null;
    if ('resourceType' in criteria) {
      if (criteria.resourceType === resourceType) {
        result = criteria;
      }
    } else if (criteria.condition === 'and') {
      const length = criteria.rules.length;
      for (let i = 0; i < length && !result; ++i) {
        result = this.findAndedWithOtherCriteriaFor(
          resourceType,
          criteria.rules[i]
        );
      }
    }
    return result;
  }

  /**
   * Move observationDataType property to field value level in new format,
   * in case it came from an earlier-downloaded cohort which has no version.
   * @param criteria rawCriteria object from cohort file
   */
  updateOldFormatCriteria(criteria: any): void {
    if ('resourceType' in criteria) {
      if (criteria.resourceType !== 'Observation') {
        return;
      } else {
        criteria.rules.forEach((rule) => {
          if (
            rule.field.element === OBSERVATION_VALUE &&
            rule.field.observationDataType &&
            !rule.field.value.observationDataType
          ) {
            rule.field.value.observationDataType =
              rule.field.observationDataType;
            delete rule.field.observationDataType;
          }
        });
      }
    } else {
      criteria.rules.forEach((rule) => {
        this.updateOldFormatCriteria(rule);
      });
    }
  }
}
