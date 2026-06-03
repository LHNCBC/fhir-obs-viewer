import { TestBed } from '@angular/core/testing';
import { SettingsService } from './settings.service';
import { configureTestingModule } from 'src/test/helpers';

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(async () => {
    await configureTestingModule(
      {},
      { serverUrl: 'https://dbgap-api.ncbi.nlm.nih.gov/fhir/x1' }
    );
    service = TestBed.inject(SettingsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should read custom settings for dbGap', async () => {
    expect(typeof service.get('definitionsFile')).toBe('string');
  });
});
