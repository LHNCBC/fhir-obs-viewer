import { ErrorStateMatcher } from '@angular/material/core';
import {
  UntypedFormControl,
  FormGroupDirective,
  NgForm,
  ValidationErrors
} from '@angular/forms';
import { Injectable, Optional, SkipSelf } from '@angular/core';

/**
 * Service for managing validation and displaying errors.
 */
@Injectable()
export class ErrorManager implements ErrorStateMatcher {
  constructor(@SkipSelf() @Optional() parent: ErrorManager) {
    if (parent) {
      parent.childServices.push(this);
    }
  }
  // Array of child ErrorManager services in the DI tree
  childServices: ErrorManager[] = [];
  // Array of controls for which errors should be displayed
  controlToShowErrors: UntypedFormControl[] = [];
  // Array of all controls
  allControls: UntypedFormControl[] = [];

  // Determines the visibility of an error
  isErrorState(
    control: UntypedFormControl | null,
    form: FormGroupDirective | NgForm | null
  ): boolean {
    const showError = this.controlToShowErrors.indexOf(control) !== -1;
    return !!(control && control.invalid && showError);
  }

  /**
   * Adds a new formControl
   */
  addControl(control: UntypedFormControl): void {
    this.allControls.push(control);
  }

  /**
   * Removes formControl
   */
  removeControl(control: UntypedFormControl): void {
    const index = this.allControls.indexOf(control);
    this.allControls.splice(index, 1);
    if (index < this.controlToShowErrors.length) {
      this.controlToShowErrors.splice(index, 1);
    }
  }

  /**
   * Shows errors for existing formControls
   */
  showErrors(): void {
    this.controlToShowErrors = this.allControls.concat();
    this.childServices.forEach(s => {
      s.showErrors();
    });
  }

  /**
   * Returns errors
   */
  get errors(): ValidationErrors | null {
    const length = this.allControls.length;
    for (let i = 0; i < length; ++i) {
      if (this.allControls[i].invalid) {
        return { required: true };
      }
    }
    // Return error if any of the child ErrorManagers has errors.
    // Controls in a child component with an ErrorManager provider is managed in the child ErrorManager.
    for (let i = 0; i < this.childServices.length; ++i) {
      const err = this.childServices[i].errors;
      if (err) {
        return err;
      }
    }
    return null;
  }
}
