import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { APP_VERSION } from '../../shared/app-version';
import { removeUrlParam, setUrlParam } from '../../shared/utils';
import { RasTokenService } from '../../shared/ras-token/ras-token.service';
import { Step, StepperComponent } from '../stepper/stepper.component';
import { CreateCohortMode } from '../../shared/cohort/cohort.service';
import {
  ConnectionStatus,
  FhirBackendService
} from '../../shared/fhir-backend/fhir-backend.service';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  Oauth2TokenService
} from '../../shared/oauth2-token/oauth2-token.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.less'],
  standalone: false
})
export class HomeComponent implements AfterViewInit {
  version = APP_VERSION;
  @ViewChild(StepperComponent) stepperComponent: StepperComponent;

  constructor(
    public rasToken: RasTokenService,
    public fhirBackend: FhirBackendService,
    private liveAnnouncer: LiveAnnouncer,
    public oauth2Token: Oauth2TokenService
  ) {
    // Initialize FhirBackendService only on the default route which uses HomeComponent.
    fhirBackend.init();
  }

  openChangelog(): void {
    window.open(
      'https://github.com/lhncbc/fhir-obs-viewer/blob/master/CHANGELOG.md',
      '_blank',
      'noopener noreferrer'
    );
  }

  /**
   * Switch between 'alpha' and stable versions of the app.
   * Log out of RAS if it was logged in when switching.
   */
  switchVersion(): void {
    if (this.rasToken.rasTokenValidated) {
      this.rasToken.logout();
    }
    this.switchVersionUrlParam();
  }

  /**
   * Sets the "prev-version" parameter in the application URL to the opposite
   * value of the currently loaded UI. If "pre-version" = "enable" the previous
   * (legacy) UI will be used, otherwise the new table-based UI will be used.
   * @private
   */
  private switchVersionUrlParam(): void {
    if (this.fhirBackend.isPreviousVersion) {
      window.location.href = removeUrlParam('prev-version');
    } else {
      window.location.href = setUrlParam('prev-version', 'enable');
    }
  }

  /**
   * Initiate login through OAuth2.
   */
  onOauth2Login(): void {
    this.oauth2Token.login(this.fhirBackend.serviceBaseUrl);
  }

  private returnToSettingsPage(): void {
    if (this.stepperComponent.stepper.selectedIndex !== Step.SETTINGS) {
      this.stepperComponent.stepper.selectedIndex = Step.SETTINGS;
      this.liveAnnouncer.announce('Returning to settings page.');
    }
    this.stepperComponent.selectAnActionComponent?.createCohortMode.setValue(
      CreateCohortMode.UNSELECTED
    );
  }

  /**
   * Log out of a server connected through OAuth2.
   */
  onOauth2Logout(): void {
    this.oauth2Token.logout();
    this.liveAnnouncer.announce('Logged out.');
    this.returnToSettingsPage();
    // Show "Authorization required" error message below server input.
    this.fhirBackend.initialized.next(ConnectionStatus.Oauth2Required);
    this.stepperComponent.settingsPageComponent.settingsFormGroup.get('serviceBaseUrl').updateValueAndValidity();
  }

  onRasLogout(): void {
    this.rasToken.logout();
    this.liveAnnouncer.announce('Logged out.');
    this.returnToSettingsPage();
  }

  onSmartLogout(): void {
    window.history.pushState({}, '', setUrlParam('isSmart', 'false'));
    this.fhirBackend.isSmartOnFhir = false;
    this.liveAnnouncer.announce('Logged out from SMART on FHIR connection.');
  }

  /**
   * Handles a click on the "Change ScrubberID" link - opens a dialog to select
   * ScrubberID.
   */
  onChangeScrubberID(): void {
    this.fhirBackend.selectScrubberId(true).then((scrubberID) => {
      if (scrubberID !== false && scrubberID !== this.fhirBackend.fhirClient.getScrubberIDHeader()) {
        // If the "Cancel" button was not pressed, apply changes
        this.fhirBackend.fhirClient.setScrubberIDHeader(scrubberID);
        // Reset interface
        this.returnToSettingsPage();
        // Reinitialize the FHIR client to ensure the latest ScrubberID works.
        this.fhirBackend.fhirClient._serviceBaseUrl = '';
        this.stepperComponent.settingsPageComponent.settingsFormGroup.get('serviceBaseUrl').updateValueAndValidity();
      }
    });
  }

  ngAfterViewInit(): void {
    // Display shared header/footer after Angular page loads.
    document.getElementById('sharedHeader').style.display = 'block';
    document.getElementById('sharedFooter').style.display = 'block';
    // Create a script tag to load shared nav links.
    // Angular removes any <script> tag in component templates for security reasons.
    const s = document.createElement('script');
    s.src = 'https://lhcforms.nlm.nih.gov/shared/loadSharedNavLinks.js';
    document.body.appendChild(s);
  }

  /**
   * Returns the display text for the ScrubberID link.
   *
   * @returns {string} The link text showing the current ScrubberID or a prompt to select one.
   */
  getScrubberIdLinkText(): string {
    const scrubberID = this.fhirBackend.fhirClient.getScrubberIDHeader();
    return scrubberID ? 'ScrubberID: ' + scrubberID : 'Select ScrubberID';
  }
}
