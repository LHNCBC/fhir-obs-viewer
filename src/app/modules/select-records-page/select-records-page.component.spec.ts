import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectRecordsPageComponent } from './select-records-page.component';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  configureTestingModule,
  verifyOutstandingRequests
} from 'src/test/helpers';
import { SelectRecordsPageModule } from './select-records-page.module';
import { HttpTestingController } from '@angular/common/http/testing';
import researchStudies from 'src/test/test-fixtures/research-studies.json';
import threeVariables from 'src/test/test-fixtures/variables-3.json';
import fourVariables from 'src/test/test-fixtures/variables-4.json';
import observationsByCodePhv00492021 from 'src/test/test-fixtures/observations-by-code-phv00492021.v1.p1.json';
import observationsByCodePhv00492022 from 'src/test/test-fixtures/observations-by-code-phv00492022.v1.p1.json';
import observationsByCodePhv00492024 from 'src/test/test-fixtures/observations-by-code-phv00492024.v1.p1.json';
import observationsByCodePhv00492025 from 'src/test/test-fixtures/observations-by-code-phv00492025.v1.p1.json';
import { MatTabGroupHarness } from '@angular/material/tabs/testing';
import { HttpParams, HttpRequest } from '@angular/common/http';
import { MatTableHarness } from '@angular/material/table/testing';
import { CohortService } from '../../shared/cohort/cohort.service';
import tenPatientBundle
  from '../step-2-define-cohort-page/test-fixtures/patients-10.json';
import observations from './test-fixtures/observations.json';
import { CartService } from '../../shared/cart/cart.service';
import {
  ResourceTableComponent
} from '../resource-table/resource-table.component';
import { last } from 'rxjs/operators';
import { MatIconTestingModule } from '@angular/material/icon/testing';

describe('SelectRecordsPageComponent (when there are studies for the user)', () => {
  let component: SelectRecordsPageComponent;
  let fixture: ComponentFixture<SelectRecordsPageComponent>;
  let mockHttp: HttpTestingController;
  let loader: HarnessLoader;
  let cohortService: CohortService;
  let cartService: CartService;
  const code2observations = {
    'phv00492021.v1.p1': observationsByCodePhv00492021,
    'phv00492022.v1.p1': observationsByCodePhv00492022,
    'phv00492024.v1.p1': observationsByCodePhv00492024,
    'phv00492025.v1.p1': observationsByCodePhv00492025
  };
  const statuses = [
    'candidate',
    'eligible',
    'follow-up',
    'ineligible',
    'not-registered',
    'off-study',
    'on-study',
    'on-study-intervention',
    'on-study-observation',
    'pending-on-study',
    'potential-candidate',
    'screening,withdrawn'
  ];

  beforeEach(async () => {
    await configureTestingModule(
      {
        declarations: [SelectRecordsPageComponent],
        imports: [SelectRecordsPageModule, MatIconTestingModule]
      },
      {
        features: {
          hasResearchStudy: true,
          hasAvailableStudy: true,
          maxHasAllowed: 2
        },
        serverUrl: 'https://dbgap-api.ncbi.nlm.nih.gov/fhir/x1'
      }
    );
    mockHttp = TestBed.inject(HttpTestingController);
    cohortService = TestBed.inject(CohortService);
    cartService = TestBed.inject(CartService);
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(SelectRecordsPageComponent);
    loader = TestbedHarnessEnvironment.loader(fixture);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // The first call to getHarness in the expectNumberOfRecords function will
    // never end if the interval is active. This looks like a bug.
    // As a workaround, just do not create the "interval()":
    spyOn(
      ResourceTableComponent.prototype,
      'runPreloadEvents'
    ).and.callFake(() => {});
  });

  afterEach(() => {
    // Verify that no unmatched requests are outstanding
    verifyOutstandingRequests(mockHttp);
  });

  /**
   * Load studies at the beginning
   */
  async function loadStudies(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    mockHttp
      .expectOne(
        `$fhir/ResearchStudy?_count=3000&_has:ResearchSubject:study:status=${statuses.join(
          ','
        )}`
      )
      .flush(researchStudies);
    await expectNumberOfRecords(2);
  }

  /**
   * Selects a tab by label
   * @param label - tab's label
   */
  async function selectTab(label: string): Promise<void> {
    const tabGroup = await loader.getHarness(MatTabGroupHarness);
    return tabGroup.selectTab({ label });
  }

  /**
   * Creates an expectation for the number of records on the current tab.
   * @param n - number of expected records
   */
  async function expectNumberOfRecords(n: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    const tabGroup = await loader.getHarness(MatTabGroupHarness);
    const currentTab = await tabGroup.getSelectedTab();
    const table = await currentTab.getHarness(MatTableHarness);
    const rows = await table.getRows();
    expect(rows.length).toBe(n);
  }

  /**
   * Go to variables tab and load variables.
   * @param query - value of the q parameter for the request to the CTSS.
   */
  async function loadVariables(query = ''): Promise<void> {
    const runPreloadEventsSpy = ResourceTableComponent.prototype
      .runPreloadEvents as jasmine.Spy;
    runPreloadEventsSpy.calls.reset();
    const selectVariablesTabPromise = selectTab('Variables');
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    const preloadCallsBeforeResponse = runPreloadEventsSpy.calls.count();
    mockHttp
      .expectOne((req: HttpRequest<any>) => {
        return (
          req.url ===
            'https://clinicaltables.nlm.nih.gov/api/dbg_vars/v3/search' &&
          new HttpParams({ fromString: req.body }).get('q') ===
            (query ? query : 'study_id:(phs002410* OR phs002409*)')
        );
      })
      .flush(query ? threeVariables : fourVariables);
    await selectVariablesTabPromise;
    // TODO: In Angular 19, we need "resize" event to trigger rendering table here
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(runPreloadEventsSpy.calls.count()).toBeGreaterThan(
      preloadCallsBeforeResponse
    );
    await expectNumberOfRecords(query ? 3 : 4);
  }

  /**
   * Adds the second study from the list to the cart.
   */
  async function addSecondStudyToCart(): Promise<void> {
    const secondStudy = component.resourceTable.dataSource.data.find(
      (row) => row.resource.id === 'phs002409'
    )?.resource;
    if (!secondStudy) {
      fail('Expected phs002409 to be loaded in the studies table.');
      return;
    }
    component.addRecordsToCart('ResearchStudy', [secondStudy]);

    // One study in the cart
    expect(cartService.getListItems('ResearchStudy').length).toEqual(1);
    expect((cartService.getListItems('ResearchStudy')[0] as any).id).toEqual(
      'phs002409'
    );
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load studies at the beginning', async () => {
    await loadStudies();
  });

  it('should load variables when the selected tab changes', async () => {
    await loadStudies();
    await loadVariables();
  });

  it('should reload variables when the selected studies changes', async () => {
    await loadStudies();
    await loadVariables();
    await selectTab('Studies');
    await addSecondStudyToCart();
    await loadVariables('study_id:(phs002409*)');
    await selectTab('Studies');
    // Remove the study from the cart
    component.removeRecordFromCart(
      'ResearchStudy',
      cartService.getListItems('ResearchStudy')[0]
    );
    // No studies in the cart
    expect(cartService.getListItems('ResearchStudy').length).toEqual(0);

    await loadVariables();
  });

  it('should search for patients by study in the cart', async () => {
    await loadStudies();
    await addSecondStudyToCart();

    component.searchForPatients();
    cohortService.patientStream.subscribe();

    mockHttp
      .expectOne(
        '$fhir/Patient?_count=100&_has:ResearchSubject:individual:study=phs002409'
      )
      .flush(tenPatientBundle);
  });

  /**
   * Adds variables to the cart.
   */
  async function addVariablesToCart(): Promise<void> {
    const variableResources = component.variableTable.dataSource.data.map(
      (row) => row.resource
    );
    component.addRecordsToCart('Variable', variableResources);
    expect(cartService.getListItems('Variable').length).toEqual(
      variableResources.length
    );

    Object.entries(code2observations).slice(0, variableResources.length).forEach(([code, data]) => {
      mockHttp
        .expectOne(`$fhir/Observation?_count=1&combo-code=${code}`)
        .flush(data);
    });
  }

  it('should search for patients by ANDed variables in the cart', async (done) => {
    component.maxPatientsNumber.setValue(20);
    await loadStudies();
    await loadVariables();
    await addVariablesToCart();

    component.searchForPatients();
    cohortService.patientStream.pipe(last()).subscribe((pat) => {
      expect(pat.length).toEqual(10);
      done();
    });

    mockHttp
      .expectOne(
        '$fhir/Patient?_total=accurate&_summary=count&_has:Observation:subject:combo-code=phv00492021.v1.p1&_has:Observation:subject:combo-code=phv00492022.v1.p1'
      )
      .flush({total: 10});
    mockHttp
      .expectOne(
        '$fhir/Patient?_total=accurate&_summary=count&_has:Observation:subject:combo-code=phv00492024.v1.p1&_has:Observation:subject:combo-code=phv00492025.v1.p1'
      )
      .flush({total: 20});

    mockHttp
      .expectOne(`$fhir/Patient?_count=20&_has:Observation:subject:combo-code=phv00492021.v1.p1&_has:Observation:subject:combo-code=phv00492022.v1.p1`)
      .flush(tenPatientBundle);

    mockHttp
      .expectOne(
        `$fhir/Patient?_id=${tenPatientBundle.entry.map(({resource}) => resource.id).join(',')}&_has:Observation:subject:combo-code=phv00492024.v1.p1&_has:Observation:subject:combo-code=phv00492025.v1.p1`
      )
      .flush(tenPatientBundle);

  });

  it('should search for patients by ORed variables in the cart', async () => {
    component.maxPatientsNumber.setValue(20);
    await loadStudies();
    await loadVariables();
    await addVariablesToCart();

    cartService.logicalOperator.Variable = 'or';

    component.searchForPatients();
    cohortService.patientStream.subscribe();

    mockHttp
      .expectOne(
        '$fhir/Patient?_count=20&_has:Observation:subject:combo-code=phv00492021.v1.p1,phv00492022.v1.p1,phv00492024.v1.p1,phv00492025.v1.p1'
      )
      .flush(tenPatientBundle);
  });

  it('should search for patients by grouped variables in the cart', async () => {
    component.maxPatientsNumber.setValue(20);
    await loadStudies();
    await loadVariables();
    await addVariablesToCart();
    cartService.groupItems(
      'Variable',
      new Set(cartService.getListItems('Variable'))
    );

    component.searchForPatients();
    cohortService.patientStream.subscribe();

    mockHttp
      .expectOne(
        '$fhir/Patient?_total=accurate&_summary=count&_has:Observation:subject:combo-code=phv00492021.v1.p1,phv00492022.v1.p1'
      )
      .flush({ total: 10 });

    mockHttp
      .expectOne(
        '$fhir/Patient?_total=accurate&_summary=count&_has:Observation:subject:combo-code=phv00492024.v1.p1,phv00492025.v1.p1'
      )
      .flush({total: 20});

    mockHttp
      .expectOne(
        '$fhir/Patient?_count=20&_has:Observation:subject:combo-code=phv00492021.v1.p1,phv00492022.v1.p1'
      )
      .flush(tenPatientBundle);

    mockHttp
      .expectOne(
        `$fhir/Patient?_id=${tenPatientBundle.entry.map(({resource}) => resource.id).join(',')}&_has:Observation:subject:combo-code=phv00492024.v1.p1,phv00492025.v1.p1`
      )
      .flush(tenPatientBundle);
  });

  it('should search for patients by additional criteria', async (done) => {
    component.maxPatientsNumber.setValue(20);
    await loadStudies();
    await loadVariables();
    await addVariablesToCart();

    component.additionalCriteria.queryCtrl.setValue({
      condition: 'and',
      resourceType: 'Patient',
      rules: [
        {
          field: {
            element: 'deceased',
            value: false
          }
        }
      ]
    });

    component.searchForPatients();
    cohortService.patientStream.pipe(last()).subscribe((pat) => {
      expect(pat.length).toEqual(10);
      done();
    });

    mockHttp
      .expectOne(
        '$fhir/Patient?_total=accurate&_summary=count&_has:Observation:subject:combo-code=phv00492021.v1.p1&_has:Observation:subject:combo-code=phv00492022.v1.p1'
      )
      .flush({total: 10});
    mockHttp
      .expectOne(
        '$fhir/Patient?_total=accurate&_summary=count&_has:Observation:subject:combo-code=phv00492024.v1.p1&_has:Observation:subject:combo-code=phv00492025.v1.p1&deceased=false'
      )
      .flush({total: 20});

    mockHttp
      .expectOne(`$fhir/Patient?_count=20&_has:Observation:subject:combo-code=phv00492021.v1.p1&_has:Observation:subject:combo-code=phv00492022.v1.p1`)
      .flush(tenPatientBundle);

    mockHttp
      .expectOne(
        `$fhir/Patient?_id=${tenPatientBundle.entry.map(({resource}) => resource.id).join(',')}&_has:Observation:subject:combo-code=phv00492024.v1.p1&_has:Observation:subject:combo-code=phv00492025.v1.p1&deceased=false`
      )
      .flush(tenPatientBundle);
  });

  it('should use selected studies in the patient search when variables have been selected', async () => {
    await loadStudies();
    await addSecondStudyToCart();
    await loadVariables('study_id:(phs002409*)');
    await addVariablesToCart();
    spyOn(cohortService, 'searchForPatients').and.callThrough();
    component.searchForPatients();
    expect(cohortService.searchForPatients).toHaveBeenCalledOnceWith(
      jasmine.any(Object), jasmine.any(Number), ['phs002409']
    );
  });
});

describe('SelectRecordsPageComponent (when there are no studies for the user)', () => {
  let component: SelectRecordsPageComponent;
  let fixture: ComponentFixture<SelectRecordsPageComponent>;
  let mockHttp: HttpTestingController;
  let loader: HarnessLoader;
  const emptyBundle = {};

  beforeEach(async () => {
    await configureTestingModule(
      {
        declarations: [SelectRecordsPageComponent],
        imports: [SelectRecordsPageModule, MatIconTestingModule]
      },
      {
        features: {
          hasResearchStudy: true,
          hasAvailableStudy: false
        }
      }
    );
    mockHttp = TestBed.inject(HttpTestingController);
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(SelectRecordsPageComponent);
    loader = TestbedHarnessEnvironment.loader(fixture);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // The first call to getHarness in the expectNumberOfRecords function will
    // never end if the interval is active. This looks like a bug.
    // As a workaround, just do not create the "interval()":
    spyOn(
      ResourceTableComponent.prototype,
      'runPreloadEvents'
    ).and.callFake(() => {});
  });

  afterEach(() => {
    // Verify that no unmatched requests are outstanding.
    // For example, there are no requests for research studies.
    verifyOutstandingRequests(mockHttp);
  });

  /**
   * Creates an expectation for the number of records on the current tab.
   * @param n - number of expected records
   */
  async function expectNumberOfRecords(n: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    const tabGroup = await loader.getHarness(MatTabGroupHarness);
    const currentTab = await tabGroup.getSelectedTab();
    const table = await currentTab.getHarness(MatTableHarness);
    const rows = await table.getRows();
    expect(rows.length).toBe(n);
  }

  /**
   * Checks requests to get variables.
   */
  async function checkRequestsToGetVariables(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    mockHttp
      .expectOne('$fhir/Observation?_elements=code,value,category&_count=50')
      .flush(observations);
    fixture.detectChanges();
    expect(component.variableTable.runPreloadEvents).toHaveBeenCalledOnceWith();
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    mockHttp
      .expectOne(
        '$fhir/Observation?_elements=code,value,category&code:not=http://loinc.org%7C11881-0&code:not=http://loinc.org%7C3137-7&code:not=http://loinc.org%7C8302-2&code:not=http://loinc.org%7C8303-0&_count=50'
      )
      .flush(emptyBundle);
    await expectNumberOfRecords(4);
  }

  it('should load variables at the beginning', async () => {
    expect(component.visibleResourceTypes).toEqual(['Observation']);
    await checkRequestsToGetVariables();
  });
});
