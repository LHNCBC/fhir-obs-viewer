// Ordered list of steps (should be the same as in the stepper template).
// The main purpose of this is to determine the name of the previous or next
// visible step before the template is rendered so that the
// "NG0100: ExpressionChangedAfterItHasBeenCheckedError" error does not occur.
//
// This enum lives in its own file (separate from `stepper.component.ts`) to
// avoid circular module dependencies — `RasTokenService` needs the enum value
// at runtime, but transitively importing `StepperComponent` from the service
// pulls the wizard's child components back into the dependency graph.
export enum Step {
  SETTINGS,
  SELECT_AN_ACTION,
  SELECT_RESEARCH_STUDIES,
  SELECT_RECORDS,
  BROWSE_PUBLIC_DATA,
  DEFINE_COHORT,
  VIEW_COHORT,
  PULL_DATA_FOR_THE_COHORT
}
