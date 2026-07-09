// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // The codebase predates these rules and intentionally uses the
      // pre-existing patterns (NgModules + constructor DI, explicit `any`
      // in places interacting with FHIR JSON, index signatures, empty
      // lifecycle hooks, etc.). They were not enforced under the prior
      // tslint configuration; keep them off to preserve project style.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-indexed-object-style": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/prefer-for-of": "off",
      "@typescript-eslint/ban-tslint-comment": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "@angular-eslint/prefer-inject": "off",
      "@angular-eslint/prefer-standalone": "off",
      "@angular-eslint/no-empty-lifecycle-method": "off",
      "@angular-eslint/no-input-rename": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-async-promise-executor": "off",
      "no-case-declarations": "off",
      "no-cond-assign": "off",
      "no-misleading-character-class": "off",
      "no-fallthrough": "off",
      "prefer-const": "off",
      "prefer-rest-params": "off",
      "prefer-spread": "off",
    },
  },
  {
    // The `query-builder` directory is a vendored copy of an external
    // library (ngx-angular-query-builder); keep its original selectors
    // and patterns untouched.
    files: ["src/query-builder/**/*.ts"],
    rules: {
      "@angular-eslint/directive-selector": "off",
      "@angular-eslint/component-selector": "off",
    },
  },
  {
    // Directives below intentionally augment Angular Material / Forms
    // host elements (mat-step, [formControl], [ngModel], [tabToSelect],
    // [dialogTitle], etc.) and therefore cannot adopt the `app` prefix.
    files: [
      "src/app/shared/announce-if-active/**/*.ts",
      "src/app/shared/custom-dialog/**/*.ts",
      "src/app/shared/error-manager/form-control-collector.directive.ts",
      "src/app/shared/tab-to-select/**/*.ts",
    ],
    rules: {
      "@angular-eslint/directive-selector": "off",
    },
  },
  {
    // Test-only host/child components in *.spec.ts files use ad-hoc
    // selectors that are never rendered in the app.
    files: ["**/*.spec.ts"],
    rules: {
      "@angular-eslint/component-selector": "off",
      "@angular-eslint/directive-selector": "off",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {
      // The codebase still uses structural directives (*ngIf / *ngFor /
      // *ngSwitch) throughout; allow them rather than rewriting every
      // template to the new control-flow syntax.
      "@angular-eslint/template/prefer-control-flow": "off",
      // The remaining a11y/template rules below flag patterns that the
      // project intentionally keeps; revisit individually if/when those
      // templates are refactored.
      "@angular-eslint/template/label-has-associated-control": "off",
      "@angular-eslint/template/click-events-have-key-events": "off",
      "@angular-eslint/template/interactive-supports-focus": "off",
      "@angular-eslint/template/elements-content": "off",
    },
  },
]);
