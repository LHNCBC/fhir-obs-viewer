import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TableVirtualScrollDirective
} from './table-virtual-scroll.directive';


@NgModule({
  declarations: [TableVirtualScrollDirective],
  exports: [TableVirtualScrollDirective],
  imports: [CommonModule]
})
export class TableVirtualScrollModule {}

