/**
 * This file contains helper functions for unit tests.
 */
import { TestBed, TestModuleMetadata } from '@angular/core/testing';
import { SharedModule } from '../app/shared/shared.module';
import {
  ConnectionStatus,
  FhirBackendService
} from '../app/shared/fhir-backend/fhir-backend.service';
import { FhirBatchQuery } from '../app/shared/fhir-backend/fhir-batch-query';
import {
  SettingsService
} from '../app/shared/settings-service/settings.service';
import { filter, take } from 'rxjs/operators';
import {
  HttpTestingController, provideHttpClientTesting
} from '@angular/common/http/testing';
import { HttpRequest } from '@angular/common/http';

/**
 * Wrapper for standard TestBed.configureTestingModule which does additional
 * preparation specific to the project environment:
 *  - mocks FhirBatchQuery prototype functions to remove unnecessary request to
 *  backend.
 *  - loads JSON configuration.
 *  - allows to redefine definitions of columns, search params, and value sets.
 * @param moduleDef - parameter for TestBed.configureTestingModule
 * @param options - object with additional options:
 * @param options.definitions - object which will be returned by
 *   FhirBackendService.getCurrentDefinitions.
 */
export async function configureTestingModule(
  moduleDef: TestModuleMetadata,
  options: {
    definitions?: any;
    features?: any;
    serverUrl?: string;
    isSmartOnFhirEnabled?: boolean;
    skipInitApp?: boolean;
    settingsOverrides?: { [key: string]: any };
  } = {}
): Promise<void> {
  moduleDef.imports = (moduleDef.imports || []).concat(
    SharedModule
  );
  moduleDef.providers = (moduleDef.providers || []).concat(
    provideHttpClientTesting()
  );
  await TestBed.configureTestingModule(moduleDef).compileComponents();
  spyOn(FhirBatchQuery.prototype, 'initialize').and.resolveTo(null);
  const spySmartConfiguration = spyOn(
    FhirBatchQuery.prototype,
    'getWithCache'
  ).withArgs(
    jasmine.stringMatching(/\/\.well-known\/smart-configuration/),
    jasmine.any(Object)
  );
  if (options.isSmartOnFhirEnabled) {
    spySmartConfiguration.and.resolveTo(null);
  } else {
    spySmartConfiguration.and.rejectWith(null);
  }
  const fhirBackend = TestBed.inject(FhirBackendService);
  spyOnProperty(fhirBackend, 'currentVersion').and.returnValue('R4');
  spyOnProperty(fhirBackend, 'features').and.callFake(() => ({
    lastnLookup: true,
    sortObservationsByDate: true,
    sortObservationsByAgeAtEvent: false,
    ...(options.features ? options.features : {})
  }));

  // Mock service base URL to apply default settings
  spyOnProperty(fhirBackend, 'serviceBaseUrl').and.returnValue(
    options.serverUrl || 'someDefaultURL'
  );

  // Mock the scrubber ID selection to return null
  spyOn(fhirBackend, 'selectScrubberId').and.resolveTo(null);

  const settingsService = TestBed.inject(SettingsService);
  const mockHttp = TestBed.inject(HttpTestingController);

  // Mock defaultPullDataCount to 1000 to avoid issues with tests
  const originalGet = settingsService.get.bind(settingsService);
  spyOn(settingsService, 'get').and.callFake(function(prop, ...rest) {
    if (prop === 'defaultPullDataCount') {
      return 1000;
    }
    if (prop === 'useCapabilityStatement') {
      return false;
    }
    if (options.settingsOverrides && prop in options.settingsOverrides) {
      return options.settingsOverrides[prop];
    }

    // Call the original
    return originalGet(prop, ...rest);
  });

  if (!options.skipInitApp) {
    settingsService.loadJsonConfig().subscribe(() => {
      fhirBackend.init();
    });

    await flushSettingsRequests(mockHttp);

    await fhirBackend.initialized
      .pipe(
        filter((status) => status === ConnectionStatus.Ready),
        take(1)
      )
      .toPromise();
  }

  if (options.definitions) {
    spyOn(fhirBackend, 'getCurrentDefinitions').and.returnValue(
      options.definitions
    );
  }
}


/**
 * Flushes settings and generated definitions requests from source assets.
 * @param mockHttp - HTTP testing controller.
 */
export async function flushSettingsRequests(
  mockHttp: HttpTestingController
): Promise<void> {
  // Pass-through for settings file
  mockHttp
    .expectOne(`conf/settings.json5`)
    .flush(await fetch('conf/settings.json5').then((r) => r.text()));

  // We can't expect a request before it is issued, so we give a chance to issue
  // a request
  setTimeout(() => {
    // Pass-through for CSV files
    const request = mockHttp.expectOne((req) => {
      if (req.url.startsWith('conf/csv')) {
        fetch(req.url)
          .then((r) => r.text())
          .then((responseText) => {
            request.flush(responseText);
          });
        return true;
      }
      return false;
    });
  }, 20);
}


/**
 * Verify that no unmatched requests except for SVG icons are outstanding
 */
export function verifyOutstandingRequests(
  mockHttp: HttpTestingController
): void {
  const outstandingRequests = [];
  mockHttp
    .match((request: HttpRequest<any>) => {
      const isSvg = /assets\/.*\.svg/.test(request.url);
      if (!isSvg) {
        outstandingRequests.push(request.urlWithParams);
      }
      return isSvg;
    })
    .forEach((testReq) => !testReq.cancelled && testReq.flush('<svg></svg>'));

  // Instead of using `mockHttp.verify();` we use custom handling of outstanding
  // requests to show full URLs:
  if (outstandingRequests.length) {
    throw new Error(
      `Expected no open requests, found ${outstandingRequests.length}:\n${outstandingRequests.join('\n')}`
    );
  }
}
