/**
 * This file contains a service used to handle HTTP requests to the FHIR server.
 */
import { Injectable, Injector } from '@angular/core';
import { HttpBackend, HttpContextToken, HttpErrorResponse, HttpEvent,
  HttpRequest, HttpResponse, HttpXhrBackend } from '@angular/common/http';
import { BehaviorSubject, Observable, Observer, ReplaySubject } from 'rxjs';
import {
  BASIC_AUTH_REQUIRED,
  FhirBatchQuery,
  HTTP_ABORT,
  OAUTH2_REQUIRED,
  PRIORITIES as FhirBatchQueryPriorities,
  UNSUPPORTED_VERSION
} from './fhir-batch-query.js';
import definitionsIndex from '../definitions/generated-index.json';
import { FhirServerFeatures } from '../../types/fhir-server-features';
import { escapeStringForRegExp, getUrlParam, setUrlParam } from '../utils';
import { SettingsService } from '../settings-service/settings.service';
import { find } from 'lodash-es';
import { filter, map } from 'rxjs/operators';
import { FhirService } from '../fhir-service/fhir.service';
import { Router } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { RasTokenService } from '../ras-token/ras-token.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AlertDialogComponent } from '../alert-dialog/alert-dialog.component';
import { CohortService, CreateCohortMode } from '../cohort/cohort.service';
import fhirPathModelR4 from 'fhirpath/fhir-context/r4';
import fhirPathModelR5 from 'fhirpath/fhir-context/r5';
import fhirpath, { Context, Options } from 'fhirpath';
import { Oauth2TokenService } from '../oauth2-token/oauth2-token.service';
import {
  ScrubberIdDialogComponent
} from '../scrubber-id-dialog/scrubber-id-dialog.component';
import { Resource, Bundle } from 'fhir/r4';

// RegExp to modify the URL of requests to the FHIR server.
// If the URL starts with the substring "$fhir", it will be replaced
// with the current URL of the FHIR REST API database.
const serviceBaseUrlRegExp = /^\$fhir/;

export enum ConnectionStatus {
  Pending = 0,
  Ready,
  Error,
  UnsupportedVersion,
  BasicAuthFailed,
  Oauth2Required,
  Disconnect
}

export enum RequestPriorities {
  LOW = FhirBatchQueryPriorities.LOW,
  NORMAL = FhirBatchQueryPriorities.NORMAL
}

// Token to store cacheName in the context of an HTTP request.
// See https://angular.io/api/common/http/HttpContext
export const CACHE_NAME = new HttpContextToken<string>(() => '');
// Token to store a flag to disable cache in the context of an HTTP request.
// See https://angular.io/api/common/http/HttpContext
export const NO_CACHE = new HttpContextToken<boolean>(() => false);
// Token to store priority in the context of an HTTP request.
// See https://angular.io/api/common/http/HttpContext
export const REQUEST_PRIORITY = new HttpContextToken<number>(
  () => RequestPriorities.NORMAL
);

// Token to store cache info in the context of an HTTP request.
// See https://angular.io/api/common/http/HttpContext
export const CACHE_INFO = new HttpContextToken<{
  timestamp: number;
  expirationTime: number;
}>(() => null);

// A list of resources in dbGap that must have _security params passed along when querying.
const RESOURCES_REQUIRING_AUTHORIZATION = 'Observation|ResearchSubject';

/**
 * This is a final HttpHandler which will dispatch the request via browser HTTP APIs
 * to a backend. Interceptors sit between the HttpClient interface and the
 * HttpBackend. When injected, HttpBackend dispatches requests directly to
 * the backend, without going through the interceptor chain.
 * The main function which handles HTTP requests is called "handle".
 */
@Injectable({
  providedIn: 'root'
})
export class FhirBackendService implements HttpBackend {
  // FHIR REST API Service Base URL (https://www.hl7.org/fhir/http.html#root)
  set serviceBaseUrl(url: string) {
    const dbgapRasLoginServer = sessionStorage.getItem('dbgapRasLoginServer');
    const isRasLogoutNeeded =
      dbgapRasLoginServer && url !== dbgapRasLoginServer;

    if (this.serviceBaseUrl !== url) {
      this.initialized.next(ConnectionStatus.Pending);
      this.smartConnectionSuccess = false;
      this.fhirService.setSmartConnection(null);
      this._isSmartOnFhir = false;
      this.fhirClient.withCredentials = false;
      // Logging out of OAuth2 when changing server
      const oauth2Token = this.injector.get(Oauth2TokenService);
      oauth2Token.oauth2TokenValidated && oauth2Token.logout();
      oauth2Token.isOauth2Required = false;
      // Logging out of RAS when changing server
      if (isRasLogoutNeeded) {
        // Access to RasTokenService via injector to avoid circular dependency
        this.injector.get(RasTokenService).logout();
      }
      this.initializeFhirBatchQuery(url);
    } else if (isRasLogoutNeeded) {
      // Logging out of RAS when changing the "server" URL parameter
      // Access to RasTokenService via injector to avoid circular dependency
      this.injector.get(RasTokenService).logout();
      this.initializeFhirBatchQuery(url);
    }
  }
  get serviceBaseUrl(): string {
    return this.fhirClient?.getServiceBaseUrl();
  }

  /**
   * Whether the previous version is enabled.
   */
  isPreviousVersion = getUrlParam('prev-version') === 'enable';

  // Checkbox value of whether to use a SMART on FHIR client.
  // tslint:disable-next-line:variable-name
  private _isSmartOnFhir = false;
  set isSmartOnFhir(value: boolean) {
    if (value) {
      this.initialized.next(ConnectionStatus.Pending);
      this._isSmartOnFhir = true;
      // Navigate to 'launch' page to authorize a SMART on FHIR connection.
      this.router.navigate(
        [
          '/launch',
          {
            iss: this.serviceBaseUrl,
            redirectUri: setUrlParam(
              'isSmart',
              true,
              setUrlParam(
                'server',
                this.serviceBaseUrl,
                window.location.origin + window.location.pathname + window.location.search)
            )
          }
        ],
        {
          skipLocationChange: true
        }
      );
    } else {
      this.smartConnectionSuccess = false;
      this.fhirService.setSmartConnection(null);
      this._isSmartOnFhir = false;
      this.initialized.next(ConnectionStatus.Pending);
      this.initializeFhirBatchQuery(this.serviceBaseUrl);
    }
  }
  get isSmartOnFhir(): boolean {
    return this._isSmartOnFhir;
  }

  // Maximum number of requests that can be combined
  set maxRequestsPerBatch(value: number) {
    this.fhirClient.setMaxRequestsPerBatch(value);
  }
  get maxRequestsPerBatch(): number {
    return this.fhirClient.getMaxRequestsPerBatch();
  }

  // Maximum number of requests that can be executed simultaneously
  set maxActiveRequests(val: number) {
    this.fhirClient.setMaxActiveRequests(val);
  }
  get maxActiveRequests(): number {
    return this.fhirClient.getMaxActiveRequests();
  }

  // NCBI E-utilities API Key.
  // See https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/
  set apiKey(val: string) {
    this.fhirClient.setApiKey(val);
  }
  get apiKey(): string {
    return this.fhirClient.getApiKey();
  }

  set cacheEnabled(value: boolean) {
    this.isCacheEnabled = value;
    sessionStorage.setItem('isCacheEnabled', value.toString());
    if (!value) {
      FhirBatchQuery.clearCache();
    }
  }
  get cacheEnabled(): boolean {
    return this.isCacheEnabled;
  }

  // An object describing the server features
  get features(): FhirServerFeatures {
    return this.fhirClient.getFeatures();
  }

  // Version name e.g. "R4"
  get currentVersion(): string {
    return this.fhirClient?.getVersionName();
  }

  // FHIRPath model
  fhirPathModel: any;

  // FHIRPath compiled expressions
  compiledExpressions: {
    [expression: string]:
      (row: Resource, envVars?: Context, additionalOptions?: Options) => any
  };

  /**
   * The name of the patient reference search parameter for the ResearchSubject.
   */
  get subjectParamName(): string {
    return this.currentVersion === 'R5' ? 'subject' : 'individual';
  }

  /**
   * Creates and initializes an instance of FhirBackendService
   * @param defaultBackend - default Angular final HttpHandler which uses
   *   XMLHttpRequest to send requests to a backend server.
   * @param fhirService a service which holds the SMART on FHIR connection client
   * @param router Angular router
   * @param injector an Angular injector, which is responsible for creating
   *   service instances and injecting them into classes
   * @param liveAnnouncer a service is used to announce messages for screen-reader
   *   users using an aria-live region.
   * @param dialog MatDialog service from Angular
   */
  constructor(
    private defaultBackend: HttpXhrBackend,
    private fhirService: FhirService,
    private router: Router,
    private injector: Injector,
    private liveAnnouncer: LiveAnnouncer,
    private dialog: MatDialog
  ) {
    // Patch fhirpath.js to use the FHIRBatchQuery for the same serverBaseUrl
    this.patchFhirpathJs();
  }


  /**
   * Patches the FHIRPath library's fetchWithCache function to route requests
   * through the FhirBatchQuery client for URLs starting with the service base
   * URL. For other URLs, falls back to the original fetchWithCache
   * implementation.
   */
  patchFhirpathJs(): void {
    const originalFetchWithCache = fhirpath['util'].fetchWithCache;
    fhirpath['util'].fetchWithCache =
      (url: string, fetchOptions: { [key: string]: string }) => {
      let request: Promise<{ data: any }>;
      if (url.startsWith(this.serviceBaseUrl)) {
        const endpointRegExp = new RegExp(
          `^${escapeStringForRegExp(this.serviceBaseUrl)}\\/[^?]+`);
        const fhirClientOptions =
          fetchOptions?.method?.toUpperCase() === 'POST' ? {
            method: 'POST',
            body: fetchOptions.body
          } : {
            combine: this.fhirClient.getFeatures().batch &&
              endpointRegExp.test(url)
          };
        request = this.isCacheEnabled
          ? this.fhirClient.getWithCache(url, fhirClientOptions)
          : this.fhirClient.get(url, fhirClientOptions);
      }
      return request ? request.then(({ data }) => data)
        : originalFetchWithCache(url, fetchOptions);
    };
  }


  /**
   * Creates and initializes an instance of FhirBackendService.
   * This is moved out of the constructor and now called from HomeComponent, so that
   * the service is not initialized in the token callback routes.
   */
  init(): Promise<void> {
    this.isCacheEnabled = sessionStorage.getItem('isCacheEnabled') !== 'false';
    this._isSmartOnFhir = getUrlParam('isSmart') === 'true';
    const serviceBaseUrl = this.settings.getDefaultServerUrl();
    this.fhirClient = new FhirBatchQuery({
      serviceBaseUrl
    });
    this.currentDefinitions$ = this.initialized.pipe(
      filter((status) => status === ConnectionStatus.Ready),
      map(() => this.getCurrentDefinitions())
    );
    return this.initializeFhirBatchQuery(serviceBaseUrl);
  }

  // Whether the connection to server is initialized.
  initialized = new BehaviorSubject(ConnectionStatus.Pending);
  currentDefinitions$: Observable<any>;

  // Emits when dbGaP re-login is triggered (RAS TST token expired).
  dbgapRelogin$ = new ReplaySubject<void>();

  // Whether to cache requests to the FHIR server
  private isCacheEnabled;

  // Whether to show a checkbox of SMART on FHIR connection.
  public isSmartOnFhirEnabled = false;
  // Whether a SMART on FHIR connection has been successfully established.
  public smartConnectionSuccess = false;

  // Javascript client from the old version of Research Data Finder
  // for FHIR with the ability to automatically combine requests in a batch .
  fhirClient: FhirBatchQuery;

  // Can't be injected in constructor because of circular dependency
  settings: SettingsService;

  // Definitions of columns, search params, value sets for current FHIR version
  private currentDefinitions: any;

  // MatDialogRef that shows dialog box on dbGaP query errors
  dialogRef: MatDialogRef<AlertDialogComponent>;

  // Whether an authorization tag should be added to the url.
  private isAuthorizationRequiredForUrl(url: string): boolean {
    const regEx = new RegExp(`/(${RESOURCES_REQUIRING_AUTHORIZATION})`);
    return this.isDbgap(url) && regEx.test(url);
  }

  /**
   * Checks whether SMART on FHIR connection is available for current base url.
   * Initializes the SMART connection if it's available and this.isSmartOnFhir is
   * already marked as true.
   * @param url - FHIR REST API Service Base URL.
   */
  checkSmartOnFhirEnabled(url: string): Promise<boolean> {
    return this.fhirClient
      .getWithCache(`${url}/.well-known/smart-configuration`, {
        combine: false,
        cacheErrors: true,
        retryCount: 2
      })
      .then(() => {
        this.isSmartOnFhirEnabled = true;
        return true;
      })
      .catch(() => {
        this.isSmartOnFhirEnabled = false;
        return false;
      });
  }

  /**
   * Establish a SMART on FHIR connection.
   */
  initializeSmartOnFhirConnection(): Promise<void> {
    return this.fhirService.requestSmartConnection().then(
      () => {
        this.smartConnectionSuccess = true;
        this.liveAnnouncer.announce('SMART on FHIR connection succeeded.');
        return Promise.resolve();
      },
      () => {
        this.smartConnectionSuccess = false;
        this.initialized.next(ConnectionStatus.Error);
        return Promise.reject();
      }
    );
  }

  /**
   * Opens a dialog to select ScrubberID.
   * @param hasCancelButton - whether to allow the Cancel button.
   * @param serviceBaseUrl - FHIR REST API Service Base URL.
   * @returns a promise that is resolved when the dialog is finished closing.
   */
  selectScrubberId(hasCancelButton: boolean, serviceBaseUrl: string = null): Promise<string|false> {
     return this.dialog.open(ScrubberIdDialogComponent, {
        data : {
          scrubberId: this.fhirClient.getScrubberIDHeader(serviceBaseUrl),
          hasCancelButton
        },
        disableClose: true
      }).afterClosed().toPromise();
  }

  /**
   * Initialize/reinitialize FhirBatchQuery instance
   * @param serviceBaseUrl - new FHIR REST API Service Base URL
   */
  initializeFhirBatchQuery(serviceBaseUrl: string = ''): Promise<void> {
    // If serviceBaseUrl param is omitted, use this.serviceBaseUrl.
    serviceBaseUrl ||= this.serviceBaseUrl;
    // Cleanup definitions before initialize
    this.currentDefinitions = null;

    const needScrubberId = this.settings.get('scrubber', serviceBaseUrl) === true;
    this.fhirClient.setMaxPageSize(this.settings.get('maxPageSize', serviceBaseUrl));
    const currentScrubberID = this.fhirClient.getScrubberIDHeader(serviceBaseUrl) || null;
    let scrubberIdPromise =
      needScrubberId && !currentScrubberID  ?
        this.selectScrubberId(this.settings.get('allowChangeServer', serviceBaseUrl), serviceBaseUrl)
        : Promise.resolve(currentScrubberID);
    return scrubberIdPromise.then((scrubberID) => {
      if (scrubberID !== false) {
        // If the "Cancel" button was not pressed, apply changes
        this.fhirClient.setScrubberIDHeader(scrubberID, serviceBaseUrl);
      }

      return this.checkSmartOnFhirEnabled(serviceBaseUrl)
        .then(() => {
          // Set up SMART connection when it redirects back with a SMART-valid server and "isSmart=true".
          return this.isSmartOnFhirEnabled && this.isSmartOnFhir
            ? this.initializeSmartOnFhirConnection()
            : Promise.resolve();
        })
        .then(() => {
          const isDbgap = this.isDbgap(serviceBaseUrl);
          const isRasLoggedIn = this.injector.get(RasTokenService).rasTokenValidated;
          const isOauth2LoggedIn = this.injector.get(Oauth2TokenService).oauth2TokenValidated;
          // Set authorization header.
          let authorizationHeader;
          const dbgapTstToken =
            isDbgap && sessionStorage.getItem('dbgapTstToken');
          if (dbgapTstToken) {
            authorizationHeader = 'Bearer ' + dbgapTstToken;
          } else if (isOauth2LoggedIn) {
            authorizationHeader = 'Bearer ' + sessionStorage.getItem('oauth2AccessToken');
          } else {
            authorizationHeader = (this.smartConnectionSuccess &&
                this.fhirService.getSmartConnection().getAuthorizationHeader()) ||
              null;
          }
          this.fhirClient.setAuthorizationHeader(authorizationHeader);

          const initializeContext =
            isRasLoggedIn || isOauth2LoggedIn || this.smartConnectionSuccess
              ? 'after-login'
              : isDbgap && !isRasLoggedIn && !this.isPreviousVersion
                ? 'dbgap-pre-login'
                : '';

          this.makeInitializationCalls(serviceBaseUrl, initializeContext);
        });
    });
  }

  /**
   * Calls fhirClient.initialize()
   */
  private makeInitializationCalls(
    serviceBaseUrl: string,
    initializeContext: string
  ): void {
    const serverUrlForSettings = serviceBaseUrl || this.serviceBaseUrl;
    const version: string = this.settings.get('serverDescription.version', serverUrlForSettings);
    const features: FhirServerFeatures = this.settings.get('serverDescription.features', serverUrlForSettings);
    const useCapabilityStatement = this.settings.get('useCapabilityStatement', serverUrlForSettings);
    if (features && !features.maxHasAllowed) {
      // Set default value for maxHasAllowed if it is missed in the serverDescription in settings.json5.
      features.maxHasAllowed = 1;
    }
    this.fhirClient
      .initialize({useCapabilityStatement}, serviceBaseUrl, initializeContext, version && features ? {
        version,
        features
      } : null)
      .then(() => {
          if (initializeContext === 'basic-auth' && !sessionStorage.getItem('basicAuthSuccessMessage')) {
            const message = `Logged in to ${serviceBaseUrl}. To log out, quit your browser.`;
            sessionStorage.setItem('basicAuthSuccessMessage', message);
            this.liveAnnouncer.announce(message);
          }
          // Load definitions of search parameters and columns from CSV file
          this.settings.loadCsvDefinitions().subscribe(
            (resourceDefinitions) => {
              // Filter definitions according to the CapabilityStatement resource
              // if this is enabled in the configuration.
              if (useCapabilityStatement) {
                // Retrieve CapabilityStatement from fhirClient
                const capabilityStatement = this.fhirClient.getCapabilities();
                // Filter searchParameters for each resourceType
                const allowedResourceTypes = (capabilityStatement?.rest?.[0]?.resource || []).map((r: any) => r.type);
                Object.keys(resourceDefinitions).forEach((resourceType) => {
                  if (!allowedResourceTypes.includes(resourceType)) {
                    console.warn(
                      `Resource type '${resourceType}' is not allowed per CapabilityStatement.`
                    );
                    delete resourceDefinitions[resourceType];
                    return;
                  }
                  const resourceEntry = (capabilityStatement.rest[0].resource || []).find(
                    (r: any) => r.type === resourceType
                  );
                  if (resourceEntry && Array.isArray(resourceDefinitions[resourceType].searchParameters)) {
                    const allowedElements = (resourceEntry.searchParam || []).map((sp: any) => sp.name);
                    const originalParams = resourceDefinitions[resourceType].searchParameters;
                    const allowedParams = [];
                    const filteredOut = [];
                    for (const param of originalParams) {
                      if (
                        param.element === 'code text' ||
                        param.element === 'observation value' ||
                        (Array.isArray(param.element)
                          ? param.element.find((elem: string) => allowedElements.includes(elem))
                          : allowedElements.includes(param.element))
                      ) {
                        allowedParams.push(param);
                      } else {
                        filteredOut.push(param);
                      }
                    }
                    if (filteredOut.length > 0) {
                      console.warn(
                        `Search parameters for resource '${resourceType}' that are not allowed per CapabilityStatement:`,
                        filteredOut.map(i => i.element).join(', ') + '.'
                      );
                    }
                    resourceDefinitions[resourceType].searchParameters = allowedParams;
                  }

                  if (!resourceDefinitions[resourceType].searchParameters?.length) {
                    console.warn(
                      `No visible search parameters are available for resource '${resourceType}'.`
                    );
                    delete resourceDefinitions[resourceType];
                  }
                });
              }
              this.currentDefinitions = {resources: resourceDefinitions};
              // Below block should only be run for the first time opening the app.
              // Do not set advanced settings controls if sessionStorage has 'maxPerBatch' stored.
              // They should be set from sessionStorage in cases like refreshing page.
              if (sessionStorage.getItem('maxPerBatch') === null) {
                this.fhirClient.setMaxRequestsPerBatch(
                  this.settings.get('maxRequestsPerBatch')
                );
                this.fhirClient.setMaxActiveRequests(
                  this.settings.get('maxActiveRequests')
                );
              }
              this.fhirPathModel = {
                R4: fhirPathModelR4,
                R5: fhirPathModelR5
              }[this.currentVersion];
              this.compiledExpressions = {};
              this.initialized.next(ConnectionStatus.Ready);
            },
            (err) => {
              if (!(err instanceof HttpErrorResponse)) {
                // Show exceptions from loadCsvDefinitions in console
                console.error(err.message);
              }
              this.initialized.next(ConnectionStatus.Error);
            }
          );
        },
        (err) => {
          if (err.status === BASIC_AUTH_REQUIRED) {
            if (initializeContext === 'basic-auth') {
              // Clear other pending initialization requests if user hits "Cancel" on
              // the credentials challenge, so it won't pop up again.
              this.fhirClient.clearPendingRequests();
              this.initialized.next(ConnectionStatus.BasicAuthFailed);
            } else {
              this.fhirClient.withCredentials = true;
              // Use a new initialize context so the initialization requests will be
              // made again with withCredentials=true.
              initializeContext = 'basic-auth';
              this.makeInitializationCalls(serviceBaseUrl, initializeContext);
            }
          } else if (err.status === OAUTH2_REQUIRED) {
            this.injector.get(Oauth2TokenService).isOauth2Required = true;
            const dialogRef = this.dialog.open(AlertDialogComponent, {
              data: {
                header: 'OAuth2 Authorization Required',
                content:
                  'This server requires authorization through OAuth2.' +
                  ' You will be redirected to the authorization page.',
                hasCancelButton: true
              }
            });
            dialogRef.afterClosed().subscribe((isOk) => {
              if (isOk) {
                this.injector.get(Oauth2TokenService).login(this.serviceBaseUrl);
              } else {
                this.initialized.next(ConnectionStatus.Oauth2Required);
              }
            });
          } else if (err.status !== HTTP_ABORT) {
            this.initialized.next(
              err.status === UNSUPPORTED_VERSION
                ? ConnectionStatus.UnsupportedVersion
                : ConnectionStatus.Error
            );
          }
        }
      );
  }

  /**
   * Prepares the request URL by replacing "$fhir" with serviceBaseURL and
   * adding additional required parameters.
   * @param url - request URL
   */
  prepareRequestUrl(url: string): string {
    const newUrl = url.replace(serviceBaseUrlRegExp, this.serviceBaseUrl);
    // Until authentication is in place for dbGaP, we need to include the
    // consent groups as values for _security.
    // Observation and ResearchSubject queries will be sent with _security params.
    return this.features.consentGroup &&
      this.isAuthorizationRequiredForUrl(newUrl)
      ? this.fhirClient.addParamToUrl(
          newUrl,
          '_security',
          this.features.consentGroup
        )
      : newUrl;
  }

  /**
   * Whether cached response data exists for the URL and has not expired.
   * @param url - URL
   * @param cacheName - cache name for persistent data storage
   *   between sessions, if not specified, gets response data from the temporary
   *   cache that will disappear when the page is reloaded.
   */
  isCached(url: string, cacheName: string): Promise<boolean> {
    return this.fhirClient.isCached(
      this.prepareRequestUrl(url),
      cacheName ? cacheName + '-' + this.serviceBaseUrl : ''
    );
  }

  /**
   * Clears persistent cache data by cache name.
   * @param cacheName - cache name for persistent data storage between
   *   sessions.
   */
  clearCacheByName(cacheName: string): Promise<void> {
    return this.fhirClient.clearCacheByName(
      cacheName + '-' + this.serviceBaseUrl
    );
  }

  /**
   * Handles HTTP requests.
   * All requests which matched to serviceBaseUrlRegExp treated as requests
   * to the current FHIR server. GET requests to the FHIR server could be
   * combined into a batch. FhirBatchQuery from the old version of
   * Research Data Finder is used for that.
   */
  handle(request: HttpRequest<any>): Observable<HttpEvent<any>> {
    if (!this.fhirClient ||
      (!serviceBaseUrlRegExp.test(request.url) &&
      !request.url.startsWith(this.serviceBaseUrl))
    ) {
      // If it is not a request to the FHIR server,
      // pass the request to the default Angular backend.
      return this.defaultBackend.handle(request);
    }

    // A controller object that allows aborting of the HTTP request.
    // See https://developer.mozilla.org/en-US/docs/Web/API/AbortController
    const abortController = new AbortController();
    // A signal object that allows aborting of the HTTP request via
    // the AbortController object.
    // See https://developer.mozilla.org/en-US/docs/Web/API/AbortController
    const signal = abortController.signal;

    const serviceBaseUrlWithEndpoint = new RegExp(
      '^' + escapeStringForRegExp(this.serviceBaseUrl) + '\\/[^?]+'
    );
    const cacheName = request.context.get(CACHE_NAME);
    const priority = request.context.get(REQUEST_PRIORITY);
    const noCache = request.context.get(NO_CACHE);
    const newRequest = request.clone({
      url: this.prepareRequestUrl(request.url)
    });

    if (request.method !== 'GET') {
      // If it is not a GET request to the FHIR server,
      // pass the request to the default Angular backend.
      return this.defaultBackend.handle(newRequest);
    }

    const fullUrl = newRequest.urlWithParams;

    // Otherwise, use the FhirBatchQuery from the old version of
    // Research Data Finder to handle the HTTP request.
    return new Observable<HttpResponse<any>>(
      (observer: Observer<HttpResponse<any>>) => {
        this.fhirClient.initialize().then(() => {
          // Requests to the FHIR server without endpoint cannot be combined
          // into a batch request
          const combine =
            this.fhirClient.getFeatures().batch &&
            serviceBaseUrlWithEndpoint.test(newRequest.url);
          const promise = this.isCacheEnabled && !noCache
            ? this.fhirClient.getWithCache(fullUrl, {
                combine,
                signal,
                cacheName: cacheName
                  ? cacheName + '-' + this.serviceBaseUrl
                  : '',
                priority
              })
            : this.fhirClient.get(fullUrl, { combine, signal, priority });

          promise.then(
            ({ status, data, _cacheInfo_ }) => {
              request.context.set(CACHE_INFO, _cacheInfo_);
              observer.next(
                new HttpResponse<any>({
                  status,
                  body: data,
                  url: fullUrl
                })
              );
              observer.complete();
            },
            ({ status, error }) => {
              if (this.isDbgap(this.serviceBaseUrl) && !this.dialogRef) {
                if (
                  status >= 400 &&
                  status < 500 &&
                  this.injector.get(RasTokenService).rasTokenValidated &&
                  // Don't show session expired message on "browse public data".
                  // Access to CohortService via injector to avoid circular dependency.
                  this.injector.get(CohortService).createCohortMode !==
                    CreateCohortMode.NO_COHORT
                ) {
                  // Current focus might be in an autocomplete-lhc input field, which tries to
                  // refocus the input when it's blurred. We let it blur, but open the dialog
                  // after a delay, to make sure the focus ends up in the dialog.
                  (document.activeElement as HTMLElement).blur();
                  setTimeout(() => {
                    this.liveAnnouncer.announce('A dialog has opened.');
                    this.dialogRef = this.dialog.open(AlertDialogComponent, {
                      data: {
                        header: 'Session Expired',
                        content:
                          'It looks like the session with dbGaP has expired.' +
                          ' You will be returned to the login page so you can login and select consent groups again.',
                        hasCancelButton: true
                      }
                    });
                    this.dialogRef.afterClosed().subscribe((isOk) => {
                      if (isOk) {
                        this.dbgapRelogin$.next();
                      }
                      this.dialogRef = null;
                    });
                  }, 1);

                } else if (status >= 500 && status < 600) {
                  this.dialog.open(AlertDialogComponent, {
                    data: {
                      header: 'Alert',
                      content:
                        'We are unable to connect to dbGaP at this time.',
                      hasCancelButton: false
                    }
                  });
                }
              }
              observer.error(
                new HttpErrorResponse({
                  status,
                  error,
                  url: fullUrl
                })
              );
            }
          );
        });
        // This is the return from the Observable function, which is the
        // request cancellation handler.
        return () => {
          abortController.abort();
        };
      }
    );
  }

  /**
   * Disconnect from server (run on destroying the main component)
   */
  disconnect(): void {
    this.initialized.next(ConnectionStatus.Disconnect);
  }

  /**
   * Returns definitions of columns, search params, value sets for current FHIR version
   */
  getCurrentDefinitions(): any {
    // Prepare CSV definitions only on first call
    if (this.currentDefinitions?.initialized) {
      return this.currentDefinitions;
    }

    const versionName = this.currentVersion || 'R4';
    let definitions = definitionsIndex.configByVersionName[versionName];

    // Initialize common definitions
    if (!definitions.initialized) {
      // Add default common column "id"
      Object.keys(definitions.resources).forEach((resourceType) => {
        definitions.resources[resourceType].columnDescriptions.unshift({
          types: ['string'],
          element: 'id',
          isArray: false
        });
      });

      // Normalize spec definitions
      Object.keys(definitions.resources).forEach((resourceType) => {
        definitions.resources[resourceType].searchParameters.forEach(
          (param) => {
            param.element = param.displayName = param.name;
            delete param.name;
          }
        );
      });

      // Prepare spec definitions only on first call
      const valueSets = definitions.valueSets;
      const valueSetMaps = (definitions.valueSetMaps = Object.keys(
        valueSets
      ).reduce((valueSetsMap, entityName) => {
        valueSetsMap[entityName] =
          typeof valueSets[entityName] === 'string'
            ? valueSets[entityName]
            : valueSets[entityName].reduce((entityMap, item) => {
                entityMap[item.code] = item.display;
                return entityMap;
              }, {});
        return valueSetsMap;
      }, {}));

      Object.keys(definitions.valueSetByPath).forEach((path) => {
        definitions.valueSetMapByPath[path] =
          valueSetMaps[definitions.valueSetByPath[path]];
        definitions.valueSetByPath[path] =
          valueSets[definitions.valueSetByPath[path]];
      });
      definitions.initialized = true;
    }

    // Merge definitions(from spec) with currentDefinitions(from CSV)
    // TODO: Modify the webpack loader to exclude unnecessary data retrieving
    //       from the specification
    this.currentDefinitions = {
      ...definitions,
      resources: this.currentDefinitions.resources
    };

    Object.keys(this.currentDefinitions.resources).forEach((resourceType) => {
      // Array of current parameter definitions to be updated
      const currentParameters = this.currentDefinitions.resources[resourceType]
        .searchParameters;
      // Array of parameter definitions from the specification
      const specParameters =
        definitions.resources[resourceType]?.searchParameters;
      if (specParameters) {
        // For each parameter, finds corresponding spec parameters by splitting
        // the element string. If multiple elements are present, merges their
        // properties as arrays. Otherwise, merges properties from the single
        // corresponding spec parameter.
        currentParameters.forEach((parameter) => {
          if (Array.isArray(parameter.element)) {
            const correspondingSpecParams = parameter.element.map(
              (element) => find(specParameters, { element })
            );
            if (correspondingSpecParams.some((p) => p)) {
              Object.assign(parameter, {
                rootPropertyName: correspondingSpecParams.map(p => p?.rootPropertyName),
                expression: correspondingSpecParams.map(p => p?.expression),
                // path: specParameters.map(p => p?.path),
                valueSet: correspondingSpecParams.map(p => p?.valueSet),
                required: correspondingSpecParams.map(p => p?.required),
                type: parameter.element.map((element) =>
                  find(currentParameters, {element})?.type)
              });
            }
          } else {
            const correspondingSpecParam = find(specParameters, {
              element: parameter.element
            });
            if (correspondingSpecParam) {
              Object.assign(parameter, {
                rootPropertyName: correspondingSpecParam.rootPropertyName,
                expression: correspondingSpecParam.expression,
                // path: correspondingSpecParam.path,
                valueSet: correspondingSpecParam.valueSet,
                required: correspondingSpecParam.required
              });
            }
          }
        });
      }
    });

    // Add interpretation search parameter if applicable.
    if (this.features.interpretation) {
      const observationSearchParams = this.currentDefinitions.resources
        .Observation?.searchParameters;
      if (
        observationSearchParams &&
        !observationSearchParams.some((sp) => sp.element === 'interpretation')
      ) {
        observationSearchParams.push({
          element: 'interpretation',
          displayName: 'interpretation',
          description:
            'A categorical assessment, providing a rough qualitative interpretation of the observation value',
          type: 'CodeableConcept',
          isArray: false
        });
        observationSearchParams.sort((a, b) =>
          a.element.localeCompare(b.element)
        );
      }
    }

    this.currentDefinitions.initialized = true;
    return this.currentDefinitions;
  }

  /**
   * Whether the URL is dbGap (https://dbgap-api.ncbi.nlm.nih.gov/fhir*).
   */
  isDbgap(url): boolean {
    const urlPattern = this.settings.getDbgapUrlPattern();
    return urlPattern ? new RegExp(urlPattern).test(url) : false;
  }

  /**
   * Clears cache data.
   */
  clearCache(): void {
    FhirBatchQuery.clearCache();
  }

  /**
   * Returns a function for evaluating the passed FHIRPath expression using
   * the current FHIRPath model.
   * If the expression is not already compiled, it compiles and caches it.
   *
   * @param expression - FHIRPath expression to compile and evaluate.
   * @returns A function that takes a FHIR Resource and returns the evaluation result.
   */
  getEvaluator(expression: string): (row: Resource, envVars?: Context, additionalOptions?: Options) => any {
    let compiledExpression = this.compiledExpressions[expression];
    if (!compiledExpression) {
      compiledExpression = fhirpath.compile(
        expression,
        this.fhirPathModel,
        {
          terminologyUrl: this.serviceBaseUrl,
          async: true
        }
      );
      this.compiledExpressions[expression] = compiledExpression;
    }
    return compiledExpression;
  }

  /**
   * Extracts next page URL from a bundle (see: https://www.hl7.org/fhir/http.html#paging)
   */
  getNextPageUrl(response: Bundle): string | undefined {
    let nextPageUrl = response.link?.find((l) => l.relation === 'next')?.url || null;
    // Workaround for LF2383.
    if (nextPageUrl && nextPageUrl.startsWith('http:') && this.serviceBaseUrl.startsWith('https:')) {
      nextPageUrl = nextPageUrl.replace('http:', 'https:');
    }
    return nextPageUrl;
  }
}
