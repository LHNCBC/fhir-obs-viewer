import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EllipsisTextComponent } from './ellipsis-text.component';
import { EllipsisTextModule } from './ellipsis-text.module';
import { Component, ViewChild } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';


@Component({
  template: ` <div style="width: 100px">
    <app-ellipsis-text [text]="text"></app-ellipsis-text>
  </div>`,
  standalone: false
})
class TestHostComponent {
  @ViewChild(EllipsisTextComponent) component: EllipsisTextComponent;
  text = '';
}


describe('EllipsisTextComponent', () => {
  let hostComponent: TestHostComponent;
  let component: EllipsisTextComponent;
  let fixture: ComponentFixture<TestHostComponent>;
  let div: HTMLElement;
  let tooltip: MatTooltip;
  const LONG_TEXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const SHORT_TEXT = 'aaa';


  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TestHostComponent],
      imports: [EllipsisTextModule]
    }).compileComponents();
  });


  beforeEach(() => {
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    hostComponent = fixture.componentInstance;
    component = hostComponent.component;
    spyOn(component, 'getTooltipText').and.callThrough();
    div = fixture.nativeElement.querySelector('app-ellipsis-text div');
    tooltip = fixture.debugElement
      .query(By.directive(MatTooltip))
      .injector.get(MatTooltip);
  });


  it('should create', () => {
    expect(component).toBeTruthy();
  });


  /**
   * Sets the host component text, triggers change detection, simulates hovering
   * over the ellipsis text element, and verifies that the tooltip message matches
   * the expected value.
   *
   * @param text - The text value to render in the ellipsis text component.
   * @param expectedTooltipText - The tooltip text expected after mouse hover.
   */
  function expectTooltipText(text: string, expectedTooltipText: string): void {
    hostComponent.text = text;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(component.getTooltipText).not.toHaveBeenCalled();
    expect(tooltip.message).toBe('');

    div.dispatchEvent(new Event('mouseenter'));

    expect(component.getTooltipText).toHaveBeenCalled();
    expect(tooltip.message).toBe(expectedTooltipText);
  }


  it('should set tooltip for long text', () => {
    expectTooltipText(LONG_TEXT, LONG_TEXT);
  });


  it('should not set tooltip for short text', () => {
    expectTooltipText(SHORT_TEXT, '');
  });

});
