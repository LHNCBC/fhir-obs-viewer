import { TableVirtualScrollDirective } from './table-virtual-scroll.directive';
import { ChangeDetectorRef, NgZone } from '@angular/core';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { MatTable } from '@angular/material/table';
import { Subject } from 'rxjs';


/**
 * Flushes pending microtasks so queued offset syncs and change detection run.
 * @returns promise resolved after the current microtask queue drains.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}


describe('TableVirtualScrollDirective', () => {
  let directive: TableVirtualScrollDirective;
  let renderedRange$: Subject<{ start: number; end: number }>;
  let contentChanged$: Subject<void>;
  let viewChange: { next: jasmine.Spy };
  let table: MatTable<unknown>;
  let viewport: CdkVirtualScrollViewport;
  let ngZone: NgZone;
  let changeDetectorRef: ChangeDetectorRef;
  let contentWrapper: HTMLElement | null;
  let querySelectorSpy: jasmine.Spy;
  let getOffsetSpy: jasmine.Spy;

  beforeEach(() => {
    renderedRange$ = new Subject();
    contentChanged$ = new Subject();
    viewChange = { next: jasmine.createSpy('viewChange.next') };
    table = {
      contentChanged: contentChanged$,
      viewChange
    } as unknown as MatTable<unknown>;
    contentWrapper = document.createElement('div');
    querySelectorSpy = jasmine
      .createSpy('querySelector')
      .and.callFake(() => contentWrapper);
    getOffsetSpy = jasmine
      .createSpy('getOffsetToRenderedContentStart')
      .and.returnValue(0);
    viewport = {
      renderedRangeStream: renderedRange$,
      getOffsetToRenderedContentStart: getOffsetSpy,
      elementRef: {
        nativeElement: {
          querySelector: querySelectorSpy
        }
      }
    } as unknown as CdkVirtualScrollViewport;
    ngZone = {
      runOutsideAngular: (fn: () => unknown) => fn()
    } as unknown as NgZone;
    changeDetectorRef = jasmine.createSpyObj<ChangeDetectorRef>(
      'ChangeDetectorRef',
      ['detectChanges']
    );
    directive = new TableVirtualScrollDirective(
      viewport,
      ngZone,
      changeDetectorRef
    );
    directive.table = table;
  });


  it('should forward the rendered range to the Material table', () => {
    directive.ngAfterContentInit();
    const range = { start: 5, end: 15 };

    renderedRange$.next(range);

    expect(viewChange.next).toHaveBeenCalledOnceWith(range);
  });


  it('should register the rendered range listener outside Angular', () => {
    spyOn(ngZone, 'runOutsideAngular').and.callThrough();

    directive.ngAfterContentInit();

    expect(ngZone.runOutsideAngular).toHaveBeenCalled();
  });


  it('should apply the rendered content offset after a microtask', async () => {
    getOffsetSpy.and.returnValue(120);
    directive.ngAfterContentInit();

    renderedRange$.next({ start: 0, end: 10 });
    expect(contentWrapper.style.transform).toBe('');

    await flushMicrotasks();

    expect(contentWrapper.style.transform).toBe('translateY(120px)');
  });


  it('should sync the content offset only once per microtask', async () => {
    getOffsetSpy.and.returnValue(40);
    directive.ngAfterContentInit();

    renderedRange$.next({ start: 0, end: 10 });
    renderedRange$.next({ start: 1, end: 11 });
    renderedRange$.next({ start: 2, end: 12 });
    await flushMicrotasks();

    expect(getOffsetSpy.calls.count()).toBe(1);
  });


  it('should skip applying the offset when it is null', async () => {
    getOffsetSpy.and.returnValue(null);
    directive.ngAfterContentInit();

    renderedRange$.next({ start: 0, end: 10 });
    await flushMicrotasks();

    expect(querySelectorSpy).not.toHaveBeenCalled();
    expect(contentWrapper.style.transform).toBe('');
  });


  it('should not throw when the content wrapper is missing', async () => {
    getOffsetSpy.and.returnValue(10);
    contentWrapper = null;
    directive.ngAfterContentInit();

    renderedRange$.next({ start: 0, end: 10 });
    await flushMicrotasks();

    expect(querySelectorSpy).toHaveBeenCalled();
  });


  it('should run change detection after the table content changes', async () => {
    directive.ngAfterContentInit();

    contentChanged$.next();
    expect(changeDetectorRef.detectChanges).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(changeDetectorRef.detectChanges).toHaveBeenCalledTimes(1);
  });


  it('should run change detection once per microtask', async () => {
    directive.ngAfterContentInit();

    contentChanged$.next();
    contentChanged$.next();
    contentChanged$.next();
    await flushMicrotasks();

    expect(changeDetectorRef.detectChanges).toHaveBeenCalledTimes(1);
  });


  it('should stop forwarding ranges after destroy', () => {
    directive.ngAfterContentInit();
    directive.ngOnDestroy();

    renderedRange$.next({ start: 0, end: 10 });

    expect(viewChange.next).not.toHaveBeenCalled();
  });


  it('should not apply a queued offset sync after destroy', async () => {
    getOffsetSpy.and.returnValue(80);
    directive.ngAfterContentInit();

    renderedRange$.next({ start: 0, end: 10 });
    directive.ngOnDestroy();
    await flushMicrotasks();

    expect(getOffsetSpy).not.toHaveBeenCalled();
    expect(contentWrapper.style.transform).toBe('');
  });


  it('should not run queued change detection after destroy', async () => {
    directive.ngAfterContentInit();

    contentChanged$.next();
    directive.ngOnDestroy();
    await flushMicrotasks();

    expect(changeDetectorRef.detectChanges).not.toHaveBeenCalled();
  });


  it('should subscribe without a projected table', () => {
    directive.table = undefined;

    expect(() => directive.ngAfterContentInit()).not.toThrow();

    renderedRange$.next({ start: 0, end: 10 });

    expect(getOffsetSpy).not.toHaveBeenCalled();
  });

});


