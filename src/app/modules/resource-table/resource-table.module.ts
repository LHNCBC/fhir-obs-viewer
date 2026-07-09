import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ResourceTableComponent } from './resource-table.component';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSortModule } from '@angular/material/sort';
import {
  EllipsisTextModule
} from '../../shared/ellipsis-text/ellipsis-text.module';
import {
  ResourceTableFilterModule
} from '../resource-table-filter/resource-table-filter.module';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import {
  TableVirtualScrollModule
} from '../../shared/table-virtual-scroll/table-virtual-scroll.module';

@NgModule({
  declarations: [ResourceTableComponent],
  exports: [ResourceTableComponent],
  imports: [
    CommonModule,
    MatIconModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatTableModule,
    MatCheckboxModule,
    FormsModule,
    MatInputModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    ScrollingModule,
    MatProgressBarModule,
    MatExpansionModule,
    MatSortModule,
    EllipsisTextModule,
    ResourceTableFilterModule,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    TableVirtualScrollModule
  ]
})
export class ResourceTableModule {}
