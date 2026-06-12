// Plugins enable you to tap into, modify, or extend the internal behavior of Cypress
// For more info, visit https://on.cypress.io/plugins-api
import * as fs from 'fs';

/**
 * Registers Cypress plugin tasks used by e2e tests.
 * @param on - Cypress event registration function.
 * @param config - Cypress resolved plugin configuration.
 * @returns The Cypress configuration.
 */
export default function (on, config) {
  on('task', {
    /**
     * Removes the downloaded cohort file if it exists.
     * @returns `null` after the task completes.
     */
    removeCohortFileIfExist(): null {
      const cohortFile = `${config.downloadsFolder}/cohort-100.json`;
      if (fs.existsSync(cohortFile)) {
        fs.unlinkSync(cohortFile);
      }
      return null;
    }
  });
  return config;
};
