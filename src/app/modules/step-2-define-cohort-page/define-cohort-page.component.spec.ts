import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DefineCohortPageComponent } from './define-cohort-page.component';
import { DefineCohortPageModule } from './define-cohort-page.module';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { configureTestingModule } from 'src/test/helpers';
import { HttpTestingController } from '@angular/common/http/testing';
import tenPatientBundle from './test-fixtures/patients-10.json';
import tenObservationBundle from './test-fixtures/observations-10.json';
import examplePatient from './test-fixtures/example-patient.json';
import { last } from 'rxjs/operators';
import { CohortService } from '../../shared/cohort/cohort.service';

describe('DefineCohortComponent', () => {
  let component: DefineCohortPageComponent;
  let fixture: ComponentFixture<DefineCohortPageComponent>;
  let mockHttp: HttpTestingController;
  let cohort: CohortService;

  beforeEach(async () => {
    await configureTestingModule({
      declarations: [DefineCohortPageComponent],
      imports: [
        DefineCohortPageModule,
        MatIconTestingModule
      ]
    });
    mockHttp = TestBed.inject(HttpTestingController);
    cohort = TestBed.inject(CohortService);
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(DefineCohortPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    // Verify that no unmatched requests are outstanding
    mockHttp.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should add ResearchStudy ids to search parameters', () => {
    expect(
      cohort.prepareCriteria({ condition: 'and', rules: [] }, [
        'someResearchStudyId'
      ])
    ).toEqual({
      condition: 'and',
      resourceType: 'Patient',
      rules: [
        {
          field: {
            element: '_has:ResearchSubject:individual:study',
            value: 'someResearchStudyId'
          }
        }
      ]
    });
  });

  it('should load Patients by empty criteria', (done) => {
    component.defineCohortForm.get('maxNumberOfPatients').setValue(10);
    component.searchForPatients();
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(10);
      done();
    });

    mockHttp.expectOne(`$fhir/Patient?_count=10`).flush(tenPatientBundle);
  });

  it('should load Patients by Observation criteria using _has', (done) => {
    component.defineCohortForm.get('maxNumberOfPatients').setValue(20);
    component.patientParams.queryCtrl.setValue({
      condition: 'and',
      rules: [
        {
          condition: 'and',
          resourceType: 'Observation',
          rules: [
            {
              field: {
                element: 'code text',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '3137-7',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'Quantity',
                  items: ['Height cm']
                }
              }
            }
          ]
        }
      ]
    });
    component.searchForPatients();
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(10);
      done();
    });

    mockHttp
      .expectOne(
        `$fhir/Patient?_count=20&_has:Observation:subject:combo-code=http%3A%2F%2Floinc.org%7C3137-7`
      )
      .flush(tenPatientBundle);
  });

  it('should load Patients by Observation criteria', (done) => {
    component.defineCohortForm.get('maxNumberOfPatients').setValue(20);
    component.patientParams.queryCtrl.setValue({
      condition: 'and',
      rules: [
        {
          condition: 'and',
          resourceType: 'Observation',
          rules: [
            {
              field: {
                element: 'code text',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '3137-7',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'Quantity',
                  items: ['Height cm']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: 'gt',
                  testValueModifier: '',
                  testValue: 100,
                  testValueUnit: '',
                  observationDataType: 'Quantity'
                }
              }
            },
            {
              field: {
                element: 'status',
                value: {
                  codes: ['final'],
                  items: ['Final']
                }
              }
            }
          ]
        }
      ]
    });
    component.searchForPatients();
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(9);
      done();
    });

    mockHttp
      .expectOne(
        `$fhir/Observation?_count=20&_elements=subject&status=final&combo-code-value-quantity=http%3A%2F%2Floinc.org%7C3137-7%24gt100`
      )
      .flush(tenObservationBundle);

    const patientIds = [
      // Search ignores duplicate Patients
      ...new Set(
        tenObservationBundle.entry.map(({ resource }) =>
          resource.subject.reference.replace(/^Patient\//, '')
        )
      )
    ];

    mockHttp
      .expectOne(
        `$fhir/Patient?_id=${patientIds.join(',')}&_count=${patientIds.length}`
      )
      .flush({
        entry: patientIds.map((patientId) => ({
          resource: { ...examplePatient, id: patientId }
        }))
      });
  });

  it('should load Patients by Observation and Patient criteria', (done) => {
    component.defineCohortForm.get('maxNumberOfPatients').setValue(20);
    component.patientParams.queryCtrl.setValue({
      condition: 'and',
      rules: [
        {
          condition: 'and',
          resourceType: 'Patient',
          rules: [
            {
              field: {
                element: 'gender',
                value: { codes: ['female'] },
                selectedObservationCodes: null
              }
            }
          ]
        },
        {
          condition: 'and',
          resourceType: 'Observation',
          rules: [
            {
              field: {
                element: 'code text',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '3137-7',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'Quantity',
                  items: ['Height cm']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: 'gt',
                  testValueModifier: '',
                  testValue: 100,
                  testValueUnit: '',
                  observationDataType: 'Quantity'
                }
              }
            },
            {
              field: {
                element: 'status',
                value: {
                  codes: ['final'],
                  items: ['Final']
                }
              }
            }
          ]
        }
      ]
    });

    component.searchForPatients();
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(9);
      done();
    });

    mockHttp
      .expectOne(`$fhir/Patient?_total=accurate&_summary=count&gender=female`)
      .flush({ total: 30 });

    mockHttp
      .expectOne(
        `$fhir/Observation?_total=accurate&_summary=count&status=final&combo-code-value-quantity=http%3A%2F%2Floinc.org%7C3137-7%24gt100`
      )
      .flush({ total: 20 });

    mockHttp
      .expectOne(
        `$fhir/Observation?_count=20&_elements=subject&status=final&combo-code-value-quantity=http%3A%2F%2Floinc.org%7C3137-7%24gt100`
      )
      .flush({
        ...tenObservationBundle,
        link: [{relation: 'next', url: 'next-observation-bundle-page'}]
      });

    const patientIds = [
      // Search ignores duplicate Patients
      ...new Set(
        tenObservationBundle.entry.map(({resource}) =>
          resource.subject.reference.replace(/^Patient\//, '')
        )
      )
    ];
    mockHttp
      .expectOne(`$fhir/Patient?_id=${patientIds.join(',')}&gender=female`)
      .flush({
        entry: patientIds.map(patientId => ({
          resource: {
            ...examplePatient,
            id: patientId
          }
        }))
      });

    // If the next page contains the same resources, there are no additional requests
    mockHttp
      .expectOne(`next-observation-bundle-page`)
      .flush(tenObservationBundle);
  });

  it('should load Patients by Observation and ResearchStudy criteria', (done) => {
    component.defineCohortForm.get('maxNumberOfPatients').setValue(20);
    component.patientParams.queryCtrl.setValue({
      condition: 'and',
      rules: [
        {
          condition: 'and',
          resourceType: 'ResearchStudy',
          rules: [
            {
              field: {
                element: 'status',
                value: { codes: ['completed'] },
                selectedObservationCodes: null
              }
            }
          ]
        },
        {
          condition: 'and',
          resourceType: 'Observation',
          rules: [
            {
              field: {
                element: 'code text',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '3137-7',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'Quantity',
                  items: ['Height cm']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: 'gt',
                  testValueModifier: '',
                  testValue: 100,
                  testValueUnit: 'cm',
                  observationDataType: 'Quantity'
                }
              }
            },
            {
              field: {
                element: 'status',
                value: {
                  codes: ['final'],
                  items: ['Final']
                }
              }
            }
          ]
        }
      ]
    });

    component.searchForPatients();
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(9);
      done();
    });

    mockHttp
      .expectOne(
        `$fhir/ResearchStudy?_elements=id&_has:ResearchSubject:study:status=candidate,eligible,follow-up,ineligible,not-registered,off-study,on-study,on-study-intervention,on-study-observation,pending-on-study,potential-candidate,screening,withdrawn&status=completed`
      )
      .flush({
        entry: [
          {resource: {id: 'study-1'}},
          {resource: {id: 'study-2'}}
        ]
      });

    mockHttp
      .expectOne(
        `$fhir/Patient?_total=accurate&_summary=count&_has:ResearchSubject:individual:study=study-1,study-2`
      )
      .flush({total: 20});

    mockHttp
      .expectOne(
        `$fhir/Observation?_total=accurate&_summary=count&status=final&combo-code-value-quantity=http%3A%2F%2Floinc.org%7C3137-7%24gt100%7C%7Ccm`
      )
      .flush({total: 10});

    mockHttp
      .expectOne(
        `$fhir/Observation?_count=20&_elements=subject&status=final&combo-code-value-quantity=http%3A%2F%2Floinc.org%7C3137-7%24gt100%7C%7Ccm`
      )
      .flush(tenObservationBundle);

    const patientIds = [
      // Search ignores duplicate Patients
      ...new Set(
        tenObservationBundle.entry.map(({resource}) =>
          resource.subject.reference.replace(/^Patient\//, '')
        )
      )
    ];

    mockHttp
      .expectOne(
        `$fhir/Patient?_id=${patientIds.join(',')}&_has:ResearchSubject:individual:study=study-1,study-2`
      )
      .flush({
        entry: patientIds.map(patientId => ({
          resource: {
            ...examplePatient,
            id: patientId
          }
        }))
      });
  });

  it('should load Patients using _has with Observation code and value', (done) => {
    component.defineCohortForm.get('maxNumberOfPatients').setValue(20);
    component.patientParams.queryCtrl.setValue({
      condition: 'and',
      rules: [
        {
          condition: 'and',
          resourceType: 'Observation',
          rules: [
            {
              field: {
                element: 'code text',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '3137-7',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'Quantity',
                  items: ['Height cm']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: 'gt',
                  testValueModifier: '',
                  testValue: 100,
                  testValueUnit: '',
                  observationDataType: 'Quantity'
                }
              }
            }
          ]
        }
      ]
    });
    component.searchForPatients();
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(10);
      done();
    });

    mockHttp
      .expectOne(
        `$fhir/Patient?_count=20&_has:Observation:subject:combo-code-value-quantity=http%3A%2F%2Floinc.org%7C3137-7%24gt100`
      )
      .flush(tenPatientBundle);
  });

});


describe('DefineCohortComponent', () => {
  let component: DefineCohortPageComponent;
  let fixture: ComponentFixture<DefineCohortPageComponent>;
  let mockHttp: HttpTestingController;
  let cohort: CohortService;


  beforeEach(async () => {
    await configureTestingModule({
      declarations: [DefineCohortPageComponent],
      imports: [
        DefineCohortPageModule,
        MatIconTestingModule
      ]
    }, {
      serverUrl: 'https://lforms-fhir.nlm.nih.gov/baseR4'
    });
    mockHttp = TestBed.inject(HttpTestingController);
    cohort = TestBed.inject(CohortService);
  });


  beforeEach(() => {
    fixture = TestBed.createComponent(DefineCohortPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });


  afterEach(() => {
    // Verify that no unmatched requests are outstanding
    mockHttp.verify();
  });


  it('should load Patients by EvidenceVariable criteria', (done) => {
    component.defineCohortForm.get('maxNumberOfPatients').setValue(20);
    component.patientParams.queryCtrl.setValue({
      condition: 'and',
      rules: [
        {
          condition: 'and',
          resourceType: 'EvidenceVariable',
          rules: [
            {
              field: {
                element: 'name',
                value: {
                  codes: [['phv00492039']]
                },
                selectedObservationCodes: null
              }
            }
          ]
        }
      ]
    });

    component.searchForPatients();
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(1);
      done();
    });

    mockHttp
      .expectOne(
        `$fhir/Observation?_count=20&_elements=subject&evidencevariable=https://lforms-fhir.nlm.nih.gov/baseR4/EvidenceVariable/phv00492039`
      )
      .flush({
        entry: [
          {
            fullUrl: 'https://lforms-fhir.nlm.nih.gov/baseR4/Observation/ev999',
            resource: {
              id: 'ev999',
              resourceType: 'Observation',
              subject: { reference: 'Patient/p-999', display: 'HAO XIE' }
            }
          }
        ]
      });

    mockHttp.expectOne(`$fhir/Patient?_id=p-999&_count=1`).flush({
      entry: [
        {
          fullUrl: 'https://lforms-fhir.nlm.nih.gov/baseR4/Patient/p-999',
          resource: {
            id: 'p-999'
          }
        }
      ]
    });
  });

});
