import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  ViewChild
} from '@angular/core';
import Def from 'autocomplete-lhc';
import { FilterType } from '../../types/filter-type';
import { CustomDialogRef } from '../../shared/custom-dialog/custom-dialog-ref';

/**
 * Component for filtering criteria of a resource table column
 */
@Component({
  selector: 'app-resource-table-filter',
  templateUrl: './resource-table-filter.component.html',
  styleUrls: ['./resource-table-filter.component.less'],
  standalone: false
})
export class ResourceTableFilterComponent implements AfterViewInit {
  static idPrefix = 'resource-table-filter-';
  static idIndex = 0;
  inputId =
    ResourceTableFilterComponent.idPrefix +
    ++ResourceTableFilterComponent.idIndex;
  @ViewChild('input') input: ElementRef<HTMLInputElement>;
  value: string | string[];
  filterType = FilterType.Text;
  options: string[] = [];
  // Autocompleter instance
  acInstance: Def.Autocompleter.Prefetch;

  readonly INSTRUCTIONS = [
    'Filter by text',
    'Select one or more to filter by',
    'Type a range filter'
  ];
  readonly TOOLTIPS = [
    'Type here.',
    'Start typing here.',
    'Examples: >5000, <=10, 50, 10 - 19.'
  ];

  constructor(private dialogRef: CustomDialogRef) {
    this.value = this.dialogRef.data.value;
    this.filterType = this.dialogRef.data.filterType;
    this.options = this.dialogRef.data.options;
  }

  ngAfterViewInit(): void {
    if (this.filterType === FilterType.Autocomplete) {
      this.acInstance = new Def.Autocompleter.Prefetch(
        this.inputId,
        this.options,
        {
          maxSelect: '*',
          matchListValue: true,
          suggestionMode: Def.Autocompleter.NO_COMPLETION_SUGGESTIONS
        }
      );
      if (this.value && this.value.length) {
        (this.value as string[]).forEach((v) => {
          this.acInstance.storeSelectedItem(v);
          this.acInstance.addToSelectedArea(v);
        });
      }
    } else {
      this.input.nativeElement.value = this.value as string;
    }
    this.dialogRef.overlay.backdropClick().subscribe(() => this.close());
  }

  @HostListener('document:keydown.escape', ['$event'])
  @HostListener('keydown.enter', ['$event'])
  onKeydown(event): void {
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }

  close(): void {
    if (
      this.filterType === FilterType.Number &&
      this.input.nativeElement.value &&
      !/^\d+\s*-\s*\d+$|^[<>]?=?\s*\d+$/.test(this.input.nativeElement.value)
    ) {
      alert('Please type a range filter, examples: >5000, <=10, 50, 10 - 19.');
      return;
    }
    if (this.filterType === FilterType.Autocomplete) {
      this.dialogRef.close(this.acInstance.getSelectedItems());
    } else {
      this.dialogRef.close(this.input.nativeElement.value);
    }
  }
}
