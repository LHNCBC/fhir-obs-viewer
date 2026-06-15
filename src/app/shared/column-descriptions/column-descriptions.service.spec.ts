import { TestBed } from '@angular/core/testing';

import { ColumnDescriptionsService } from './column-descriptions.service';
import { MatDialog } from '@angular/material/dialog';
import {
  ConnectionStatus,
  FhirBackendService
} from '../fhir-backend/fhir-backend.service';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { ColumnValuesService } from '../column-values/column-values.service';
import { SettingsService } from '../settings-service/settings.service';


/**
 * Returns resource definitions used by column description service tests.
 */
function getMockDefinitions(): any {
  return {
    resources: {
      Patient: {
        columnDescriptions: [
          {
            element: 'id',
            types: ['string'],
            isArray: false
          },
          {
            element: 'name',
            types: ['string'],
            isArray: false
          }
        ]
      }
    }
  };
}


/**
 * Returns whether the mock FHIR server should use dbGaP settings.
 */
function isMockDbgapServer(): boolean {
  return false;
}


/**
 * Returns a displayable mock value for a supported column type.
 */
function getMockColumnValue(): string {
  return '';
}


/**
 * Returns a mock value reader for a supported column type.
 */
function getMockValueFn(): () => string {
  return getMockColumnValue;
}


/**
 * Returns undefined for settings paths that are not relevant to the test.
 */
function getMockSetting(): undefined {
  return undefined;
}


describe('ColumnDescriptionsService', () => {
  let service: ColumnDescriptionsService;
  const storageKey = 'someUrl-Patient-someContext-columns';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: {} },
        {
          provide: FhirBackendService,
          useValue: {
            initialized: new BehaviorSubject(ConnectionStatus.Ready),
            currentVersion: 'R4',
            serviceBaseUrl: 'someUrl',
            getCurrentDefinitions: getMockDefinitions,
            isDbgap: isMockDbgapServer
          }
        },
        {
          provide: ColumnValuesService,
          useValue: {
            getValueFn: getMockValueFn
          }
        },
        {
          provide: SettingsService,
          useValue: {
            get: getMockSetting
          }
        },
        ColumnDescriptionsService
      ]
    });
    window.localStorage.setItem(storageKey, 'name');
    service = TestBed.inject(ColumnDescriptionsService);
  });

  afterEach(() => {
    window.localStorage.removeItem(storageKey);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });


  it('should get columns', async () => {
    service.setColumnsWithData('Patient', 'someContext', ['name']);

    const visibleColumns = await firstValueFrom(
      service.getVisibleColumns('Patient', 'someContext').pipe(
        filter((columns) => columns.length > 0),
        take(1)
      )
    );

    expect(visibleColumns).toEqual([
      jasmine.objectContaining({ displayName: 'Name' })
    ]);
  });

});
