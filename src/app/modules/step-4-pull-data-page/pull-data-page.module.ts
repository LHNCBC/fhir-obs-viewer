import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PullDataPageComponent } from './pull-data-page.component';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { ResourceTableModule } from '../resource-table/resource-table.module';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { SearchParameterGroupModule } from '../search-parameter-group/search-parameter-group.module';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { EllipsisTextModule } from '../../shared/ellipsis-text/ellipsis-text.module';
import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  TableVirtualScrollModule
} from '../../shared/table-virtual-scroll/table-virtual-scroll.module';

@NgModule({
  declarations: [PullDataPageComponent],
  exports: [PullDataPageComponent],
  imports: [
    CommonModule,
    MatTabsModule,
    SearchParameterGroupModule,
    MatTableModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    MatInputModule,
    MatButtonModule,
    MatMenuModule,
    ResourceTableModule,
    MatCheckboxModule,
    FormsModule,
    EllipsisTextModule,
    ScrollingModule,
    TableVirtualScrollModule
  ]
})
export class PullDataPageModule {}
