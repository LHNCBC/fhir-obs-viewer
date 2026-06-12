import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ObservationCodeLookupComponent
} from './observation-code-lookup.component';
import { ObservationCodeLookupModule } from './observation-code-lookup.module';
import { Component, ViewChild } from '@angular/core';
import { ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { SharedModule } from '../../shared/shared.module';
import { FhirBatchQuery } from '../../shared/fhir-backend/fhir-batch-query';
import observations from './test-fixtures/observations.json';
import observationsDuplicateDisplay
  from './test-fixtures/observations_duplicate_display.json';
import { HttpTestingController } from '@angular/common/http/testing';
import { CartService } from '../../shared/cart/cart.service';
import {
  configureTestingModule,
  verifyOutstandingRequests
} from 'src/test/helpers';
import { CohortService } from '../../shared/cohort/cohort.service';
import {
  ConnectionStatus,
  FhirBackendService
} from '../../shared/fhir-backend/fhir-backend.service';
import {
  SettingsService
} from '../../shared/settings-service/settings.service';
import { filter, take } from 'rxjs/operators';

@Component({
  template: `
    <mat-form-field class="flex">
      <mat-label>Observation codes from FHIR server</mat-label>
      <app-observation-code-lookup
          [formControl]="selectedObservationCodes"
          [isPullData]="isPullData"
          placeholder="Type and select one or more"
      >
      </app-observation-code-lookup>
    </mat-form-field>`,
  standalone: false
})
class TestHostComponent {
  @ViewChild(ObservationCodeLookupComponent)
  component: ObservationCodeLookupComponent;
  isPullData = false;
  selectedObservationCodes = new UntypedFormControl({
    coding: [{code: '3137-7', system: 'http://loinc.org'}],
    items: ['Height cm'],
    datatype: 'Quantity',
    defaultUnit: 'cm',
    defaultUnitSystem: 'http://unitsofmeasure.org'
  });
}

describe('ObservationCodeLookupComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostComponent: TestHostComponent;
  let component: ObservationCodeLookupComponent;

  /**
   * Sends keydown event to specified input
   */
  function keyDownInAutocompleteInput(
    input: HTMLInputElement,
    keyCode: number
  ): Promise<void> {
    // @ts-ignore keyCode is deprecated, but autocomplete-lhc uses this property
    input.dispatchEvent(new KeyboardEvent('keydown', { keyCode }));
    // Let autocompleter and ObservationCodeLookupComponent to react on keydown event
    return new Promise((resolve) => {
      setTimeout(() => resolve(), 500);
    });
  }

  [
    {
      description: 'when "lastn" operation is supported',
      beforeEachFn: () => {
        spyOn(FhirBatchQuery.prototype, 'getWithCache').and.callFake((url) => {
          const HTTP_OK = 200;
          const HTTP_ERROR = 404;
          if (/Duplicate/i.test(url)) {
            return Promise.resolve({
              status: HTTP_OK,
              data: observationsDuplicateDisplay
            });
          } else if (/\$lastn\?/.test(url) || /Observation/.test(url)) {
            return Promise.resolve({ status: HTTP_OK, data: observations });
          } else if (/\/\.well-known\/smart-configuration/.test(url)) {
            return Promise.reject({ status: HTTP_ERROR, error: 'error' });
          }
        });
      }
    },
    {
      description: 'when "lastn" operation is not supported',
      beforeEachFn: () => {
        spyOn(FhirBatchQuery.prototype, 'getWithCache').and.callFake((url) => {
          const HTTP_OK = 200;
          const HTTP_ERROR = 404;
          if (/Duplicate/i.test(url)) {
            return Promise.resolve({
              status: HTTP_OK,
              data: observationsDuplicateDisplay
            });
          } else if (/Observation/.test(url)) {
            return /code:not/.test(url)
              ? Promise.resolve({ status: HTTP_OK, data: observations })
              : Promise.resolve({
                  status: HTTP_OK,
                  data: {
                    link: [
                      {
                        relation: 'next',
                        url: 'someUrl'
                      }
                    ],
                    entry: observations.entry
                  }
                });
          } else if (/\/\.well-known\/smart-configuration/.test(url)) {
            return Promise.reject({ status: HTTP_ERROR, error: 'error' });
          }
        });
      }
    }
  ].forEach(({ description, beforeEachFn }) => {
    describe(description, () => {
      beforeEach(async () => {
        await TestBed.configureTestingModule({
          declarations: [TestHostComponent],
          imports: [
            CommonModule,
            ReactiveFormsModule,
            MatFormFieldModule,
            ObservationCodeLookupModule,
            SharedModule
          ]
        }).compileComponents();
      });

      beforeEach(async () => {
        beforeEachFn();
        spyOn(FhirBatchQuery.prototype, 'initialize').and.resolveTo(null);
        const fhirBackend = TestBed.inject(FhirBackendService);
        const settingsService = TestBed.inject(SettingsService);
        spyOnProperty(fhirBackend, 'currentVersion').and.returnValue('R4');
        spyOnProperty(fhirBackend, 'features').and.returnValue({
          isFormatSupported: true,
          hasResearchStudy: false,
          missingModifier: false,
          batch: true,
          sortObservationsByDate: true,
          sortObservationsByAgeAtEvent: false,
          lastnLookup: !description.includes('not supported'),
          interpretation: false,
          hasNotModifierIssue: false,
          hasAvailableStudy: false
        });

        // Mock the scrubber ID selection to return null
        spyOn(fhirBackend, 'selectScrubberId').and.resolveTo(null);

        // Mock defaultPullDataCount to 1000 to avoid issues with tests
        const originalGet = settingsService.get.bind(settingsService);
        spyOn(settingsService, 'get').and.callFake(function(prop, ...rest) {
          if (prop === 'useCapabilityStatement') {
            return false;
          }
          // Call the original
          return originalGet(prop, ...rest);
        });

        settingsService.loadJsonConfig().subscribe(() => {
          fhirBackend.init();
        });
        await fhirBackend.initialized
          .pipe(
            filter((status) => status === ConnectionStatus.Ready),
            take(1)
          )
          .toPromise();
        fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();
        hostComponent = fixture.componentInstance;
        component = hostComponent.component;
      });

      it('should create', () => {
        expect(component).toBeTruthy();
      });

      it('should initialize autocomplete correctly', () => {
        expect(component.acInstance).toBeTruthy();
        expect(component.acInstance.getSelectedCodes()).toEqual(
          hostComponent.selectedObservationCodes.value.coding
        );
        expect(component.acInstance.getSelectedItems()).toEqual(
          hostComponent.selectedObservationCodes.value.items
        );
      });

      it('should be able to select an additional item', async () => {
        // get the input element from the DOM
        const hostElement = fixture.nativeElement;
        const input: HTMLInputElement = hostElement.querySelector('input');

        // simulate user entering a new text into the input box
        input.value = 'H';
        const ARROW_DOWN = 40;
        const ENTER = 13;
        input.focus();
        await keyDownInAutocompleteInput(input, ARROW_DOWN);
        // Check if autocompleter displays the dropdown list
        expect(
          (document.querySelector('#lhc-tools-searchResults') as HTMLElement).style
            .visibility
        ).toBe('visible');
        await keyDownInAutocompleteInput(input, ARROW_DOWN);
        await keyDownInAutocompleteInput(input, ENTER);

        const requestedUrls = FhirBatchQuery.prototype.getWithCache.calls
          .allArgs()
          .map((params) => params[0]);

        // use "code:not" when $last is not used
        expect(requestedUrls).toContain(
          jasmine.stringMatching(
            /(code:not=http:\/\/loinc.org%7C11881-0&code:not=http:\/\/loinc.org%7C3137-7&code:not=http:\/\/loinc.org%7C8302-2&code:not=http:\/\/loinc.org%7C8303-0|(\$lastn.*&code:text=H))/
          )
        );

        // search by text
        expect(requestedUrls).toContain(
          jasmine.stringMatching(/&code:text=H/)
        );

        // search by code
        expect(requestedUrls).toContain(
          jasmine.stringMatching(/&code=H/)
        );

        expect(hostComponent.selectedObservationCodes.value.coding.length).toBe(
          2
        );
      });

      it('should show distinct code and system for duplicate display', async () => {
        // clear autocomplete selected value
        hostComponent.selectedObservationCodes.setValue(null);
        // get the input element from the DOM
        const hostElement = fixture.nativeElement;
        const input: HTMLInputElement = hostElement.querySelector('input');

        // simulate user entering a new text into the input box
        input.value = 'Duplicate';
        const ARROW_DOWN = 40;
        const ENTER = 13;
        input.focus();
        await keyDownInAutocompleteInput(input, ARROW_DOWN);
        // Check if autocompleter displays the dropdown list
        expect(
          (document.querySelector('#lhc-tools-searchResults') as HTMLElement).style
            .visibility
        ).toBe('visible');
        await keyDownInAutocompleteInput(input, ARROW_DOWN);
        await keyDownInAutocompleteInput(input, ENTER);
        await keyDownInAutocompleteInput(input, ARROW_DOWN);
        await keyDownInAutocompleteInput(input, ENTER);
        await keyDownInAutocompleteInput(input, ARROW_DOWN);
        await keyDownInAutocompleteInput(input, ENTER);

        expect(hostComponent.selectedObservationCodes.value.coding.length).toBe(
          3
        );
        expect(hostComponent.selectedObservationCodes.value.items).toEqual([
          'Duplicate Display | code1 | system1',
          'Duplicate Display | code2 | system1',
          'Duplicate Display' // This text could be
                              // 'Duplicate Display | code3 | system2'
                              // if we had not excluded the selected codes.
        ]);
      });
    });
  });
});

describe('ObservationCodeLookupComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostComponent: TestHostComponent;
  let component: ObservationCodeLookupComponent;

  let mockHttp: HttpTestingController;
  let cartService: CartService;
  let cohortService: CohortService;


  beforeEach(async () => {
    await configureTestingModule(
      {
        declarations: [TestHostComponent],
        imports: [
          CommonModule,
          ReactiveFormsModule,
          MatFormFieldModule,
          ObservationCodeLookupModule,
          SharedModule
        ]
      },
      {
        features: {
          hasResearchStudy: true,
          hasAvailableStudy: true
        },
        serverUrl: 'https://dbgap-api.ncbi.nlm.nih.gov/fhir/x1'
      }
    );
    mockHttp = TestBed.inject(HttpTestingController);
    cartService = TestBed.inject(CartService);
    cohortService = TestBed.inject(CohortService);
  });


  beforeEach(() => {
    fixture = TestBed.createComponent(TestHostComponent);
    hostComponent = fixture.componentInstance;
    hostComponent.isPullData = true;
    fixture.detectChanges();
    component = hostComponent.component;
  });


  afterEach(() => {
    // Verify that no unmatched requests are outstanding
    verifyOutstandingRequests(mockHttp);
  });


  it('should use Observations from FHIR server in the pull data step if we don\'t have studies in the cart', () => {
    spyOn(cartService, 'getListItems').and.callFake(() => []);
    spyOn(component, 'setupAutocompleteInputToUseCTSS').and.callThrough();
    spyOn(component, 'setupAutocompleteInputToUseObservations').and.callThrough();
    // @ts-ignore Access to private method
    spyOn(component, 'updateAutocomplete').and.callThrough();
    cohortService.resetCriteria();
    expect(component.setupAutocompleteInputToUseCTSS).not.toHaveBeenCalled();
    expect(component.setupAutocompleteInputToUseObservations).toHaveBeenCalledOnceWith();
    // @ts-ignore Access to private method
    expect(component.updateAutocomplete).toHaveBeenCalledOnceWith();
  });


  it('should use variables from CTSS in the pull data step if we have studies in the cart', () => {
    spyOn(cartService, 'getListItems').and.callFake((resourceType) => {
      return resourceType === 'ResearchStudy' ? [{id: 'someStudyId', resourceType: 'Study'}] : [];
    });
    spyOn(component, 'setupAutocompleteInputToUseCTSS').and.callThrough();
    spyOn(component, 'setupAutocompleteInputToUseObservations').and.callThrough();
    // @ts-ignore Access to private method
    spyOn(component, 'updateAutocomplete').and.callThrough();
    cohortService.resetCriteria();
    expect(component.setupAutocompleteInputToUseCTSS).toHaveBeenCalledOnceWith();
    expect(component.setupAutocompleteInputToUseObservations).not.toHaveBeenCalled();
    // @ts-ignore Access to private method
    expect(component.updateAutocomplete).toHaveBeenCalledOnceWith();
  });
});
