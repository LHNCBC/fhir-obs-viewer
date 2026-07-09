import { BrowserModule } from '@angular/platform-browser';
import { NgModule, inject, provideAppInitializer } from '@angular/core';
import { AppComponent } from './app.component';
import {
  MAT_FORM_FIELD_DEFAULT_OPTIONS,
  MatFormFieldDefaultOptions
} from '@angular/material/form-field';
import { SettingsService } from './shared/settings-service/settings.service';
import { AppRoutingModule } from './app-routing.module';
import { HomeModule } from './modules/home/home.module';
import {
  RasTokenCallbackModule
} from './modules/ras-token-callback/ras-token-callback.module';
import { LaunchModule } from './modules/launch/launch.module';
import { AnnouncerModule } from './shared/announcer/announcer.module';
import {
  MAT_TOOLTIP_DEFAULT_OPTIONS,
  type MatTooltipDefaultOptions
} from '@angular/material/tooltip';
import {
  Oauth2TokenCallbackModule
} from './modules/oauth2-token-callback/oauth2-token-callback.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule } from 'ngx-toastr';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import {
  ToastrInterceptor
} from './shared/http-interceptors/toastr-interceptor';
import {
  AriaDescriberService
} from './shared/aria-tweaks/aria-describer.service';
import { AriaDescriber } from '@angular/cdk/a11y';

const appearance: MatFormFieldDefaultOptions = {
  // subscriptSizing: 'dynamic',
  appearance: 'outline'
};

const myCustomTooltipDefaults: MatTooltipDefaultOptions = {
  showDelay: 0,
  hideDelay: 0,
  touchendHideDelay: 1500,
  disableTooltipInteractivity: true
};

/**
 * Application initializer.
 * See https://angular.io/api/core/APP_INITIALIZER for details.
 */
function initializeApp(settingsService: SettingsService): () => Promise<any> {
  return () => settingsService.loadJsonConfig().toPromise();
}

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    AnnouncerModule,
    AppRoutingModule,
    HomeModule,
    RasTokenCallbackModule,
    Oauth2TokenCallbackModule,
    LaunchModule,
    BrowserAnimationsModule,
    ToastrModule.forRoot()
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: ToastrInterceptor, multi: true },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: appearance
    },
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: myCustomTooltipDefaults
    },
    provideAppInitializer(() => {
        const initializerFn = (initializeApp)(inject(SettingsService));
        return initializerFn();
      }),
    AriaDescriberService,
    {
      provide: AriaDescriber,
      useExisting: AriaDescriberService
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
