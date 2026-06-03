// Plugins enable you to tap into, modify, or extend the internal behavior of Cypress
// For more info, visit https://on.cypress.io/plugins-api
import * as fs from 'fs';
import * as webpackPreprocessor from '@cypress/webpack-preprocessor';
import webpackConfig from '../cypress.webpack.config.js';

export default function (on, config) {
  on('task', {
    removeCohortFileIfExist(): null {
      const cohortFile = `${config.downloadsFolder}/cohort-100.json`;
      if (fs.existsSync(cohortFile)) {
        fs.unlinkSync(cohortFile);
      }
      return null;
    }
  });
  // Fixed e2e tests after migrating from Angular 12 to 14
  // The idea was taken from the comments on this issue:
  // https://github.com/cypress-io/cypress/issues/19066
  on(
    'file:preprocessor',
    webpackPreprocessor({
      webpackOptions: webpackConfig
    })
  );
  return config;
};
