import {
  AfterViewInit,
  Component,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { MatStep, MatStepper } from '@angular/material/stepper';
import {
  ConnectionStatus,
  FhirBackendService
} from '../../shared/fhir-backend/fhir-backend.service';
import {
  ColumnDescriptionsService
} from '../../shared/column-descriptions/column-descriptions.service';
import { Subject, Subscription } from 'rxjs';
import { saveAs } from 'file-saver';
import {
  SelectAnAreaOfInterestComponent
} from '../step-1-select-an-area-of-interest/select-an-area-of-interest.component';
import {
  DefineCohortPageComponent
} from '../step-2-define-cohort-page/define-cohort-page.component';
import {
  ViewCohortPageComponent
} from '../step-3-view-cohort-page/view-cohort-page.component';
import {
  PullDataPageComponent
} from '../step-4-pull-data-page/pull-data-page.component';
import {
  CohortService,
  CreateCohortMode
} from '../../shared/cohort/cohort.service';
import { PullDataService } from '../../shared/pull-data/pull-data.service';
import { APP_VERSION } from '../../shared/app-version';
import { findLast } from 'lodash-es';
import { getUrlParam } from '../../shared/utils';
import {
  SelectRecordsService
} from '../../shared/select-records/select-records.service';
import { RasTokenService } from '../../shared/ras-token/ras-token.service';
import {
  SelectRecordsPageComponent
} from '../select-records-page/select-records-page.component';
import {
  SelectAnActionComponent
} from '../select-an-action/select-an-action.component';
import {
  SettingsPageComponent
} from '../step-0-settings-page/settings-page.component';
import { first } from 'rxjs/operators';
import { CartService } from '../../shared/cart/cart.service';
import { MatDialog } from '@angular/material/dialog';
import {
  AlertDialogComponent
} from '../../shared/alert-dialog/alert-dialog.component';
import { Patient } from 'fhir/r4';

// Ordered list of steps (should be the same as in the template)
// The main purpose of this is to determine the name of the previous or next
// visible step before the template is rendered so that the
// "NG0100: ExpressionChangedAfterItHasBeenCheckedError" error does not occur.
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

/**
 * The main component provides a wizard-like workflow by dividing content into logical steps.
 */
@Component({
  selector: 'app-stepper',
  templateUrl: './stepper.component.html',
  styleUrls: ['./stepper.component.less'],
  standalone: false
})
export class StepperComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('stepper') public stepper: MatStepper;
  @ViewChild('settings') public settingsPageComponent: SettingsPageComponent;
  @ViewChild('settingsStep') public settingsStep: MatStep;

  @ViewChild('selectAnActionStep') set _selectAnActionStep(step: MatStep) {
    this.selectAnActionStep = step;
    if (step) {
      if (this.selectAnActionComponent?.createCohortMode) {
        // This is necessary in case this setter is run after the subscriber
        // from the _selectAnActionComponent setter.
        const value = this.selectAnActionComponent.createCohortMode.value;
        step.completed = !this.isRasLoginRequired(value);
      } else {
        step.completed = false;
      }
    }
  }
  selectAnActionStep: MatStep;

  @ViewChild('defineCohortStep') set _defineCohortStep(step: MatStep) {
    this.defineCohortStep = step;
    if (step) {
      step.completed = false;
    }
  }
  defineCohortStep: MatStep;

  @ViewChild('selectRecordsStep') set _selectRecordsStep(step: MatStep) {
    this.selectRecordsStep = step;
    if (step) {
      step.completed = false;
    }
  }
  selectRecordsStep: MatStep;

  @ViewChild(SelectAnAreaOfInterestComponent)
  public selectAreaOfInterestComponent: SelectAnAreaOfInterestComponent;
  @ViewChild(SelectAnActionComponent) set _selectAnActionComponent(comp: SelectAnActionComponent) {
    this.selectAnActionComponent = comp;
    if (comp) {
      comp.createCohortMode.valueChanges.subscribe((value) => {
        // If RAS login is required, mark the step incomplete to disable the header of the next step.
        this.selectAnActionStep.completed = !this.isRasLoginRequired(value);
      });
    }
  }
  public selectAnActionComponent: SelectAnActionComponent;
  @ViewChild(DefineCohortPageComponent)
  public defineCohortComponent: DefineCohortPageComponent;
  @ViewChild(SelectRecordsPageComponent)
  public selectRecordsComponent: SelectRecordsPageComponent;
  @ViewChild(ViewCohortPageComponent)
  public viewCohortComponent: ViewCohortPageComponent;
  @ViewChild(PullDataPageComponent)
  public pullDataPageComponent: PullDataPageComponent;

  allowChangeCreateCohortMode = true;

  defineCohort: UntypedFormControl = new UntypedFormControl();
  subscription: Subscription;
  CreateCohortMode = CreateCohortMode;
  // Publish enum for template
  Step = Step;
  // Step descriptions.
  // The main purpose of this is to determine the name of the previous or next
  // visible step before the template is rendered so that the
  // "NG0100: ExpressionChangedAfterItHasBeenCheckedError" error does not occur.
  stepDescriptions: Array<{
    // Step label
    label: string;
    // Visibility condition
    isVisible: () => boolean;
  }> = [];

  // Enable RAS if it is not disabled via the URL parameter
  enableRas = getUrlParam('ras') !== 'disable';

  // A counter used to navigate to the previous step after RAS login
  rasStepCountDown = 0;

  constructor(
    public columnDescriptions: ColumnDescriptionsService,
    public fhirBackend: FhirBackendService,
    public cohort: CohortService,
    public pullData: PullDataService,
    public selectRecord: SelectRecordsService,
    public rasToken: RasTokenService,
    private cart: CartService,
    private dialog: MatDialog
  ) {
    this.stepDescriptions[Step.SETTINGS] = {
      label: 'Settings',
      isVisible: () => true
    };
    this.stepDescriptions[Step.SELECT_AN_ACTION] = {
      label: 'Select an action',
      isVisible: () => this.allowChangeCreateCohortMode
    };
    this.stepDescriptions[Step.SELECT_RESEARCH_STUDIES] = {
      label: 'Select Research Studies',
      isVisible: () =>
        this.fhirBackend.features.hasResearchStudy &&
        !this.allowChangeCreateCohortMode &&
        this.cohort.createCohortMode === CreateCohortMode.SEARCH
    };
    this.stepDescriptions[Step.SELECT_RECORDS] = {
      label: 'Select records',
      isVisible: () => this.cohort.createCohortMode === CreateCohortMode.BROWSE
    };
    this.stepDescriptions[Step.BROWSE_PUBLIC_DATA] = {
      label: 'Browse public data',
      isVisible: () =>
        this.cohort.createCohortMode === CreateCohortMode.NO_COHORT
    };
    this.stepDescriptions[Step.DEFINE_COHORT] = {
      label: 'Define cohort',
      isVisible: () => this.cohort.createCohortMode === CreateCohortMode.SEARCH
    };
    this.stepDescriptions[Step.VIEW_COHORT] = {
      label: 'View cohort',
      isVisible: () =>
        [CreateCohortMode.SEARCH, CreateCohortMode.BROWSE].includes(
          this.cohort.createCohortMode
        )
    };
    this.stepDescriptions[Step.PULL_DATA_FOR_THE_COHORT] = {
      label: 'Pull data for the cohort',
      isVisible: () =>
        [CreateCohortMode.SEARCH, CreateCohortMode.BROWSE].includes(
          this.cohort.createCohortMode
        )
    };
  }

  ngOnInit() {
    this.fhirBackend.dbgapRelogin$.pipe(first()).subscribe(() => {
      const savedObject = this.getSavedObject();
      sessionStorage.setItem('savedObject', JSON.stringify(savedObject));
      const currentStep = this.getCurrentStep();
      if (currentStep === Step.PULL_DATA_FOR_THE_COHORT.toString()) {
        // Save which tabs user has opened and related form controls if in "pull data" step.
        const pullDataStatus = this.pullDataPageComponent.getReloginStatus();
        sessionStorage.setItem(
          'pullDataStatus',
          JSON.stringify(pullDataStatus)
        );
      }
      if (
        currentStep === Step.VIEW_COHORT.toString() &&
        this.cohort.patient400ErrorFlag
      ) {
        // In case of 4xx error while searching for patients, re-login the user to the
        // previous step and go to "view cohort" step with an actual search for patients.
        this.cohort.patient400ErrorFlag = false;
        this.rasToken.login(
          this.fhirBackend.serviceBaseUrl,
          this.selectAnActionComponent.createCohortMode.value,
          this.stepper.selectedIndex - 1,
          true
        );
      } else {
        this.rasToken.login(
          this.fhirBackend.serviceBaseUrl,
          this.selectAnActionComponent.createCohortMode.value,
          this.stepper.selectedIndex,
          false
        );
      }
    });
  }

  /**
   * A lifecycle hook that is called after Angular has fully initialized
   * a component's view.
   */
  ngAfterViewInit(): void {
    this.subscription = this.fhirBackend.initialized.subscribe((status) => {
      if (
        status === ConnectionStatus.Disconnect ||
        status === ConnectionStatus.Pending
      ) {
        this.stepper.reset();
        // A workaround for the bug which is described here:
        // https://github.com/angular/components/issues/13736
        // The problem is with [completed] input parameter which is ignored
        // after reset(), because the actual completed value is set directly here:
        // https://github.com/angular/components/blob/12.2.x/src/cdk/stepper/stepper.ts#L217
        // Another way is not to use [completed]="expression" in our template at
        // all and always set this value directly. But this requires significant
        // changes. So I decided to do it only here:
        this.settingsStep.completed = this.settingsPageComponent.settingsFormGroup.valid;
      } else if (status === ConnectionStatus.Ready) {
        this.allowChangeCreateCohortMode = !this.fhirBackend.isPreviousVersion;
        if (!this.allowChangeCreateCohortMode) {
          this.cohort.createCohortMode = CreateCohortMode.SEARCH;
        } else {
          if (!this.rasToken.isRasCallbackNavigation) {
            this.cohort.createCohortMode = CreateCohortMode.UNSELECTED;
            this.selectAnActionComponent?.createCohortMode.setValue(
              CreateCohortMode.UNSELECTED
            );
          } else {
            this.rasToken.isRasCallbackNavigation = false;
            this.rasStepCountDown = Number(
              sessionStorage.getItem('currentStepperIndex')
            );
            const goNextStep = sessionStorage.getItem('goNextStep') === 'true';
            if (this.rasStepCountDown) {
              // setTimeout to allow selectAnActionComponent to come into existence,
              // since this.allowChangeCreateCohortMode is just set in this block above.
              setTimeout(() => {
                this.stepper.next();
                this.rasStepCountDown--;
                // If it came from '/request-redirect-token-callback' and RAS token
                // has been validated, go back to Select An Action step and restore
                // user's selection before contacting RAS.
                const selectedCreateCohortMode = sessionStorage.getItem(
                  'selectedCreateCohortMode'
                ) as CreateCohortMode;
                this.selectAnActionComponent.createCohortMode.setValue(
                  selectedCreateCohortMode
                );
                if (!this.rasToken.rasTokenValidated) {
                  this.dialog.open(AlertDialogComponent, {
                    data: {
                      header: 'Problem obtaining authorization for research study data',
                      content:
                      'Error message from dbGaP or CIT: ' + this.rasToken.errorMessage,
                      hasCancelButton: false
                    }
                  });
                } else if (this.rasStepCountDown === 0) {
                  this.checkNextStep(goNextStep);
                } else {
                  // setTimeout is needed so this.stepper.next() is only called after
                  // new steps come into existence as a result of 'createCohortMode' change.
                  // The stepper have only 2 steps before 'createCohortMode' is set.
                  // Same in this.checkNextStep();
                  setTimeout(() => {
                    this.stepper.next();
                    this.rasStepCountDown--;
                    const savedObject = sessionStorage.getItem('savedObject');
                    if (savedObject) {
                      this.loadFromRawCriteria(JSON.parse(savedObject));
                    }
                    if (this.rasStepCountDown === 0) {
                      this.checkNextStep(goNextStep);
                    } else {
                      // Put below Pull Data step work in the next macrotask queue, lest
                      // it is called before the stepper is at View Cohort step, since
                      // this.loadFromRawCriteria() above could involve some asynchronous work.
                      setTimeout(() => {
                        this.stepper.next();
                        const pullDataStatus = sessionStorage.getItem(
                          'pullDataStatus'
                        );
                        const currentStep = this.getCurrentStep();
                        if (
                          currentStep ===
                            Step.PULL_DATA_FOR_THE_COHORT.toString() &&
                          pullDataStatus
                        ) {
                          this.pullDataPageComponent.restoreLoginStatus(
                            JSON.parse(pullDataStatus)
                          );
                        }
                      }, 200);
                    }
                  }, 0);
                }
              }, 0);
            }
          }
        }
      }
    });
  }

  /**
   * If applicable, go to the next step after user's previous step is restored.
   * @param goNextStep
   * @private
   */
  private checkNextStep(goNextStep: boolean): void {
    if (!goNextStep) {
      return;
    }
    setTimeout(() => {
      const currentStep = this.getCurrentStep();
      if (
        currentStep === Step.DEFINE_COHORT.toString() ||
        currentStep === Step.SELECT_RECORDS.toString()
      ) {
        // call searchForPatients() to go to "view cohort" step with an actual search.
        this.searchForPatients();
      } else {
        this.stepper.next();
      }
    }, 200);
  }

  /**
   * Performs cleanup when a component instance is destroyed.
   */
  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.fhirBackend.disconnect();
  }

  /**
   * Runs searching for Patient resources
   */
  searchForPatients(): void {
    if (this.defineCohortStep) {
      this.defineCohortStep.completed = !this.defineCohortComponent.hasErrors();
      if (this.defineCohortStep.completed) {
        if (this.selectAreaOfInterestComponent) {
          this.defineCohortComponent.searchForPatients(
            this.selectAreaOfInterestComponent.getResearchStudySearchParam()
          );
        } else {
          this.defineCohortComponent.searchForPatients();
        }
        if (this.defineCohortStep.isSelected()) {
          this.stepper.next();
        }
      } else {
        this.defineCohortComponent.showErrors();
      }
    } else {
      this.selectRecordsStep.completed = !this.selectRecordsComponent.hasErrors();
      if (this.selectRecordsStep.completed) {
        this.selectRecordsComponent.searchForPatients();
        if (this.selectRecordsStep.isSelected()) {
          this.stepper.next();
        }
      } else {
        this.selectRecordsComponent.showErrors();
      }
    }
  }

  /**
   * Save criteria and data into json file for future loading.
   */
  saveCohort(): void {
    const objectToSave = this.getSavedObject();
    const blob = new Blob([JSON.stringify(objectToSave, null, 2)], {
      type: 'text/json;charset=utf-8',
      endings: 'native'
    });
    saveAs(blob, `cohort-${objectToSave.data.length}.json`);
  }

  /**
   * Get the object to be saved, either to a file or to sessionStorage.
   */
  getSavedObject(): any {
    const scrubberID = this.fhirBackend.fhirClient.getScrubberIDHeader();
    const result: any = {
      version: APP_VERSION,
      ...(scrubberID ? {scrubberID} : {}),
      serviceBaseUrl: this.fhirBackend.serviceBaseUrl,
      isCartCriteria: !!this.selectRecordsComponent,
      maxPatientCount: this.cohort.maxPatientCount,
      rawCriteria: this.cohort.criteria,
      cartCriteria: this.cart.getCartCriteria(),
      additionalCriteria: this.selectRecordsComponent?.additionalCriteria
        ?.queryCtrl.value,
      researchStudies:
        this.selectAreaOfInterestComponent?.getResearchStudySearchParam() ?? []
    };
    const currentStep = this.getCurrentStep();
    // Save Patient table data if user is at "view cohort" or "pull data" step.
    // Do not save patients data as empty array if 4xx error happened during patient search.
    if (
      (currentStep === Step.VIEW_COHORT.toString() &&
        !this.cohort.patient400ErrorFlag) ||
      currentStep === Step.PULL_DATA_FOR_THE_COHORT.toString()
    ) {
      result.data =
        this.viewCohortComponent?.resourceTableComponent?.dataSource?.data.map(
          (i) => i.resource
        ) ?? [];
    }
    return result;
  }

  /**
   * Find which step user is at.
   */
  getCurrentStep(): string {
    return Object.keys(Step).find(
      (s) => this.stepDescriptions[s].label === this.stepper.selected.label
    );
  }

  /**
   * Process file and load criteria and patient list data.
   */
  loadCohort(event, fromResearchStudyStep = false): void {
    if (event.target.files.length === 1) {
      const reader = new FileReader();
      const filename = event.target.files[0].name;
      reader.onload = (loadEvent) => {
        try {
          const blobData = JSON.parse(loadEvent.target.result as string);
          this.loadFromRawCriteria(blobData, fromResearchStudyStep, filename);
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };
      reader.readAsText(event.target.files[0]);
    }
    event.target.value = '';
  }

  /**
   * Load cohort from raw criteria data.
   */
  loadFromRawCriteria(
    rawData: any,
    fromResearchStudyStep = false,
    filename = null
  ): void {
    const {
      version,
      scrubberID,
      serviceBaseUrl,
      isCartCriteria,
      maxPatientCount,
      rawCriteria,
      cartCriteria,
      data,
      researchStudies
    } = rawData;
    let additionalCriteria = rawData.additionalCriteria;
    if (serviceBaseUrl !== this.fhirBackend.serviceBaseUrl) {
      alert(
        'Error: Inapplicable data, because it was downloaded from another server.'
      );
      return;
    }
    const isCartApproach =
      this.getCurrentStep() === Step.SELECT_RECORDS.toString();
    // It means non-cart approach if "isCartCriteria" is undefined or false.
    // For backward compatibility, user might have saved a cohort without "isCartCriteria" property only in non-cart approach.
    const isCartCriteriaFromCohort = isCartCriteria === true;
    if (isCartCriteriaFromCohort !== isCartApproach) {
      const stepNameFromCohort = isCartCriteriaFromCohort
        ? this.stepDescriptions[Step.SELECT_RECORDS].label
        : this.stepDescriptions[Step.DEFINE_COHORT].label;
      alert(
        `Error: Inapplicable data, because the data is for the cohort definition in "${stepNameFromCohort}" step.`
      );
      return;
    }
    if (isCartApproach) {
      // Set max field value.
      this.selectRecordsComponent.maxPatientsNumber.setValue(maxPatientCount);
      // Update criteria object if the cohort was downloaded from an older version.
      if (additionalCriteria.parameters) {
        additionalCriteria = {
          condition: 'and',
          rules: [{
            resourceType: 'Patient',
            rules: additionalCriteria.parameters.map(item => ({field: item}))
          }]
        };
      }
      // Restore resources, controls and lookups in carts and in 'Additional Criteria' tab.
      this.selectRecordsComponent.setCartCriteria(
        cartCriteria,
        additionalCriteria
      );
    } else {
      // Set max field value.
      this.defineCohortComponent.defineCohortForm
        .get('maxNumberOfPatients')
        .setValue(maxPatientCount);
      // Update criteria object if the cohort was downloaded from an older version.
      if (!version) {
        this.cohort.updateOldFormatCriteria(rawCriteria);
      }
      // Set search parameter form values.
      this.defineCohortComponent.patientParams.queryCtrl.setValue(rawCriteria);
      this.cohort.setCriteria(rawCriteria);
      // Set selected research studies.
      this.selectAreaOfInterestComponent?.selectLoadedResearchStudies(
        researchStudies
      );
    }
    const currentScrubberID = this.fhirBackend.fhirClient.getScrubberIDHeader();
    if (data && (!currentScrubberID && !scrubberID || currentScrubberID === scrubberID)) {
      // Set patient table data, if it was saved.
      this.loadPatientsData(data, fromResearchStudyStep, isCartApproach);
      this.cohort.loadingStatistics = filename
        ? [[`Data loaded from file ${filename}.`]]
        : [[`Data reloaded from session storage.`]];
    } else {
      this.resetStepsStartingWithCurrent();
    }
  }

  /**
   * Resets current and following steps.
   */
  resetStepsStartingWithCurrent(): void {
    const steps = this.stepper.steps;
    const selectedIndex = this.stepper.selectedIndex;
    for (let i = selectedIndex; i < steps.length; i++) {
      steps.get(i).reset();
    }
    this.redrawStepper();
  }

  /**
   * Hack for manually redrawing MatStepper.
   */
  redrawStepper(): void {
    const inc = this.stepper.selectedIndex > 0 ? -1 : 1;
    this.stepper.selectedIndex = this.stepper.selectedIndex + inc;
    this.stepper.selectedIndex = this.stepper.selectedIndex - inc;
  }


  /**
   * Re-populate the patient table
   * @private
   */
  private loadPatientsData(
    data: Patient[],
    fromResearchStudyStep = false,
    isCartApproach = false
  ): void {
    if (isCartApproach) {
      this.selectRecordsStep.completed = true;
    } else {
      this.defineCohortStep.completed = true;
    }
    const patientStream = new Subject<Patient[]>();
    this.cohort.patientStream = patientStream.asObservable();
    setTimeout(() => {
      this.stepper.next();
      if (this.rasStepCountDown) {
        this.rasStepCountDown--;
      }
      if (fromResearchStudyStep) {
        this.stepper.next();
      }
      setTimeout(() => {
        this.cohort.currentState.patients = data;
        patientStream.next(data);
        patientStream.complete();
      });
    }, 100);
  }

  /**
   * Returns the step label
   * @param step - step number
   */
  getLabel(step: Step): string {
    return this.stepDescriptions[step].label;
  }

  /**
   * Returns the previous step label
   * @param step - current step number
   */
  getPrevStepLabel(step: Step): string {
    return findLast(this.stepDescriptions.slice(0, step), (desc) =>
      desc.isVisible()
    )?.label;
  }

  /**
   * Returns the next step label
   * @param step - current step number
   */
  getNextStepLabel(step: Step): string {
    return this.stepDescriptions
      .slice(step + 1)
      .find((desc) => desc.isVisible())?.label;
  }

  /**
   * Returns the current step label
   * @param step - current step number
   */
  isVisible(step: Step): boolean {
    return this.stepDescriptions[step].isVisible();
  }

  /**
   * Returns whether RAS login is required.
   */
  isRasLoginRequired(createCohortModeValue: CreateCohortMode): boolean {
    return this.enableRas &&
      this.fhirBackend.isDbgap(this.fhirBackend.serviceBaseUrl) &&
      [CreateCohortMode.BROWSE, CreateCohortMode.SEARCH].includes(
        createCohortModeValue
      ) &&
      !this.rasToken.rasTokenValidated;
  }

  /**
   * Contact rdf-server for dbGap login, if required.
   */
  onSelectAnActionNext(createCohortModeValue: CreateCohortMode): void {
    if (this.isRasLoginRequired(createCohortModeValue)) {
      this.rasToken.login(
        this.fhirBackend.serviceBaseUrl,
        createCohortModeValue
      );
    } else {
      this.stepper.next();
    }
  }
}
