import { TestBed } from '@angular/core/testing';

import { CohortService } from './cohort.service';
import { SharedModule } from '../shared.module';
import { last } from 'rxjs/operators';
import tenObservationBundle
  from '../../modules/step-2-define-cohort-page/test-fixtures/observations-10.json';
import tenPatientBundle
  from '../../modules/step-2-define-cohort-page/test-fixtures/patients-10.json';
import examplePatient
  from '../../modules/step-2-define-cohort-page/test-fixtures/example-patient.json';
import { HttpTestingController } from '@angular/common/http/testing';
import { Criteria, ResourceTypeCriteria } from '../../types/search-parameters';
import {
  configureTestingModule,
  verifyOutstandingRequests
} from 'src/test/helpers';
import { of } from 'rxjs';

describe('CohortService', () => {
  let cohort: CohortService;
  let mockHttp: HttpTestingController;

  beforeEach(async () => {
    await configureTestingModule({
      imports: [SharedModule]
    }, {
      features: {
        maxHasAllowed: 1
      }
    });
    mockHttp = TestBed.inject(HttpTestingController);
    cohort = TestBed.inject(CohortService);
  });

  afterEach(() => {
    // Verify that no unmatched requests are outstanding
    verifyOutstandingRequests(mockHttp);
  });

  it('should be created', () => {
    expect(cohort).toBeTruthy();
  });

  it('should load Patients without using _has when using modifier on the Observation value', (done) => {
    const criteria: Criteria = {
      condition: 'and',
      rules: [
        {
          condition: 'and',
          rules: [
            {
              field: {
                element: 'code text',
                value: '',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '9317-9',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'String',
                  items: ['Platelet Bld Ql Smear']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: '',
                  testValueModifier: ':contains',
                  testValue: 'a',
                  testValueUnit: '',
                  observationDataType: 'String'
                }
              }
            }
          ],
          resourceType: 'Observation'
        }
      ]
    };
    cohort.searchForPatients(criteria, 20);

    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(9);
      done();
    });

    mockHttp
      .expectOne(
        '$fhir/Observation?_count=20&_elements=subject&code-value-string:contains=http%3A%2F%2Floinc.org%7C9317-9%24a'
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
          resource: {...examplePatient, id: patientId}
        }))
      });
  });


  it('should skip resources without patient IDs before patient lookup', (done) => {
    const criteria: Criteria = {
      condition: 'and',
      rules: [
        {
          condition: 'and',
          rules: [
            {
              field: {
                element: 'code text',
                value: '',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '9317-9',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'String',
                  items: ['Platelet Bld Ql Smear']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: '',
                  testValueModifier: ':contains',
                  testValue: 'a',
                  testValueUnit: '',
                  observationDataType: 'String'
                }
              }
            }
          ],
          resourceType: 'Observation'
        }
      ]
    };
    const matchingObservation = tenObservationBundle.entry[0].resource;
    const patientId =
      matchingObservation.subject.reference.replace(/^Patient\//, '');

    cohort.searchForPatients(criteria, 20);

    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.map(({id}) => id)).toEqual([patientId]);
      done();
    });

    mockHttp
      .expectOne(
        '$fhir/Observation?_count=20&_elements=subject&code-value-string:contains=http%3A%2F%2Floinc.org%7C9317-9%24a'
      )
      .flush({
        entry: [
          {resource: {resourceType: 'Observation', id: 'missing-subject'}},
          {
            resource: {
              ...matchingObservation,
              id: 'missing-reference',
              subject: {}
            }
          },
          {resource: matchingObservation}
        ]
      });

    mockHttp
      .expectOne(`$fhir/Patient?_id=${patientId}&_count=1`)
      .flush({
        entry: [{
          resource: {...examplePatient, id: patientId}
        }]
      });
  });


  it('should skip resources without patient IDs before Patient criteria checks', (done) => {
    const validObservation = {
      resourceType: 'Observation',
      id: 'valid-observation',
      subject: {reference: 'Patient/pat-1'}
    } as any;
    const invalidObservation = {
      resourceType: 'Observation',
      id: 'invalid-observation'
    } as any;

    cohort.check([
      {resource: invalidObservation, checkPassed: true},
      {resource: validObservation, checkPassed: true}
    ], getCriteriaFor('Patient')).subscribe((resourcesToCheck) => {
      const invalidCheck =
        resourcesToCheck.find(({resource}) => resource === invalidObservation);
      const validCheck =
        resourcesToCheck.find(({resource}) => resource.id === 'pat-1');

      expect(invalidCheck?.checkPassed).toBe(false);
      expect(validCheck?.checkPassed).toBe(true);
      done();
    });

    mockHttp
      .expectOne('$fhir/Patient?_id=pat-1&gender=female')
      .flush({
        entry: [{resource: {...examplePatient, id: 'pat-1'}}]
      });
  });


  it('should skip resources without patient IDs before subject checks', (done) => {
    const validObservation = {
      resourceType: 'Observation',
      id: 'valid-observation',
      subject: {reference: 'Patient/pat-1'}
    } as any;
    const invalidObservation = {
      resourceType: 'Observation',
      id: 'invalid-observation',
      subject: {}
    } as any;

    cohort.check([
      {resource: invalidObservation, checkPassed: true},
      {resource: validObservation, checkPassed: true}
    ], {
      condition: 'and',
      resourceType: 'ResearchStudy',
      rules: []
    }).subscribe((resourcesToCheck) => {
      const invalidCheck =
        resourcesToCheck.find(({resource}) => resource === invalidObservation);
      const validCheck =
        resourcesToCheck.find(({resource}) => resource === validObservation);

      expect(invalidCheck?.checkPassed).toBe(false);
      expect(validCheck?.checkPassed).toBe(true);
      done();
    });

    mockHttp
      .expectOne(
        '$fhir/ResearchStudy?_count=1&_has:ResearchSubject:study:individual=Patient/pat-1&_elements=id'
      )
      .flush({
        entry: [{resource: {resourceType: 'ResearchStudy', id: 'study-1'}}]
      });
  });


  it('should correctly process nested ANDed criteria if parent nodes are ORed', (done) => {
    const criteria: Criteria = {
      'condition': 'and',
      'rules': [
        {
          'condition': 'and',
          'rules': [
            {
              'field': {
                'element': 'code text',
                'value': '',
                'selectedObservationCodes': {
                  'coding': [
                    {
                      'code': '72166-2',
                      'system': 'http://loinc.org'
                    }
                  ],
                  'datatype': 'CodeableConcept',
                  'items': [
                    'Tobacco smoking status'
                  ]
                }
              }
            }
          ],
          'resourceType': 'Observation'
        },
        {
          'condition': 'or',
          'rules': [
            {
              'condition': 'and',
              'rules': [
                {
                  'field': {
                    'element': 'active',
                    'value': 'false'
                  }
                }
              ],
              'resourceType': 'Patient'
            },
            {
              'condition': 'and',
              'rules': [
                {
                  'field': {
                    'element': 'gender',
                    'value': {
                      'codes': [
                        'male'
                      ],
                      'items': [
                        'Male'
                      ]
                    }
                  }
                }
              ],
              'resourceType': 'Patient'
            },
            {
              'condition': 'and',
              'rules': [
                {
                  'field': {
                    'element': 'gender',
                    'value': {
                      'codes': [
                        'unknown'
                      ],
                      'items': [
                        'Unknown'
                      ]
                    }
                  }
                }
              ],
              'resourceType': 'Patient'
            }
          ]
        }
      ]
    };

    cohort.searchForPatients(criteria, 20);
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(10);
      done();
    });

    mockHttp
      .expectOne(
        '$fhir/Patient?_total=accurate&_summary=count&_has:Observation:subject:combo-code=http%3A%2F%2Floinc.org%7C72166-2'
      )
      .flush({total: 10});

    mockHttp
      .expectOne('$fhir/Patient?_total=accurate&_summary=count&active=false')
      .flush({total: 20});

    mockHttp
      .expectOne('$fhir/Patient?_total=accurate&_summary=count&gender=male')
      .flush({total: 30});

    mockHttp
      .expectOne('$fhir/Patient?_total=accurate&_summary=count&gender=unknown')
      .flush({total: 40});

    mockHttp
      .expectOne(
        '$fhir/Patient?_count=20&_has:Observation:subject:combo-code=http%3A%2F%2Floinc.org%7C72166-2'
      )
      .flush(tenPatientBundle);

    const patientIds = tenPatientBundle.entry.map(({resource}) => resource.id).join(',');
    mockHttp
      .expectOne(`$fhir/Patient?_id=${patientIds}&active=false`)
      .flush({total: 0});

    mockHttp
      .expectOne(`$fhir/Patient?_id=${patientIds}&gender=male`)
      .flush(tenPatientBundle);
  });


  it('should skip unnecessary requests when criteria are ANDed', (done) => {
    const criteria: Criteria = {
      'condition': 'and',
      'rules': [
        {
          'condition': 'and',
          'rules': [
            {
              'field': {
                'element': 'onset-date',
                'value': {
                  'from': '1980-01-01'
                }
              }
            }
          ],
          'resourceType': 'Condition'
        },
        {
          'condition': 'and',
          'rules': [
            {
              'condition': 'and',
              'rules': [
                {
                  'field': {
                    'element': 'status',
                    'value': {
                      'codes': [
                        'active'
                      ],
                      'items': [
                        'Active'
                      ]
                    }
                  }
                }
              ],
              'resourceType': 'MedicationRequest'
            },
            {
              'condition': 'and',
              'rules': [
                {
                  'field': {
                    'element': 'status',
                    'value': {
                      'codes': [
                        'declined'
                      ],
                      'items': [
                        'Declined'
                      ]
                    }
                  }
                }
              ],
              'resourceType': 'MedicationDispense'
            }
          ]
        }
      ]
    };

    cohort.searchForPatients(criteria, 20);
    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(1);
      done();
    });

    mockHttp
      .expectOne('$fhir/Patient?_total=accurate&_summary=count&_has:Condition:subject:onset-date=ge1980-01-01')
      .flush({total: 10});

    mockHttp
      .expectOne('$fhir/Patient?_total=accurate&_summary=count&_has:MedicationRequest:subject:status=active')
      .flush({total: 20});

    mockHttp
      .expectOne('$fhir/Patient?_total=accurate&_summary=count&_has:MedicationDispense:subject:status=declined')
      .flush({total: 30});

    mockHttp
      .expectOne(
        '$fhir/Patient?_count=20&_has:Condition:subject:onset-date=ge1980-01-01'
      )
      .flush(tenPatientBundle);

    // Index of a resource that meets the criteria
    const indexOfMatchingResource = 3;

    mockHttp
      .expectOne(`$fhir/Patient?_id=${tenPatientBundle.entry.map(({resource}) => resource.id).join(',')}&_has:MedicationRequest:subject:status=active`)
      .flush({
        ...tenPatientBundle,
        entry: tenPatientBundle.entry.filter((item, index) => index === indexOfMatchingResource)
      });


    const matchingPatient = tenPatientBundle.entry[indexOfMatchingResource].resource;

    mockHttp
      .expectOne(`$fhir/Patient?_id=${matchingPatient.id}&_has:MedicationDispense:subject:status=declined`)
      .flush({total: 1, entry: [{resource: matchingPatient}]});

  });


  it('should correctly process nested ORed criteria if they return different resource types', (done) => {
    const criteria: Criteria = {
      condition: 'and',
      rules: [
        {
          condition: 'and',
          rules: [
            {
              field: {
                element: 'code text',
                value: '',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '9317-9',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'String',
                  items: ['Platelet Bld Ql Smear']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: '',
                  testValueModifier: ':contains',
                  testValue: 'a',
                  testValueUnit: '',
                  observationDataType: 'String'
                }
              }
            }
          ],
          resourceType: 'Observation'
        },
        {
          condition: 'or',
          rules: [
            {
              condition: 'and',
              rules: [
                {
                  field: {
                    element: 'active',
                    value: 'false'
                  }
                }
              ],
              resourceType: 'Patient'
            },
            {
              condition: 'and',
              rules: [
                {
                  field: {
                    element: 'code text',
                    value: '',
                    selectedObservationCodes: {
                      coding: [
                        {
                          code: '9317-9',
                          system: 'http://loinc.org'
                        }
                      ],
                      datatype: 'String',
                      items: ['Platelet Bld Ql Smear']
                    }
                  }
                },
                {
                  field: {
                    element: 'observation value',
                    value: {
                      testValuePrefix: '',
                      testValueModifier: ':contains',
                      testValue: 'b',
                      testValueUnit: '',
                      observationDataType: 'String'
                    }
                  }
                }
              ],
              resourceType: 'Observation'
            }
          ]
        }
      ]
    };
    cohort.searchForPatients(criteria, 20);


    cohort.patientStream.pipe(last()).subscribe((patients) => {
      expect(patients.length).toEqual(9);
      done();
    });

    mockHttp
      .expectOne(
        '$fhir/Observation?_total=accurate&_summary=count&code-value-string:contains=http%3A%2F%2Floinc.org%7C9317-9%24a'
      )
      .flush({total: 10});

    mockHttp
      .expectOne('$fhir/Patient?_total=accurate&_summary=count&active=false')
      .flush({total: 20});

    mockHttp
      .expectOne('$fhir/Observation?_total=accurate&_summary=count&code-value-string:contains=http%3A%2F%2Floinc.org%7C9317-9%24b')
      .flush({total: 30});

    mockHttp
      .expectOne(
        '$fhir/Observation?_count=20&_elements=subject&code-value-string:contains=http%3A%2F%2Floinc.org%7C9317-9%24a'
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

    // Index of a patient that meets the second ORed criteria
    const patientIndex = 3;
    // ID of patient that meets the second ORed criteria
    const patientIdForSecondCriterion = patientIds[patientIndex];

    mockHttp
      .expectOne(`$fhir/Patient?_id=${patientIds.join(',')}&active=false`)
      .flush(
        {
          total: 9,
          entry: patientIds
            .filter(patientId => patientId !== patientIdForSecondCriterion)
            .map(patientId => ({resource: {...examplePatient, id: patientId}}))
        }
      );

    const exampleObservation = tenObservationBundle.entry[patientIndex];
    mockHttp
      .expectOne(
        `$fhir/Observation?_count=1&subject=Patient/${patientIdForSecondCriterion}&_elements=subject&code-value-string:contains=http%3A%2F%2Floinc.org%7C9317-9%24b`
      )
      .flush({entry: [{resource: exampleObservation}]});


    mockHttp
      .expectOne(
        `$fhir/Patient?_id=${patientIdForSecondCriterion}&_count=1`
      )
      .flush({
        entry: [{
          resource: {...examplePatient, id: patientIdForSecondCriterion}
        }]
      });

  });


  it('should update old format criteria for observationDataType', () => {
    const criteria = {
      condition: 'and',
      rules: [
        {
          condition: 'and',
          rules: [
            {
              field: {
                element: 'code text',
                value: '',
                selectedObservationCodes: {
                  coding: [
                    {
                      code: '44255-8',
                      system: 'http://loinc.org'
                    }
                  ],
                  datatype: 'CodeableConcept',
                  items: ['Feeling down, depressed, or hopeless?']
                }
              }
            },
            {
              field: {
                element: 'observation value',
                value: {
                  testValuePrefix: '',
                  testValueModifier: '',
                  testValue: {
                    codes: ['LA6569-3', 'LA6568-5'],
                    items: ['Several days', 'Not at all']
                  },
                  testValueUnit: ''
                },
                observationDataType: 'CodeableConcept'
              }
            }
          ],
          resourceType: 'Observation'
        }
      ]
    };
    expect(criteria.rules[0].rules[1].field.observationDataType).toBe(
      'CodeableConcept'
    );
    expect(Object.keys(criteria.rules[0].rules[1].field.value)).not.toContain(
      'observationDataType'
    );
    cohort.updateOldFormatCriteria(criteria);
    expect(criteria.rules[0].rules[1].field.value).toEqual(
      jasmine.objectContaining({observationDataType: 'CodeableConcept'})
    );
    expect(Object.keys(criteria.rules[0].rules[1].field)).not.toContain(
      'observationDataType'
    );
  });


  /**
   * Creates an example of criteria for a resource type.
   * @param resourceType resource type with a prefix or suffix describing its modification
   * @return a new object describes criteria to select Patient resources.
   */
  function getCriteriaFor(
    resourceType: 'Patient' | 'ResearchStudy' | 'otherResearchStudy'
      | 'Condition' | 'PatientForResearchStudy' | 'PatientForOtherResearchStudy'
      | 'PatientCombinedWithPatientForResearchStudy' | 'nonexistentResearchStudy'
      | 'PatientForCondition'
  ): ResourceTypeCriteria {
    switch (resourceType) {
      case 'Patient':
        return {
          condition: 'and',
          resourceType: 'Patient',
          rules: [
            {
              field: {
                element: 'gender',
                value: {
                  codes: ['female'],
                  items: ['Female']
                }
              }
            }
          ]
        };
      case 'ResearchStudy':
      case 'otherResearchStudy':
      case 'nonexistentResearchStudy':
        return {
          condition: 'and',
          resourceType: 'ResearchStudy',
          rules: [
            {
              field: {
                element: 'title',
                value: {
                  testValuePrefix: '',
                  testValueModifier: '',
                  testValue: {
                    ResearchStudy: 'a',
                    otherResearchStudy: 'b',
                    nonexistentResearchStudy: 'nonexistent'
                  }[resourceType],
                  testValueUnit: '',
                  testValuePrefix2: '',
                  testValue2: '',
                  observationDataType: 'String'
                }
              }
            }
          ]
        };
      case 'PatientForResearchStudy':
      case 'PatientForOtherResearchStudy':
        return {
          condition: 'and',
          resourceType: 'Patient',
          rules: [
            {
              field: {
                element: '_has:ResearchSubject:individual:study',
                value: resourceType === 'PatientForResearchStudy' ? 'study-1,study-2' : 'study-3'
              }
            }
          ]
        };
      case 'PatientCombinedWithPatientForResearchStudy':
        return {
          condition: 'and',
          resourceType: 'Patient',
          rules: [
            {
              field: {
                element: 'gender',
                value: {
                  codes: ['female'],
                  items: ['Female']
                }
              }
            },
            {
              field: {
                element: '_has:ResearchSubject:individual:study',
                value: 'study-1,study-2'
              }
            }
          ]
        };
      case 'Condition':
        return {
          condition: 'and',
          resourceType: 'Condition',
          rules: [
            {
              field: {
                element: 'code text',
                value: {
                  codes: ['276.3'],
                  items: ['ALKALOSIS']
                }
              }
            }
          ]
        };
      case 'PatientForCondition':
        return {
          condition: 'and',
          resourceType: 'Patient',
          rules: [
            {
              field: {
                element: '_has:Condition:subject:code',
                value: '276.3'
              }
            }
          ]
        };
    }
  }


  describe('simplifyCriteriaTree', () => {
    it('should move ANDed child criteria to the parent criteria', () => {
      expect(
        cohort.simplifyCriteriaTree({
          condition: 'and',
          rules: [
            getCriteriaFor('Patient'),
            {
              condition: 'and',
              rules: [
                getCriteriaFor('ResearchStudy'),
                getCriteriaFor('Condition')
              ]
            }
          ]
        })
      ).toEqual({
        condition: 'and',
        rules: [
          getCriteriaFor('Patient'),
          getCriteriaFor('ResearchStudy'),
          getCriteriaFor('Condition')
        ]
      });
    });


    it('should not move ORed child criteria to the parent criteria', () => {
      expect(
        cohort.simplifyCriteriaTree({
          condition: 'and',
          rules: [
            getCriteriaFor('Patient'),
            {
              condition: 'or',
              rules: [
                getCriteriaFor('ResearchStudy'),
                getCriteriaFor('Condition')
              ]
            }
          ]
        })
      ).toEqual({
        condition: 'and',
        rules: [
          getCriteriaFor('Patient'),
          {
            condition: 'or',
            rules: [
              getCriteriaFor('ResearchStudy'),
              getCriteriaFor('Condition')
            ]
          }
        ]
      });

      expect(
        cohort.simplifyCriteriaTree({
          condition: 'or',
          rules: [
            getCriteriaFor('Patient'),
            {
              condition: 'and',
              rules: [
                getCriteriaFor('ResearchStudy'),
                getCriteriaFor('Condition')
              ]
            }
          ]
        })
      ).toEqual({
        condition: 'or',
        rules: [
          getCriteriaFor('Patient'),
          {
            condition: 'and',
            rules: [
              getCriteriaFor('ResearchStudy'),
              getCriteriaFor('Condition')
            ]
          }
        ]
      });
    });
  });


  describe('replaceOtherResourceCriteriaWithPatientCriteria', () => {
    it('should replace ResearchStudy criteria with patient criteria', (done) => {
      cohort.replaceOtherResourceCriteriaWithPatientCriteria(of({
        'condition': 'and',
        'rules': [
          {
            'condition': 'and',
            'rules': [
              getCriteriaFor('Patient'),
              getCriteriaFor('ResearchStudy'),
              getCriteriaFor('Condition')
            ]
          },
          {
            'condition': 'or',
            'rules': [
              getCriteriaFor('Patient'),
              getCriteriaFor('otherResearchStudy'),
              {
                condition: 'and',
                rules: [
                  getCriteriaFor('Condition'),
                ]
              },
              {
                condition: 'and',
                rules: [
                  getCriteriaFor('Condition'),
                  getCriteriaFor('nonexistentResearchStudy'),
                ]
              }
            ]
          }
        ]
      })).subscribe((criteria) => {
        expect(criteria).toEqual({
          'condition': 'and',
          'rules': [
            {
              'condition': 'and',
              'rules': [
                getCriteriaFor('Patient'),
                getCriteriaFor('PatientForResearchStudy'),
                getCriteriaFor('PatientForCondition')
              ]
            },
            {
              'condition': 'or',
              'rules': [
                getCriteriaFor('Patient'),
                getCriteriaFor('PatientForOtherResearchStudy'),
                {
                  condition: 'and',
                  rules: [
                    getCriteriaFor('PatientForCondition'),
                  ]
                }
              ]
            }
          ]
        });

        done();
      });

      mockHttp
        .expectOne(
          '$fhir/ResearchStudy?_elements=id&_has:ResearchSubject:study:status=candidate,eligible,follow-up,ineligible,not-registered,off-study,on-study,on-study-intervention,on-study-observation,pending-on-study,potential-candidate,screening,withdrawn&title=a'
        )
        .flush({
          entry: [{resource: {id: 'study-1'}}, {resource: {id: 'study-2'}}]
        });
      mockHttp
        .expectOne(
          '$fhir/ResearchStudy?_elements=id&_has:ResearchSubject:study:status=candidate,eligible,follow-up,ineligible,not-registered,off-study,on-study,on-study-intervention,on-study-observation,pending-on-study,potential-candidate,screening,withdrawn&title=b'
        )
        .flush({
          entry: [{resource: {id: 'study-3'}}]
        });
      mockHttp
        .expectOne(
          '$fhir/ResearchStudy?_elements=id&_has:ResearchSubject:study:status=candidate,eligible,follow-up,ineligible,not-registered,off-study,on-study,on-study-intervention,on-study-observation,pending-on-study,potential-candidate,screening,withdrawn&title=nonexistent'
        )
        .flush({
          entry: []
        });
    });
  });


  describe('combineANDedCriteriaForPatient', () => {
    it('should combine ANDed criteria for Patient', () => {
      expect(
        cohort.combineANDedCriteriaForPatient({
          condition: 'and',
          rules: [
            {
              condition: 'and',
              rules: [
                getCriteriaFor('Patient'),
                getCriteriaFor('PatientForResearchStudy'),
                getCriteriaFor('Condition')]
            },
            {
              condition: 'or',
              rules: [
                getCriteriaFor('Patient'),
                getCriteriaFor('PatientForOtherResearchStudy'),
                getCriteriaFor('Condition')
              ]
            }
          ]
        })
      ).toEqual({
        condition: 'and',
        rules: [
          {
            condition: 'and',
            rules: [
              getCriteriaFor('Condition'),
              getCriteriaFor('PatientCombinedWithPatientForResearchStudy')
            ]
          },
          {
            condition: 'or',
            rules: [
              getCriteriaFor('Patient'),
              getCriteriaFor('PatientForOtherResearchStudy'),
              getCriteriaFor('Condition')
            ]
          }
        ]
      });
    });
  });

});
