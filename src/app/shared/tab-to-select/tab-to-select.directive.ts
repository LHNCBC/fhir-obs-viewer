import { Directive, HostListener, Optional } from '@angular/core';
import { MatAutocompleteTrigger } from '@angular/material/autocomplete';

/**
 * When applied to a mat-autocomplete control, user can hit TAB key to select
 * an item and move focus to the next control.
 */
@Directive({
  selector: '[tabToSelect]',
  standalone: false
})
export class TabToSelectDirective {
  observable: any;
  constructor(@Optional() private autoTrigger: MatAutocompleteTrigger) {}

  @HostListener('keydown.tab') onTab(): void {
    if (this.autoTrigger.activeOption) {
      this.autoTrigger.writeValue(this.autoTrigger.activeOption.value);
      this.autoTrigger._onChange(this.autoTrigger.activeOption.value);
    }
  }
}
