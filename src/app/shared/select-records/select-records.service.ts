/**
 * The file contains a service for loading and processing records in
 * the "Select records" and "Browse public data" steps.
 */
import { Injectable } from '@angular/core';
import {
  combineLatest,
  from,
  Observable,
  of,
  pipe,
  Subject,
  Subscription,
  UnaryFunction
} from 'rxjs';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import {
  catchError,
  concatMap,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap
} from 'rxjs/operators';
import { escapeStringForRegExp, modifyStringForSynonyms } from '../utils';
import { Sort } from '@angular/material/sort';
import { CartService } from '../cart/cart.service';
import { HttpOptions } from '../../types/http-options';
import {
  CACHE_INFO,
  CACHE_NAME,
  FhirBackendService,
  NO_CACHE,
  REQUEST_PRIORITY,
  RequestPriorities
} from '../fhir-backend/fhir-backend.service';
import { PullDataService } from '../pull-data/pull-data.service';
import { CohortService } from '../cohort/cohort.service';
import {
  ObservationCodeLookupComponent
} from '../../modules/observation-code-lookup/observation-code-lookup.component';
import {
  CustomRxjsOperatorsService
} from '../custom-rxjs-operators/custom-rxjs-operators.service';
import { omit, uniq } from 'lodash-es';
import {
  ColumnDescriptionsService
} from '../column-descriptions/column-descriptions.service';
import { FilterType } from '../../types/filter-type';
import { ColumnValuesService } from '../column-values/column-values.service';
import { Resource, Bundle, Observation } from 'fhir/r4';

interface SelectRecordState {
  // Indicates that data is loading
  loading: boolean;
  // Array of loaded resources
  resources: Resource[];
  // Whether result is cached
  isCached?: Observable<boolean>;
  // Time when the data was received from the server
  loadTime?: Date;
  // Next page URL for regular FHIR resources
  nextBundleUrl?: string;
  // Page number for CTSS variables
  currentPage?: number;
  // Indicates whether we need to reload data
  reset?: boolean;
  // The total number of records is used to determine whether the next page
  // of CTSS variables exists
  totalRecords?: number;
  // A set of processed observation codes when we build a list of variables from
  // observations
  processedObservationCodes?: Set<string>;
  // Subjects for selected studies
  subjectsForVariables?: {
    // Patient reference list used to load variables from observations
    current: string[],
    // Patient reference set for which variables have already been loaded
    processedSubjects: Set<string>,
    // Link to the next page of subjects for selected studies
    nextPageUrl: string,
    // The time of the last access to the link to the next page is used to
    // periodically repeat the request to keep it alive
    lastTime: Date
  },
  // Observable for loading resources
  resourceStream?: Observable<Resource[]>;
  // Preload subscription
  preloadSubscription?: Subscription;
  // Used to emit and observe sorting changes
  sortChanged: Subject<Sort>;
}

@Injectable({
  providedIn: 'root'
})
export class SelectRecordsService {
  constructor(
    private http: HttpClient,
    private cart: CartService,
    private pullData: PullDataService,
    private cohort: CohortService,
    private fhirBackend: FhirBackendService,
    private customRxjs: CustomRxjsOperatorsService,
    private columnDescriptionsService: ColumnDescriptionsService,
    private columnValuesService: ColumnValuesService,
  ) {}

  currentState: { [resourceType: string]: SelectRecordState } = {};
  preloadState: { [resourceType: string]: SelectRecordState } = {};

  /**
   * Resets the state of all resource types.
   */
  resetAll(): void {
    this.currentState = {};
    this.preloadState = {};
    this.cart.reset();
    this.cohort.resetCriteria();
    this.pullData.reset();
  }

  /**
   * Resets the state for the specified resource type
   * @param resourceType - resource type
   */
  resetState(resourceType: string): void {
    if (this.currentState[resourceType]) {
      // The easiest way is to delete the state, but in this case, the table
      // component will be recreated, which will lead to the image flickering.
      this.currentState[resourceType].reset = true;
    }
  }

  /**
   * Returns true if resource type records need to be reloaded.
   * @param resourceType - resource type
   */
  isNeedToReload(resourceType: string): boolean {
    return (
      !this.currentState[resourceType] || this.currentState[resourceType].reset
    );
  }

  /**
   * Loads the first page of resources of specified resource type.
   * @param resourceType - resource type
   * @param url - request URL.
   * @param options - the HTTP options to send with the request.
   */
  loadFirstPage(resourceType: string, url: string, options: HttpOptions): void {
    this.currentState[resourceType] = {
      loading: true,
      resources: [],
      nextBundleUrl: url,
      sortChanged: new Subject<Sort>()
    };

    this.loadNextPage(resourceType, options);
  }

  /**
   * Loads the next page of resources of specified resource type.
   * @param resourceType - resource type
   * @param options - the HTTP options to send with the request.
   */
  loadNextPage(resourceType, options?: HttpOptions): void {
    const currentState = this.currentState[resourceType];
    if (!currentState.nextBundleUrl) {
      return;
    }
    const url = currentState.nextBundleUrl;
    delete currentState.nextBundleUrl;

    currentState.loading = true;
    currentState.isCached = from(
      this.fhirBackend.isCached(url, options?.context?.get(CACHE_NAME))
    );
    currentState.resourceStream = this.http.get(url, options).pipe(
      this.customRxjs.takeAllIf(resourceType === 'ResearchStudy', options),
      map((data: Bundle) => {
        const cacheInfo = options?.context?.get(CACHE_INFO);
        currentState.loadTime = cacheInfo
          ? new Date(cacheInfo.timestamp)
          : new Date();

        currentState.resources = currentState.resources.concat(
          data.entry?.map((item) => item.resource) || []
        );
        currentState.nextBundleUrl = this.fhirBackend.getNextPageUrl(data);
        return currentState.resources;
      }),
      catchError(() => {
        // Do not retry after an error
        currentState.nextBundleUrl = null;
        return of(currentState.resources);
      }),
      finalize(() => {
        currentState.loading = false;
      }),
      switchMap((resources: Resource[]) =>
        // Exclude records added to the cart from the list
        this.cart.getCartChanged(resourceType).pipe(
          startWith(resources),
          map(() =>
            resources.filter(
              (resource) => !this.cart.hasRecord(resourceType, resource)
            )
          )
        )
      ),
      startWith([])
    );
  }

  /**
   * Loads variables for selected research studies.
   * @param selectedResearchStudies - array of selected research studies.
   * @param params - http parameters
   * @param filters - filter values
   * @param sort - the current sort state
   * @param pageNumber - page number to load
   */
  loadVariables(
    selectedResearchStudies: Resource[],
    params: {
      [param: string]: any;
    },
    filters: any,
    sort: Sort,
    pageNumber: number
  ): void {
    const resourceType = 'Variable';
    let currentState;
    if (pageNumber === 0) {
      currentState = {
        loading: true,
        resources: [],
        currentPage: pageNumber,
        totalRecords: 0
      };
      this.currentState[resourceType] = currentState;
    } else {
      currentState = this.currentState[resourceType];
      if (
        currentState?.loading ||
        currentState?.totalRecords <= pageNumber * 50
      ) {
        return;
      }
      currentState.loading = true;
    }

    const dataFields = {
      id: 'uid',
      display_name: 'display_name',
      loinc_long_name: 'loinc.LONG_COMMON_NAME',
      loinc_short_name: 'loinc.SHORTNAME',
      loinc_num: 'loinc_num',
      study_id: 'study_id',
      study_name: 'study_name',
      dataset_id: 'dataset_id',
      dataset_name: 'dataset_name',
      class: 'loinc.CLASS',
      type: 'dbgv.type',
      unit: 'dbgv.unit'
    };

    const url = `https://clinicaltables.nlm.nih.gov/api/dbg_vars/v3/search`;

    const studyIds = selectedResearchStudies.map((r) => r.id + '*');

    const query = [];
    if (studyIds.length) {
      query.push('study_id:(' + studyIds.join(' OR ') + ')');
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        if (key === 'display_name') {
          // Name for display is currently the LOINC short name or dbGap description.
          // To find synonyms, we extended the display name search by additionally
          // searching the long and short LOINC names.
          query.push(`(${dataFields[key]}:(${value}*) OR synonyms:(${value}*))`);
        } else {
          // Use wildcard search for below columns so user can filter by typing a prefix.
          ['id', 'study_id', 'dataset_id', 'type', 'unit'].includes(key)
            ? query.push(`${dataFields[key]}:(${value}*)`)
            : query.push(`${dataFields[key]}:(${value})`);
        }
      }
    });

    const uniqDataFields = [...new Set(Object.values(dataFields))];

    const httpParams = new HttpParams({
      fromObject: {
        offset: pageNumber * 50,
        count: 50,
        df: uniqDataFields.join(','),
        terms: '',
        q: query.join(' AND '),
        ...params,
        ...(sort
          ? {
              of:
                dataFields[sort.active] +
                ':' + sort.direction
            }
          : {})
      }
    });

    currentState.resourceStream = this.http
      .post(url, httpParams.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })
      .pipe(
        map((data: any) => {
          const total = data[0];
          currentState.totalRecords = total;
          const list = data[3];
          if (total && list) {
            list.forEach((item) => {
              const res = {
                resourceType
              };
              const values = {};
              Object.keys(dataFields).forEach((key, index) => {
                values[uniqDataFields[index]] = item[index];
              });
              Object.entries(dataFields).forEach(([key, field]) => {
                res[key] = values[field];
              });
              currentState.resources.push(res);
            });
          }
          currentState.currentPage = pageNumber;
          return currentState.resources;
        }),
        catchError(() => {
          return of(currentState.resources);
        }),
        finalize(() => {
          currentState.loading = false;
        }),
        switchMap((resources: Resource[]) =>
          this.cart.getCartChanged(resourceType).pipe(
            startWith(resources),
            map(() =>
              resources.filter(
                (resource) => !this.cart.hasRecord(resourceType, resource)
              )
            )
          )
        )
      );
  }

  // Loading is complete and there is data in the table
  getHasLoadedData(resourceType: string): boolean {
    return (
      !this.currentState[resourceType]?.loading &&
      this.currentState[resourceType]?.resources.length > 0
    );
  }

  /**
   * Loads the first page of the list of variables for the selected studies
   * from observations.
   * @param selectedResearchStudies - array of selected research studies.
   * @param filters - filter values.
   * @param sort - the current sort state.
   */
  loadFirstPageOfVariablesFromObservations(
    selectedResearchStudies: Resource[],
    filters: any,
    sort: Sort
  ) {
    const resourceType = 'Observation';
    const state: SelectRecordState = {
      loading: true,
      resources: [],
      processedObservationCodes: new Set<string>(),
      totalRecords: 0,
      sortChanged: new Subject<Sort>()
    };
    this.currentState[resourceType] = state;
    this.preloadState[resourceType]?.preloadSubscription.unsubscribe();
    delete this.preloadState[resourceType];

    const subjects$: Observable<Bundle | null> = selectedResearchStudies?.length
      ? this.http.get<Bundle>('$fhir/ResearchSubject', {
        params: {
          _elements: this.fhirBackend.subjectParamName,
          study: selectedResearchStudies.map((s) => 'ResearchStudy/' + s.id).join(',')
        }
      })
      : of(null);

    subjects$.subscribe((bundle) => {
      let subjects: string[] = bundle?.entry
        ?.map((i) => i.resource?.[this.fhirBackend.subjectParamName]?.reference/*.replace(/^Patient\/(.*)/, '$1')*/)
        .filter((i) => i);
      const uniqSubjects = subjects ? uniq(subjects) : [];
      state.subjectsForVariables = {
        current: uniqSubjects,
        processedSubjects: new Set<string>(),
        nextPageUrl: bundle ? this.fhirBackend.getNextPageUrl(bundle) : null,
        lastTime: new Date()
      };
      this.loadVariablesFromObservations(
        state,
        filters,
        sort,
        true
      );
    });

  }

  /**
   * Gets the next page of research subjects for loading variables from observations.
   * @param state
   */
  getNextSubjects(state: SelectRecordState): Observable<any> {
    if (state.subjectsForVariables?.nextPageUrl) {
      return this.http.get(state.subjectsForVariables.nextPageUrl).pipe(
        concatMap((bundle: Bundle) => {
          let subjects = bundle?.entry
            ?.map((i) => i.resource?.[this.fhirBackend.subjectParamName]?.reference/*.replace(/^Patient\/(.*)/, '$1')*/)
            .filter((i) => i);
          state.subjectsForVariables.current.forEach(i => state.subjectsForVariables.processedSubjects.add(i));
          state.subjectsForVariables.current = (subjects ? uniq(subjects) : []).filter(i => !state.subjectsForVariables.processedSubjects.has(i));
          state.subjectsForVariables.nextPageUrl = this.fhirBackend.getNextPageUrl(bundle);
          state.subjectsForVariables.lastTime = new Date();
          return state.subjectsForVariables.current.length ? of(state.subjectsForVariables) : this.getNextSubjects(state);
        })
      );
    } else {
      return of(null);
    }
  }

  /**
   * Loads the next page of the list of variables for the selected studies
   * from observations.
   * @param filters - filter values.
   * @param sort - the current sort state.
   */
  loadNextPageOfVariablesFromObservations(
    filters: any,
    sort: Sort
  ) {
    const resourceType = 'Observation';
    if (this.preloadState[resourceType]) {
      this.preloadState[resourceType].resources = [].concat(
        this.currentState[resourceType].resources,
        this.sortObservationsByVariableColumn(this.preloadState[resourceType].resources, sort)
      );
      this.currentState[resourceType] = this.preloadState[resourceType];
      this.preloadState[resourceType].preloadSubscription.unsubscribe();
      delete this.preloadState[resourceType].preloadSubscription;
      this.currentState[resourceType].sortChanged.next(null);
      delete this.preloadState[resourceType];
    } else {
      const state = this.currentState[resourceType];
      if (state.loading || !state.nextBundleUrl) {
        return;
      }
      state.loading = true;

      this.loadVariablesFromObservations(
        state,
        filters,
        sort,
        false
      );
    }
  }

  /**
   * Preloads the next page of the list of variables for the selected studies
   * from observations.
   * @param filters - filter values.
   * @param sort - the current sort state.
   */
  preloadNextPageOfVariablesFromObservations(
    filters: any,
    sort: Sort
  ) {
    const resourceType = 'Observation';
    const minNumOfRecordsToPreload = 30;
    const currentState = this.currentState[resourceType];
    let preloadState = this.preloadState[resourceType];

    if (
      !currentState || currentState.loading || !currentState.nextBundleUrl ||
      (preloadState && (preloadState.loading || !preloadState.nextBundleUrl ||
        preloadState.resources.length > minNumOfRecordsToPreload))
    ) {
      if (preloadState?.subjectsForVariables && preloadState.subjectsForVariables.nextPageUrl
        && (+new Date() - +preloadState.subjectsForVariables.lastTime) > 20000) {
        // keep alive next page link
        preloadState.subjectsForVariables.lastTime = new Date();
        this.http.get(preloadState.subjectsForVariables.nextPageUrl, {
          context: new HttpContext().set(REQUEST_PRIORITY, RequestPriorities.LOW).set(NO_CACHE, true)
        }).subscribe(() => {
        });
      }
      return;
    }
    if (!this.preloadState[resourceType]) {
      preloadState = {
        ...omit(currentState, ['resources', 'resourceStream', 'sortChanged']),
        resources: [],
        sortChanged: new Subject<Sort>()
      };
      this.preloadState[resourceType] = preloadState;
    }

    preloadState.loading = true;

    preloadState.preloadSubscription = this.loadVariablesFromObservations(
      preloadState, filters, sort, false
    ).subscribe(() => {
    });
  }

  /**
   * Loads a list of variables for selected research studies from observations.
   * @param state - the state of the observation records loading process.
   * @param filters - filter values
   * @param sort - the current sort state
   * @param reset - whether to reset already loaded data
   * @return an Observable of an array of variables
   */
  loadVariablesFromObservations(
    state: SelectRecordState,
    filters: any,
    sort: Sort,
    reset: boolean
  ): Observable<Resource[]> {
    const resourceType = 'Observation';

    // Observation filter parameters
    const obsFilterParams = {
      ...(filters.code
        ? {
            'code:text': modifyStringForSynonyms(
              ObservationCodeLookupComponent.wordSynonymsLookup,
              filters.code
            )
        }
        : {}),
      ...(filters.code_value
        ? {
          code: filters.code_value
        }
        : {}),
      ...(filters.category
        ? {
          'category:text': modifyStringForSynonyms(
            ObservationCodeLookupComponent.wordSynonymsLookup,
            filters.category
          )
        }
        : {}),
      ...(state.subjectsForVariables?.current.length
        ? {
          subject: state.subjectsForVariables?.current.join(',')
        }
        : {}),
      ...(state.processedObservationCodes.size
        ? {
          'code:not': this.fhirBackend.features.hasNotModifierIssue
            ? // Pass a single "code:not" parameter, which is currently working
              // correctly on the HAPI FHIR server.
            Array.from<string>(state.processedObservationCodes.keys()).join(',')
            : // Pass each code as a separate "code:not" parameter, which is
              // currently causing performance issues on the HAPI FHIR server.
            Array.from<string>(state.processedObservationCodes.keys())
        }
        : {})
    };

    // When we use lastn we get only 499 Variables.
    // const lastnLookup =
    //   this.fhirBackend.features.lastnLookup && !references.length;
    const lastnLookup = false;
    const url = lastnLookup
      ? reset
        ? '$fhir/Observation/$lastn?max=1'
        : state.nextBundleUrl
      : '$fhir/Observation';

    const reqParams =
      lastnLookup && !reset
        ? {}
        : {
            _elements: 'code,value,category',
            // TODO: Currently, we can't link Observations to ResearchStudies
            //   through a search parameter. That may be possible in R5. See:
            //   https://build.fhir.org/extension-workflow-researchstudy.html
            //   https://chat.fhir.org/#narrow/stream/179166-implementers/topic/Link.20ObservationDefinition.20to.20ResearchStudy.3F/near/316394306
            ...obsFilterParams,
            _count: 50
          };

    state.resourceStream = this.http.get(url, { params: reqParams }).pipe(
      this.filterObservationsByCode(state),
      this.convertObservationToVariableRecords(state, obsFilterParams, sort),
      catchError(() => {
        // Do not retry after an error
        state.nextBundleUrl = null;
        return of(state.resources);
      }),
      finalize(() => {
        state.loading = false;
      }),
      switchMap(() => {
        let currentSort: Sort = null;
        return combineLatest([
          state.sortChanged.pipe(startWith(currentSort)),
          this.cart.getCartChanged(resourceType).pipe(startWith(state.resources))
        ]).pipe(
          map(([sort]) => {
            if (currentSort?.active !== sort?.active || currentSort?.direction !== sort?.direction) {
              state.resources = this.sortObservationsByVariableColumn(state.resources, sort);
              currentSort = sort;
            }
            return state.resources.filter(
              // Exclude records added to the cart from the list
              (resource) => !this.cart.hasRecord(resourceType, resource)
            );
          })
        );
      }),
      shareReplay()
    );
    return state.resourceStream;
  }

  /**
   * RxJS operator to filter observations by code:
   * - excludes observation with repeated codes
   * - if there are no new codes, load the next page of subjects to search for
   *   other codes on the next run of loadVariablesFromObservations().
   * @param state - current state
   */
  filterObservationsByCode(
    state: SelectRecordState
  ): UnaryFunction<Observable<Bundle>, Observable<Observation[]>> {
    return pipe(
      concatMap((data: Bundle) => {
        const observations = data.entry?.reduce((res, entry) => {
          const obs: Observation = entry.resource as Observation;
          const coding = obs.code.coding?.[0];
          const codeAndSystem = coding
            ? (coding.system ? coding.system : '') + '|' + coding.code
            : null;
          const isNew =
            codeAndSystem &&
            !state.processedObservationCodes.has(codeAndSystem);
          if (isNew) {
            state.processedObservationCodes.add(codeAndSystem);
            res.push(obs);
          }
          return res;
        }, []) || [];

        const nextPage = this.fhirBackend.getNextPageUrl(data);
        let loadNextSubject: Observable<any>;
        if (observations.length === 0 || !nextPage) {
          if (state.subjectsForVariables?.nextPageUrl) {
            loadNextSubject = this.getNextSubjects(state);
            state.nextBundleUrl = 'custom';
          } else {
            // When loading variables from observations using code:not=<loaded codes>,
            // nextBundleUrl is used as a flag that there are observations that have
            // not yet been loaded. If no new codes are found on the current page,
            // then calling the load operation again with the code:not=<loaded codes>
            // parameter will not give new results, so we need to reset the flag.
            state.nextBundleUrl = null;
          }
        } else {
          state.nextBundleUrl = nextPage;
        }

        return (loadNextSubject || of(null))
          .pipe(
            map(() => (observations.length === 0 ? [] : observations))
          );
      })
    );
  }

  /**
   * RxJS operator to converts an array of observations to an array of variable
   * records:
   * - creates a variable record for each code in each observation
   * - exclude codes that don't match filter parameters
   * @param state - current state
   * @param obsFilterParams - observation filter parameters
   * @param sort - the current sort state
   */
  convertObservationToVariableRecords(
    state: SelectRecordState,
    obsFilterParams: { [param: string]: string | string[] },
    sort: Sort
  ): UnaryFunction<Observable<Observation[]>, Observable<Resource[]>> {
    return pipe(
      map((observations: Observation[]) => {
        const reCodeText = obsFilterParams['code:text']
          ? new RegExp(
              '(' +
                (obsFilterParams['code:text'] as string)
                  .split(',')
                  .map((str) => escapeStringForRegExp(str))
                  .join('|') +
                ')',
              'i'
            )
          : null;
        const allowedCodes = (obsFilterParams.code as string)
          ?.trim()
          .split(/\s*,\s*/)
          .filter((code) => code)
          .reduce((acc, code) => {
            acc.add(code.trim());
            return acc;
          }, new Set<string>());

        const newItems = this.sortObservationsByVariableColumn(
          [].concat(
            ...observations.map((obs) => {
              return (
                obs.code.coding
                  .filter((coding) => {
                    // Exclude codes that don't match filters
                    return (
                      (!allowedCodes?.size || allowedCodes.has(coding.code)) &&
                      (!reCodeText || reCodeText.test(coding.display))
                    );
                  })
                  // Create a variable record for each code
                  .map((coding) => ({
                    ...obs,
                    // Replace observation ID with code and system, this ID is
                    // used for identify variable in cart
                    id: coding.system + '|' + coding.code,
                    code: {
                      coding: [coding]
                    }
                  }))
              );
            })
          ),
          sort
        );

        state.resources = state.resources.concat(newItems);

        return state.resources;
      })
    );
  }

  /**
   * Sorts list of variables obtained from observations
   */
  sortObservationsByVariableColumn(resources: Resource[], sort: Sort) {
    let result = resources;

    if (sort) {
      // MatTable shows sort order icons in reverse (see comment to PR on LF-1905).
      const isAsc = sort.direction === 'asc';
      const allColumns = this.columnDescriptionsService.getAvailableColumns(
        'Variable',
        'browse'
      );
      const sortingColumnDescription = allColumns.find(item => item.element === sort.active);
      if (sortingColumnDescription) {
        const filterType = sortingColumnDescription.types.length === 1 && sortingColumnDescription.types[0] === 'Count'
          ? FilterType.Number
          : FilterType.Text;

        const cells: Map<Resource, string> = new Map(resources.map((r: Resource) => [r, this.columnValuesService.getCellStrings(r, sortingColumnDescription).join('; ')]));
        result = [].concat(resources).sort((a: Resource, b: Resource) => {
          const cellValueA = cells.get(a);
          const cellValueB = cells.get(b);
          return filterType === FilterType.Number
            ? (+cellValueA - +cellValueB) * (isAsc ? 1 : -1)
            : cellValueA.localeCompare(cellValueB) * (isAsc ? 1 : -1);
        });
      }
    }

    return result;
  }
}
