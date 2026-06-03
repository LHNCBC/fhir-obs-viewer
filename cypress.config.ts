import { defineConfig } from 'cypress'
import plugins from './test/cypress/plugins';

export default defineConfig({
  videosFolder: 'test/cypress/videos',
  screenshotsFolder: 'test/cypress/screenshots',
  fixturesFolder: 'test/cypress/fixtures',
  video: true,
  downloadsFolder: 'test/cypress/downloads',
  e2e: {
    testIsolation: false,
    // We've imported your old cypress plugins here.
    // You may want to clean this up later by importing these.
    setupNodeEvents(on, config) {
      return plugins(on, config)
    },
    specPattern: 'test/cypress/integration/**/*.cy.{js,jsx,ts,tsx}',
    supportFile: 'test/cypress/support/index.ts',
    baseUrl: 'http://localhost:8100/fhir/research-data-finder',
  },
})
