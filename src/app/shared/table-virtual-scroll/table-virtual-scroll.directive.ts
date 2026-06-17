import {
  AfterContentInit,
  ChangeDetectorRef,
  ContentChild,
  Directive,
  NgZone,
  OnDestroy
} from '@angular/core';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import type { ListRange } from '@angular/cdk/collections';
import { MatTable } from '@angular/material/table';
import { Subscription } from 'rxjs';


/**
 * Glue directive that makes a Material `mat-table` render correctly inside a
 * `cdk-virtual-scroll-viewport`. A plain `mat-table` does not integrate with
 * the CDK virtual scroll viewport on its own, so this directive:
 * - forwards the viewport rendered range to the table,
 * - applies the rendered content offset before the browser paints the new
 *   range to avoid a one-frame paint at the previous offset, and
 * - runs change detection once recycled rows finish rebinding so a cached row
 *   does not paint with its previous cell values.
 * It also disables browser scroll anchoring, which otherwise counteracts the
 * row recycling and makes the native scrollbar thumb and table content jump.
 */
@Directive({
  // tslint:disable-next-line:directive-selector
  selector: 'cdk-virtual-scroll-viewport[appTableVirtualScroll]',
  standalone: false,
  host: { style: 'overflow-anchor: none;' }
})
export class TableVirtualScrollDirective implements AfterContentInit, OnDestroy {
  // Material table rendered inside the virtual scroll viewport.
  @ContentChild(MatTable) table: MatTable<unknown> | undefined;
  // Subscriptions to the viewport rendered range and the table content updates.
  private subscriptions = new Subscription();
  // Whether a content offset sync has already been queued for this microtask.
  private viewportOffsetSyncQueued = false;
  // Whether change detection has already been queued for this microtask.
  private tableRenderDetectionQueued = false;
  // Whether the host view has been destroyed.
  private viewDestroyed = false;
  // Selector of the CDK content wrapper that receives the scroll offset.
  private readonly virtualScrollContentWrapperSelector =
    '.cdk-virtual-scroll-content-wrapper';


  constructor(
    private viewport: CdkVirtualScrollViewport,
    private ngZone: NgZone,
    private changeDetectorRef: ChangeDetectorRef
  ) {}


  /**
   * Subscribes to the viewport and table once the projected table is available.
   */
  ngAfterContentInit(): void {
    if (this.table) {
      this.subscriptions.add(
        this.table.contentChanged.subscribe(() => {
          this.scheduleTableRenderDetection();
        })
      );
    }

    // Register the rendered range listener outside Angular so scrolling does
    // not trigger change detection before CDK virtual scroll updates its range.
    this.ngZone.runOutsideAngular(() => {
      this.subscriptions.add(
        this.viewport.renderedRangeStream.subscribe((range) => {
          this.updateTableRenderedRange(range);
          this.scheduleViewportOffsetSync();
        })
      );
    });
  }


  /**
   * Unsubscribes from viewport and table updates.
   */
  ngOnDestroy(): void {
    this.viewDestroyed = true;
    this.subscriptions.unsubscribe();
  }


  /**
   * Forwards the latest rendered range to the Material table without waiting
   * for its internal animation-frame subscription to the virtual scroll
   * viewport.
   * @param range - latest rendered range from the virtual scroll viewport.
   */
  private updateTableRenderedRange(range: ListRange): void {
    this.table?.viewChange.next(range);
  }


  /**
   * Schedules the content wrapper offset to be applied before the browser
   * paints the new rendered range.
   */
  private scheduleViewportOffsetSync(): void {
    if (this.viewportOffsetSyncQueued) {
      return;
    }

    this.viewportOffsetSyncQueued = true;
    queueMicrotask(() => {
      this.viewportOffsetSyncQueued = false;
      if (this.viewDestroyed) {
        return;
      }

      this.syncViewportContentOffset();
    });
  }


  /**
   * Applies CDK's latest rendered content offset synchronously. The CDK
   * viewport applies the same transform through its queued change detection,
   * but setting it here prevents a one-frame paint at the previous offset.
   */
  private syncViewportContentOffset(): void {
    const offset = this.viewport.getOffsetToRenderedContentStart();
    if (offset === null) {
      return;
    }

    const contentWrapper =
      this.viewport.elementRef.nativeElement.querySelector<HTMLElement>(
        this.virtualScrollContentWrapperSelector
      );
    if (!contentWrapper) {
      return;
    }

    contentWrapper.style.transform = `translateY(${offset}px)`;
  }


  /**
   * Schedules change detection after the CDK table updates recycled row
   * contexts. This prevents a cached row from painting with its previous cell
   * values before Angular checks the rebound row template.
   */
  private scheduleTableRenderDetection(): void {
    if (this.tableRenderDetectionQueued) {
      return;
    }

    this.tableRenderDetectionQueued = true;
    queueMicrotask(() => {
      this.tableRenderDetectionQueued = false;
      if (this.viewDestroyed) {
        return;
      }

      this.changeDetectorRef.detectChanges();
    });
  }
}

