import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SelectColumnsComponent } from './select-columns.component';
import { SelectColumnsModule } from './select-columns.module';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';


describe('SelectColumnsComponent', () => {
  let component: SelectColumnsComponent;
  let fixture: ComponentFixture<SelectColumnsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SelectColumnsComponent],
      imports: [SelectColumnsModule],
      providers: [
        { provide: MatDialogRef, useValue: {} },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            resourceType: 'Condition',
            columns: [],
            columnsWithData: new BehaviorSubject([])
          }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(SelectColumnsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
