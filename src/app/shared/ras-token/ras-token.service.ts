/**
 * This is a singleton service that manages RAS(OIDC) connection state.
 */
import { Injectable } from '@angular/core';
import { CreateCohortMode } from '../cohort/cohort.service';
import { Step } from '../../modules/stepper/step.enum';

@Injectable({
  providedIn: 'root'
})
export class RasTokenService {
  public rasTokenValidated = false;

  // A flag that is set to true only during RAS callback navigation to
  // automatically move to next steps.
  public isRasCallbackNavigation = false;

  public errorMessage = '';

  constructor() {
    // If user is logged in and refreshes the page, we keep the login state.
    if (sessionStorage.getItem('dbgapTstToken')) {
      this.rasTokenValidated = true;
    }
  }

  /**
   * Initiates login to RAS
   * @param serviceBaseUrl - FHIR REST API Service Base URL
   *   (See https://www.hl7.org/fhir/http.html#root)
   * @param createCohortMode - selected cohort creation mode
   * @param currentStepperIndex - user's current step in StepperComponent
   * @param goNextStep - whether the system should bring user to the next step
   *   after currentStepperIndex. This should be true if this login is triggered by
   *   clicking the "next step" button on the stepper.
   */
  login(
    serviceBaseUrl: string,
    createCohortMode: CreateCohortMode,
    currentStepperIndex = Step.SELECT_AN_ACTION.valueOf(),
    goNextStep = true
  ): void {
    sessionStorage.setItem('dbgapRasLoginServer', serviceBaseUrl);
    // Store user's selection, so it can be restored after successful RAS connection.
    sessionStorage.setItem('selectedCreateCohortMode', createCohortMode);
    sessionStorage.setItem(
      'currentStepperIndex',
      currentStepperIndex.toString()
    );
    sessionStorage.setItem('goNextStep', goNextStep.toString());
    // Contact rdf-server for RAS login. '/rdf-server' queries are proxy forwarded
    // to rdf-server (see src/proxy.conf.json).
    window.location.href = `${window.location.origin}/rdf-server/login`;
  }

  /**
   * Logs out of RAS.
   */
  logout(): void {
    sessionStorage.removeItem('dbgapRasLoginServer');
    this.rasTokenValidated = false;
    sessionStorage.clear();
  }
}
